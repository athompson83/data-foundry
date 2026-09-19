import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  CANONICAL_HOSTNAMES,
  EXPECTED_MESSAGE_RETENTION_SECONDS,
  captureCloudflareReadbackSnapshot,
  evaluateCloudflareReadback,
  loadReadbackExpectations,
  parseReadbackArgs,
  run,
  type CloudflareReadbackSnapshot,
  type FetchLike,
  type ReadbackExpectations,
  type SnapshotQueue,
} from '../scripts/check-cloudflare-readback.js';

const temporaryDirectories: string[] = [];

afterAll(async () => {
  await Promise.all(temporaryDirectories.map((directory) => rm(directory, { recursive: true, force: true })));
});

const CANARY_WORKERS = [
  'data-foundry-private-canary-edge',
  'data-foundry-private-canary-web',
  'data-foundry-private-canary-usage-consumer',
  'data-foundry-private-canary-acquisition-worker',
  'data-foundry-private-canary-ingestion-worker',
  'data-foundry-private-canary-mcp-hvac',
  'data-foundry-private-canary',
];

const ORDINARY_WORKERS = [
  'data-foundry-edge',
  'data-foundry-web',
  'data-foundry-usage-consumer',
  'data-foundry-acquisition-worker',
  'data-foundry-ingestion-worker',
  'data-foundry-mcp-hvac',
];

/**
 * A snapshot the provider *would* return if it agreed with the tracked
 * manifests. Built from the expectations themselves so the fixture cannot
 * drift from the manifests; the tests below then assert what those
 * expectations contain, and break the fixture one fact at a time.
 */
function agreeingSnapshot(
  expectations: ReadbackExpectations,
  options: { readonly ordinaryDeployed?: boolean } = {},
): CloudflareReadbackSnapshot {
  const workers = [
    ...CANARY_WORKERS,
    ...(options.ordinaryDeployed ? ORDINARY_WORKERS : []),
    'unrelated-worker',
  ];
  const subdomains = Object.fromEntries(
    workers.map((name) => [name, { enabled: false, previews_enabled: false }]),
  );
  const queues: SnapshotQueue[] = [];
  const metrics: Record<string, { backlog_count: number; backlog_bytes: number; oldest_message_timestamp_ms: number }> = {};
  let counter = 0;
  const queueRow = (expected: ReadbackExpectations['exactQueues'][number], exact: boolean): SnapshotQueue => {
    counter += 1;
    const id = `q${counter.toString().padStart(31, '0')}`;
    metrics[id] = { backlog_count: 0, backlog_bytes: 0, oldest_message_timestamp_ms: 0 };
    const attachOrdinary = exact || options.ordinaryDeployed === true;
    return {
      queue_id: id,
      queue_name: expected.name,
      settings: { message_retention_period: EXPECTED_MESSAGE_RETENTION_SECONDS, delivery_delay: 0, delivery_paused: false },
      producers: attachOrdinary
        ? [...expected.producers].sort().map((script) => ({ type: 'worker', script }))
        : [],
      consumers:
        attachOrdinary && expected.consumer !== undefined
          ? [
              {
                type: 'worker',
                script_name: expected.consumer.script,
                ...(expected.consumer.deadLetterQueue === undefined
                  ? {}
                  : { dead_letter_queue: expected.consumer.deadLetterQueue }),
                settings: {
                  batch_size: expected.consumer.batchSize,
                  max_retries: expected.consumer.maxRetries,
                  max_wait_time_ms: expected.consumer.maxWaitTimeMs,
                  ...(expected.consumer.maxConcurrency === undefined
                    ? {}
                    : { max_concurrency: expected.consumer.maxConcurrency }),
                },
              },
            ]
          : [],
    };
  };
  for (const expected of expectations.exactQueues) queues.push(queueRow(expected, true));
  for (const expected of expectations.subsetQueues) queues.push(queueRow(expected, false));
  queues.push({
    queue_id: 'unrelated00000000000000000000000',
    queue_name: 'unrelated-queue',
    settings: { message_retention_period: 86_400 },
    producers: [],
    consumers: [],
  });
  return {
    workers,
    subdomains,
    routes: [{ id: 'r1', pattern: 'unrelated.example/*', script: 'unrelated-worker' }],
    domains: [{ hostname: 'unrelated.example', service: 'unrelated-worker' }],
    queues,
    metrics,
  };
}

