/**
 * Read back, from the Cloudflare account itself, the runtime facts the
 * 2026-09-18 reconciliation could not observe with `wrangler` or the
 * connector: queue message retention and backlog, Worker zone routes, Worker
 * custom domains, and the per-script `workers.dev` / preview-URL flags.
 *
 * The expectations are derived from the tracked Worker manifests rather than
 * typed in twice: every `[[queues.producers]]` and `[[queues.consumers]]`
 * block in the tracked templates says which Worker may touch which queue and
 * with which retry policy, and every template pins `workers_dev = false` and
 * `preview_urls = false` and declares no route. The provider is then required
 * to agree.
 *
 * Two phases are checked:
 *
 * - `private-canary` — the current hosted state. The seven route-less
 *   private-canary Workers and their five dedicated queues must exist with
 *   exactly the tracked topology; the ordinary usage pair must be untouched by
 *   any private-canary script; nothing named `data-foundry-*` may hold a zone
 *   route, a custom domain, a `workers.dev` subdomain or a preview URL; and no
 *   canonical hostname from ADR-0012 may be served by a Worker (`UA-005` is
 *   unexecuted).
 * - `ordinary-route-less` — the next step: the six ordinary Workers are also
 *   deployed, still without routes, and the ordinary usage and ingestion
 *   queue topologies match their manifests exactly.
 *
 * Provider access is read-only and comes from the process environment
 * (`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, optionally
 * `CLOUDFLARE_ZONE_ID`), never from argv. A previously captured snapshot can be
 * evaluated offline with `--snapshot`, which is also how the tests exercise the
 * evaluator. Output is sanitized: it names Workers, queues and canonical
 * hostnames, and prints booleans, counts and seconds, but never an account,
 * zone, queue or route identifier, a route pattern, or a token.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'smol-toml';
import { isMain } from '../lib/cli-entry.js';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(HERE, '..', '..');

/** 14 days, the retention every Data Foundry queue is created with. */
export const EXPECTED_MESSAGE_RETENTION_SECONDS = 1_209_600;
/** ADR-0012 canonical hostnames; none may be served by a Worker before `UA-005`. */
export const CANONICAL_HOSTNAMES = [
  'data.aroqon.com',
  'api.data.aroqon.com',
  'mcp.data.aroqon.com',
] as const;
/** The zone those hostnames live in (ADR-0012). Used only to resolve a zone id read-only. */
export const CANONICAL_ZONE_NAME = 'aroqon.com';
export const DATA_FOUNDRY_NAME_PREFIX = 'data-foundry-';
export const PRIVATE_CANARY_NAME_PREFIX = 'data-foundry-private-canary';

export type ReadbackPhase = 'private-canary' | 'ordinary-route-less';

const ORDINARY_MANIFESTS = [
  'apps/edge/wrangler.toml',
  'apps/web/wrangler.toml',
  'apps/usage-consumer/wrangler.toml',
  'apps/acquisition-worker/wrangler.toml',
  'apps/ingestion-worker/wrangler.toml',
  'apps/mcp-worker/wrangler.toml',
] as const;

const PRIVATE_CANARY_MANIFESTS = [
  'apps/edge/wrangler.private-canary.toml',
  'apps/web/wrangler.private-canary.toml',
  'apps/usage-consumer/wrangler.private-canary.toml',
  'apps/acquisition-worker/wrangler.private-canary.toml',
  'apps/ingestion-worker/wrangler.private-canary.toml',
  'apps/mcp-worker/wrangler.private-canary.toml',
  'apps/private-canary/wrangler.toml',
] as const;

// ---------------------------------------------------------------------------
// Provider snapshot: the raw read-only responses, in the API's own shapes.
// ---------------------------------------------------------------------------

export interface SnapshotQueueConsumerSettings {
  readonly batch_size?: number;
  readonly max_retries?: number;
  readonly max_wait_time_ms?: number;
  readonly max_concurrency?: number;
  readonly retry_delay?: number;
}

export interface SnapshotQueueConsumer {
  readonly type?: string;
  readonly script_name?: string;
  readonly dead_letter_queue?: string;
  readonly settings?: SnapshotQueueConsumerSettings;
}

export interface SnapshotQueueProducer {
  readonly type?: string;
  readonly script?: string;
  readonly bucket_name?: string;
}

