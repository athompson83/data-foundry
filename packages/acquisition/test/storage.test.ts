import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { ArtifactStoreError } from '../src/errors.js';
import { InMemoryFileSystem, type WritableFileSystem } from '../src/fs.js';
import { sha256Hex } from '../src/hashing.js';
import type { ArtifactPutRequest, ArtifactStore } from '../src/storage/artifact-store.js';
import {
  artifactContentKey,
  artifactContentPath,
  artifactRetrievalKey,
  parseArtifactContentKey,
  parseArtifactRetrievalKey,
} from '../src/storage/keys.js';
import { LocalFsArtifactStore } from '../src/storage/local-fs-artifact-store.js';
import { InMemoryObjectClient, R2ArtifactStore } from '../src/storage/r2-artifact-store.js';

const RETRIEVED_AT = '2026-08-14T09:30:00.000Z';
const BYTES = new TextEncoder().encode('{"unit":"XC21"}');
const HASH = sha256Hex(BYTES);
const EXPECTED_KEY = `raw/hvac/ratings-directory/content/${HASH.slice(0, 2)}/${HASH}`;
const EXPECTED_RETRIEVAL_KEY = `raw/hvac/ratings-directory/retrieved/2026/08/14/${HASH}.json`;
const POLICY_A = '22222222-2222-4222-8222-222222222222' as never;
const POLICY_B = '33333333-3333-4333-8333-333333333333' as never;

function putRequest(overrides: Partial<ArtifactPutRequest> = {}): ArtifactPutRequest {
  return {
    vertical: 'hvac',
    source: 'ratings-directory',
    body: BYTES,
    metadata: {
      source_key: 'ratings-directory',
      vertical_slug: 'hvac',
      url: 'https://www.ratings-directory.example.org/certified/units.json',
      retrieved_at: RETRIEVED_AT,
      http_status: 200,
      mime_type: 'application/json',
      policy_snapshot_id: null,
      acquisition_provider: 'http',
      acquisition_route: 'DIRECT_HTTP',
      account_or_product_plan: null,
      acquisition_jurisdiction: null,
      etag: '"v1"',
      last_modified: null,
    },
    ...overrides,
  };
}