/** A deep-copied, freely editable snapshot for breaking one fact at a time. */
interface MutableQueue {
  queue_id: string;
  queue_name: string;
  producers: { type?: string; script?: string; bucket_name?: string }[];
  consumers: {
    type?: string;
    script_name?: string;
    dead_letter_queue?: string;
    settings: { batch_size?: number; max_retries?: number; max_wait_time_ms?: number; max_concurrency?: number };
  }[];
  settings?: { message_retention_period?: number; delivery_delay?: number; delivery_paused?: boolean };
}

interface MutableSnapshot {
  workers: string[];
  subdomains: Record<string, { enabled: boolean; previews_enabled: boolean }>;
  routes: { id: string; pattern: string; script?: string }[] | null;
  domains: { hostname: string; service: string }[];
  queues: MutableQueue[];
  metrics: Record<string, { backlog_count: number; backlog_bytes: number; oldest_message_timestamp_ms: number }>;
}

function mutate(
  snapshot: CloudflareReadbackSnapshot,
  change: (draft: MutableSnapshot) => void,
): CloudflareReadbackSnapshot {
  const draft = JSON.parse(JSON.stringify(snapshot)) as MutableSnapshot;
  change(draft);
  return draft as unknown as CloudflareReadbackSnapshot;
}

function queueNamed(snapshot: MutableSnapshot, name: string): MutableQueue {
  const queue = snapshot.queues.find((candidate) => candidate.queue_name === name);
  if (queue === undefined) throw new Error(`fixture has no queue ${name}`);
  return queue;
}

describe('read-back expectations derived from the tracked manifests', () => {
  it('private-canary phase expects the seven canary Workers, five canary queues and the untouched ordinary pair', async () => {
    const expectations = await loadReadbackExpectations('private-canary');
    expect([...expectations.requiredWorkers].sort()).toEqual([...CANARY_WORKERS].sort());
    expect(expectations.exactQueues.map((queue) => queue.name)).toEqual([
      'data-foundry-private-canary-dlq',
      'data-foundry-private-canary-events',
      'data-foundry-private-canary-quarantine',
      'data-foundry-private-canary-usage-events',
      'data-foundry-private-canary-usage-events-dlq',
    ]);
    expect(expectations.subsetQueues.map((queue) => queue.name)).toEqual([
      'data-foundry-usage-events',
      'data-foundry-usage-events-dlq',
    ]);

    const byName = new Map(expectations.exactQueues.map((queue) => [queue.name, queue]));
    const usage = byName.get('data-foundry-private-canary-usage-events');
    expect([...(usage?.producers ?? [])].sort()).toEqual([
      'data-foundry-private-canary-edge',
      'data-foundry-private-canary-mcp-hvac',
    ]);
    expect(usage?.consumer).toEqual({
      script: 'data-foundry-private-canary-usage-consumer',
      batchSize: 100,
      maxRetries: 3,
      maxWaitTimeMs: 5000,
      maxConcurrency: undefined,
      deadLetterQueue: 'data-foundry-private-canary-usage-events-dlq',
    });
    const events = byName.get('data-foundry-private-canary-events');
    expect(events?.producers.size).toBe(0);
    expect(events?.consumer?.script).toBe('data-foundry-private-canary-usage-consumer');
    expect(events?.consumer?.batchSize).toBe(1);
    expect(events?.consumer?.maxWaitTimeMs).toBe(1000);
    expect(events?.consumer?.deadLetterQueue).toBe('data-foundry-private-canary-dlq');
    const dlq = byName.get('data-foundry-private-canary-dlq');
    expect(dlq?.consumer?.script).toBe('data-foundry-private-canary');
    expect(dlq?.consumer?.deadLetterQueue).toBe('data-foundry-private-canary-quarantine');
    expect(dlq?.mustBeEmpty).toBe(false);
    expect(byName.get('data-foundry-private-canary-quarantine')?.mustBeEmpty).toBe(true);
    expect(byName.get('data-foundry-private-canary-usage-events-dlq')?.mustBeEmpty).toBe(true);
    expect(byName.get('data-foundry-private-canary-usage-events-dlq')?.consumer).toBeUndefined();
  });

  it('ordinary-route-less phase adds the six ordinary Workers and the usage and ingestion topologies', async () => {
    const expectations = await loadReadbackExpectations('ordinary-route-less');
    expect([...expectations.requiredWorkers].sort()).toEqual([...CANARY_WORKERS, ...ORDINARY_WORKERS].sort());
    expect(expectations.subsetQueues).toEqual([]);
    const byName = new Map(expectations.exactQueues.map((queue) => [queue.name, queue]));
    expect([...byName.keys()].sort()).toEqual([
      'data-foundry-ingestion',
      'data-foundry-ingestion-dlq',
      'data-foundry-private-canary-dlq',
      'data-foundry-private-canary-events',
      'data-foundry-private-canary-quarantine',
      'data-foundry-private-canary-usage-events',
      'data-foundry-private-canary-usage-events-dlq',
      'data-foundry-usage-events',
      'data-foundry-usage-events-dlq',
    ]);
    const ingestion = byName.get('data-foundry-ingestion');
    expect([...(ingestion?.producers ?? [])].sort()).toEqual([
      'data-foundry-acquisition-worker',
      'data-foundry-ingestion-worker',
    ]);
    expect(ingestion?.consumer).toEqual({
      script: 'data-foundry-ingestion-worker',
      batchSize: 1,
      maxRetries: 5,
      maxWaitTimeMs: 5000,
      maxConcurrency: 1,
      deadLetterQueue: 'data-foundry-ingestion-dlq',
    });
    expect(byName.get('data-foundry-ingestion-dlq')?.mustBeEmpty).toBe(true);
    const usage = byName.get('data-foundry-usage-events');
    expect([...(usage?.producers ?? [])].sort()).toEqual(['data-foundry-edge', 'data-foundry-mcp-hvac']);
    expect(usage?.consumer?.script).toBe('data-foundry-usage-consumer');
    expect(usage?.consumer?.deadLetterQueue).toBe('data-foundry-usage-events-dlq');
  });
});