export interface SnapshotQueue {
  readonly queue_id: string;
  readonly queue_name: string;
  readonly producers?: readonly SnapshotQueueProducer[];
  readonly consumers?: readonly SnapshotQueueConsumer[];
  readonly settings?: {
    readonly message_retention_period?: number;
    readonly delivery_delay?: number;
    readonly delivery_paused?: boolean;
  };
}

export interface SnapshotQueueMetrics {
  readonly backlog_count: number;
  readonly backlog_bytes: number;
  readonly oldest_message_timestamp_ms: number;
}

export interface SnapshotSubdomain {
  readonly enabled: boolean;
  readonly previews_enabled: boolean;
}

export interface SnapshotRoute {
  readonly id: string;
  readonly pattern: string;
  readonly script?: string;
}

export interface SnapshotDomain {
  readonly hostname: string;
  readonly service: string;
  readonly zone_name?: string;
}

export interface CloudflareReadbackSnapshot {
  /** Script names present in the account. */
  readonly workers: readonly string[];
  /** Per-script `workers.dev` and preview flags, keyed by script name. */
  readonly subdomains: Readonly<Record<string, SnapshotSubdomain>>;
  /** Zone Worker routes, or `null` when no zone could be read. */
  readonly routes: readonly SnapshotRoute[] | null;
  /** Account-level Worker custom domains. */
  readonly domains: readonly SnapshotDomain[];
  readonly queues: readonly SnapshotQueue[];
  /** Best-effort backlog metrics keyed by queue id. */
  readonly metrics: Readonly<Record<string, SnapshotQueueMetrics>>;
}

// ---------------------------------------------------------------------------
// Expectations derived from the tracked manifests.
// ---------------------------------------------------------------------------

export interface ExpectedConsumer {
  readonly script: string;
  readonly batchSize: number;
  readonly maxRetries: number;
  readonly maxWaitTimeMs: number;
  readonly maxConcurrency: number | undefined;
  readonly deadLetterQueue: string | undefined;
}

export interface ExpectedQueue {
  readonly name: string;
  readonly producers: ReadonlySet<string>;
  readonly consumer: ExpectedConsumer | undefined;
  /** True when the queue must be empty after a healthy cycle (DLQs, quarantine). */
  readonly mustBeEmpty: boolean;
}

export interface ReadbackExpectations {
  readonly phase: ReadbackPhase;
  /** Workers that must exist. */
  readonly requiredWorkers: readonly string[];
  /** Queues that must exist with exactly this topology. */
  readonly exactQueues: readonly ExpectedQueue[];
  /**
   * Queues that must exist with the expected retention and whose attached
   * scripts must be a subset of the manifest topology (the ordinary pair
   * while the ordinary Workers are not deployed yet).
   */
  readonly subsetQueues: readonly ExpectedQueue[];
}

type TomlObject = Record<string, unknown>;

function object(value: unknown): TomlObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as TomlObject)
    : {};
}

