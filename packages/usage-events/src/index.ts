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

/** The two methods this API ever serves, and therefore the only ones a usage event can name. */
const ALLOWED_METHODS = new Set(['GET', 'HEAD']);
export type UsageMethod = 'GET' | 'HEAD';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROUTE_KEY_RE = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/;
const POSTGRES_INTEGER_MAX = 2_147_483_647;
const USAGE_EVENT_FIELDS = [
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

/**
 * One request, metered. Every field here is either a constant the server
 * chose or a count — never a request body, a query string, or a value a
 * customer supplied. `route_key` in particular is a member of the registered
 * accounting vocabulary, never a path or request target.
 */
export interface UsageEvent {
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

export interface UsageEventInput {
  readonly tenantId: string;
  readonly apiKeyId: string;
  readonly verticalId: string;
  readonly routeKey: string;
  readonly method: UsageMethod;
  readonly status: number;
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
export function buildUsageEvent(input: UsageEventInput): UsageEvent {
  return {
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
  const expectedKeys = [...USAGE_EVENT_FIELDS].sort();
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

  return {
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
 * batch at 100 messages, so this is at most 1,000 parameters — comfortably
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
    const offset = rowIndex * 10;
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
    );
    return `(${Array.from({ length: 10 }, (_, columnIndex) => `$${offset + columnIndex + 1}`).join(', ')})`;
  });

  const rows = await executor.query<{ id: string }>(
    `insert into api_usage_events
       (id, tenant_id, api_key_id, vertical_id, occurred_at, route_key, method, status, rows_served, duration_ms)
     values ${values.join(',\n            ')}
     on conflict (id) do nothing
     returning id`,
    params,
  );
  return rows.length;
}