describe('evaluating a provider snapshot against the private-canary phase', () => {
  it('passes when the provider agrees with the manifests and reports sanitized observations', async () => {
    const expectations = await loadReadbackExpectations('private-canary');
    const report = evaluateCloudflareReadback(agreeingSnapshot(expectations), expectations);
    expect(report.errors).toEqual([]);
    expect(report.observations).toContain('workers named data-foundry-*: 7.');
    expect(report.observations).toContain('queues named data-foundry-*: 7.');
    expect(report.observations).toContain(
      `queue data-foundry-private-canary-quarantine: retention ${EXPECTED_MESSAGE_RETENTION_SECONDS} s.`,
    );
    expect(report.observations).toContain('worker data-foundry-private-canary: 0 zone routes.');
    // Nothing that looks like an identifier or a route pattern leaks into the report.
    for (const line of [...report.observations, ...report.errors]) {
      expect(line).not.toMatch(/q0{20,}/);
      expect(line).not.toContain('unrelated.example');
    }
  });

  it('tolerates the ordinary usage pair having no producer or consumer before the ordinary Workers exist', async () => {
    const expectations = await loadReadbackExpectations('private-canary');
    const snapshot = agreeingSnapshot(expectations);
    expect(snapshot.queues.find((queue) => queue.queue_name === 'data-foundry-usage-events')?.consumers).toEqual([]);
    expect(evaluateCloudflareReadback(snapshot, expectations).errors).toEqual([]);
  });

  it('accepts the ordinary Workers being attached to the ordinary pair, but never a private-canary script', async () => {
    const expectations = await loadReadbackExpectations('private-canary');
    const attached = mutate(agreeingSnapshot(expectations), (draft) => {
      const usage = queueNamed(draft, 'data-foundry-usage-events');
      usage.producers.push({ type: 'worker', script: 'data-foundry-edge' });
      usage.consumers.push({
        type: 'worker',
        script_name: 'data-foundry-usage-consumer',
        dead_letter_queue: 'data-foundry-usage-events-dlq',
        settings: { batch_size: 100, max_retries: 3, max_wait_time_ms: 5000 },
      });
    });
    expect(evaluateCloudflareReadback(attached, expectations).errors).toEqual([]);

    const poisoned = mutate(agreeingSnapshot(expectations), (draft) => {
      const dlq = queueNamed(draft, 'data-foundry-usage-events-dlq');
      dlq.consumers.push({ type: 'worker', script_name: 'data-foundry-private-canary', settings: {} });
    });
    const report = evaluateCloudflareReadback(poisoned, expectations);
    expect(report.errors).toContain(
      'queue data-foundry-usage-events-dlq: private-canary script data-foundry-private-canary is attached to an ordinary queue.',
    );
    expect(report.errors).toContain(
      'queue data-foundry-usage-events-dlq: unexpected consumer data-foundry-private-canary.',
    );
  });

  it('fails on the wrong retention, a paused queue, or a delivery delay', async () => {
    const expectations = await loadReadbackExpectations('private-canary');
    const report = evaluateCloudflareReadback(
      mutate(agreeingSnapshot(expectations), (draft) => {
        const quarantine = queueNamed(draft, 'data-foundry-private-canary-quarantine');
        quarantine.settings = { message_retention_period: 345_600, delivery_paused: true, delivery_delay: 30 };
      }),
      expectations,
    );
    expect(report.errors).toEqual([
      'queue data-foundry-private-canary-quarantine: message retention is 345600 s; expected 1209600 s.',
      'queue data-foundry-private-canary-quarantine: delivery is paused.',
      'queue data-foundry-private-canary-quarantine: delivery delay is 30 s; expected 0.',
    ]);
  });

  it('fails when retention is not reported at all', async () => {
    const expectations = await loadReadbackExpectations('private-canary');
    const report = evaluateCloudflareReadback(
      mutate(agreeingSnapshot(expectations), (draft) => {
        delete queueNamed(draft, 'data-foundry-private-canary-events').settings;
      }),
      expectations,
    );
    expect(report.errors).toEqual([
      'queue data-foundry-private-canary-events: message retention is unreported s; expected 1209600 s.',
    ]);
  });

  it('fails when a terminal failure queue holds messages, and when metrics are missing', async () => {
    const expectations = await loadReadbackExpectations('private-canary');
    const backlog = mutate(agreeingSnapshot(expectations), (draft) => {
      const quarantine = queueNamed(draft, 'data-foundry-private-canary-quarantine');
      const metric = draft.metrics[quarantine.queue_id];
      if (metric !== undefined) metric.backlog_count = 2;
      const dlq = queueNamed(draft, 'data-foundry-private-canary-dlq');
      const hop = draft.metrics[dlq.queue_id];
      if (hop !== undefined) hop.backlog_count = 1;
    });
    const report = evaluateCloudflareReadback(backlog, expectations);
    expect(report.errors).toEqual([
      'queue data-foundry-private-canary-quarantine: terminal failure queue holds 2 message(s); investigate, do not purge.',
    ]);
    expect(report.observations).toContain('queue data-foundry-private-canary-dlq: backlog 1 message(s), 0 byte(s).');

    const missing = mutate(agreeingSnapshot(expectations), (draft) => {
      const events = queueNamed(draft, 'data-foundry-private-canary-events');
      delete draft.metrics[events.queue_id];
    });
    expect(evaluateCloudflareReadback(missing, expectations).errors).toEqual([
      'queue data-foundry-private-canary-events: backlog metrics were not read back.',
    ]);
  });

  it('fails on a drifted consumer policy, a wrong dead-letter target, or an extra producer', async () => {
    const expectations = await loadReadbackExpectations('private-canary');
    const report = evaluateCloudflareReadback(
      mutate(agreeingSnapshot(expectations), (draft) => {
        const events = queueNamed(draft, 'data-foundry-private-canary-events');
        const consumer = events.consumers[0];
        if (consumer === undefined) throw new Error('fixture consumer missing');
        consumer.settings.max_retries = 5;
        consumer.settings.batch_size = 10;
        consumer.dead_letter_queue = 'data-foundry-usage-events-dlq';
        events.producers.push({ type: 'worker', script: 'data-foundry-private-canary-web' });
        events.producers.push({ type: 'r2_bucket', bucket_name: 'data-foundry-raw-artifacts' });
      }),
      expectations,
    );
    expect(report.errors).toEqual([
      'queue data-foundry-private-canary-events: 1 R2 bucket producer(s) attached; expected none.',
      'queue data-foundry-private-canary-events: producers are data-foundry-private-canary-web; expected (none).',
      'queue data-foundry-private-canary-events: consumer batch size is 10; expected 1.',
      'queue data-foundry-private-canary-events: consumer max retries is 5; expected 3.',
      'queue data-foundry-private-canary-events: dead-letter queue is data-foundry-usage-events-dlq; expected data-foundry-private-canary-dlq.',
    ]);
  });

  it('fails when a consumer is missing, doubled, or the wrong script', async () => {
    const expectations = await loadReadbackExpectations('private-canary');
    const snapshot = mutate(agreeingSnapshot(expectations), (draft) => {
      const dlq = queueNamed(draft, 'data-foundry-private-canary-dlq');
      const consumer = dlq.consumers[0];
      if (consumer === undefined) throw new Error('fixture consumer missing');
      consumer.script_name = 'data-foundry-usage-consumer';
      const quarantine = queueNamed(draft, 'data-foundry-private-canary-quarantine');
      quarantine.consumers.push({ type: 'worker', script_name: 'data-foundry-private-canary', settings: {} });
      const usage = queueNamed(draft, 'data-foundry-private-canary-usage-events');
      usage.consumers.push({ type: 'worker', script_name: 'data-foundry-private-canary-usage-consumer', settings: {} });
    });
    const report = evaluateCloudflareReadback(snapshot, expectations);
    expect(report.errors).toContain(
      'queue data-foundry-private-canary-dlq: consumer is data-foundry-usage-consumer; expected data-foundry-private-canary.',
    );
    expect(report.errors).toContain(
      'queue data-foundry-private-canary-quarantine: expected no consumer; found data-foundry-private-canary.',
    );
    expect(report.errors).toContain(
      'queue data-foundry-private-canary-usage-events: expected exactly one consumer (data-foundry-private-canary-usage-consumer); found 2.',
    );
  });

  it('fails when an expected Worker or queue is absent, or an unexpected data-foundry queue exists', async () => {
    const expectations = await loadReadbackExpectations('private-canary');
    const report = evaluateCloudflareReadback(
      mutate(agreeingSnapshot(expectations), (draft) => {
        draft.workers = draft.workers.filter((name) => name !== 'data-foundry-private-canary-web');
        draft.queues = draft.queues.filter((queue) => queue.queue_name !== 'data-foundry-usage-events-dlq');
        draft.queues.push({
          queue_id: 'extra000000000000000000000000000',
          queue_name: 'data-foundry-ingestion',
          settings: { message_retention_period: EXPECTED_MESSAGE_RETENTION_SECONDS },
          producers: [],
          consumers: [],
        });
      }),
      expectations,
    );
    expect(report.errors).toContain('worker data-foundry-private-canary-web: not present in the account.');
    expect(report.errors).toContain('queue data-foundry-usage-events-dlq: not present in the account.');
    expect(report.errors).toContain('queue data-foundry-ingestion: not in the private-canary inventory.');
  });

  it('fails when any data-foundry Worker has workers.dev, previews, a route or a custom domain', async () => {
    const expectations = await loadReadbackExpectations('private-canary');
    const report = evaluateCloudflareReadback(
      mutate(agreeingSnapshot(expectations), (draft) => {
        draft.subdomains['data-foundry-private-canary-edge'] = { enabled: true, previews_enabled: true };
        delete draft.subdomains['data-foundry-private-canary-web'];
        draft.routes?.push({ id: 'r2', pattern: 'canary.example/*', script: 'data-foundry-private-canary-mcp-hvac' });
        draft.domains.push({ hostname: 'canary.example', service: 'data-foundry-private-canary-mcp-hvac' });
        // An ordinary Worker that happens to exist is held to the same posture.
        draft.workers.push('data-foundry-edge');
        draft.subdomains['data-foundry-edge'] = { enabled: false, previews_enabled: true };
      }),
      expectations,
    );
    expect(report.errors).toEqual([
      'worker data-foundry-edge: preview URLs are enabled; expected disabled.',
      'worker data-foundry-private-canary-edge: workers.dev subdomain is enabled; expected disabled.',
      'worker data-foundry-private-canary-edge: preview URLs are enabled; expected disabled.',
      'worker data-foundry-private-canary-mcp-hvac: 1 zone route(s) attached; expected 0.',
      'worker data-foundry-private-canary-mcp-hvac: 1 custom domain(s) attached; expected 0.',
      'worker data-foundry-private-canary-web: workers.dev / preview flags were not read back.',
    ]);
    for (const line of report.errors) expect(line).not.toContain('canary.example');
  });

  it('fails when a canonical hostname is served by any Worker, in any spelling, before UA-005', async () => {
    const expectations = await loadReadbackExpectations('private-canary');
    for (const hostname of CANONICAL_HOSTNAMES) {
      const viaRoute = mutate(agreeingSnapshot(expectations), (draft) => {
        draft.routes?.push({ id: 'r9', pattern: `${hostname.toUpperCase()}/*`, script: 'unrelated-worker' });
      });
      expect(evaluateCloudflareReadback(viaRoute, expectations).errors).toEqual([
        `a zone route targets canonical hostname ${hostname}; UA-005 public cutover has not been authorized.`,
      ]);
      const viaWildcard = mutate(agreeingSnapshot(expectations), (draft) => {
        draft.routes?.push({ id: 'r9', pattern: `https://*.${hostname}/v1/*`, script: 'unrelated-worker' });
      });
      expect(evaluateCloudflareReadback(viaWildcard, expectations).errors).toHaveLength(1);
      const viaDomain = mutate(agreeingSnapshot(expectations), (draft) => {
        draft.domains.push({ hostname: `${hostname}.`, service: 'unrelated-worker' });
      });
      expect(evaluateCloudflareReadback(viaDomain, expectations).errors).toEqual([
        `custom domain ${hostname}. is bound to a Worker; UA-005 public cutover has not been authorized.`,
      ]);
    }
  });

  it('fails closed when zone routes could not be read', async () => {
    const expectations = await loadReadbackExpectations('private-canary');
    const report = evaluateCloudflareReadback(
      mutate(agreeingSnapshot(expectations), (draft) => {
        draft.routes = null;
      }),
      expectations,
    );
    expect(report.errors).toEqual(['zone Worker routes were not read back (no zone available).']);
  });
});

