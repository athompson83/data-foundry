import {
  buildRuntimeRoleEffectivePrivilegeMatrixCtes,
  type RuntimeRole,
} from './runtime-role-policy.js';

export {
  API_KEY_AUTH_COLUMNS,
  API_TENANT_AUTH_COLUMNS,
  buildMigrationRoleUnsafeExternalCapabilitySql,
  buildMigrationRoleUnsafeDefaultAclSql,
  buildMigrationRoleUnsafeDurableSettingSql,
  buildMigrationRoleUnsafePostureSql,
  buildRuntimeRoleExpectedExternalAclValuesSql,
  buildRuntimeRoleExternalDirectAclSql,
  buildRuntimeRoleReachableExternalCapabilitySql,
  buildRuntimeRoleUnsafeDurableSettingSql,
  buildRuntimeRoleExpectedGrants,
  PRIVATE_FUNCTION_SIGNATURES,
  QUERY_CORE_RELATIONS,
  QUERY_ROLES,
  RIGHTS_CONTEXT_RELATIONS,
  RUNTIME_ROLES,
  USAGE_INSERT_COLUMNS,
  buildUnsafeMigrationSearchPathSql,
  buildUnsafeMigrationSessionSql,
} from './runtime-role-policy.js';
export type {
  RuntimeGrantScope,
  RuntimeRole,
  RuntimeRoleExpectedGrant,
} from './runtime-role-policy.js';

/**
 * The one message shape deliberately sent through the dedicated private-canary
 * ingress so that the strict usage-event parser retries it and Cloudflare moves
 * it to the dedicated private-canary DLQ. It carries only deterministic
 * synthetic identifiers: never a credential, request target, source artifact,
 * or source-derived content.
 */
export const PRIVATE_CANARY_ENVELOPE_KIND = 'data-foundry.private-canary.v1';

/**
 * A target Worker accepts the synthetic probe only from the deliberately
 * route-less service-bound deployment profile. This is not a general feature
 * flag: an omitted or different value keeps the probe closed.
 */
export const PRIVATE_CANARY_SERVICE_BINDING_MODE = 'service-binding';

/** The minimal binding shape the route-less target probe is allowed to use. */
export interface PrivateCanaryRuntimeEnvironment {
  readonly DEPLOYMENT_ENVIRONMENT?: string | undefined;
  readonly PRIVATE_CANARY_MODE?: string | undefined;
  readonly HYPERDRIVE?: { readonly connectionString: string } | undefined;
  readonly POSTGRES_URL?: string | undefined;
}

export class PrivateCanaryConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PrivateCanaryConfigurationError';
  }
}

/**
 * Resolve only the database capability a target RPC probe needs. Public
 * origins, HTTP hosts, source/R2 configuration, and direct Postgres URLs are
 * intentionally outside this contract so a private canary cannot make a
 * partially public Worker appear ready.
 */
export function resolvePrivateCanaryConnectionString(
  env: PrivateCanaryRuntimeEnvironment,
): string {
  if (env.DEPLOYMENT_ENVIRONMENT !== 'production') {
    throw new PrivateCanaryConfigurationError(
      'Private canary requires production deployment configuration.',
    );
  }
  if (env.PRIVATE_CANARY_MODE !== PRIVATE_CANARY_SERVICE_BINDING_MODE) {
    throw new PrivateCanaryConfigurationError(
      'Private canary requires an explicit service-binding deployment.',
    );
  }
  if ((env.POSTGRES_URL ?? '').trim() !== '') {
    throw new PrivateCanaryConfigurationError(
      'Private canary does not permit a direct database connection.',
    );
  }
  const connectionString = env.HYPERDRIVE?.connectionString;
  if (typeof connectionString !== 'string' || connectionString.trim() === '') {
    throw new PrivateCanaryConfigurationError(
      'Private canary requires the HYPERDRIVE binding.',
    );
  }
  return connectionString;
}

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ENVELOPE_KEYS = [
  'kind',
  'run_id',
  'issued_at',
  'tenant_id',
  'vertical_id',
  'edge_api_key_id',
  'mcp_api_key_id',
  'edge_event_id',
  'mcp_event_id',
] as const;

export interface PrivateCanaryEnvelope {
  readonly kind: typeof PRIVATE_CANARY_ENVELOPE_KIND;
  readonly run_id: string;
  /** Canonical synthetic-fixture timestamp, retained as safe receipt provenance. */
  readonly issued_at: string;
  readonly tenant_id: string;
  readonly vertical_id: string;
  readonly edge_api_key_id: string;
  readonly mcp_api_key_id: string;
  readonly edge_event_id: string;
  readonly mcp_event_id: string;
}

