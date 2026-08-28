/**
 * `@data-foundry/usage-events` — the shape of a metering event, agreed on by
 * the producer (the edge Worker) and the consumer (the queue's own Worker),
 * who otherwise share no code and run as separate isolates.
 *
 * Nothing here is business logic. It is a contract: what a usage event
 * contains (never more than `db/migrations/0011_api_tenancy.sql`'s
 * `api_usage_events` table can hold, because a field this package invents and
 * the table cannot store is a field that silently never persists), and the
 * one write both sides use to persist it idempotently.
 *
 * `id` **is** the idempotency key. Cloudflare Queues is at-least-once: the
 * same message can be delivered twice, and `api_usage_events.id` — the same
 * primary key `gen_random_uuid()` would otherwise fill in — is generated here,
 * at the producer, instead. Postgres accepts an explicit value for a
 * `DEFAULT`-bearing column, so this needs no schema change: `ON CONFLICT (id)
 * DO NOTHING` is the whole of the idempotency mechanism, enforced by the
 * primary key the table already had.
 */
import type { SqlExecutor, SqlParam } from '@data-foundry/canonical-store';
import {
  isApiAccessClassification,
  type ApiAccessTier,
  type ApiBillingSource,
} from '@data-foundry/api-keys';

/** The two methods this API ever serves, and therefore the only ones a usage event can name. */
const ALLOWED_METHODS = new Set(['GET', 'HEAD']);
export type UsageMethod = 'GET' | 'HEAD';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROUTE_KEY_RE = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/;
const POSTGRES_INTEGER_MAX = 2_147_483_647;
const LEGACY_USAGE_EVENT_FIELDS = [
  'id',
  'tenant_id',
  'api_key_id',
  'vertical_id',
  'occurred_at',
  'route_key',
  'method',
  'status',
  'rows_served',
  'duration_ms',
] as const;
const USAGE_EVENT_V2_FIELDS = [
  'schema_version',
  ...LEGACY_USAGE_EVENT_FIELDS,
  'access_tier',
  'billing_source',
] as const;

/**
 * One request, metered. Every field here is either a constant the server
 * chose or a count — never a request body, a query string, or a value a
 * customer supplied. `route_key` in particular is a member of the registered
 * accounting vocabulary, never a path or request target.
 */
export interface UsageEventBase {
  readonly id: string;
  readonly tenant_id: string;
  readonly api_key_id: string;
  readonly vertical_id: string;
  readonly occurred_at: string;
  readonly route_key: string;
  readonly method: UsageMethod;
  readonly status: number;
  readonly rows_served: number;
  readonly duration_ms: number | null;
}

/** Queue payload shipped before access/billing classification existed. */
export interface LegacyUsageEvent extends UsageEventBase {}

/** Current wire payload. The explicit version makes staged consumer-first deployment possible. */
export interface UsageEventV2 extends UsageEventBase {
  readonly schema_version: 2;
  readonly access_tier: ApiAccessTier;
  readonly billing_source: ApiBillingSource;
}

export type UsageEvent = LegacyUsageEvent | UsageEventV2;

export interface UsageEventInput {
  readonly tenantId: string;
  readonly apiKeyId: string;
  readonly verticalId: string;
  readonly routeKey: string;
  readonly method: UsageMethod;
  readonly status: number;
  readonly accessTier: ApiAccessTier;
  readonly billingSource: ApiBillingSource;
  readonly rowsServed?: number;
  readonly durationMs?: number | null;
  /** Test seam only. Production callers never supply these. */
  readonly id?: string;
  readonly occurredAt?: Date;
}

/**
 * Construct a usage event at the producer. The one place `id` is minted for
 * a row that does not exist yet — every other function in this package reads
 * one that was already built.
 */
export function buildUsageEvent(input: UsageEventInput): UsageEventV2 {
  if (
    !isApiAccessClassification({
      accessTier: input.accessTier,
      billingSource: input.billingSource,
    })
  ) {
    throw new TypeError('usage event access classification is invalid');
  }
  return {
    schema_version: 2,
    id: input.id ?? crypto.randomUUID(),
    tenant_id: input.tenantId,
    api_key_id: input.apiKeyId,
    vertical_id: input.verticalId,
    occurred_at: (input.occurredAt ?? new Date()).toISOString(),
    route_key: input.routeKey,
    method: input.method,
    status: input.status,
    rows_served: input.rowsServed ?? 0,
    duration_ms: input.durationMs ?? null,
    access_tier: input.accessTier,
    billing_source: input.billingSource,
  };
}

