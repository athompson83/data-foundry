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
  createPostgresDriver,
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
  readonly close: () => Promise<void>;
}

/**
 * One deployment per isolate, keyed by what would change it.
 *
 * A Worker isolate serves many requests. Opening a pool per request would spend
 * the connection budget Hyperdrive exists to conserve, so the graph is built
 * once and reused. The key is the connection string and vertical rather than a
 * bare singleton, so a test that builds two differently-configured deployments
 * gets two, instead of silently receiving the first one back.
 */
const deployments = new Map<string, Promise<EdgeDeployment>>();

export interface BuildOptions {
  readonly env: EdgeEnv;
  readonly runtime: VerticalRuntime;
  /** Swappable so tests can compose against PGlite without a network. */
  readonly openDriver?: (connectionString: string) => Promise<SqlDriver>;
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

  const open = options.openDriver ?? createPostgresDriver;
  const driver = await open(config.connectionString);
  const store = createCanonicalStore(driver);

  const vertical = await store.getVerticalBySlug(config.verticalSlug as Slug);
  if (vertical === null) {
    await driver.close();
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

  return { app, verticalId: vertical.id, close: () => driver.close() };
}

export function getDeployment(options: BuildOptions): Promise<EdgeDeployment> {
  const config = resolveEdgeConfig(options.env);
  const key = `${config.verticalSlug} ${config.connectionString}`;
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