/** The only data a named target-entrypoint receives from the canary DLQ trigger. */
export interface PrivateCanaryProbeInput {
  readonly runId: string;
  readonly tenantId: string;
  readonly verticalId: string;
  readonly edgeApiKeyId: string;
  readonly mcpApiKeyId: string;
  readonly edgeEventId: string;
  readonly mcpEventId: string;
}

export const PRIVATE_CANARY_WORKERS = [
  'edge',
  'web',
  'usage-consumer',
  'acquisition-worker',
  'mcp-worker',
] as const;
export type PrivateCanaryWorker = (typeof PRIVATE_CANARY_WORKERS)[number];
export type PrivateCanaryMetering = 'QUEUED' | 'NOT_APPLICABLE';

const PRIVATE_CANARY_RUNTIME_ROLE_BY_WORKER: Readonly<Record<PrivateCanaryWorker, RuntimeRole>> = {
  edge: 'df_edge',
  web: 'df_web',
  'usage-consumer': 'df_usage',
  'acquisition-worker': 'df_acquisition',
  'mcp-worker': 'df_mcp',
};

/** The only non-sensitive identity and privilege facts a target probe retains. */
export interface PrivateCanaryRuntimeBinding {
  readonly [key: string]: unknown;
  readonly current_user: unknown;
  readonly session_user: unknown;
  readonly role_is_login_nonprivileged: unknown;
  readonly membership_is_empty: unknown;
  readonly search_path_is_exact: unknown;
  readonly lo_compat_privileges_is_off: unknown;
  readonly session_replication_role_is_origin: unknown;
  readonly private_schema_usage: unknown;
  readonly private_schema_create: unknown;
  readonly privilege_matrix_is_exact: unknown;
}

/** Reused by direct role probes so all runtime checks share one ACL policy. */
export const PRIVATE_CANARY_RUNTIME_PRIVILEGE_MATRIX_CTES =
  buildRuntimeRoleEffectivePrivilegeMatrixCtes();

/**
 * A target proves the identity of its bound Hyperdrive before treating a
 * successful connection as readiness. The query contains no connection data or
 * source rows; it returns only booleans, role identity, and an exact effective
 * privilege-matrix result derived from the generated grant inventory.
 */
export const PRIVATE_CANARY_RUNTIME_BINDING_SQL = `
WITH ${PRIVATE_CANARY_RUNTIME_PRIVILEGE_MATRIX_CTES}
SELECT current_user::text AS current_user,
       session_user::text AS session_user,
       EXISTS (
         SELECT 1 FROM pg_roles role
          WHERE role.rolname = $1 AND role.rolcanlogin
            AND NOT role.rolinherit AND NOT role.rolsuper AND NOT role.rolcreatedb AND NOT role.rolcreaterole
            AND NOT role.rolreplication AND NOT role.rolbypassrls
       ) AS role_is_login_nonprivileged,
       NOT EXISTS (
         SELECT 1 FROM pg_auth_members membership
          WHERE membership.member = (SELECT oid FROM pg_roles WHERE rolname = $1)
             OR membership.roleid = (SELECT oid FROM pg_roles WHERE rolname = $1)
       ) AS membership_is_empty,
       current_setting('search_path') = 'data_foundry, pg_catalog, extensions'
       AND current_schemas(false) = ARRAY['data_foundry', 'pg_catalog', 'extensions']::name[]
         AS search_path_is_exact,
       current_setting('lo_compat_privileges') = 'off' AS lo_compat_privileges_is_off,
       current_setting('session_replication_role') = 'origin' AS session_replication_role_is_origin,
       has_schema_privilege(current_user, 'data_foundry', 'USAGE') AS private_schema_usage,
       has_schema_privilege(current_user, 'data_foundry', 'CREATE') AS private_schema_create,
       NOT EXISTS (SELECT 1 FROM effective_privilege_differences)
       AND NOT EXISTS (SELECT 1 FROM external_direct_acl_differences)
       AND NOT EXISTS (SELECT 1 FROM external_reachable_capabilities)
        AND NOT EXISTS (SELECT 1 FROM unsafe_migration_role_posture)
        AND NOT EXISTS (SELECT 1 FROM unsafe_migration_role_durable_settings)
        AND NOT EXISTS (SELECT 1 FROM unsafe_migration_role_external_capability)
       AND NOT EXISTS (SELECT 1 FROM unsafe_migration_role_default_object_acl)
       AND NOT EXISTS (SELECT 1 FROM unsafe_runtime_role_durable_settings)
       AND NOT EXISTS (SELECT 1 FROM public_private_acl_entries) AS privilege_matrix_is_exact`;

