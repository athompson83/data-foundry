/**
 * Route-less private-canary Worker.
 *
 * The normal usage consumer retries the fixed synthetic envelope until it
 * arrives in the existing DLQ. This Worker consumes only that narrow shape,
 * invokes the five named service-entrypoint capabilities, and persists a
 * closed receipt. It deliberately has no `fetch` handler, secret, database,
 * Hyperdrive, source artifact, or public route.
 */
import {
  createPrivateCanaryReceipt,
  parsePrivateCanaryEnvelope,
  parsePrivateCanaryProbeResult,
  toPrivateCanaryProbeInput,
  type PrivateCanaryProbe,
  type PrivateCanaryProbeResult,
  type PrivateCanaryWorker,
} from '@data-foundry/private-canary';

export interface PrivateCanaryQueueMessage<Body = unknown> {
  readonly id: string;
  readonly body: Body;
  ack(): void;
  retry(): void;
}

export interface PrivateCanaryQueueBatch<Body = unknown> {
  readonly messages: readonly PrivateCanaryQueueMessage<Body>[];
}

/** The least R2 capability the worker needs: put one sanitized receipt. */
export interface PrivateCanaryReceiptBucket {
  put(key: string, value: string): Promise<unknown>;
}

/**
 * Every binding names a target Worker entrypoint rather than an HTTP URL.
 * No service identity, credential, endpoint, or raw source record crosses
 * this boundary.
 */
export interface PrivateCanaryEnv {
  readonly EDGE_CANARY: PrivateCanaryProbe;
  readonly WEB_CANARY: PrivateCanaryProbe;
  readonly USAGE_CONSUMER_CANARY: PrivateCanaryProbe;
  readonly ACQUISITION_CANARY: PrivateCanaryProbe;
  readonly MCP_CANARY: PrivateCanaryProbe;
  readonly CANARY_RECEIPTS: PrivateCanaryReceiptBucket;
}

export interface PrivateCanaryConsumeOptions {
  /** Test seam; the deployed handler records the completion time itself. */
  readonly now?: () => Date;
}

const TARGETS: readonly (readonly [PrivateCanaryWorker, keyof Pick<
  PrivateCanaryEnv,
  'EDGE_CANARY' | 'WEB_CANARY' | 'USAGE_CONSUMER_CANARY' | 'ACQUISITION_CANARY' | 'MCP_CANARY'
>])[] = [
  ['edge', 'EDGE_CANARY'],
  ['web', 'WEB_CANARY'],
  ['usage-consumer', 'USAGE_CONSUMER_CANARY'],
  ['acquisition-worker', 'ACQUISITION_CANARY'],
  ['mcp-worker', 'MCP_CANARY'],
];

async function collectProbes(
  env: PrivateCanaryEnv,
  input: ReturnType<typeof toPrivateCanaryProbeInput>,
): Promise<readonly PrivateCanaryProbeResult[] | null> {
  const probes: PrivateCanaryProbeResult[] = [];
  for (const [worker, binding] of TARGETS) {
    const result = parsePrivateCanaryProbeResult(await env[binding].probe(input));
    // A valid-looking result from a different entrypoint is not proof of this
    // target's readiness. Fail closed before anything becomes durable.
    if (result === null || result.worker !== worker) return null;
    probes.push(result);
  }
  return probes;
}

function receiptKey(runId: string): string {
  return `runs/${runId}.json`;
}

async function consumeMessage(
  message: PrivateCanaryQueueMessage,
  env: PrivateCanaryEnv,
  now: () => Date,
): Promise<void> {
  const envelope = parsePrivateCanaryEnvelope(message.body);
  if (envelope === null) {
    // This DLQ must never become a discard path for a message this Worker did
    // not understand. Do not log the body: it is not this Worker's data.
    message.retry();
    return;
  }

  try {
    const probes = await collectProbes(env, toPrivateCanaryProbeInput(envelope));
    if (probes === null) {
      message.retry();
      return;
    }
    const receipt = createPrivateCanaryReceipt({
      runId: envelope.run_id,
      completedAt: now().toISOString(),
      probes,
    });
    // The deterministic key makes a delivery retry overwrite only the same
    // safe receipt; it cannot accumulate source-derived artifacts.
    await env.CANARY_RECEIPTS.put(receiptKey(envelope.run_id), JSON.stringify(receipt));
    message.ack();
  } catch {
    // A service/R2 failure may carry provider or implementation detail in its
    // Error message. It is intentionally neither logged nor stored here.
    message.retry();
  }
}

/**
 * Process each DLQ delivery independently. A single bad or unavailable probe
 * never acknowledges another canary's message.
 */
export async function consumePrivateCanaryBatch(
  batch: PrivateCanaryQueueBatch,
  env: PrivateCanaryEnv,
  options: PrivateCanaryConsumeOptions = {},
): Promise<void> {
  const now = options.now ?? (() => new Date());
  for (const message of batch.messages) {
    await consumeMessage(message, env, now);
  }
}

export default {
  queue: (batch: PrivateCanaryQueueBatch, env: PrivateCanaryEnv): Promise<void> =>
    consumePrivateCanaryBatch(batch, env),
};
