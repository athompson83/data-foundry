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
  createPostgresDriver,
  type CanonicalStore,
  type SqlDriver,
} from '@data-foundry/canonical-store';
import { createQueryModel, type SurfaceQueryModel } from '@data-foundry/query-model';
import type { VerticalId } from '@data-foundry/canonical-schema';
import { resolveWebConfig, type WebEnv } from './env.js';
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

export interface WebDeployment {
  readonly publicOrigin: string;
  /** Keyed by vertical slug. Only verticals present in BOTH the bundle and the database. */
  readonly verticals: ReadonlyMap<string, VerticalDeployment>;
  readonly close: () => Promise<void>;
}

export interface BuildOptions {
  readonly env: WebEnv;
  /** Every vertical this Worker's bundle carries, keyed by slug. */
  readonly runtimes: Readonly<Record<string, WebRuntime>>;
  /** Swappable so tests can compose against PGlite without a network. */
  readonly openDriver?: (connectionString: string) => Promise<SqlDriver>;
  readonly onWarning?: (message: string) => void;
}

async function buildVertical(
  store: CanonicalStore,
  runtime: WebRuntime,
): Promise<VerticalDeployment | null> {
  const vertical = await store.getVerticalBySlug(runtime.vertical_slug as never);
  if (vertical === null) return null;

  const queryModel = createQueryModel(store, { fields: runtime.fields as never });
  return {
    slug: runtime.vertical_slug,
    verticalId: vertical.id,
    publicQueryModel: queryModel.forSurface('PUBLIC_WEB'),
    searchIndexQueryModel: queryModel.forSurface('SEARCH_INDEX'),
    runtime,
  };
}

async function build(options: BuildOptions): Promise<WebDeployment> {
  const config = resolveWebConfig(options.env);
  const open = options.openDriver ?? createPostgresDriver;
  const driver = await open(config.connectionString);

  // Same leak discipline as apps/edge/src/composition.ts: everything past this
  // line owns an open pool, so every path out — including the one that throws —
  // must give it back.
  try {
    const store = createCanonicalStore(driver);
    const verticals = new Map<string, VerticalDeployment>();

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

    return { publicOrigin: config.publicOrigin, verticals, close: () => driver.close() };
  } catch (error) {
    await driver.close().catch(() => undefined);
    throw error;
  }
}

/** One deployment per isolate, keyed by what would change it — same reasoning as `apps/edge`. */
const deployments = new Map<string, Promise<WebDeployment>>();

export function getDeployment(options: BuildOptions): Promise<WebDeployment> {
  const config = resolveWebConfig(options.env);
  const key = JSON.stringify([config.connectionString, config.publicOrigin]);
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
