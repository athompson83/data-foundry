/**
 * The composition root. The one place in this app allowed to reach below the
 * query layer (AGENTS.md rule 5) — same discipline as `apps/edge/src/composition.ts`.
 *
 * The one real difference from `apps/edge`: that Worker composes ONE vertical
 * per deployment, because a `QueryModel` carries exactly one vertical's field
 * metadata and a metered API is deliberately siloed per industry. This Worker
 * is the opposite by design (ADR-0011): it is the single parent site plus
 * every child industry site, so it opens ONE database connection and builds
 * one `QueryModel` per vertical the bundle carries AND the database actually
 * holds. A vertical that is compiled into the bundle but not yet ingested into
 * this database is not an error — it is simply not offered, so a child site
 * can exist in code before it exists in data without taking the parent site
 * down with it.
 */
import {
  createCanonicalStore,
  createHyperdriveDriver,
  createPostgresDriver,
  DATA_FOUNDRY_PRIVATE_SCHEMA,
  type CanonicalStore,
  type PostgresDriverOptions,
  type SqlDriver,
} from '@data-foundry/canonical-store';
import {
  createQueryModel,
  type SurfaceReadSnapshot,
  type SurfaceQueryModel,
} from '@data-foundry/query-model';
import { resolvePrivateCanaryConnectionString } from '@data-foundry/private-canary';
import type { IsoDateTime, VerticalId } from '@data-foundry/canonical-schema';
import { resolveWebConfig, type WebEnv } from './env.js';
import type { PublicCacheMode } from './http.js';
import type { WebRuntime } from './seo.js';

export interface VerticalDeployment {
  readonly slug: string;
  readonly verticalId: VerticalId;
  /** All human-visible reads are irreversibly bound to PUBLIC_WEB rights. */
  readonly publicQueryModel: SurfaceQueryModel;
  /** Sitemap eligibility is independently bound to SEARCH_INDEX rights. */
  readonly searchIndexQueryModel: SurfaceQueryModel;
  readonly runtime: WebRuntime;
}

export interface CachedVerticalDeployment {
  readonly slug: string;
  readonly verticalId: VerticalId;
  /** The canonical graph stays captured here; callers receive only safe surfaces. */
  readonly bindRequestSurfaces: (
    asOf: IsoDateTime,
    snapshot?: SurfaceReadSnapshot,
  ) => {
    readonly publicQueryModel: SurfaceQueryModel;
    readonly searchIndexQueryModel: SurfaceQueryModel;
  };
  readonly runtime: WebRuntime;
}

export interface WebDeployment {
  readonly publicOrigin: string;
  readonly cacheMode: PublicCacheMode;
  /** Keyed by vertical slug. Only verticals present in BOTH the bundle and the database. */
  readonly verticals: ReadonlyMap<string, CachedVerticalDeployment>;
  /**
   * Materialize every vertical on one request-owned database snapshot. The
   * opaque query-layer token never leaves this composition root.
   */
  readonly withRequestSnapshot: <T>(
    asOf: IsoDateTime,
    run: (deployment: RequestWebDeployment) => Promise<T>,
  ) => Promise<T>;
  readonly close: () => Promise<void>;
}

export interface RequestWebDeployment {
  readonly publicOrigin: string;
  /** Optional only so narrow routing tests can supply a static deployment fixture. */
  readonly cacheMode?: PublicCacheMode;
  /** Fresh surface bindings, shared only within this one request. */
  readonly verticals: ReadonlyMap<string, VerticalDeployment>;
}

export interface BuildOptions {
  readonly env: WebEnv;
  /** Every vertical this Worker's bundle carries, keyed by slug. */
  readonly runtimes: Readonly<Record<string, WebRuntime>>;
  /** Swappable so tests can compose against PGlite without a network. */
  readonly openDriver?: (
    connectionString: string,
    options?: PostgresDriverOptions,
  ) => Promise<SqlDriver>;
  readonly onWarning?: (message: string) => void;
}

/**
 * A route-less, service-bound database check. Keeping this in the composition
 * root preserves the Web surface boundary: page and RPC adapters never open a
 * driver or issue SQL themselves.
 */
export interface PrivateCanaryDatabaseProbeOptions {
  readonly env: WebEnv;
  readonly openDriver?: (
    connectionString: string,
    options?: PostgresDriverOptions,
  ) => Promise<SqlDriver>;
}

