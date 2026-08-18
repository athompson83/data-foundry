import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sourceId, type SourceId } from '@data-foundry/canonical-schema';
import { InMemorySourceRegistry, type SourceRegistryEntry } from '@data-foundry/source-registry';
import { ManualClock } from '../src/clock.js';
import { InMemoryFileSystem, type ReadOnlyFileSystem } from '../src/fs.js';
import { InMemoryValidatorCache } from '../src/policy/conditional.js';
import { InMemoryPolicySnapshotRecorder } from '../src/policy/policy-snapshot.js';
import { LocalFsArtifactStore } from '../src/storage/local-fs-artifact-store.js';
import type { ArtifactStore } from '../src/storage/artifact-store.js';
import type { AcquisitionProviderDeps } from '../src/providers/base.js';
import type {
  FetchLike,
  HttpHeadersLike,
  HttpRequestInit,
  HttpResponseLike,
} from '../src/providers/http-client.js';
import type { SourceRequest } from '../src/types.js';

export const NOW = '2026-08-14T00:00:00.000Z';
export const SOURCE_UUID = '11111111-1111-4111-8111-111111111111';
export const TARGET_URL = 'https://www.ahridirectory.org/certified/units.json';
export const BODY = '{"unit":"XC21","seer2":16.2}';
export const ETAG = '"v1"';
export const LAST_MODIFIED = 'Mon, 10 Aug 2026 00:00:00 GMT';

/** Real on-disk fixture sets, resolved relative to this file rather than to the cwd. */
const FIXTURE_ROOT = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
export const FIXTURE_DIR = join(FIXTURE_ROOT, 'ahri-directory');
export const CONFORMANCE_FIXTURE_DIR = join(FIXTURE_ROOT, 'conformance');

/** The same compliant source, declared as using a particular acquisition method. */
export function entryForMethod(
  method: SourceRegistryEntry['acquisition_policy']['method'],
  overrides: Partial<SourceRegistryEntry> = {},
): SourceRegistryEntry {
  const entry = compliantEntry(overrides);
  return { ...entry, acquisition_policy: { ...entry.acquisition_policy, method } };
}

/**
 * A fully-compliant source: GREEN, reviewed, DIRECT_HTTP approved, attribution
 * configured, artifacts retained, robots permitting everything but `/admin`.
 *
 * Every test starts here and breaks exactly one thing, so a failure names its
 * own cause.
 */
export function compliantEntry(overrides: Partial<SourceRegistryEntry> = {}): SourceRegistryEntry {
  return {
    key: 'ahri-directory',
    vertical_slug: 'hvac',
    publisher: 'Air-Conditioning, Heating, and Refrigeration Institute',
    domain: 'ahridirectory.org',
    source_type: 'CERTIFICATION_BODY',
    authority_rank: 95,
    status: 'ACTIVE',
    refresh_cadence: 'WEEKLY',

    rights_classification: 'GREEN',
    attribution_requirement: {
      required: true,
      text: 'Certification data courtesy of AHRI',
      url: null,
    },
    robots_policy: {
      respect_robots: true,
      user_agent: 'DataFoundryBot',
      crawl_delay_seconds: 2,
      disallowed_paths: ['/admin'],
      allowed_paths: ['/'],
      robots_url: 'https://www.ahridirectory.org/robots.txt',
      snapshot_hash: 'a'.repeat(64),
      snapshot_at: '2026-07-01T00:00:00.000Z',
    },

    rights_policy: {
      publisher_legal_entity: 'Air-Conditioning, Heating, and Refrigeration Institute',
      terms_url: 'https://www.ahridirectory.org/terms',
      license_id: null,
      license_text_ref: 'legal/ahri-terms-2026-07-01.pdf',
      api_terms_url: null,
      commercial_use_allowed: true,
      redistribution_allowed: true,
      derivative_normalization_allowed: true,
      attribution: { required: true, text: 'Courtesy of AHRI', url: null },
      images_reusable: false,
      personal_data_present: false,
      geographic_notes: 'US/Canada certification directory.',
      reviewed_at: '2026-07-01T00:00:00.000Z',
      reviewed_by: 'legal@example.com',
      next_review_at: '2027-07-01',
    },
    acquisition_policy: {
      method: 'DIRECT_HTTP',
      approved: true,
      approved_by: 'legal@example.com',
      approved_at: '2026-07-01T00:00:00.000Z',
      max_requests_per_minute: 30,
      notes: 'Public search endpoint; respects crawl delay.',
    },
    image_policy: {
      images_reusable: false,
      cache_to_r2_permitted: false,
      default_display_modes: [],
      image_attribution: { required: false, text: null, url: null },
    },
    provenance_retention: {
      retain_artifacts: true,
      retention_days: null,
      legal_hold: false,
    },
    license_split: {
      code_license_id: null,
      data_license_id: null,
      notes: 'Directory content is not open-licensed; terms permit factual reuse with attribution.',
    },

    kill_switch_engaged: false,
    notes: '',
    ...overrides,
  };
}

