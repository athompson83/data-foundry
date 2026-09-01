import { describe, expect, it, vi } from 'vitest';
import type {
  PrivateCanaryProbeInput,
  PrivateCanaryProbeResult,
  PrivateCanaryWorker,
} from '@data-foundry/private-canary';
import {
  consumePrivateCanaryBatch,
  type PrivateCanaryEnv,
  type PrivateCanaryQueueMessage,
} from '../src/index.js';
import privateCanaryWorker from '../src/index.js';

const envelope = {
  kind: 'data-foundry.private-canary.v1',
  run_id: '11111111-1111-4111-8111-111111111111',
  issued_at: '2026-09-01T12:00:00.000Z',
  tenant_id: '22222222-2222-4222-8222-222222222222',
  vertical_id: '33333333-3333-4333-8333-333333333333',
  edge_api_key_id: '44444444-4444-4444-8444-444444444444',
  mcp_api_key_id: '55555555-5555-4555-8555-555555555555',
  edge_event_id: '66666666-6666-4666-8666-666666666666',
  mcp_event_id: '77777777-7777-4777-8777-777777777777',
} as const;

const expectedInput: PrivateCanaryProbeInput = {
  runId: envelope.run_id,
  tenantId: envelope.tenant_id,
  verticalId: envelope.vertical_id,
  edgeApiKeyId: envelope.edge_api_key_id,
  mcpApiKeyId: envelope.mcp_api_key_id,
  edgeEventId: envelope.edge_event_id,
  mcpEventId: envelope.mcp_event_id,
};

function probeResult(worker: PrivateCanaryWorker): PrivateCanaryProbeResult {
  return {
    worker,
    runId: envelope.run_id,
    readiness: 'READY',
    metering: worker === 'edge' || worker === 'mcp-worker' ? 'QUEUED' : 'NOT_APPLICABLE',
  };
}

function queueMessage(body: unknown): PrivateCanaryQueueMessage {
  return {
    id: 'queue-message-id',
    body,
    ack: vi.fn(),
    retry: vi.fn(),
  };
}

function canaryEnv(overrides: Partial<PrivateCanaryEnv> = {}): {
  readonly env: PrivateCanaryEnv;
  readonly calls: { readonly worker: PrivateCanaryWorker; readonly input: PrivateCanaryProbeInput }[];
  readonly receipts: { readonly key: string; readonly value: string }[];
} {
  const calls: { worker: PrivateCanaryWorker; input: PrivateCanaryProbeInput }[] = [];
  const receipts: { key: string; value: string }[] = [];
  const binding = (worker: PrivateCanaryWorker) => ({
    probe: async (input: PrivateCanaryProbeInput): Promise<PrivateCanaryProbeResult> => {
      calls.push({ worker, input });
      return probeResult(worker);
    },
  });
  return {
    env: {
      EDGE_CANARY: binding('edge'),
      WEB_CANARY: binding('web'),
      USAGE_CONSUMER_CANARY: binding('usage-consumer'),
      ACQUISITION_CANARY: binding('acquisition-worker'),
      MCP_CANARY: binding('mcp-worker'),
      CANARY_RECEIPTS: {
        put: async (key: string, value: string): Promise<void> => {
          receipts.push({ key, value });
        },
      },
      ...overrides,
    },
    calls,
    receipts,
  };
}

describe('private-canary DLQ consumer', () => {
  it('exports only the Queue handler, never an Internet-reachable fetch handler', () => {
    expect(Object.keys(privateCanaryWorker)).toEqual(['queue']);
  });

  it('acknowledges only after every named RPC probe is ready and writes one sanitized receipt', async () => {
    const message = queueMessage(envelope);
    const { env, calls, receipts } = canaryEnv();

    await consumePrivateCanaryBatch({ messages: [message] }, env, {
      now: () => new Date('2026-09-01T12:01:00.000Z'),
    });

    expect(calls).toEqual([
      { worker: 'edge', input: expectedInput },
      { worker: 'web', input: expectedInput },
      { worker: 'usage-consumer', input: expectedInput },
      { worker: 'acquisition-worker', input: expectedInput },
      { worker: 'mcp-worker', input: expectedInput },
    ]);
    expect(message.ack).toHaveBeenCalledOnce();
    expect(message.retry).not.toHaveBeenCalled();
    expect(receipts).toEqual([{
      key: `runs/${envelope.run_id}.json`,
      value: JSON.stringify({
        kind: 'data-foundry.private-canary-receipt.v1',
        run_id: envelope.run_id,
        completed_at: '2026-09-01T12:01:00.000Z',
        probes: [
          probeResult('edge'),
          probeResult('web'),
          probeResult('usage-consumer'),
          probeResult('acquisition-worker'),
          probeResult('mcp-worker'),
        ],
      }),
    }]);
    expect(receipts[0]?.value).not.toMatch(/authorization|token|source|url|content/i);
  });

  it('retries an unrecognized DLQ message without calling a target or writing a receipt', async () => {
    const message = queueMessage({ ...envelope, token: 'must-not-be-accepted' });
    const { env, calls, receipts } = canaryEnv();

    await consumePrivateCanaryBatch({ messages: [message] }, env);

    expect(calls).toEqual([]);
    expect(receipts).toEqual([]);
    expect(message.ack).not.toHaveBeenCalled();
    expect(message.retry).toHaveBeenCalledOnce();
  });

  it('retries without a receipt when a named service returns invalid or swapped evidence', async () => {
    const message = queueMessage(envelope);
    const { env, receipts } = canaryEnv({
      EDGE_CANARY: {
        probe: async () => ({
          ...probeResult('edge'),
          worker: 'mcp-worker',
          metering: 'QUEUED',
        }),
      },
    });

    await consumePrivateCanaryBatch({ messages: [message] }, env);

    expect(receipts).toEqual([]);
    expect(message.ack).not.toHaveBeenCalled();
    expect(message.retry).toHaveBeenCalledOnce();
  });

  it('uses the deterministic run receipt key on redelivery rather than creating an additional canary artifact', async () => {
    const first = queueMessage(envelope);
    const second = queueMessage(envelope);
    const { env, receipts } = canaryEnv();

    await consumePrivateCanaryBatch({ messages: [first, second] }, env, {
      now: () => new Date('2026-09-01T12:01:00.000Z'),
    });

    expect(first.ack).toHaveBeenCalledOnce();
    expect(second.ack).toHaveBeenCalledOnce();
    expect(new Set(receipts.map(({ key }) => key))).toEqual(new Set([`runs/${envelope.run_id}.json`]));
    expect(receipts.map(({ value }) => value)).toEqual([receipts[0]?.value, receipts[0]?.value]);
  });
});
