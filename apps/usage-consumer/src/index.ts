/**
 * `@data-foundry/usage-consumer` - the Cloudflare Queue consumer that turns
 * delivered usage events into rows in `api_usage_events`.
 *
 * This is the other half of the asymmetry `apps/edge` establishes: a read
 * request's success never depends on this consumer being up, because
 * `apps/edge` publishes to the queue and returns without waiting for a
 * database write. Everything that write needs to be safe under Cloudflare
 * Queues' at-least-once delivery lives here instead — idempotent persistence
 * per message, and never turning one malformed or failing message in a batch
 * into a reason to lose the rest of it.
 */
import {
  createPostgresDriver,
  type SqlDriver,
} from '@data-foundry/canonical-store';
import { parseUsageEvent, persistUsageEvents, type UsageEvent } from '@data-foundry/usage-events';
import { resolveConsumerConfig, type ConsumerEnv } from './env.js';

export { ConsumerConfigurationError, resolveConsumerConfig, type ConsumerEnv, type HyperdriveBinding } from './env.js';

/**
 * Cloudflare's Queue message, narrowed to what a consumer reads and calls.
 * Named locally rather than pulled from `@cloudflare/workers-types` — the
 * same choice `apps/edge/src/env.ts`'s `QueueBinding` already made, for the
 * same reason: this Worker is trusted with exactly the surface it uses.
 */
export interface QueueMessage<Body = unknown> {
  readonly id: string;
  readonly body: Body;
  ack(): void;
  retry(): void;
}

export interface QueueMessageBatch<Body = unknown> {
  readonly messages: readonly QueueMessage<Body>[];
}

/** One pooled driver per connection string, shared across every batch this isolate consumes. */
const drivers = new Map<string, Promise<SqlDriver>>();

export interface ConsumeOptions {
  readonly env: ConsumerEnv;
  /** Swappable so tests can compose against PGlite without a network. */
  readonly openDriver?: (connectionString: string) => Promise<SqlDriver>;
  readonly onError?: (error: unknown, context: ConsumerErrorContext) => void;
}

export interface ConsumerErrorContext {
  readonly stage: 'configuration' | 'parse' | 'persist';
  /** The queue's own message id — never the event's fields, which may not exist yet at the `parse` stage. */
  readonly messageId?: string;
}

function getDriver(options: ConsumeOptions): Promise<SqlDriver> {
  const config = resolveConsumerConfig(options.env);
  const existing = drivers.get(config.connectionString);
  if (existing !== undefined) return existing;

  const open = options.openDriver ?? createPostgresDriver;
  const pending = open(config.connectionString).catch((error: unknown) => {
    // A failed open must not stay cached, or one transient outage at cold
    // start would wedge every future batch until the isolate recycles.
    drivers.delete(config.connectionString);
    throw error;
  });
  drivers.set(config.connectionString, pending);
  return pending;
}

/** Test seam: drop cached drivers so a suite can compose a fresh one. */
export function resetDrivers(): void {
  drivers.clear();
}

function isIntegrityViolation(error: unknown): boolean {
  if (error === null || typeof error !== 'object') return false;
  const code = (error as { readonly code?: unknown }).code;
  return typeof code === 'string' && code.startsWith('23');
}

type ValidMessage = { readonly message: QueueMessage; readonly event: UsageEvent };

/**
 * Normal delivery is one statement. If and only if PostgreSQL identifies an
 * integrity violation, bisect the batch to isolate the poison message: valid
 * usage is still acked, while the one event that violates a foreign key or
 * CHECK reaches retry/DLQ. Transient/systemic failures never take this path;
 * they retry the whole valid subset so no partially acknowledged batch hides
 * an outage.
 */
async function persistValidMessages(
  driver: SqlDriver,
  valid: readonly ValidMessage[],
  onError: ConsumeOptions['onError'],
): Promise<void> {
  try {
    await persistUsageEvents(driver, valid.map(({ event }) => event));
    for (const { message } of valid) message.ack();
  } catch (error) {
    if (isIntegrityViolation(error) && valid.length > 1) {
      const midpoint = Math.floor(valid.length / 2);
      await persistValidMessages(driver, valid.slice(0, midpoint), onError);
      await persistValidMessages(driver, valid.slice(midpoint), onError);
      return;
    }
    for (const { message } of valid) {
      onError?.(error, { stage: 'persist', messageId: message.id });
      message.retry();
    }
  }
}

/**
 * Consume one batch.
 *
 * Malformed messages are isolated before persistence. Every well-formed
 * message is then written in one multi-row, idempotent statement. This keeps
 * the database round-trip count bounded and gives the valid subset atomic
 * semantics: either all valid rows are inserted/deduplicated and acked, or
 * none are committed and all are retried.
 *
 * A malformed message (fails `parseUsageEvent`) is retried rather than
 * acked. Queues has no "send straight to the dead-letter queue" API — the
 * only way a message leaves this queue without being persisted is exhausting
 * `max_retries`, configured on the consumer's `wrangler.toml`. Acking a
 * message this consumer could not parse would be the one way to make a bad
 * message disappear without ever being persisted *or* dead-lettered, so it
 * is never done here.
 *
 * A transient persistence failure (the database round trip throws) retries
 * every valid message. `persistUsageEvents`'s `ON CONFLICT (id) DO NOTHING`
 * makes redelivery safe: duplicates are acked exactly like newly inserted rows.
 */
export async function consumeBatch(batch: QueueMessageBatch, options: ConsumeOptions): Promise<void> {
  let driver: SqlDriver;
  try {
    driver = await getDriver(options);
  } catch (error) {
    options.onError?.(error, { stage: 'configuration' });
    // Nothing in this batch was acked or retried: Cloudflare Queues retries
    // the whole batch when `queue()` throws without disposing of every
    // message, which is the right behaviour for a systemic failure like a
    // missing database — not a reason to hand-roll a per-message retry loop
    // around a driver that does not exist.
    throw error;
  }

  const valid: ValidMessage[] = [];
  for (const message of batch.messages) {
    const event = parseUsageEvent(message.body);
    if (event === null) {
      options.onError?.(new Error('malformed usage event'), { stage: 'parse', messageId: message.id });
      message.retry();
      continue;
    }
    valid.push({ message, event });
  }

  if (valid.length === 0) return;

  await persistValidMessages(driver, valid, options.onError);
}

export default {
  queue: (batch: QueueMessageBatch, env: ConsumerEnv): Promise<void> =>
    consumeBatch(batch, {
      env,
      // Workers logs. `onError` never receives a message's raw body — the
      // callsites above pass only the queue's own message id and, at most,
      // the stage that failed — so this can log freely without becoming a
      // second place a plaintext key or a raw request target could leak.
      onError: (error, context) => {
        console.error(`[usage-consumer] ${context.stage}`, { messageId: context.messageId, error });
      },
    }),
};
