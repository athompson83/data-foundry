/**
 * Database-backed bearer-key authentication shared by Cloudflare access
 * adapters. This package decides credential validity, tenant activity,
 * one-key-one-vertical scope, and the stored access/billing pair. It owns no
 * HTTP response shape and imports no consumer app.
 */
import {
  evaluateStoredKey,
  hashApiKey,
  isApiAccessClassification,
  keyEnvironment,
  looksLikeApiKey,
  readBearerToken,
  type ApiAccessTier,
  type ApiBillingSource,
  type KeyEnvironment,
  type StoredApiKey,
} from '@data-foundry/api-keys';
import type { SqlExecutor } from '@data-foundry/canonical-store';

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

export interface AuthenticateOptions {
  readonly verticalId: string;
  readonly environment: KeyEnvironment;
  /**
   * The trusted deployment channel. Because the database vocabulary permits
   * only closed pairs, `NONE` identifies exactly MCP/NONE, `RAPIDAPI`
   * identifies exactly RAPIDAPI/RAPIDAPI, and `DIRECT` admits only the two
   * first-party API tiers.
   */
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
  if (!looksLikeApiKey(token)) return { ok: false, reason: 'MALFORMED_CREDENTIAL' };
  if (keyEnvironment(token) !== environment) {
    return { ok: false, reason: 'WRONG_ENVIRONMENT' };
  }

  const tokenHash = await hashApiKey(token);
  const row = await findKeyByHash(executor, tokenHash);
  const verdict = evaluateStoredKey(row, now, { presented: token, environment });
  if (!verdict.ok) return { ok: false, reason: verdict.reason };

  const key = verdict.key as ApiKeyRow;
  if (key.vertical_id !== verticalId) return { ok: false, reason: 'WRONG_VERTICAL' };

  const classification = { accessTier: key.access_tier, billingSource: key.billing_source };
  if (!isApiAccessClassification(classification)) {
    return { ok: false, reason: 'ACCESS_PROFILE_MISSING' };
  }
  if (classification.billingSource !== expectedBillingSource) {
    return { ok: false, reason: 'WRONG_BILLING_SOURCE' };
  }

  const tenant = await findTenantById(executor, key.tenant_id);
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
