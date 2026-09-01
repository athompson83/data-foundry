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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
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
export function parsePrivateCanaryEnvelope(raw: unknown): PrivateCanaryEnvelope | null {
  if (!isRecord(raw) || !hasExactKeys(raw)) return null;
  if (raw['kind'] !== PRIVATE_CANARY_ENVELOPE_KIND) {
    return null;
  }

  if (typeof raw['run_id'] !== 'string' || !UUID_V4_RE.test(raw['run_id'])) {
    return null;
  }

  const correlationIdentifiers = [
    raw['tenant_id'],
    raw['vertical_id'],
    raw['edge_api_key_id'],
    raw['mcp_api_key_id'],
    raw['edge_event_id'],
    raw['mcp_event_id'],
  ];
  if (correlationIdentifiers.some((identifier) => typeof identifier !== 'string' || !UUID_RE.test(identifier))) {
    return null;
  }
  if (!isCanonicalIsoInstant(raw['issued_at'])) return null;

  return {
    kind: PRIVATE_CANARY_ENVELOPE_KIND,
    run_id: raw['run_id'] as string,
    issued_at: raw['issued_at'] as string,
    tenant_id: raw['tenant_id'] as string,
    vertical_id: raw['vertical_id'] as string,
    edge_api_key_id: raw['edge_api_key_id'] as string,
    mcp_api_key_id: raw['mcp_api_key_id'] as string,
    edge_event_id: raw['edge_event_id'] as string,
    mcp_event_id: raw['mcp_event_id'] as string,
  };
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