/**
 * Refuse a target whose bound login, session login, narrow private-schema
 * matrix, or external direct-data/custom-routine boundary differs from its
 * declared runtime role before it can emit READY.
 */
export async function assertPrivateCanaryRuntimeBinding(
  worker: PrivateCanaryWorker,
  readBinding: (expectedRole: string) => Promise<readonly PrivateCanaryRuntimeBinding[]>,
): Promise<void> {
  const expectedRole = PRIVATE_CANARY_RUNTIME_ROLE_BY_WORKER[worker];
  const [binding] = await readBinding(expectedRole);
  if (
    binding === undefined
    || binding.current_user !== expectedRole
    || binding.session_user !== expectedRole
    || binding.role_is_login_nonprivileged !== true
    || binding.membership_is_empty !== true
    || binding.search_path_is_exact !== true
    || binding.lo_compat_privileges_is_off !== true
    || binding.session_replication_role_is_origin !== true
    || binding.private_schema_usage !== true
    || binding.private_schema_create !== false
    || binding.privilege_matrix_is_exact !== true
  ) {
    throw new PrivateCanaryConfigurationError('Private canary runtime binding is invalid.');
  }
}

/**
 * A named Worker RPC result. Its closed vocabulary intentionally leaves no
 * field for a connection string, exception, request, source record, or body.
 */
export interface PrivateCanaryProbeResult {
  readonly worker: PrivateCanaryWorker;
  readonly runId: string;
  readonly readiness: 'READY';
  readonly metering: PrivateCanaryMetering;
}

/** The named target entrypoints expose this one capability to the harness. */
export interface PrivateCanaryProbe {
  probe(input: PrivateCanaryProbeInput): Promise<PrivateCanaryProbeResult>;
}