/**
 * Structural validation for a message arriving at the consumer.
 *
 * A Queue message is JSON that crossed an isolate boundary — it carries no
 * more guarantee of shape than a request body does, whether the producer
 * changed shape, a message was hand-crafted, or a future bug served a message
 * this consumer predates. Returning `null` rather than throwing is
 * deliberate: the caller's job is to decide what happens to an unparseable
 * message (this package has no opinion), and every check here doubles as a
 * defence-in-depth mirror of a database CHECK constraint, so a malformed
 * message is recognised as malformed before it becomes a database error.
 */
export function parseUsageEvent(raw: unknown): UsageEvent | null {
  if (raw === null || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  const keys = Object.keys(value).sort();
  const isV2 = value['schema_version'] === 2;
  const expectedKeys = [...(isV2 ? USAGE_EVENT_V2_FIELDS : LEGACY_USAGE_EVENT_FIELDS)].sort();
  if (keys.length !== expectedKeys.length || keys.some((key, index) => key !== expectedKeys[index])) {
    return null;
  }

  const id = value['id'];
  const tenantId = value['tenant_id'];
  const apiKeyId = value['api_key_id'];
  const verticalId = value['vertical_id'];
  const occurredAt = value['occurred_at'];
  const routeKey = value['route_key'];
  const method = value['method'];
  const status = value['status'];
  const rowsServed = value['rows_served'];
  const durationMs = value['duration_ms'];
  const accessTier = value['access_tier'];
  const billingSource = value['billing_source'];

  if (typeof id !== 'string' || !UUID_RE.test(id)) return null;
  if (typeof tenantId !== 'string' || !UUID_RE.test(tenantId)) return null;
  if (typeof apiKeyId !== 'string' || !UUID_RE.test(apiKeyId)) return null;
  if (typeof verticalId !== 'string' || !UUID_RE.test(verticalId)) return null;
  if (typeof occurredAt !== 'string') return null;
  try {
    if (new Date(occurredAt).toISOString() !== occurredAt) return null;
  } catch {
    return null;
  }
  if (
    typeof routeKey !== 'string' ||
    routeKey.length < 3 ||
    routeKey.length > 64 ||
    !ROUTE_KEY_RE.test(routeKey)
  ) return null;
  if (typeof method !== 'string' || !ALLOWED_METHODS.has(method)) return null;
  if (typeof status !== 'number' || !Number.isInteger(status) || status < 100 || status > 599) {
    return null;
  }
  if (
    typeof rowsServed !== 'number' ||
    !Number.isInteger(rowsServed) ||
    rowsServed < 0 ||
    rowsServed > POSTGRES_INTEGER_MAX
  ) return null;
  if (durationMs !== null) {
    if (
      typeof durationMs !== 'number' ||
      !Number.isInteger(durationMs) ||
      durationMs < 0 ||
      durationMs > POSTGRES_INTEGER_MAX
    ) return null;
  }

  const base: UsageEventBase = {
    id,
    tenant_id: tenantId,
    api_key_id: apiKeyId,
    vertical_id: verticalId,
    occurred_at: occurredAt,
    route_key: routeKey,
    method: method as UsageMethod,
    status,
    rows_served: typeof rowsServed === 'number' ? rowsServed : 0,
    duration_ms: typeof durationMs === 'number' ? durationMs : null,
  };
  if (!isV2) return base;
  const classification = { accessTier, billingSource };
  if (!isApiAccessClassification(classification)) return null;
  return {
    schema_version: 2,
    ...base,
    access_tier: classification.accessTier,
    billing_source: classification.billingSource,
  };
}

export type PersistOutcome = 'inserted' | 'duplicate';

/**
 * Idempotent single-row write. `duplicate` is not a failure — it is the
 * expected outcome of at-least-once delivery redelivering a message this
 * consumer already persisted, and the caller acknowledges it exactly as it
 * would `inserted`.
 */
export async function persistUsageEvent(
  executor: SqlExecutor,
  event: UsageEvent,
): Promise<PersistOutcome> {
  const inserted = await persistUsageEvents(executor, [event]);
  return inserted === 1 ? 'inserted' : 'duplicate';
}

/**
 * Persist one queue batch with one idempotent statement. The producer caps a
 * batch at 100 messages, so this is at most 1,200 parameters — comfortably
 * below PostgreSQL's protocol limit. A statement failure commits none of the
 * batch, allowing the consumer to retry every valid message coherently.
 */
export async function persistUsageEvents(
  executor: SqlExecutor,
  events: readonly UsageEvent[],
): Promise<number> {
  if (events.length === 0) return 0;

  const params: SqlParam[] = [];
  const values = events.map((event, rowIndex) => {
    const offset = rowIndex * 12;
    const accessTier = 'schema_version' in event ? event.access_tier : null;
    const billingSource = 'schema_version' in event ? event.billing_source : null;
    params.push(
      event.id,
      event.tenant_id,
      event.api_key_id,
      event.vertical_id,
      event.occurred_at,
      event.route_key,
      event.method,
      event.status,
      event.rows_served,
      event.duration_ms,
      accessTier,
      billingSource,
    );
    const casts = [
      'uuid',
      'uuid',
      'uuid',
      'uuid',
      'timestamptz',
      'text',
      'text',
      'integer',
      'integer',
      'integer',
      'text',
      'text',
    ] as const;
    return `(${casts
      .map((cast, columnIndex) => `$${offset + columnIndex + 1}::${cast}`)
      .join(', ')})`;
  });

  const rows = await executor.query<{ id: string }>(
    `with incoming
       (id, tenant_id, api_key_id, vertical_id, occurred_at, route_key, method,
        status, rows_served, duration_ms, access_tier, billing_source) as (
       values ${values.join(',\n              ')}
     )
     insert into api_usage_events
       (id, tenant_id, api_key_id, vertical_id, occurred_at, route_key, method,
        status, rows_served, duration_ms, access_tier, billing_source)
     select incoming.id, incoming.tenant_id, incoming.api_key_id, incoming.vertical_id,
            incoming.occurred_at, incoming.route_key, incoming.method, incoming.status,
            incoming.rows_served, incoming.duration_ms,
            coalesce(incoming.access_tier, key.access_tier),
            coalesce(incoming.billing_source, key.billing_source)
       from incoming
       left join api_keys key on key.id = incoming.api_key_id
     on conflict (id) do nothing
     returning id`,
    params,
  );
  return rows.length;
}

export interface DirectInvoiceUsageWindow {
  /** Inclusive ISO-8601 lower bound. */
  readonly from: string;
  /** Exclusive ISO-8601 upper bound. */
  readonly before: string;
}

export interface DirectInvoiceUsageSummary {
  readonly tenant_id: string;
  readonly vertical_id: string;
  readonly request_count: number;
  readonly rows_served: number;
  readonly duration_ms: number;
}

type DirectInvoiceUsageRow = {
  readonly tenant_id: string;
  readonly vertical_id: string;
  readonly request_count: string;
  readonly rows_served: string;
  readonly duration_ms: string;
} & Record<string, unknown>;

function canonicalInstant(value: string, name: string): number {
  let canonical: string;
  try {
    canonical = new Date(value).toISOString();
  } catch {
    throw new TypeError(`${name} must be a canonical ISO-8601 instant`);
  }
  if (canonical !== value) throw new TypeError(`${name} must be a canonical ISO-8601 instant`);
  return Date.parse(value);
}

function safeCount(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new RangeError(`${name} exceeded the safe integer range`);
  }
  return parsed;
}