describe('artifact key layout', () => {
  it('addresses content by digest alone, with no date in the key', () => {
    const parts = { vertical: 'hvac', source: 'ratings-directory', contentHash: HASH } as const;
    expect(artifactContentKey(parts)).toBe(EXPECTED_KEY);
    expect(artifactContentPath(parts)).toBe(`/${EXPECTED_KEY}`);
    // Finding #6: a date in the content key meant identical bytes fetched on
    // two days were two objects, and the second was cited by nothing.
    expect(artifactContentKey(parts)).not.toMatch(/\/20\d\d\//);
  });

  it('gives the same bytes the same key however many days pass', () => {
    const parts = { vertical: 'hvac', source: 'ratings-directory', contentHash: HASH } as const;
    expect(artifactContentKey(parts)).toBe(artifactContentKey({ ...parts }));
  });

  it('partitions retrieval records on the UTC date of retrieval', () => {
    expect(
      artifactRetrievalKey({
        vertical: 'hvac',
        source: 'ratings-directory',
        retrievedAt: RETRIEVED_AT,
        contentHash: HASH,
      }),
    ).toBe(EXPECTED_RETRIEVAL_KEY);
    expect(
      artifactRetrievalKey({
        vertical: 'hvac',
        source: 'ratings-directory',
        retrievedAt: '2026-01-05T23:59:59.000Z',
        contentHash: HASH,
      }),
    ).toContain('/2026/01/05/');
  });

  it('separates same-day retrievals made under different policy snapshots', () => {
    const key = artifactRetrievalKey({
      vertical: 'hvac',
      source: 'ratings-directory',
      retrievedAt: RETRIEVED_AT,
      contentHash: HASH,
      policySnapshotId: POLICY_A,
    });
    expect(key).toBe(
      `raw/hvac/ratings-directory/retrieved/2026/08/14/${HASH}.${POLICY_A}.json`,
    );
    expect(parseArtifactRetrievalKey(key)?.policySnapshotId).toBe(POLICY_A);
  });

  it('round-trips both key kinds through their parsers, and does not confuse them', () => {
    expect(parseArtifactContentKey(EXPECTED_KEY)).toEqual({
      vertical: 'hvac',
      source: 'ratings-directory',
      contentHash: HASH,
    });
    expect(parseArtifactRetrievalKey(EXPECTED_RETRIEVAL_KEY)).toEqual({
      vertical: 'hvac',
      source: 'ratings-directory',
      year: '2026',
      month: '08',
      day: '14',
      contentHash: HASH,
    });
    expect(parseArtifactContentKey(`/${EXPECTED_KEY}`)).not.toBeNull();
    expect(parseArtifactContentKey(EXPECTED_RETRIEVAL_KEY)).toBeNull();
    expect(parseArtifactRetrievalKey(EXPECTED_KEY)).toBeNull();
    expect(parseArtifactContentKey('raw/hvac/x')).toBeNull();
  });

  it('rejects a shard that does not match the digest it claims to hold', () => {
    expect(parseArtifactContentKey(`raw/hvac/ratings-directory/content/zz/${HASH}`)).toBeNull();
  });

  it.each(['../escape', 'has/slash', 'UPPER', ''])(
    'rejects the illegal path segment %s',
    (segment) => {
      expect(() =>
        artifactContentKey({ vertical: segment, source: 'ratings-directory', contentHash: HASH }),
      ).toThrow(ArtifactStoreError);
    },
  );

  it('rejects a non-sha256 content hash', () => {
    expect(() =>
      artifactContentKey({
        vertical: 'hvac',
        source: 'ratings-directory',
        contentHash: 'not-a-hash',
      }),
    ).toThrow(ArtifactStoreError);
  });
});

/**
 * Both adapters must satisfy the same evidence-store contract, so the behavioural
 * assertions are written once and run against each.
 */
const temporaryDirectories: string[] = [];

afterAll(async () => {
  await Promise.all(temporaryDirectories.map((dir) => rm(dir, { recursive: true, force: true })));
});

interface StoreCase {
  readonly name: string;
  readonly make: () => Promise<{ store: ArtifactStore; writes: () => number }>;
}

const storeCases: readonly StoreCase[] = [
  {
    name: 'R2ArtifactStore',
    make: () => {
      const client = new InMemoryObjectClient();
      return Promise.resolve({
        store: new R2ArtifactStore({ bucket: 'data-foundry-raw', client }),
        writes: () => client.writes.length,
      });
    },
  },
  {
    name: 'LocalFsArtifactStore (in-memory fs)',
    make: () => {
      const files = new InMemoryFileSystem();
      let writes = 0;
      const counting: WritableFileSystem = {
        readFile: (path) => files.readFile(path),
        exists: (path) => files.exists(path),
        mkdir: () => files.mkdir(),
        listFiles: (prefix) => files.listFiles(prefix),
        remove: (path) => files.remove(path),
        modifiedAt: (path) => files.modifiedAt(path),
        writeFile: (path, data) => {
          // Retrieval records and sidecars are bookkeeping; the assertion under
          // test is about how many times the *bytes* are written.
          if (!path.endsWith('.json')) writes += 1;
          return files.writeFile(path, data);
        },
      };
      return Promise.resolve({
        store: new LocalFsArtifactStore({ baseDir: '.data', fs: counting }),
        writes: () => writes,
      });
    },
  },
  {
    name: 'LocalFsArtifactStore (real disk)',
    make: async () => {
      const dir = await mkdtemp(join(tmpdir(), 'data-foundry-raw-'));
      temporaryDirectories.push(dir);
      return { store: new LocalFsArtifactStore({ baseDir: dir }), writes: () => 0 };
    },
  },
];

describe.each(storeCases)('$name — raw evidence contract', ({ make }) => {
  it('stores content-addressed at the documented key', async () => {
    const { store } = await make();
    const stored = await store.put(putRequest());
    expect(stored.key).toBe(EXPECTED_KEY);
    expect(stored.contentHash).toBe(HASH);
    expect(stored.byteSize).toBe(BYTES.byteLength);
    expect(stored.deduplicated).toBe(false);
  });

  it('records evidence and the exact acquisition scope with the bytes', async () => {
    const { store } = await make();
    const request = putRequest();
    const stored = await store.put({
      ...request,
      metadata: {
        ...request.metadata,
        policy_snapshot_id: '22222222-2222-4222-8222-222222222222' as never,
      },
    });

    const head = await store.head(stored.key);
    expect(head).not.toBeNull();
    expect(head?.retrieved_at).toBe(RETRIEVED_AT);
    expect(head?.http_status).toBe(200);
    expect(head?.mime_type).toBe('application/json');
    expect(head?.content_hash).toBe(HASH);
    expect(head?.byte_size).toBe(BYTES.byteLength);
    expect(head?.policy_snapshot_id).toBe('22222222-2222-4222-8222-222222222222');
    expect(head?.acquisition_route).toBe('DIRECT_HTTP');
    expect(head?.account_or_product_plan).toBeNull();
    expect(head?.acquisition_jurisdiction).toBeNull();
    expect(head?.etag).toBe('"v1"');
  });

  it('is idempotent: identical bytes are the same key and no second write', async () => {
    const { store, writes } = await make();
    const first = await store.put(putRequest());
    const writesAfterFirst = writes();

    const second = await store.put(putRequest());

    expect(second.key).toBe(first.key);
    expect(second.contentHash).toBe(first.contentHash);
    expect(second.deduplicated).toBe(true);
    expect(writes()).toBe(writesAfterFirst);
  });

  it('keeps the first retrieval authoritative rather than rewriting history', async () => {
    const { store } = await make();
    const request = putRequest();
    await store.put(request);
    const second = await store.put({
      ...request,
      metadata: { ...request.metadata, http_status: 203, etag: '"v2"' },
    });
    expect(second.metadata.http_status).toBe(200);
    expect(second.metadata.etag).toBe('"v1"');
  });

  it('records a new retrieval when identical bytes are fetched under a new rights scope', async () => {
    const { store } = await make();
    const firstRequest = putRequest();
    await store.put({
      ...firstRequest,
      metadata: { ...firstRequest.metadata, policy_snapshot_id: POLICY_A },
    });
    const second = await store.put({
      ...firstRequest,
      metadata: {
        ...firstRequest.metadata,
        policy_snapshot_id: POLICY_B,
        acquisition_route: 'BROWSER_RUN',
        account_or_product_plan: 'partner-pro',
        acquisition_jurisdiction: 'US',
      },
    });

    expect(second.deduplicated).toBe(true);
    expect(second.retrievalKey).toContain(String(POLICY_B));
    const retrieval = await store.get(second.retrievalKey ?? 'missing');
    expect(retrieval?.metadata.acquisition_route).toBe('BROWSER_RUN');
    expect(retrieval?.metadata.account_or_product_plan).toBe('partner-pro');
    const record = JSON.parse(new TextDecoder().decode(retrieval?.body ?? new Uint8Array())) as {
      acquisition_route?: string;
      policy_snapshot_id?: string;
    };
    expect(record.acquisition_route).toBe('BROWSER_RUN');
    expect(record.policy_snapshot_id).toBe(POLICY_B);
  });

  it('gives different bytes a different key', async () => {
    const { store } = await make();
    const first = await store.put(putRequest());
    const changed = new TextEncoder().encode('{"unit":"XC25"}');
    const second = await store.put({ ...putRequest(), body: changed });
    expect(second.key).not.toBe(first.key);
    expect(second.deduplicated).toBe(false);
  });

  it('reads the bytes back', async () => {
    const { store } = await make();
    const stored = await store.put(putRequest());
    const body = await store.get(stored.key);
    expect(body).not.toBeNull();
    expect(new TextDecoder().decode(body?.body ?? new Uint8Array())).toBe('{"unit":"XC21"}');
  });

  it('returns null for a key it does not hold', async () => {
    const { store } = await make();
    const missing = `raw/hvac/ratings-directory/content/ff/${'f'.repeat(64)}`;
    expect(await store.head(missing)).toBeNull();
    expect(await store.get(missing)).toBeNull();
  });
});

describe('store-specific URIs', () => {
  it('R2 addresses objects as r2://bucket/key', async () => {
    const store = new R2ArtifactStore({
      bucket: 'data-foundry-raw',
      client: new InMemoryObjectClient(),
    });
    const stored = await store.put(putRequest());
    expect(stored.uri).toBe(`r2://data-foundry-raw/${EXPECTED_KEY}`);
  });

  it('R2 honours an environment prefix without changing the documented layout', async () => {
    const client = new InMemoryObjectClient();
    const store = new R2ArtifactStore({ bucket: 'b', client, prefix: 'staging' });
    const stored = await store.put(putRequest());
    expect(stored.key).toBe(EXPECTED_KEY);
    expect(client.keys()).toEqual([
      `b/staging/${EXPECTED_KEY}`,
      `b/staging/${EXPECTED_RETRIEVAL_KEY}`,
    ]);
    // `list` speaks in keys, not in bucket paths: the prefix is the store's
    // business and an orphan sweep must never see it.
    expect(await store.list('raw/hvac/ratings-directory/content')).toEqual([EXPECTED_KEY]);
  });

  it('the local store writes under .data/raw/... with a metadata sidecar', async () => {
    const files = new InMemoryFileSystem();
    const store = new LocalFsArtifactStore({ baseDir: '.data', fs: files });
    const stored = await store.put(putRequest());

    expect(files.paths()).toEqual([
      `.data/${EXPECTED_KEY}`,
      `.data/${EXPECTED_KEY}.meta.json`,
      `.data/${EXPECTED_RETRIEVAL_KEY}`,
      `.data/${EXPECTED_RETRIEVAL_KEY}.meta.json`,
    ]);
    expect(stored.uri.startsWith('file://')).toBe(true);
  });

  it('surfaces a corrupt metadata sidecar instead of guessing', async () => {
    const files = new InMemoryFileSystem();
    const store = new LocalFsArtifactStore({ baseDir: '.data', fs: files });
    await store.put(putRequest());
    await files.writeFile(`.data/${EXPECTED_KEY}.meta.json`, new TextEncoder().encode('{ not json'));
    await expect(store.head(EXPECTED_KEY)).rejects.toBeInstanceOf(ArtifactStoreError);
  });
});