export interface PrivateCanaryReceipt {
  readonly kind: 'data-foundry.private-canary-receipt.v1';
  readonly run_id: string;
  /** The emitted synthetic fixture cycle; it is safe correlation metadata. */
  readonly issued_at: string;
  readonly completed_at: string;
  readonly probes: readonly PrivateCanaryProbeResult[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isCanonicalIsoInstant(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    return new Date(value).toISOString() === value;
  } catch {
    return false;
  }
}

function canonicalFixtureRunId(value: string): string {
  const runId = value.trim().toLowerCase();
  if (!UUID_V4_RE.test(runId)) {
    throw new TypeError('Private canary fixture requires a canonical UUID v4 run id.');
  }
  return runId;
}

function canonicalFixtureIssuedAt(value: string): string {
  const issuedAt = value.trim();
  if (!isCanonicalIsoInstant(issuedAt)) {
    throw new TypeError('Private canary fixture requires a canonical cycle timestamp.');
  }
  return issuedAt;
}

async function deterministicFixtureUuid(runId: string, issuedAt: string, label: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`data-foundry-private-canary:${runId}:${issuedAt}:${label}`),
  );
  const bytes = new Uint8Array(digest).slice(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Derive the only control envelope a private-canary fixture may emit. Web
 * Crypto keeps this derivation identical in the fixture CLI and Cloudflare
 * Worker runtime without importing a Node-only hashing API into a Worker.
 */
export async function createPrivateCanaryFixtureEnvelope(
  inputRunId: string,
  inputIssuedAt: string,
): Promise<PrivateCanaryEnvelope> {
  const runId = canonicalFixtureRunId(inputRunId);
  const issuedAt = canonicalFixtureIssuedAt(inputIssuedAt);
  const [tenantId, verticalId, edgeApiKeyId, mcpApiKeyId, edgeEventId, mcpEventId] = await Promise.all([
    deterministicFixtureUuid(runId, issuedAt, 'tenant'),
    deterministicFixtureUuid(runId, issuedAt, 'vertical'),
    deterministicFixtureUuid(runId, issuedAt, 'edge-api-key'),
    deterministicFixtureUuid(runId, issuedAt, 'mcp-api-key'),
    deterministicFixtureUuid(runId, issuedAt, 'edge-event'),
    deterministicFixtureUuid(runId, issuedAt, 'mcp-event'),
  ]);
  return {
    kind: PRIVATE_CANARY_ENVELOPE_KIND,
    run_id: runId,
    issued_at: issuedAt,
    tenant_id: tenantId,
    vertical_id: verticalId,
    edge_api_key_id: edgeApiKeyId,
    mcp_api_key_id: mcpApiKeyId,
    edge_event_id: edgeEventId,
    mcp_event_id: mcpEventId,
  };
}

function hasExactKeys(value: Record<string, unknown>): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...ENVELOPE_KEYS].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function hasExactProbeKeys(value: Record<string, unknown>): boolean {
  const expected = ['worker', 'runId', 'readiness', 'metering'].sort();
  const actual = Object.keys(value).sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isPrivateCanaryWorker(value: unknown): value is PrivateCanaryWorker {
  return typeof value === 'string' && (PRIVATE_CANARY_WORKERS as readonly string[]).includes(value);
}

function expectedMetering(worker: PrivateCanaryWorker): PrivateCanaryMetering {
  return worker === 'edge' || worker === 'mcp-worker' ? 'QUEUED' : 'NOT_APPLICABLE';
}

/**
 * Parse a DLQ message fail-closed. Unknown fields are rejected so a future
 * caller cannot piggyback a secret, URL, source payload, or arbitrary command.
 */
export async function parsePrivateCanaryEnvelope(raw: unknown): Promise<PrivateCanaryEnvelope | null> {
  if (!isRecord(raw) || !hasExactKeys(raw)) return null;
  if (raw['kind'] !== PRIVATE_CANARY_ENVELOPE_KIND) {
    return null;
  }

  if (typeof raw['run_id'] !== 'string' || typeof raw['issued_at'] !== 'string') {
    return null;
  }

  try {
    const expected = await createPrivateCanaryFixtureEnvelope(raw['run_id'], raw['issued_at']);
    return raw['tenant_id'] === expected.tenant_id
      && raw['vertical_id'] === expected.vertical_id
      && raw['edge_api_key_id'] === expected.edge_api_key_id
      && raw['mcp_api_key_id'] === expected.mcp_api_key_id
      && raw['edge_event_id'] === expected.edge_event_id
      && raw['mcp_event_id'] === expected.mcp_event_id
      && raw['run_id'] === expected.run_id
      && raw['issued_at'] === expected.issued_at
      ? expected
      : null;
  } catch {
    return null;
  }
}

export function toPrivateCanaryProbeInput(envelope: PrivateCanaryEnvelope): PrivateCanaryProbeInput {
  return {
    runId: envelope.run_id,
    tenantId: envelope.tenant_id,
    verticalId: envelope.vertical_id,
    edgeApiKeyId: envelope.edge_api_key_id,
    mcpApiKeyId: envelope.mcp_api_key_id,
    edgeEventId: envelope.edge_event_id,
    mcpEventId: envelope.mcp_event_id,
  };
}

/** Parse a service-binding result before it becomes durable evidence. */
export function parsePrivateCanaryProbeResult(raw: unknown): PrivateCanaryProbeResult | null {
  if (!isRecord(raw) || !hasExactProbeKeys(raw)) return null;
  if (!isPrivateCanaryWorker(raw['worker']) || !UUID_V4_RE.test(String(raw['runId']))) return null;
  if (raw['readiness'] !== 'READY' || raw['metering'] !== expectedMetering(raw['worker'])) return null;
  return {
    worker: raw['worker'],
    runId: raw['runId'] as string,
    readiness: 'READY',
    metering: expectedMetering(raw['worker']),
  };
}

/**
 * Create the only object the private Worker may put into its dedicated R2
 * bucket. A receipt is valid only when every role reported the same run id.
 */
export function createPrivateCanaryReceipt(input: {
  readonly runId: string;
  readonly issuedAt: string;
  readonly completedAt: string;
  readonly probes: readonly PrivateCanaryProbeResult[];
}): PrivateCanaryReceipt {
  if (
    !UUID_V4_RE.test(input.runId)
    || !isCanonicalIsoInstant(input.issuedAt)
    || !isCanonicalIsoInstant(input.completedAt)
  ) {
    throw new TypeError('Private canary receipt requires canonical run, cycle, and completion times.');
  }
  if (input.probes.length !== PRIVATE_CANARY_WORKERS.length) {
    throw new TypeError('Private canary receipt requires one result for every Worker.');
  }

  const byWorker = new Map(input.probes.map((probe) => [probe.worker, probe]));
  if (byWorker.size !== PRIVATE_CANARY_WORKERS.length) {
    throw new TypeError('Private canary receipt cannot contain duplicate Worker results.');
  }

  const probes = PRIVATE_CANARY_WORKERS.map((worker) => {
    const probe = byWorker.get(worker);
    if (probe === undefined || probe.runId !== input.runId) {
      throw new TypeError('Private canary receipt requires matching results from every Worker.');
    }
    return probe;
  });

  return {
    kind: 'data-foundry.private-canary-receipt.v1',
    run_id: input.runId,
    issued_at: input.issuedAt,
    completed_at: input.completedAt,
    probes,
  };
}
