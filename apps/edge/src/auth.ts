/**
 * Authenticate a bearer token, resolve its tenant, and enforce scope — before
 * the request reaches `apps/api`.
 *
 * `packages/api-keys` proves a presented secret hashes to a stored value and
 * says whether that stored key is currently usable; it has no database and no
 * opinion about tenants. This module is the composition-root wiring that
 * closes the loop: it looks the hash up (through the same `SqlExecutor` the
 * canonical store already opened — one pooled connection, not a second one),
 * asks `packages/api-keys` what the row means, and adds the two checks that
 * only make sense once a tenant exists: is the *tenant* still allowed to call
 * at all, and does this *key* cover the vertical this deployment serves.
 *
 * Every failure here is reject-before-execution by construction: this
 * function returns before `composition.ts` ever builds a `QueryModel` call,
 * so there is no code path where a rejected request has already touched
 * canonical data.
 */
import {
  evaluateStoredKey,
  hashApiKey,
  isApiAccessClassification,
  keyEnvironment,
  looksLikeApiKey,
  readBearerToken,
  type KeyEnvironment,
  type ApiAccessTier,
  type ApiBillingSource,
  type StoredApiKey,
} from '@data-foundry/api-keys';
import type { SqlExecutor } from '@data-foundry/canonical-store';

/**
 * Every way a request can fail to authenticate or fail to be in scope.
 *
 * Deliberately one flat union rather than two (authn vs. authz): the HTTP
 * status is what a caller acts on, and `toAuthResponse` is the only place
 * that maps a reason to one. Keeping the reasons together here means that
 * mapping cannot drift out of sync with the set of reasons that exist.
 */
export type AuthFailureReason =
  | 'MISSING_CREDENTIAL'
  | 'MALFORMED_CREDENTIAL'
  | 'UNKNOWN_KEY'
  | 'REVOKED'
  | 'EXPIRED'
  | 'WRONG_ENVIRONMENT'
  | 'TENANT_SUSPENDED'
  | 'TENANT_CLOSED'
  | 'TENANT_INACTIVE'
  | 'WRONG_VERTICAL'
  | 'ACCESS_PROFILE_MISSING'
  | 'WRONG_BILLING_SOURCE';

export interface AuthSuccess {
  readonly ok: true;
  readonly tenantId: string;
  readonly apiKeyId: string;
  readonly verticalId: string;
  readonly accessTier: ApiAccessTier;
  readonly billingSource: ApiBillingSource;
}

export interface AuthFailure {
  readonly ok: false;
  readonly reason: AuthFailureReason;
}

export type AuthResult = AuthSuccess | AuthFailure;

/**
 * The row shape this module reads. A superset of `StoredApiKey` for the
 * fields `packages/api-keys` does not need to know exist. An intersection
 * with an index signature, not an `interface extends`, because the driver's
 * `query<R extends SqlRow>` constrains `R` to have one.
 */
type ApiKeyRow = StoredApiKey & {
  readonly vertical_id: string;
  readonly access_tier: string | null;
  readonly billing_source: string | null;
} & Record<string, unknown>;

type ApiTenantRow = { readonly id: string; readonly status: string } & Record<string, unknown>;

async function findKeyByHash(executor: SqlExecutor, tokenHash: string): Promise<ApiKeyRow | null> {
  const rows = await executor.query<ApiKeyRow>(
    `select id, tenant_id, token_hash, token_prefix, vertical_id,
            access_tier, billing_source, revoked_at, expires_at
       from api_keys
      where token_hash = $1`,
    [tokenHash],
  );
  return rows[0] ?? null;
}

async function findTenantById(executor: SqlExecutor, tenantId: string): Promise<ApiTenantRow | null> {
  const rows = await executor.query<ApiTenantRow>(
    `select id, status from api_tenants where id = $1`,
    [tenantId],
  );
  return rows[0] ?? null;
}

/**
 * The full pipeline: parse, hash, look up, evaluate, resolve tenant, enforce
 * vertical scope. One function rather than composed middleware, because every
 * step after the first needs the previous step's row and there is no request
 * state to thread between separate handlers here — `index.ts` calls this once.
 */
export interface AuthenticateOptions {
  readonly verticalId: string;
  readonly environment: KeyEnvironment;
  readonly expectedBillingSource: ApiBillingSource;
  readonly now: Date;
}