describe('evaluating a provider snapshot against the ordinary-route-less phase', () => {
  it('fails while the ordinary Workers and ingestion queues are absent', async () => {
    const expectations = await loadReadbackExpectations('ordinary-route-less');
    const canaryOnly = agreeingSnapshot(await loadReadbackExpectations('private-canary'));
    const report = evaluateCloudflareReadback(canaryOnly, expectations);
    for (const name of ORDINARY_WORKERS) {
      expect(report.errors).toContain(`worker ${name}: not present in the account.`);
    }
    expect(report.errors).toContain('queue data-foundry-ingestion: not present in the account.');
    expect(report.errors).toContain('queue data-foundry-ingestion-dlq: not present in the account.');
    expect(report.errors).toContain(
      'queue data-foundry-usage-events: producers are (none); expected data-foundry-edge, data-foundry-mcp-hvac.',
    );
  });

  it('passes once the ordinary topology is deployed route-less with exact queue bindings', async () => {
    const expectations = await loadReadbackExpectations('ordinary-route-less');
    const report = evaluateCloudflareReadback(agreeingSnapshot(expectations, { ordinaryDeployed: true }), expectations);
    expect(report.errors).toEqual([]);
    expect(report.observations).toContain('workers named data-foundry-*: 13.');
    expect(report.observations).toContain('queues named data-foundry-*: 9.');
  });

  it('checks the ingestion consumer concurrency the manifest pins', async () => {
    const expectations = await loadReadbackExpectations('ordinary-route-less');
    const report = evaluateCloudflareReadback(
      mutate(agreeingSnapshot(expectations, { ordinaryDeployed: true }), (draft) => {
        const ingestion = queueNamed(draft, 'data-foundry-ingestion');
        const consumer = ingestion.consumers[0];
        if (consumer === undefined) throw new Error('fixture consumer missing');
        delete consumer.settings.max_concurrency;
      }),
      expectations,
    );
    expect(report.errors).toEqual([
      'queue data-foundry-ingestion: consumer max concurrency is unreported; expected 1.',
    ]);
  });
});