/**
 * Aggregate the only usage Data Foundry may invoice itself.
 *
 * This is intentionally the canonical query rather than a caller-supplied
 * filter. Marketplace events remain in `api_usage_events` for analytics and
 * reconciliation, but the closed API_PAID/DIRECT predicate makes them
 * structurally absent from this projection.
 */
export async function aggregateDirectInvoiceEligibleUsage(
  executor: SqlExecutor,
  window: DirectInvoiceUsageWindow,
): Promise<readonly DirectInvoiceUsageSummary[]> {
  const from = canonicalInstant(window.from, 'from');
  const before = canonicalInstant(window.before, 'before');
  if (from >= before) throw new RangeError('from must be earlier than before');

  const rows = await executor.query<DirectInvoiceUsageRow>(
    `select tenant_id,
            vertical_id,
            count(*)::text as request_count,
            coalesce(sum(rows_served), 0)::text as rows_served,
            coalesce(sum(duration_ms), 0)::text as duration_ms
       from api_usage_events
      where access_tier = 'API_PAID'
        and billing_source = 'DIRECT'
        and occurred_at >= $1::timestamptz
        and occurred_at < $2::timestamptz
      group by tenant_id, vertical_id
      order by tenant_id, vertical_id`,
    [window.from, window.before],
  );

  return rows.map((row) => ({
    tenant_id: row.tenant_id,
    vertical_id: row.vertical_id,
    request_count: safeCount(row.request_count, 'request_count'),
    rows_served: safeCount(row.rows_served, 'rows_served'),
    duration_ms: safeCount(row.duration_ms, 'duration_ms'),
  }));
}
