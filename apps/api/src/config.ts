/**
 * What an API deployment is configured with.
 *
 * Note what is absent: no connection string, no `CanonicalStore`, no driver.
 * The app is handed a `QueryModel` and can reach nothing beneath it — that is
 * the same dependency-injection shape the query layer's own doc comment
 * prescribes for trusted infrastructure, applied in reverse to an untrusted
 * surface. There is deliberately no composition root in this package: building
 * one would mean importing `@data-foundry/canonical-store` here to open a
 * driver, and a single import is all it takes for the next handler to reach
 * through it.
 *
 * `factSelection` is the deployment's compiled doc-04 policy. Its type is
 * derived from `QueryModel`'s own signature rather than imported by name from
 * the store package, so this file names nothing below the query layer at all.
 */
import type { QueryModel, SurfaceQueryModel } from '@data-foundry/query-model';
import type { IsoDateTime, VerticalId } from '@data-foundry/canonical-schema';
import type { RouteKey } from './routes.js';
import type { ApiRequestAccess } from './http.js';

/** The fact-selection policy shape, taken from the query layer's signature. */
export type ApiFactSelectionPolicy = NonNullable<Parameters<QueryModel['canonicalFacts']>[1]>;

export interface ApiErrorContext {
  readonly method: string;
  readonly path: string;
  readonly requestId?: string;
}

/**
 * What happened, for whoever meters requests — never what was asked for.
 *
 * `routeKey` is a member of the closed accounting vocabulary declared in
 * `routes.ts`. It contains no slash or interpolation slot, so no request path,
 * query string, entity identifier, or response content can enter metering.
 */
export interface ApiRequestTelemetry {
  readonly method: string;
  readonly routeKey: RouteKey;
  readonly status: number;
}

export interface ApiAppOptions {
  readonly queryModel: QueryModel;
  /**
   * The vertical this deployment serves. One vertical per app: a `QueryModel`
   * carries exactly one vertical's field metadata, so an instance that served
   * two would be faceting one vertical's entities with another's declarations.
   */
  readonly verticalId: VerticalId;
  /**
   * Doc-04 fact selection. Passed straight to the query layer; this surface
   * never edits it and never accepts one from a request — a client that could
   * set `requirePublishableRights: false` would have a rule-1 bypass in a query
   * string.
   */
  readonly factSelection?: ApiFactSelectionPolicy;
  /**
   * Where the real error goes. Response bodies carry an opaque code; operators
   * need the cause, and this is the only channel that gets it. Defaults to
   * doing nothing so tests stay silent.
   */
  readonly onError?: (error: unknown, context: ApiErrorContext) => void;
}

interface ApiContextValues {
  readonly verticalId: VerticalId;
  readonly factSelection: ApiFactSelectionPolicy;
  /**
   * Every reviewer named anywhere in the policy. The reviewer-identity guard at
   * the wire boundary needs the names to look for, and the policy is the only
   * place they are declared.
   */
  readonly reviewers: readonly string[];
  readonly version: string;
}

/** Everything a matched route handler is allowed to see. */
export interface ApiContext extends ApiContextValues {
  readonly queryModel: SurfaceQueryModel;
}

/**
 * Request metadata plus the only safe path into the query layer.
 *
 * The raw `QueryModel` and the opaque snapshot token stay captured here. A
 * dispatcher can run one matched handler with a token-bound surface facade,
 * but cannot leak either capability into routing or service-document paths.
 */
export interface ApiRequestContext extends ApiContextValues {
  readonly withSurfaceSnapshot: <T>(
    run: (context: ApiContext) => Promise<T>,
  ) => Promise<T>;
}

export function resolveContext(
  options: ApiAppOptions,
  version: string,
  access: ApiRequestAccess,
): ApiRequestContext {
  const factSelection = options.factSelection ?? {};
  const reviewers = (factSelection.editorialOverrides ?? [])
    .map((override) => override.reviewer)
    .filter((reviewer) => reviewer.trim() !== '');
  const rightsAsOf = new Date().toISOString() as IsoDateTime;
  const values: ApiContextValues = {
    verticalId: options.verticalId,
    factSelection,
    reviewers,
    version,
  };
  return {
    ...values,
    withSurfaceSnapshot: (run) => options.queryModel.withSurfaceSnapshot((snapshot) =>
      run({
        ...values,
        queryModel: options.queryModel.forSurface(
          access.surface,
          { asOf: rightsAsOf },
          snapshot,
        ),
      }),
    ),
  };
}
