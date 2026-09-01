import { describe, expect, it } from 'vitest';
import {
  createPrivateCanaryReceipt,
  parsePrivateCanaryEnvelope,
  parsePrivateCanaryProbeResult,
  PRIVATE_CANARY_SERVICE_BINDING_MODE,
  resolvePrivateCanaryConnectionString,
  toPrivateCanaryProbeInput,
} from '../src/index.js';

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

describe('private canary DLQ envelope', () => {
  it('accepts only fixed synthetic correlation fields and derives secret-free probe input', () => {
    const parsed = parsePrivateCanaryEnvelope(JSON.parse(JSON.stringify(envelope)) as unknown);

    expect(parsed).toEqual(envelope);
    if (parsed === null) throw new Error('the fixed private-canary envelope must parse');
    expect(toPrivateCanaryProbeInput(parsed)).toEqual({
      runId: '11111111-1111-4111-8111-111111111111',
      tenantId: '22222222-2222-4222-8222-222222222222',
      verticalId: '33333333-3333-4333-8333-333333333333',
      edgeApiKeyId: '44444444-4444-4444-8444-444444444444',
      mcpApiKeyId: '55555555-5555-4555-8555-555555555555',
      edgeEventId: '66666666-6666-4666-8666-666666666666',
      mcpEventId: '77777777-7777-4777-8777-777777777777',
    });
  });

  it('refuses an unknown field so credentials, source content, and URLs cannot ride the DLQ control path', () => {
    for (const field of ['authorization', 'source_url', 'raw_content', 'token'] as const) {
      expect(parsePrivateCanaryEnvelope({ ...envelope, [field]: 'must-not-be-accepted' }), field).toBeNull();
    }
  });

  it('requires a canonical fixture timestamp rather than accepting arbitrary control metadata', () => {
    expect(parsePrivateCanaryEnvelope({ ...envelope, issued_at: '2026-09-01' })).toBeNull();
    expect(parsePrivateCanaryEnvelope({ ...envelope, issued_at: 'not-a-time' })).toBeNull();
  });

  it('refuses malformed deterministic correlation ids', () => {
    expect(parsePrivateCanaryEnvelope({ ...envelope, run_id: 'not-a-uuid' })).toBeNull();
    expect(parsePrivateCanaryEnvelope({ ...envelope, tenant_id: 'not-a-uuid' })).toBeNull();
  });

  it('requires a UUID v4 run id while retaining generic UUID correlation identifiers', () => {
    expect(parsePrivateCanaryEnvelope({
      ...envelope,
      run_id: '11111111-1111-1111-8111-111111111111',
    })).toBeNull();
  });
});

describe('private canary target runtime binding', () => {
  it('accepts only an explicitly service-bound production Hyperdrive', () => {
    expect(resolvePrivateCanaryConnectionString({
      DEPLOYMENT_ENVIRONMENT: 'production',
      PRIVATE_CANARY_MODE: PRIVATE_CANARY_SERVICE_BINDING_MODE,
      HYPERDRIVE: { connectionString: 'postgres://hyperdrive.fixture/private-canary' },
    })).toBe('postgres://hyperdrive.fixture/private-canary');
  });

  it('refuses a missing service-binding mode or direct database fallback', () => {
    expect(() => resolvePrivateCanaryConnectionString({
      DEPLOYMENT_ENVIRONMENT: 'production',
      HYPERDRIVE: { connectionString: 'postgres://hyperdrive.fixture/private-canary' },
    })).toThrow('Private canary requires an explicit service-binding deployment.');
    expect(() => resolvePrivateCanaryConnectionString({
      DEPLOYMENT_ENVIRONMENT: 'production',
      PRIVATE_CANARY_MODE: PRIVATE_CANARY_SERVICE_BINDING_MODE,
      POSTGRES_URL: 'postgres://direct.fixture/must-not-be-used',
    })).toThrow('Private canary does not permit a direct database connection.');
  });
});

describe('private canary RPC receipts', () => {
  const edgeProbe = {
    worker: 'edge',
    runId: '11111111-1111-4111-8111-111111111111',
    readiness: 'READY',
    metering: 'QUEUED',
  } as const;
  const probes = [
    edgeProbe,
    {
      worker: 'web',
      runId: envelope.run_id,
      readiness: 'READY',
      metering: 'NOT_APPLICABLE',
    },
    {
      worker: 'usage-consumer',
      runId: envelope.run_id,
      readiness: 'READY',
      metering: 'NOT_APPLICABLE',
    },
    {
      worker: 'acquisition-worker',
      runId: envelope.run_id,
      readiness: 'READY',
      metering: 'NOT_APPLICABLE',
    },
    {
      worker: 'mcp-worker',
      runId: envelope.run_id,
      readiness: 'READY',
      metering: 'QUEUED',
    },
  ] as const;

  it('keeps only fixed worker/readiness/metering values in the durable receipt', () => {
    const probe = parsePrivateCanaryProbeResult(JSON.parse(JSON.stringify(edgeProbe)) as unknown);

    expect(probe).toEqual(edgeProbe);
    if (probe === null) throw new Error('the fixed edge probe result must parse');
    expect(createPrivateCanaryReceipt({
      runId: envelope.run_id,
      completedAt: '2026-09-01T12:01:00.000Z',
      probes,
    })).toEqual({
      kind: 'data-foundry.private-canary-receipt.v1',
      run_id: '11111111-1111-4111-8111-111111111111',
      completed_at: '2026-09-01T12:01:00.000Z',
      probes,
    });
  });

  it('refuses arbitrary diagnostic content from an RPC result before it can reach R2', () => {
    expect(parsePrivateCanaryProbeResult({
      ...edgeProbe,
      error: 'https://commercial-source.example/private-record',
    })).toBeNull();
    expect(parsePrivateCanaryProbeResult({
      ...edgeProbe,
      detail: 'Bearer must-not-persist',
    })).toBeNull();
  });

  it('refuses UUID versions other than v4 for result and receipt run identifiers', () => {
    const nonV4RunId = '11111111-1111-1111-8111-111111111111';
    expect(parsePrivateCanaryProbeResult({ ...edgeProbe, runId: nonV4RunId })).toBeNull();
    expect(() => createPrivateCanaryReceipt({
      runId: nonV4RunId,
      completedAt: '2026-09-01T12:01:00.000Z',
      probes: probes.map((probe) => ({ ...probe, runId: nonV4RunId })),
    })).toThrow(TypeError);
  });

  it('refuses an incomplete or mismatched probe set rather than recording partial canary success', () => {
    expect(() => createPrivateCanaryReceipt({
      runId: envelope.run_id,
      completedAt: '2026-09-01T12:01:00.000Z',
      probes: probes.slice(0, 4),
    })).toThrow(TypeError);
    expect(() => createPrivateCanaryReceipt({
      runId: envelope.run_id,
      completedAt: '2026-09-01T12:01:00.000Z',
      probes: [{ ...edgeProbe, runId: '88888888-8888-4888-8888-888888888888' }, ...probes.slice(1)],
    })).toThrow(TypeError);
  });
});
