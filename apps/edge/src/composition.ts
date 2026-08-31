/**
 * The composition root. The one place allowed to reach below the query layer.
 *
 * `apps/api/src/config.ts` refuses to build one of these, and says why: "building
 * one would mean importing `@data-foundry/canonical-store` here to open a
 * driver, and a single import is all it takes for the next handler to reach
 * through it." That reasoning is about a *handler* package. Somebody still has
 * to open the driver, and a composition root is the thing whose whole job is to
 * do it once, at the edge of the process, and hand down only what each layer may
 * see. The API app receives a `QueryModel` and cannot reach past it, which is
 * the property `config.ts` was protecting, preserved rather than traded away.
 *
 * Nothing here interprets a request. It builds the object graph and caches it.
 */
import {
  createCanonicalStore,
  createHyperdriveDriver,
  createPostgresDriver,
  DATA_FOUNDRY_PRIVATE_SCHEMA,
  type PostgresDriverOptions,
  type SqlDriver,
} from '@data-foundry/canonical-store';
import { createQueryModel } from '@data-foundry/query-model';
import { createApiApp, type ApiHandler } from '@data-foundry/api';
import type { Slug, VerticalId } from '@data-foundry/canonical-schema';
import { EdgeConfigurationError, resolveEdgeConfig, type EdgeEnv } from './env.js';

export interface VerticalRuntime {
  readonly vertical_slug: string;
  readonly fields: readonly unknown[];
  readonly fact_selection: Readonly<Record<string, unknown>>;
}

export interface EdgeDeployment {
  readonly app: ApiHandler;
  readonly verticalId: VerticalId;
  /**
   * The same pooled connection `app` reads canonical data through, exposed
   * for the one other thing that needs a database round trip before `app` is
   * ever called: looking up a presented API key. Deliberately the raw
   * `SqlDriver`, not a second store — the auth lookup is portable SQL against
   * tables the canonical store has no reason to know exist, and opening a
   * second pool for it would spend the connection budget Hyperdrive exists to
   * conserve.
   */
  readonly driver: SqlDriver;
  readonly close: () => Promise<void>;
}

/**
 * One deployment per isolate, keyed by what would change it.
 *
 * Local direct-Postgres development may cache a pool per isolate. Hyperdrive
 * deployments deliberately do not: Cloudflare requires a fresh pg Client per
 * Worker invocation and provides the upstream pool itself.
 */
const deployments = new Map<string, Promise<EdgeDeployment>>();

export interface BuildOptions {
  readonly env: EdgeEnv;
  readonly runtime: VerticalRuntime;
  /** Swappable so tests can compose against PGlite without a network. */
  readonly openDriver?: (
    connectionString: string,
    options?: PostgresDriverOptions,
  ) => Promise<SqlDriver>;
  readonly onError?: (error: unknown, context: { readonly path: string }) => void;
}

async function build(options: BuildOptions): Promise<EdgeDeployment> {
  const config = resolveEdgeConfig(options.env);
  if (options.runtime.vertical_slug !== config.verticalSlug) {
    throw new EdgeConfigurationError(
      `This Worker bundles the "${options.runtime.vertical_slug}" runtime but VERTICAL_SLUG is ` +
        `"${config.verticalSlug}". Deploy the Worker built for that vertical rather than ` +
        're-pointing this one: the bundled field metadata is not interchangeable.',
    );
  }

  const open = options.openDriver ?? (
    options.env.HYPERDRIVE === undefined ? createPostgresDriver : createHyperdriveDriver
  );
  const driver = await open(
    config.connectionString,
    config.deploymentEnvironment === 'production'
      ? { schema: DATA_FOUNDRY_PRIVATE_SCHEMA }
      : undefined,
  );

  // Everything past this line owns an open pool, so every path out of it has to
  // give the pool back. Closing only on the branch that *returns* null was the
  // original shape of this function, and it leaked on the branch that throws —
  // which is the one a database outage takes, and the one whose retries leak
  // fastest. Found in review; `test/composition.test.ts` pins both.
  try {
    const store = createCanonicalStore(driver);

    const vertical = await store.getVerticalBySlug(config.verticalSlug as Slug);
    if (vertical === null) {
      throw new EdgeConfigurationError(
        `Vertical "${config.verticalSlug}" is not present in this database. ` +
          'Apply migrations and run an ingestion before serving.',
      );
    }

    const queryModel = createQueryModel(store, { fields: options.runtime.fields as never });

    const app = createApiApp({
      queryModel,
      verticalId: vertical.id,
      // The compiled policy, verbatim. This surface never accepts one from a
      // request: a client that could set `requirePublishableRights: false` would
      // have a rule-1 bypass in a query string.
      factSelection: options.runtime.fact_selection as never,
      ...(options.onError === undefined
        ? {}
        : {
            onError: (error: unknown, context: { readonly path: string }) => {
              options.onError?.(error, context);
            },
          }),
    });

    return { app, verticalId: vertical.id, driver, close: () => driver.close() };
  } catch (error) {
    // The close is best-effort and deliberately silent. A pool that fails to
    // shut down while the build is already failing must not replace the
    // diagnosis: an operator shown a close() error instead of
    // `relation "verticals" does not exist` goes looking at connection pooling
    // rather than at their migrations.
    await driver.close().catch(() => undefined);
    throw error;
  }
}

export function getDeployment(options: BuildOptions): Promise<EdgeDeployment> {
  const config = resolveEdgeConfig(options.env);
  // A Hyperdrive client is owned by one Worker invocation. Caching this graph
  // would retain its I/O object across requests, which Cloudflare forbids.
  if (options.env.HYPERDRIVE !== undefined) return build(options);

  const key = `${config.deploymentEnvironment} ${config.verticalSlug} ${config.connectionString}`;
  const existing = deployments.get(key);
  if (existing !== undefined) return existing;

  // Cache the promise, not the result: two requests arriving before the first
  // pool is open must share it rather than open a second.
  const pending = build(options).catch((error: unknown) => {
    // A failed build must not stay cached, or one transient outage at cold
    // start would wedge the isolate until it was recycled.
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