export async function probePrivateCanaryDatabase(
  options: PrivateCanaryDatabaseProbeOptions,
): Promise<void> {
  const connectionString = resolvePrivateCanaryConnectionString(options.env);
  const open = options.openDriver ?? createHyperdriveDriver;
  const driver = await open(connectionString, { schema: DATA_FOUNDRY_PRIVATE_SCHEMA });
  try {
    const [row] = await driver.query<{ readonly ready: unknown }>('SELECT 1 AS ready');
    if (row?.ready !== 1) throw new Error('Private canary database readiness failed.');
  } finally {
    await driver.close().catch(() => undefined);
  }
}

async function buildVertical(
  store: CanonicalStore,
  runtime: WebRuntime,
): Promise<CachedVerticalDeployment | null> {
  const vertical = await store.getVerticalBySlug(runtime.vertical_slug as never);
  if (vertical === null) return null;

  const queryModel = createQueryModel(store, { fields: runtime.fields as never });
  return {
    slug: runtime.vertical_slug,
    verticalId: vertical.id,
    bindRequestSurfaces: (asOf, snapshot) => ({
      publicQueryModel: queryModel.forSurface('PUBLIC_WEB', { asOf }, snapshot),
      searchIndexQueryModel: queryModel.forSurface('SEARCH_INDEX', { asOf }, snapshot),
    }),
    runtime,
  };
}

/**
 * Bind one immutable rights snapshot for one web request. Both surface models
 * receive the exact same instant while retaining their own request-local
 * rights context/result memoization.
 */
export function materializeRequestDeployment(
  deployment: WebDeployment,
  asOf: IsoDateTime,
  snapshot?: SurfaceReadSnapshot,
): RequestWebDeployment {
  const verticals = new Map<string, VerticalDeployment>();
  for (const [slug, vertical] of deployment.verticals) {
    const surfaces = vertical.bindRequestSurfaces(asOf, snapshot);
    verticals.set(slug, {
      slug: vertical.slug,
      verticalId: vertical.verticalId,
      ...surfaces,
      runtime: vertical.runtime,
    });
  }
  return { publicOrigin: deployment.publicOrigin, cacheMode: deployment.cacheMode, verticals };
}

async function build(options: BuildOptions): Promise<WebDeployment> {
  const config = resolveWebConfig(options.env);
  const open = options.openDriver ?? (
    options.env.HYPERDRIVE === undefined ? createPostgresDriver : createHyperdriveDriver
  );
  const driver = await open(
    config.connectionString,
    config.deploymentEnvironment === 'production'
      ? { schema: DATA_FOUNDRY_PRIVATE_SCHEMA }
      : undefined,
  );

  // Same leak discipline as apps/edge/src/composition.ts: everything past this
  // line owns an open pool, so every path out — including the one that throws —
  // must give it back.
  try {
    const store = createCanonicalStore(driver);
    const snapshotCoordinator = createQueryModel(store);
    const verticals = new Map<string, CachedVerticalDeployment>();

    for (const runtime of Object.values(options.runtimes)) {
      const deployed = await buildVertical(store, runtime);
      if (deployed === null) {
        options.onWarning?.(
          `Vertical "${runtime.vertical_slug}" is compiled into this bundle but not present ` +
            'in this database. Its pages will 404 until it is migrated and ingested.',
        );
        continue;
      }
      verticals.set(runtime.vertical_slug, deployed);
    }

    const deployment: WebDeployment = {
      publicOrigin: config.publicOrigin,
      cacheMode: config.cacheMode,
      verticals,
      withRequestSnapshot: (asOf, run) =>
        snapshotCoordinator.withSurfaceSnapshot((snapshot) =>
          run(materializeRequestDeployment(deployment, asOf, snapshot)),
        ),
      close: () => driver.close(),
    };
    return deployment;
  } catch (error) {
    await driver.close().catch(() => undefined);
    throw error;
  }
}

/** Local direct-Postgres deployments may cache their pool; Hyperdrive may not. */
const deployments = new Map<string, Promise<WebDeployment>>();

export function getDeployment(options: BuildOptions): Promise<WebDeployment> {
  const config = resolveWebConfig(options.env);
  if (options.env.HYPERDRIVE !== undefined) return build(options);

  const key = JSON.stringify([
    config.deploymentEnvironment,
    config.connectionString,
    config.publicOrigin,
    config.cacheMode,
  ]);
  const existing = deployments.get(key);
  if (existing !== undefined) return existing;

  const pending = build(options).catch((error: unknown) => {
    deployments.delete(key);
    throw error;
  });
  deployments.set(key, pending);
  return pending;
}

/** Test seam: drop cached deployments so a suite can build a fresh graph. */
export function resetDeployments(): void {
  deployments.clear();
}
