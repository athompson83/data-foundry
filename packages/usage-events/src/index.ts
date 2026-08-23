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
import type { SqlExecutor } from '@data-foundry/canonical-store';

/** The two methods this API ever serves, and therefore the only ones a usage event can name. */
const ALLOWED_METHODS = new Set(['GET', 'HEAD']);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROUTE_HAS_QUERY_RE = /[?&]/;
const ROUTE_HAS_UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/**
 * One request, metered. Every field here is either a constant the server
 * chose or a count — never a request body, a query string, or a value a
 * customer supplied. `route` in particular is a matched TEMPLATE
 * (`/v1/entities/{id}`), never the request target: see
 * `@data-foundry/api`'s `routeTemplate()`, the only function that is allowed
 * to produce one of these strings.
 */
export interface UsageEvent {
  readonly id: string;
  readonly tenant_id: string;
  readonly api_key_id: string;
  readonly occurred_at: string;
  readonly route: string;
  readonly method: string;
  readonly status: number;
  readonly rows_served: number;
  readonly duration_ms: number | null;
}

export interface UsageEventInput {
  readonly tenantId: string;
  readonly apiKeyId: string;
  readonly routeTemplate: string;
  readonly method: string;
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
    occurred_at: (input.occurredAt ?? new Date()).toISOString(),
    route: input.routeTemplate,
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

  const id = value['id'];
  const tenantId = value['tenant_id'];
  const apiKeyId = value['api_key_id'];
  const occurredAt = value['occurred_at'];
  const route = value['route'];
  const method = value['method'];
  const status = value['status'];
  const rowsServed = value['rows_served'];
  const durationMs = value['duration_ms'];

  if (typeof id !== 'string' || !UUID_RE.test(id)) return null;
  if (typeof tenantId !== 'string' || !UUID_RE.test(tenantId)) return null;
  if (typeof apiKeyId !== 'string' || !UUID_RE.test(apiKeyId)) return null;
  if (typeof occurredAt !== 'string' || Number.isNaN(Date.parse(occurredAt))) return null;
  if (typeof route !== 'string' || route.length === 0) return null;
  if (ROUTE_HAS_QUERY_RE.test(route) || ROUTE_HAS_UUID_RE.test(route)) return null;
  if (typeof method !== 'string' || !ALLOWED_METHODS.has(method)) return null;
  if (typeof status !== 'number' || !Number.isInteger(status) || status < 100 || status > 599) {
    return null;
  }
  if (rowsServed !== undefined) {
    if (typeof rowsServed !== 'number' || !Number.isInteger(rowsServed) || rowsServed < 0) return null;
  }
  if (durationMs !== null && durationMs !== undefined) {
    if (typeof durationMs !== 'number' || !Number.isFinite(durationMs) || durationMs < 0) return null;
  }

  return {
    id,
    tenant_id: tenantId,
    api_key_id: apiKeyId,
    occurred_at: occurredAt,
    route,
    method,
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
  const rows = await executor.query<{ id: string }>(
    `insert into api_usage_events
       (id, tenant_id, api_key_id, occurred_at, route, method, status, rows_served, duration_ms)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     on conflict (id) do nothing
     returning id`,
    [
      event.id,
      event.tenant_id,
      event.api_key_id,
      event.occurred_at,
      event.route,
      event.method,
      event.status,
      event.rows_served,
      event.duration_ms,
    ],
  );
  return rows.length > 0 ? 'inserted' : 'duplicate';
}