export async function authenticate(
  executor: SqlExecutor,
  authorizationHeader: string | null | undefined,
  options: AuthenticateOptions,
): Promise<AuthResult> {
  const { verticalId, environment, expectedBillingSource, now } = options;
  const token = readBearerToken(authorizationHeader);
  if (token === null) return { ok: false, reason: 'MISSING_CREDENTIAL' };

  // Reject an obviously-not-a-key value before it ever reaches the database.
  // Hashing and querying for a string that cannot possibly match is work with
  // no purpose other than a marginally slower rejection.
  if (!looksLikeApiKey(token)) return { ok: false, reason: 'MALFORMED_CREDENTIAL' };

  // Environment is encoded in a well-formed credential. Refuse the wrong
  // namespace before hashing or querying so a test key can never probe live
  // storage (and vice versa), whether or not its hash exists there.
  if (keyEnvironment(token) !== environment) {
    return { ok: false, reason: 'WRONG_ENVIRONMENT' };
  }

  const tokenHash = await hashApiKey(token);
  const row = await findKeyByHash(executor, tokenHash);
  const verdict = evaluateStoredKey(row, now, { presented: token, environment });
  if (!verdict.ok) return { ok: false, reason: verdict.reason };

  const key = verdict.key as ApiKeyRow;

  // Every key names exactly one vertical. There is no broader route- or
  // resource-level scope model yet —
  // every valid, correctly-scoped key may call every GET/HEAD route this
  // deployment exposes. AGENTS.md's scope-control rule is the reason: nothing
  // measured yet needs finer granularity than "which vertical", and inventing
  // a permissions model ahead of a second one that needs it is exactly the
  // kind of speculative generality this repository avoids.
  if (key.vertical_id !== verticalId) {
    return { ok: false, reason: 'WRONG_VERTICAL' };
  }

  const classification = {
    accessTier: key.access_tier,
    billingSource: key.billing_source,
  };
  if (!isApiAccessClassification(classification)) {
    return { ok: false, reason: 'ACCESS_PROFILE_MISSING' };
  }
  if (classification.billingSource !== expectedBillingSource) {
    return { ok: false, reason: 'WRONG_BILLING_SOURCE' };
  }

  const tenant = await findTenantById(executor, key.tenant_id);
  // Unreachable while the foreign key holds; not a case a live deployment can
  // reach, but a null-check earns its line over a non-null assertion here.
  if (tenant === null) return { ok: false, reason: 'UNKNOWN_KEY' };
  if (tenant.status === 'SUSPENDED') return { ok: false, reason: 'TENANT_SUSPENDED' };
  if (tenant.status === 'CLOSED') return { ok: false, reason: 'TENANT_CLOSED' };
  if (tenant.status !== 'ACTIVE') return { ok: false, reason: 'TENANT_INACTIVE' };

  return {
    ok: true,
    tenantId: key.tenant_id,
    apiKeyId: key.id,
    verticalId: key.vertical_id,
    accessTier: classification.accessTier,
    billingSource: classification.billingSource,
  };
}

/**
 * `401` for "no valid credential was established", `403` for "a valid
 * credential was established and it may not do this". A malformed, unknown,
 * revoked or expired key never proves who is asking, so it is a 401 alongside
 * a missing one; a suspended tenant or a vertical-scope mismatch proves
 * exactly who is asking and says they may not proceed, which is what 403
 * means. The body never says which — "vertical scope" is as much a hint
 * about what exists behind this deployment as an entity id would be, so
 * every failure gets the same opaque message and only the status differs.
 */
const REASON_STATUS: Readonly<Record<AuthFailureReason, 401 | 403>> = {
  MISSING_CREDENTIAL: 401,
  MALFORMED_CREDENTIAL: 401,
  UNKNOWN_KEY: 401,
  REVOKED: 401,
  EXPIRED: 401,
  WRONG_ENVIRONMENT: 401,
  TENANT_SUSPENDED: 403,
  WRONG_VERTICAL: 403,
  TENANT_CLOSED: 403,
  TENANT_INACTIVE: 403,
  ACCESS_PROFILE_MISSING: 403,
  WRONG_BILLING_SOURCE: 403,
};

export interface AuthResponseBody {
  readonly error: {
    readonly code: 'UNAUTHORIZED' | 'FORBIDDEN';
    readonly message: string;
  };
}

/**
 * The response for a rejected request — deliberately one shape regardless of
 * `reason`. A client that could distinguish "wrong vertical" from "revoked"
 * from the body would learn more about this deployment's key model than an
 * error page needs to say; the operator channel (`waitUntil`-logged, not
 * returned) is where the real reason belongs.
 */
export function toAuthResponse(failure: AuthFailure): { status: 401 | 403; body: AuthResponseBody } {
  const status = REASON_STATUS[failure.reason];
  const code = status === 401 ? 'UNAUTHORIZED' : 'FORBIDDEN';
  const message =
    status === 401
      ? 'A valid API key is required. Provide one as a Bearer token in the Authorization header.'
      : 'This API key may not access this deployment.';
  return { status, body: { error: { code, message } } };
}