function objects(value: unknown): readonly TomlObject[] {
  return Array.isArray(value) ? value.map(object) : [];
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

interface ManifestQueueFacts {
  readonly worker: string;
  readonly produces: readonly string[];
  readonly consumes: readonly { readonly queue: string; readonly consumer: ExpectedConsumer }[];
}

async function readManifestQueueFacts(relativePath: string): Promise<ManifestQueueFacts> {
  const config = object(parse(await readFile(join(REPO_ROOT, relativePath), 'utf8')));
  const worker = typeof config['name'] === 'string' ? config['name'] : '';
  if (worker === '') {
    throw new Error(`${relativePath} does not declare a Worker name.`);
  }
  const queues = object(config['queues']);
  const produces = objects(queues['producers'])
    .map((producer) => producer['queue'])
    .filter((queue): queue is string => typeof queue === 'string');
  const consumes = objects(queues['consumers']).flatMap(
    (consumer): { readonly queue: string; readonly consumer: ExpectedConsumer }[] => {
      const queue = consumer['queue'];
      if (typeof queue !== 'string') return [];
      const deadLetterQueue = consumer['dead_letter_queue'];
      return [
        {
          queue,
          consumer: {
            script: worker,
            // Wrangler's defaults when a manifest omits them.
            batchSize: numberOr(consumer['max_batch_size'], 10),
            maxRetries: numberOr(consumer['max_retries'], 3),
            maxWaitTimeMs: numberOr(consumer['max_batch_timeout'], 5) * 1000,
            maxConcurrency: optionalNumber(consumer['max_concurrency']),
            deadLetterQueue: typeof deadLetterQueue === 'string' ? deadLetterQueue : undefined,
          },
        },
      ];
    },
  );
  return { worker, produces, consumes };
}

function buildQueues(facts: readonly ManifestQueueFacts[]): ExpectedQueue[] {
  const producers = new Map<string, Set<string>>();
  const consumers = new Map<string, ExpectedConsumer[]>();
  const names = new Set<string>();
  for (const fact of facts) {
    for (const queue of fact.produces) {
      names.add(queue);
      const set = producers.get(queue) ?? new Set<string>();
      set.add(fact.worker);
      producers.set(queue, set);
    }
    for (const { queue, consumer } of fact.consumes) {
      names.add(queue);
      if (consumer.deadLetterQueue !== undefined) names.add(consumer.deadLetterQueue);
      const list = consumers.get(queue) ?? [];
      list.push(consumer);
      consumers.set(queue, list);
    }
  }
  const deadLetterTargets = new Set(
    [...consumers.values()]
      .flat()
      .map((consumer) => consumer.deadLetterQueue)
      .filter((name): name is string => name !== undefined),
  );
  return [...names].sort().map((name) => {
    const attached = consumers.get(name) ?? [];
    if (attached.length > 1) {
      throw new Error(`Tracked manifests attach more than one consumer to ${name}.`);
    }
    const consumer = attached[0];
    return {
      name,
      producers: producers.get(name) ?? new Set<string>(),
      consumer,
      // A queue that only ever receives exhausted messages must stay empty; a
      // dead-letter target that itself has a consumer (the canary DLQ feeding
      // the harness) is a hop, not a terminal state.
      mustBeEmpty: deadLetterTargets.has(name) && consumer === undefined,
    };
  });
}

export async function loadReadbackExpectations(phase: ReadbackPhase): Promise<ReadbackExpectations> {
  const canary = await Promise.all(PRIVATE_CANARY_MANIFESTS.map(readManifestQueueFacts));
  const ordinary = await Promise.all(ORDINARY_MANIFESTS.map(readManifestQueueFacts));
  const canaryQueues = buildQueues(canary);
  const ordinaryQueues = buildQueues(ordinary);
  const canaryWorkers = canary.map((fact) => fact.worker);
  const ordinaryWorkers = ordinary.map((fact) => fact.worker);
  if (phase === 'private-canary') {
    // Before the ordinary Workers exist, only the ordinary usage pair is
    // expected to be present (it predates the canary); the ingestion pair is
    // created with the ordinary deployment.
    const ordinaryUsage = ordinaryQueues.filter((queue) => queue.name.startsWith('data-foundry-usage-events'));
    return {
      phase,
      requiredWorkers: canaryWorkers,
      exactQueues: canaryQueues,
      subsetQueues: ordinaryUsage,
    };
  }
  return {
    phase,
    requiredWorkers: [...canaryWorkers, ...ordinaryWorkers],
    exactQueues: [...canaryQueues, ...ordinaryQueues],
    subsetQueues: [],
  };
}

// ---------------------------------------------------------------------------
// Evaluation: expectations against a snapshot. Sanitized findings only.
// ---------------------------------------------------------------------------

export interface ReadbackReport {
  readonly errors: readonly string[];
  /** Sanitized observations, safe to archive as evidence. */
  readonly observations: readonly string[];
}

function consumerScripts(queue: SnapshotQueue): string[] {
  return (queue.consumers ?? [])
    .map((consumer) => consumer.script_name)
    .filter((script): script is string => typeof script === 'string');
}

function producerScripts(queue: SnapshotQueue): string[] {
  return (queue.producers ?? [])
    .map((producer) => producer.script)
    .filter((script): script is string => typeof script === 'string');
}

function sortedList(values: Iterable<string>): string {
  const list = [...values].sort();
  return list.length === 0 ? '(none)' : list.join(', ');
}

function checkRetention(queue: SnapshotQueue, errors: string[], observations: string[]): void {
  const retention = queue.settings?.message_retention_period;
  if (retention !== EXPECTED_MESSAGE_RETENTION_SECONDS) {
    errors.push(
      `queue ${queue.queue_name}: message retention is ${retention ?? 'unreported'} s; expected ${EXPECTED_MESSAGE_RETENTION_SECONDS} s.`,
    );
  } else {
    observations.push(`queue ${queue.queue_name}: retention ${retention} s.`);
  }
  if (queue.settings?.delivery_paused === true) {
    errors.push(`queue ${queue.queue_name}: delivery is paused.`);
  }
  const delay = queue.settings?.delivery_delay;
  if (delay !== undefined && delay !== 0) {
    errors.push(`queue ${queue.queue_name}: delivery delay is ${delay} s; expected 0.`);
  }
}

function checkBacklog(
  queue: SnapshotQueue,
  expected: ExpectedQueue,
  snapshot: CloudflareReadbackSnapshot,
  errors: string[],
  observations: string[],
): void {
  const metrics = snapshot.metrics[queue.queue_id];
  if (metrics === undefined) {
    errors.push(`queue ${queue.queue_name}: backlog metrics were not read back.`);
    return;
  }
  observations.push(
    `queue ${queue.queue_name}: backlog ${metrics.backlog_count} message(s), ${metrics.backlog_bytes} byte(s).`,
  );
  if (expected.mustBeEmpty && metrics.backlog_count !== 0) {
    errors.push(
      `queue ${queue.queue_name}: terminal failure queue holds ${metrics.backlog_count} message(s); investigate, do not purge.`,
    );
  }
}

function checkExactConsumer(queue: SnapshotQueue, expected: ExpectedQueue, errors: string[]): void {
  const consumers = queue.consumers ?? [];
  if (expected.consumer === undefined) {
    if (consumers.length !== 0) {
      errors.push(`queue ${queue.queue_name}: expected no consumer; found ${sortedList(consumerScripts(queue))}.`);
    }
    return;
  }
  if (consumers.length !== 1) {
    errors.push(
      `queue ${queue.queue_name}: expected exactly one consumer (${expected.consumer.script}); found ${consumers.length}.`,
    );
    return;
  }
  const consumer = consumers[0];
  if (consumer === undefined) return;
  if (consumer.type !== undefined && consumer.type !== 'worker') {
    errors.push(`queue ${queue.queue_name}: consumer type is ${consumer.type}; expected worker.`);
  }
  if (consumer.script_name !== expected.consumer.script) {
    errors.push(
      `queue ${queue.queue_name}: consumer is ${consumer.script_name ?? '(unnamed)'}; expected ${expected.consumer.script}.`,
    );
  }
  const settings = consumer.settings ?? {};
  const checks: readonly [string, number | undefined, number | undefined][] = [
    ['batch size', settings.batch_size, expected.consumer.batchSize],
    ['max retries', settings.max_retries, expected.consumer.maxRetries],
    ['max wait time (ms)', settings.max_wait_time_ms, expected.consumer.maxWaitTimeMs],
  ];
  for (const [label, actual, wanted] of checks) {
    if (actual !== wanted) {
      errors.push(`queue ${queue.queue_name}: consumer ${label} is ${actual ?? 'unreported'}; expected ${wanted}.`);
    }
  }
  if (
    expected.consumer.maxConcurrency !== undefined &&
    settings.max_concurrency !== expected.consumer.maxConcurrency
  ) {
    errors.push(
      `queue ${queue.queue_name}: consumer max concurrency is ${settings.max_concurrency ?? 'unreported'}; expected ${expected.consumer.maxConcurrency}.`,
    );
  }
  if ((consumer.dead_letter_queue ?? undefined) !== expected.consumer.deadLetterQueue) {
    errors.push(
      `queue ${queue.queue_name}: dead-letter queue is ${consumer.dead_letter_queue ?? '(none)'}; expected ${expected.consumer.deadLetterQueue ?? '(none)'}.`,
    );
  }
}

function checkExactProducers(queue: SnapshotQueue, expected: ExpectedQueue, errors: string[]): void {
  const actual = new Set(producerScripts(queue));
  const bucketProducers = (queue.producers ?? []).filter((producer) => producer.type === 'r2_bucket');
  if (bucketProducers.length !== 0) {
    errors.push(`queue ${queue.queue_name}: ${bucketProducers.length} R2 bucket producer(s) attached; expected none.`);
  }
  const same = actual.size === expected.producers.size && [...actual].every((s) => expected.producers.has(s));
  if (!same) {
    errors.push(
      `queue ${queue.queue_name}: producers are ${sortedList(actual)}; expected ${sortedList(expected.producers)}.`,
    );
  }
}

function checkSubsetTopology(queue: SnapshotQueue, expected: ExpectedQueue, errors: string[]): void {
  for (const script of producerScripts(queue)) {
    if (!expected.producers.has(script)) {
      errors.push(`queue ${queue.queue_name}: unexpected producer ${script}.`);
    }
  }
  const consumers = queue.consumers ?? [];
  if (consumers.length > 1) {
    errors.push(`queue ${queue.queue_name}: ${consumers.length} consumers attached; expected at most one.`);
  }
  for (const consumer of consumers) {
    if (expected.consumer === undefined || consumer.script_name !== expected.consumer.script) {
      errors.push(`queue ${queue.queue_name}: unexpected consumer ${consumer.script_name ?? '(unnamed)'}.`);
    }
  }
  for (const script of [...producerScripts(queue), ...consumerScripts(queue)]) {
    if (script.startsWith(PRIVATE_CANARY_NAME_PREFIX)) {
      errors.push(`queue ${queue.queue_name}: private-canary script ${script} is attached to an ordinary queue.`);
    }
  }
}

function checkWorkerExposure(
  name: string,
  snapshot: CloudflareReadbackSnapshot,
  errors: string[],
  observations: string[],
): void {
  const subdomain = snapshot.subdomains[name];
  if (subdomain === undefined) {
    errors.push(`worker ${name}: workers.dev / preview flags were not read back.`);
  } else {
    if (subdomain.enabled) errors.push(`worker ${name}: workers.dev subdomain is enabled; expected disabled.`);
    if (subdomain.previews_enabled) errors.push(`worker ${name}: preview URLs are enabled; expected disabled.`);
    if (!subdomain.enabled && !subdomain.previews_enabled) {
      observations.push(`worker ${name}: workers.dev disabled, previews disabled.`);
    }
  }
  if (snapshot.routes !== null) {
    const routes = snapshot.routes.filter((route) => route.script === name).length;
    if (routes !== 0) errors.push(`worker ${name}: ${routes} zone route(s) attached; expected 0.`);
    else observations.push(`worker ${name}: 0 zone routes.`);
  }
  const domains = snapshot.domains.filter((domain) => domain.service === name).length;
  if (domains !== 0) errors.push(`worker ${name}: ${domains} custom domain(s) attached; expected 0.`);
  else observations.push(`worker ${name}: 0 custom domains.`);
}

function routeHostname(pattern: string): string {
  const withoutScheme = pattern.replace(/^[a-z]+:\/\//i, '');
  const host = withoutScheme.split('/')[0] ?? '';
  return host.replace(/:\d+$/, '').replace(/\.$/, '').toLowerCase();
}

function hostnameMatchesCanonical(hostname: string): boolean {
  const lowered = hostname.replace(/\.$/, '').toLowerCase();
  return CANONICAL_HOSTNAMES.some((canonical) => lowered === canonical || lowered === `*.${canonical}`);
}

export function evaluateCloudflareReadback(
  snapshot: CloudflareReadbackSnapshot,
  expectations: ReadbackExpectations,
): ReadbackReport {
  const errors: string[] = [];
  const observations: string[] = [];
  const present = new Set(snapshot.workers);

  // Workers ---------------------------------------------------------------
  for (const name of expectations.requiredWorkers) {
    if (!present.has(name)) errors.push(`worker ${name}: not present in the account.`);
  }
  const dataFoundryWorkers = [...present].filter((name) => name.startsWith(DATA_FOUNDRY_NAME_PREFIX)).sort();
  observations.push(`workers named ${DATA_FOUNDRY_NAME_PREFIX}*: ${dataFoundryWorkers.length}.`);
  for (const name of dataFoundryWorkers) {
    checkWorkerExposure(name, snapshot, errors, observations);
  }

  // Routes and domains as a whole ----------------------------------------
  if (snapshot.routes === null) {
    errors.push('zone Worker routes were not read back (no zone available).');
  } else {
    observations.push(`zone Worker routes: ${snapshot.routes.length}.`);
    for (const route of snapshot.routes) {
      if (hostnameMatchesCanonical(routeHostname(route.pattern))) {
        errors.push(
          `a zone route targets canonical hostname ${routeHostname(route.pattern)}; UA-005 public cutover has not been authorized.`,
        );
      }
      if (route.script !== undefined && route.script.startsWith(DATA_FOUNDRY_NAME_PREFIX) && !present.has(route.script)) {
        errors.push(`a zone route names absent worker ${route.script}.`);
      }
    }
  }
  observations.push(`Worker custom domains: ${snapshot.domains.length}.`);
  for (const domain of snapshot.domains) {
    if (hostnameMatchesCanonical(domain.hostname)) {
      errors.push(
        `custom domain ${domain.hostname.toLowerCase()} is bound to a Worker; UA-005 public cutover has not been authorized.`,
      );
    }
  }

  // Queues ----------------------------------------------------------------
  const byName = new Map(snapshot.queues.map((queue) => [queue.queue_name, queue] as const));
  const expectedNames = new Set([
    ...expectations.exactQueues.map((queue) => queue.name),
    ...expectations.subsetQueues.map((queue) => queue.name),
  ]);
  for (const expected of expectations.exactQueues) {
    const queue = byName.get(expected.name);
    if (queue === undefined) {
      errors.push(`queue ${expected.name}: not present in the account.`);
      continue;
    }
    checkRetention(queue, errors, observations);
    checkExactProducers(queue, expected, errors);
    checkExactConsumer(queue, expected, errors);
    checkBacklog(queue, expected, snapshot, errors, observations);
  }
  for (const expected of expectations.subsetQueues) {
    const queue = byName.get(expected.name);
    if (queue === undefined) {
      errors.push(`queue ${expected.name}: not present in the account.`);
      continue;
    }
    checkRetention(queue, errors, observations);
    checkSubsetTopology(queue, expected, errors);
    checkBacklog(queue, expected, snapshot, errors, observations);
  }
  for (const queue of snapshot.queues) {
    if (queue.queue_name.startsWith(DATA_FOUNDRY_NAME_PREFIX) && !expectedNames.has(queue.queue_name)) {
      errors.push(`queue ${queue.queue_name}: not in the ${expectations.phase} inventory.`);
    }
  }
  const dataFoundryQueues = snapshot.queues.filter((queue) => queue.queue_name.startsWith(DATA_FOUNDRY_NAME_PREFIX));
  observations.push(`queues named ${DATA_FOUNDRY_NAME_PREFIX}*: ${dataFoundryQueues.length}.`);

  return { errors: [...new Set(errors)], observations };
}

// ---------------------------------------------------------------------------
// Live capture through the read-only REST API.
// ---------------------------------------------------------------------------

export type FetchLike = (
  input: string,
  init: { readonly headers: Readonly<Record<string, string>> },
) => Promise<{ readonly ok: boolean; readonly status: number; json(): Promise<unknown> }>;

export interface CaptureOptions {
  readonly apiToken: string;
  readonly accountId: string;
  readonly zoneId?: string;
  readonly fetch?: FetchLike;
  readonly baseUrl?: string;
}

interface ApiEnvelope {
  readonly success?: boolean;
  readonly result?: unknown;
  readonly result_info?: { readonly page?: number; readonly total_pages?: number };
  readonly errors?: readonly { readonly code?: number; readonly message?: string }[];
}

function describeFailure(label: string, status: number, envelope: ApiEnvelope | undefined): string {
  const codes = (envelope?.errors ?? []).map((error) => error.code).filter((code) => code !== undefined);
  return `${label}: HTTP ${status}${codes.length === 0 ? '' : ` (codes ${codes.join(', ')})`}.`;
}

async function getJson(
  fetchImpl: FetchLike,
  baseUrl: string,
  token: string,
  path: string,
  label: string,
): Promise<ApiEnvelope> {
  const response = await fetchImpl(`${baseUrl}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  let envelope: ApiEnvelope | undefined;
  try {
    envelope = (await response.json()) as ApiEnvelope;
  } catch {
    envelope = undefined;
  }
  if (!response.ok || envelope === undefined || envelope.success !== true) {
    throw new Error(describeFailure(label, response.status, envelope));
  }
  return envelope;
}

async function getAllPages(
  fetchImpl: FetchLike,
  baseUrl: string,
  token: string,
  path: string,
  label: string,
): Promise<unknown[]> {
  const items: unknown[] = [];
  for (let page = 1; page <= 50; page += 1) {
    const separator = path.includes('?') ? '&' : '?';
    const envelope = await getJson(fetchImpl, baseUrl, token, `${path}${separator}page=${page}&per_page=100`, label);
    items.push(...(Array.isArray(envelope.result) ? envelope.result : []));
    const totalPages = envelope.result_info?.total_pages ?? 1;
    if (page >= totalPages) return items;
  }
  throw new Error(`${label}: more than 50 pages; refusing to continue.`);
}

export async function captureCloudflareReadbackSnapshot(options: CaptureOptions): Promise<CloudflareReadbackSnapshot> {
  const fetchImpl = options.fetch ?? (globalThis.fetch as unknown as FetchLike);
  const baseUrl = options.baseUrl ?? 'https://api.cloudflare.com/client/v4';
  const token = options.apiToken;
  const account = encodeURIComponent(options.accountId);

  const scripts = await getAllPages(fetchImpl, baseUrl, token, `/accounts/${account}/workers/scripts`, 'workers list');
  const workers = scripts
    .map((script) => object(script))
    .map((script) => (typeof script['id'] === 'string' ? script['id'] : ''))
    .filter((name) => name !== '')
    .sort();

  const subdomains: Record<string, SnapshotSubdomain> = {};
  for (const name of workers) {
    if (!name.startsWith(DATA_FOUNDRY_NAME_PREFIX)) continue;
    const envelope = await getJson(
      fetchImpl,
      baseUrl,
      token,
      `/accounts/${account}/workers/scripts/${encodeURIComponent(name)}/subdomain`,
      `subdomain flags for ${name}`,
    );
    const result = object(envelope.result);
    subdomains[name] = {
      enabled: result['enabled'] === true,
      previews_enabled: result['previews_enabled'] === true,
    };
  }

  let zoneId = options.zoneId;
  if (zoneId === undefined) {
    const zones = await getAllPages(
      fetchImpl,
      baseUrl,
      token,
      `/zones?name=${encodeURIComponent(CANONICAL_ZONE_NAME)}`,
      'zone lookup',
    );
    const zone = zones.map(object).find((candidate) => candidate['name'] === CANONICAL_ZONE_NAME);
    zoneId = typeof zone?.['id'] === 'string' ? zone['id'] : undefined;
  }
  let routes: SnapshotRoute[] | null = null;
  if (zoneId !== undefined) {
    const envelope = await getJson(
      fetchImpl,
      baseUrl,
      token,
      `/zones/${encodeURIComponent(zoneId)}/workers/routes`,
      'zone Worker routes',
    );
    routes = (Array.isArray(envelope.result) ? envelope.result : []).map(object).map((route) => ({
      id: typeof route['id'] === 'string' ? route['id'] : '',
      pattern: typeof route['pattern'] === 'string' ? route['pattern'] : '',
      ...(typeof route['script'] === 'string' ? { script: route['script'] } : {}),
    }));
  }

  const domainRows = await getAllPages(fetchImpl, baseUrl, token, `/accounts/${account}/workers/domains`, 'custom domains');
  const domains: SnapshotDomain[] = domainRows.map(object).map((domain) => ({
    hostname: typeof domain['hostname'] === 'string' ? domain['hostname'] : '',
    service: typeof domain['service'] === 'string' ? domain['service'] : '',
    ...(typeof domain['zone_name'] === 'string' ? { zone_name: domain['zone_name'] } : {}),
  }));

  const queueRows = await getAllPages(fetchImpl, baseUrl, token, `/accounts/${account}/queues`, 'queues list');
  const queues = queueRows.map((row) => row as SnapshotQueue).filter((queue) => typeof queue.queue_name === 'string');
  const metrics: Record<string, SnapshotQueueMetrics> = {};
  for (const queue of queues) {
    if (!queue.queue_name.startsWith(DATA_FOUNDRY_NAME_PREFIX)) continue;
    const envelope = await getJson(
      fetchImpl,
      baseUrl,
      token,
      `/accounts/${account}/queues/${encodeURIComponent(queue.queue_id)}/metrics`,
      `metrics for ${queue.queue_name}`,
    );
    const result = object(envelope.result);
    metrics[queue.queue_id] = {
      backlog_count: numberOr(result['backlog_count'], Number.NaN),
      backlog_bytes: numberOr(result['backlog_bytes'], Number.NaN),
      oldest_message_timestamp_ms: numberOr(result['oldest_message_timestamp_ms'], 0),
    };
  }

  return { workers, subdomains, routes, domains, queues, metrics };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

export interface ReadbackCliOptions {
  readonly phase: ReadbackPhase;
  readonly snapshotPath?: string;
  readonly capturePath?: string;
}

export const USAGE =
  'Usage: check-cloudflare-readback.ts [--phase private-canary|ordinary-route-less] [--snapshot <captured.json>] [--capture <out.json>]\n' +
  'Live mode reads CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID and optionally CLOUDFLARE_ZONE_ID from the environment.\n';

export function parseReadbackArgs(argv: readonly string[]): ReadbackCliOptions {
  let phase: ReadbackPhase = 'private-canary';
  let snapshotPath: string | undefined;
  let capturePath: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = argv[index + 1];
    switch (arg) {
      case '--':
        // `pnpm run <script> -- <args>` forwards the separator itself.
        break;
      case '--phase':
        if (value !== 'private-canary' && value !== 'ordinary-route-less') {
          throw new Error(USAGE);
        }
        phase = value;
        index += 1;
        break;
      case '--snapshot':
        if (value === undefined || value.startsWith('--')) throw new Error(USAGE);
        snapshotPath = value;
        index += 1;
        break;
      case '--capture':
        if (value === undefined || value.startsWith('--')) throw new Error(USAGE);
        capturePath = value;
        index += 1;
        break;
      default:
        throw new Error(USAGE);
    }
  }
  if (snapshotPath !== undefined && capturePath !== undefined) {
    throw new Error('--snapshot and --capture are mutually exclusive.\n' + USAGE);
  }
  return {
    phase,
    ...(snapshotPath === undefined ? {} : { snapshotPath }),
    ...(capturePath === undefined ? {} : { capturePath }),
  };
}

function isSnapshot(value: unknown): value is CloudflareReadbackSnapshot {
  const candidate = object(value);
  return (
    Array.isArray(candidate['workers']) &&
    typeof candidate['subdomains'] === 'object' &&
    (candidate['routes'] === null || Array.isArray(candidate['routes'])) &&
    Array.isArray(candidate['domains']) &&
    Array.isArray(candidate['queues']) &&
    typeof candidate['metrics'] === 'object'
  );
}

export async function run(
  options: ReadbackCliOptions,
  environment: Readonly<Record<string, string | undefined>> = process.env,
  io: { readonly stdout: (text: string) => void; readonly stderr: (text: string) => void } = {
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
  },
): Promise<number> {
  let snapshot: CloudflareReadbackSnapshot;
  if (options.snapshotPath !== undefined) {
    const parsed: unknown = JSON.parse(await readFile(options.snapshotPath, 'utf8'));
    if (!isSnapshot(parsed)) {
      io.stderr('The snapshot file does not have the captured read-back shape.\n');
      return 1;
    }
    snapshot = parsed;
  } else {
    const apiToken = environment['CLOUDFLARE_API_TOKEN'];
    const accountId = environment['CLOUDFLARE_ACCOUNT_ID'];
    const zoneId = environment['CLOUDFLARE_ZONE_ID'];
    if (apiToken === undefined || apiToken === '' || accountId === undefined || accountId === '') {
      io.stderr('Live read-back needs CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID in the environment (never on argv).\n');
      return 2;
    }
    try {
      snapshot = await captureCloudflareReadbackSnapshot({
        apiToken,
        accountId,
        ...(zoneId === undefined || zoneId === '' ? {} : { zoneId }),
      });
    } catch (error) {
      io.stderr(`Read-back failed before evaluation: ${error instanceof Error ? error.message : 'unknown error'}\n`);
      return 2;
    }
    if (options.capturePath !== undefined) {
      // The capture carries provider identifiers and route patterns. It is
      // private evidence for the operator, not repository content.
      await writeFile(options.capturePath, `${JSON.stringify(snapshot, null, 2)}\n`, { mode: 0o600 });
    }
  }
  const expectations = await loadReadbackExpectations(options.phase);
  const report = evaluateCloudflareReadback(snapshot, expectations);
  for (const line of report.observations) io.stdout(`  ${line}\n`);
  if (report.errors.length === 0) {
    io.stdout(`OK: Cloudflare read-back matches the ${options.phase} phase (${report.observations.length} observations).\n`);
    return 0;
  }
  io.stderr(`Cloudflare read-back does not match the ${options.phase} phase:\n`);
  for (const error of report.errors) io.stderr(`  - ${error}\n`);
  return 1;
}

if (isMain(import.meta.url)) {
  let options: ReadbackCliOptions;
  try {
    options = parseReadbackArgs(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(error instanceof Error ? error.message : USAGE);
    process.exit(2);
  }
  run(options).then(
    (code) => process.exit(code),
    (error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : 'unknown error'}\n`);
      process.exit(2);
    },
  );
}