describe('capturing a snapshot through the read-only REST API', () => {
  const ACCOUNT = 'acct0000000000000000000000000000';
  const ZONE = 'zone0000000000000000000000000000';

  function fakeApi(
    responses: Readonly<Record<string, unknown>>,
    seen: { urls: string[]; headers: Record<string, string>[] },
  ): FetchLike {
    return async (input, init) => {
      seen.urls.push(input);
      seen.headers.push({ ...init.headers });
      const path = input.replace('https://api.cloudflare.com/client/v4', '');
      const key = Object.keys(responses).find((candidate) => path === candidate || path.startsWith(`${candidate}?`));
      const body = key === undefined ? undefined : responses[key];
      if (body === undefined) {
        return { ok: false, status: 404, json: async () => ({ success: false, errors: [{ code: 10007, message: 'not found' }] }) };
      }
      return { ok: true, status: 200, json: async () => body };
    };
  }

  const envelope = (result: unknown, extra: Record<string, unknown> = {}) => ({
    success: true,
    errors: [],
    messages: [],
    result,
    ...extra,
  });

  it('reads scripts, per-script subdomain flags, zone routes, domains, queues and metrics with a bearer token', async () => {
    const seen = { urls: [] as string[], headers: [] as Record<string, string>[] };
    const fetch = fakeApi(
      {
        [`/accounts/${ACCOUNT}/workers/scripts`]: envelope([{ id: 'data-foundry-private-canary' }, { id: 'other' }]),
        [`/accounts/${ACCOUNT}/workers/scripts/data-foundry-private-canary/subdomain`]: envelope({
          enabled: false,
          previews_enabled: false,
        }),
        [`/zones/${ZONE}/workers/routes`]: envelope([{ id: 'r1', pattern: 'x.example/*', script: 'other' }]),
        [`/accounts/${ACCOUNT}/workers/domains`]: envelope([
          { id: 'd1', hostname: 'x.example', service: 'other', zone_name: 'example' },
        ]),
        [`/accounts/${ACCOUNT}/queues`]: envelope([
          {
            queue_id: 'q1',
            queue_name: 'data-foundry-private-canary-quarantine',
            settings: { message_retention_period: 1_209_600 },
            producers: [],
            consumers: [],
          },
          { queue_id: 'q2', queue_name: 'other-queue', settings: {} },
        ]),
        [`/accounts/${ACCOUNT}/queues/q1/metrics`]: envelope({
          backlog_count: 0,
          backlog_bytes: 0,
          oldest_message_timestamp_ms: 0,
        }),
      },
      seen,
    );
    const snapshot = await captureCloudflareReadbackSnapshot({
      apiToken: 'token-value',
      accountId: ACCOUNT,
      zoneId: ZONE,
      fetch,
    });
    expect(snapshot.workers).toEqual(['data-foundry-private-canary', 'other']);
    expect(snapshot.subdomains).toEqual({ 'data-foundry-private-canary': { enabled: false, previews_enabled: false } });
    expect(snapshot.routes).toEqual([{ id: 'r1', pattern: 'x.example/*', script: 'other' }]);
    expect(snapshot.domains).toEqual([{ hostname: 'x.example', service: 'other', zone_name: 'example' }]);
    expect(snapshot.queues.map((queue) => queue.queue_name)).toEqual([
      'data-foundry-private-canary-quarantine',
      'other-queue',
    ]);
    expect(snapshot.metrics).toEqual({ q1: { backlog_count: 0, backlog_bytes: 0, oldest_message_timestamp_ms: 0 } });
    // Only Data Foundry scripts and queues are probed individually.
    expect(seen.urls.some((url) => url.includes('/scripts/other/subdomain'))).toBe(false);
    expect(seen.urls.some((url) => url.includes('/queues/q2/metrics'))).toBe(false);
    for (const headers of seen.headers) expect(headers['Authorization']).toBe('Bearer token-value');
  });

  it('resolves the canonical zone by name when no zone id is supplied, and leaves routes null when it cannot', async () => {
    const seen = { urls: [] as string[], headers: [] as Record<string, string>[] };
    const base = {
      [`/accounts/${ACCOUNT}/workers/scripts`]: envelope([]),
      [`/accounts/${ACCOUNT}/workers/domains`]: envelope([]),
      [`/accounts/${ACCOUNT}/queues`]: envelope([]),
    };
    const resolved = await captureCloudflareReadbackSnapshot({
      apiToken: 't',
      accountId: ACCOUNT,
      fetch: fakeApi(
        {
          ...base,
          '/zones': envelope([{ id: ZONE, name: 'aroqon.com' }]),
          [`/zones/${ZONE}/workers/routes`]: envelope([]),
        },
        seen,
      ),
    });
    expect(resolved.routes).toEqual([]);
    expect(seen.urls.some((url) => url.includes('/zones?name=aroqon.com'))).toBe(true);

    const unresolved = await captureCloudflareReadbackSnapshot({
      apiToken: 't',
      accountId: ACCOUNT,
      fetch: fakeApi({ ...base, '/zones': envelope([]) }, seen),
    });
    expect(unresolved.routes).toBeNull();
  });

  it('follows pagination and fails loudly on an API error without echoing the token', async () => {
    const seen = { urls: [] as string[], headers: [] as Record<string, string>[] };
    const pages: Record<string, unknown> = {
      [`/accounts/${ACCOUNT}/workers/domains`]: envelope([], { result_info: { page: 1, total_pages: 1 } }),
      [`/accounts/${ACCOUNT}/queues`]: envelope([]),
      '/zones': envelope([]),
    };
    const paged: FetchLike = async (input, init) => {
      if (input.includes('/workers/scripts?page=1')) {
        return { ok: true, status: 200, json: async () => envelope([{ id: 'a' }], { result_info: { page: 1, total_pages: 2 } }) };
      }
      if (input.includes('/workers/scripts?page=2')) {
        return { ok: true, status: 200, json: async () => envelope([{ id: 'b' }], { result_info: { page: 2, total_pages: 2 } }) };
      }
      return fakeApi(pages, seen)(input, init);
    };
    const snapshot = await captureCloudflareReadbackSnapshot({ apiToken: 'secret-token', accountId: ACCOUNT, fetch: paged });
    expect(snapshot.workers).toEqual(['a', 'b']);

    const failing: FetchLike = async () => ({
      ok: false,
      status: 403,
      json: async () => ({ success: false, errors: [{ code: 10000, message: 'Authentication error' }] }),
    });
    await expect(
      captureCloudflareReadbackSnapshot({ apiToken: 'secret-token', accountId: ACCOUNT, fetch: failing }),
    ).rejects.toThrow('workers list: HTTP 403 (codes 10000).');
  });
});