export interface Harness {
  readonly deps: AcquisitionProviderDeps;
  readonly clock: ManualClock;
  readonly registry: InMemorySourceRegistry;
  readonly store: ArtifactStore;
  readonly files: InMemoryFileSystem;
  readonly recorder: InMemoryPolicySnapshotRecorder;
  readonly validators: InMemoryValidatorCache;
}

export interface HarnessOptions {
  readonly entry?: SourceRegistryEntry | undefined;
  readonly entries?: readonly SourceRegistryEntry[] | undefined;
  readonly store?: ArtifactStore | undefined;
  readonly now?: string | undefined;
}

export function makeHarness(options: HarnessOptions = {}): Harness {
  const entries = options.entries ?? [options.entry ?? compliantEntry()];
  const clock = new ManualClock(options.now ?? NOW);
  const files = new InMemoryFileSystem();
  const store = options.store ?? new LocalFsArtifactStore({ baseDir: '.data', fs: files });
  const registry = new InMemorySourceRegistry(entries);
  const recorder = new InMemoryPolicySnapshotRecorder();
  const validators = new InMemoryValidatorCache();

  return {
    clock,
    registry,
    store,
    files,
    recorder,
    validators,
    deps: {
      registry,
      artifactStore: store,
      policyRecorder: recorder,
      validatorCache: validators,
      clock,
      userAgent: 'DataFoundryBot/test',
    },
  };
}

export function makeRequest(overrides: Partial<SourceRequest> = {}): SourceRequest {
  return {
    sourceId: sourceId(SOURCE_UUID) as SourceId,
    sourceKey: 'ahri-directory',
    verticalSlug: 'hvac',
    url: TARGET_URL,
    ...overrides,
  };
}

/* ------------------------------------------------------------------ */
/* HTTP stubbing                                                       */
/* ------------------------------------------------------------------ */

export interface StubResponse {
  readonly status?: number | undefined;
  readonly headers?: Readonly<Record<string, string>> | undefined;
  readonly body?: string | Uint8Array | undefined;
}

export interface RecordedCall {
  readonly url: string;
  readonly init: HttpRequestInit | undefined;
}

export interface StubbedFetch {
  readonly fetch: FetchLike;
  readonly calls: RecordedCall[];
}

function headersLike(record: Readonly<Record<string, string>>): HttpHeadersLike {
  const lower: Record<string, string> = {};
  for (const [key, value] of Object.entries(record)) lower[key.toLowerCase()] = value;
  return {
    get: (name: string) => lower[name.toLowerCase()] ?? null,
    forEach: (callback) => {
      for (const [key, value] of Object.entries(lower)) callback(value, key);
    },
  };
}

export function makeResponse(response: StubResponse): HttpResponseLike {
  const body =
    typeof response.body === 'string'
      ? new TextEncoder().encode(response.body)
      : (response.body ?? new Uint8Array());
  return {
    status: response.status ?? 200,
    headers: headersLike(response.headers ?? {}),
    arrayBuffer: () =>
      Promise.resolve(body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer),
  };
}

/** A fetch that records every call and answers from the supplied handler. */
export function stubFetch(
  handler: (url: string, init: HttpRequestInit | undefined, call: number) => StubResponse,
): StubbedFetch {
  const calls: RecordedCall[] = [];
  const fetch: FetchLike = (url, init) => {
    const index = calls.length;
    calls.push({ url, init });
    return Promise.resolve(makeResponse(handler(url, init, index)));
  };
  return { fetch, calls };
}

/** A fetch that must never be called. Fails loudly if the rights gate leaks. */
export function forbiddenFetch(): StubbedFetch {
  const calls: RecordedCall[] = [];
  const fetch: FetchLike = (url, init) => {
    calls.push({ url, init });
    return Promise.reject(new Error(`network call escaped the rights gate: ${url}`));
  };
  return { fetch, calls };
}

export function requestHeader(call: RecordedCall | undefined, name: string): string | undefined {
  return call?.init?.headers?.[name];
}

/* ------------------------------------------------------------------ */
/* Filesystem instrumentation                                          */
/* ------------------------------------------------------------------ */

/** Wraps a filesystem and counts reads, so "the fixture provider never opened a file" is assertable. */
export class CountingFileSystem implements ReadOnlyFileSystem {
  readonly reads: string[] = [];
  readonly #inner: ReadOnlyFileSystem;

  constructor(inner: ReadOnlyFileSystem) {
    this.#inner = inner;
  }

  readFile(path: string): Promise<Uint8Array> {
    this.reads.push(path);
    return this.#inner.readFile(path);
  }

  exists(path: string): Promise<boolean> {
    return this.#inner.exists(path);
  }
}