describe('command line', () => {
  it('parses the phase, snapshot and capture options and rejects the rest', () => {
    expect(parseReadbackArgs([])).toEqual({ phase: 'private-canary' });
    expect(parseReadbackArgs(['--', '--phase', 'private-canary'])).toEqual({ phase: 'private-canary' });
    expect(parseReadbackArgs(['--phase', 'ordinary-route-less', '--snapshot', 'x.json'])).toEqual({
      phase: 'ordinary-route-less',
      snapshotPath: 'x.json',
    });
    expect(parseReadbackArgs(['--capture', 'out.json'])).toEqual({ phase: 'private-canary', capturePath: 'out.json' });
    expect(() => parseReadbackArgs(['--phase', 'public'])).toThrow('Usage');
    expect(() => parseReadbackArgs(['--snapshot'])).toThrow('Usage');
    expect(() => parseReadbackArgs(['--snapshot', 'a', '--capture', 'b'])).toThrow('mutually exclusive');
    expect(() => parseReadbackArgs(['--token', 'x'])).toThrow('Usage');
  });

  it('refuses live mode without credentials in the environment and never reads them from argv', async () => {
    const stderr: string[] = [];
    const code = await run({ phase: 'private-canary' }, {}, { stdout: () => {}, stderr: (text) => stderr.push(text) });
    expect(code).toBe(2);
    expect(stderr.join('')).toContain('CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID');
  });

  it('evaluates a captured snapshot offline and exits 0 or 1 with sanitized output', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'df-readback-'));
    temporaryDirectories.push(directory);
    const expectations = await loadReadbackExpectations('private-canary');
    const good = join(directory, 'good.json');
    await writeFile(good, JSON.stringify(agreeingSnapshot(expectations)));
    const stdout: string[] = [];
    const stderr: string[] = [];
    const io = { stdout: (text: string) => stdout.push(text), stderr: (text: string) => stderr.push(text) };
    expect(await run({ phase: 'private-canary', snapshotPath: good }, {}, io)).toBe(0);
    expect(stdout.join('')).toContain('OK: Cloudflare read-back matches the private-canary phase');
    expect(stderr).toEqual([]);

    const bad = join(directory, 'bad.json');
    await writeFile(
      bad,
      JSON.stringify(
        mutate(agreeingSnapshot(expectations), (draft) => {
          draft.subdomains['data-foundry-private-canary'] = { enabled: true, previews_enabled: false };
        }),
      ),
    );
    expect(await run({ phase: 'private-canary', snapshotPath: bad }, {}, io)).toBe(1);
    expect(stderr.join('')).toContain('worker data-foundry-private-canary: workers.dev subdomain is enabled; expected disabled.');

    const malformed = join(directory, 'malformed.json');
    await writeFile(malformed, JSON.stringify({ workers: 'nope' }));
    expect(await run({ phase: 'private-canary', snapshotPath: malformed }, {}, io)).toBe(1);
    expect(stderr.join('')).toContain('does not have the captured read-back shape');
    expect(await readFile(good, 'utf8')).toContain('"workers"');
  });
});
