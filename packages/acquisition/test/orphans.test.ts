/**
 * Finding #6, second half — the leak content addressing cannot close.
 *
 * A refresh no longer duplicates anything, but the pipeline still stores bytes
 * and *then* writes the `source_artifacts` row. A process that dies between the
 * two, or a transaction that rolls back, leaves an object no row will ever
 * mention. That is unbounded growth with no way to even enumerate it: before
 * `list`, the store could not say what it held.
 *
 * The sweep is deliberately hard to misuse, because the failure mode is
 * deleting evidence a published fact depends on (AGENTS.md rule 10). Every
 * guard below is asserted, not merely documented.
 */
import { describe, expect, it } from 'vitest';
import { ArtifactStoreError } from '../src/errors.js';
import { InMemoryFileSystem } from '../src/fs.js';
import { sha256Hex } from '../src/hashing.js';
import { LocalFsArtifactStore } from '../src/storage/local-fs-artifact-store.js';
import { sweepOrphanedArtifacts } from '../src/storage/orphans.js';
import type { ArtifactPutRequest } from '../src/storage/artifact-store.js';

const VERTICAL = 'hvac';
const SOURCE = 'ratings-directory';
const DAY = 24 * 60 * 60 * 1000;

function putRequest(body: string, retrievedAt: string): ArtifactPutRequest {
  return {
    vertical: VERTICAL,
    source: SOURCE,
    body: new TextEncoder().encode(body),
    metadata: {
      source_key: SOURCE,
      vertical_slug: VERTICAL,
      url: 'https://www.ratings-directory.example.org/certified/units.json',
      retrieved_at: retrievedAt,
      http_status: 200,
      mime_type: 'application/json',
      policy_snapshot_id: null,
      acquisition_provider: 'http',
      acquisition_route: 'DIRECT_HTTP',
      account_or_product_plan: null,
      acquisition_jurisdiction: null,
      etag: null,
      last_modified: null,
    },
  };
}

interface Fixture {
  readonly store: LocalFsArtifactStore;
  readonly files: InMemoryFileSystem;
  readonly cited: string;
  readonly orphan: string;
}

/** One artifact the database cites, one it does not. Both written a week ago. */
async function fixture(): Promise<Fixture> {
  const files = new InMemoryFileSystem();
  files.clock = () => 0;
  const store = new LocalFsArtifactStore({ baseDir: '.data', fs: files });
  const cited = await store.put(putRequest('{"unit":"XC21"}', '2026-08-14T09:00:00.000Z'));
  const orphan = await store.put(putRequest('{"unit":"XC25"}', '2026-08-14T09:00:00.000Z'));
  return { store, files, cited: cited.key, orphan: orphan.key };
}

const sweep = async (
  fx: Fixture,
  overrides: Partial<Parameters<typeof sweepOrphanedArtifacts>[0]> = {},
) =>
  sweepOrphanedArtifacts({
    store: fx.store,
    vertical: VERTICAL,
    source: SOURCE,
    referencedUris: new Set([fx.store.uriFor(fx.cited)]),
    minimumAgeMs: DAY,
    now: 7 * DAY,
    ageOf: async (key) => {
      const modified = await fx.store.modifiedAt(key);
      return modified === null ? null : 7 * DAY - modified;
    },
    ...overrides,
  });

describe('orphan sweep', () => {
  it('finds the object nothing cites and leaves the cited one alone', async () => {
    const fx = await fixture();
    const report = await sweep(fx);
    expect(report.orphaned).toEqual([fx.orphan]);
    expect(report.orphaned).not.toContain(fx.cited);
  });

  it('reports without deleting unless it is explicitly told to apply', async () => {
    const fx = await fixture();
    const report = await sweep(fx);
    expect(report.deleted).toEqual([]);
    expect(await fx.store.get(fx.orphan)).not.toBeNull();
  });

  it('deletes only the orphan when applied, and the cited bytes still resolve', async () => {
    const fx = await fixture();
    const report = await sweep(fx, { apply: true });
    expect(report.deleted).toEqual([fx.orphan]);
    expect(await fx.store.get(fx.orphan)).toBeNull();

    const survivor = await fx.store.get(fx.cited);
    expect(survivor, 'cited evidence must survive every sweep').not.toBeNull();
    expect(survivor?.metadata.content_hash).toBe(sha256Hex('{"unit":"XC21"}'));
  });

  it('refuses an empty reference set rather than deleting the archive', async () => {
    const fx = await fixture();
    await expect(sweep(fx, { referencedUris: new Set(), apply: true })).rejects.toBeInstanceOf(
      ArtifactStoreError,
    );
    expect(await fx.store.get(fx.orphan)).not.toBeNull();
    expect(await fx.store.get(fx.cited)).not.toBeNull();
  });

  it('refuses to run with no grace period, which would race a live run', async () => {
    const fx = await fixture();
    await expect(sweep(fx, { minimumAgeMs: Number.NaN })).rejects.toBeInstanceOf(
      ArtifactStoreError,
    );
    await expect(sweep(fx, { minimumAgeMs: -1 })).rejects.toBeInstanceOf(ArtifactStoreError);
    // Zero IS no grace period, which is exactly what the message refuses.
    await expect(sweep(fx, { minimumAgeMs: 0 })).rejects.toBeInstanceOf(ArtifactStoreError);
  });

  it('refuses a reference set recorded against a different store', async () => {
    const fx = await fixture();
    // Membership is exact equality against this store's URI form. A set built
    // from another backend is full, so the empty-set guard cannot see it, and
    // matches nothing — every object would look orphaned and be deleted.
    await expect(
      sweep(fx, {
        referencedUris: new Set(['r2://some-bucket/raw/hvac/acme/content/aa/' + 'a'.repeat(64)]),
        apply: true,
      }),
    ).rejects.toBeInstanceOf(ArtifactStoreError);

    // And nothing was removed on the way to refusing.
    expect(await fx.store.list('raw/')).toContain(fx.cited);
  });

  it('leaves an object written moments ago alone: it may be a run in flight', async () => {
    const fx = await fixture();
    const report = await sweep(fx, { ageOf: () => Promise.resolve(60_000), apply: true });
    expect(report.orphaned).toEqual([]);
    expect(report.skippedTooRecent).toEqual([fx.orphan]);
    expect(await fx.store.get(fx.orphan)).not.toBeNull();
  });

  it('leaves an object of unknown age alone rather than guessing', async () => {
    const fx = await fixture();
    const report = await sweep(fx, { ageOf: () => Promise.resolve(null), apply: true });
    expect(report.deleted).toEqual([]);
    expect(report.skippedTooRecent).toEqual([fx.orphan]);
  });

  it('never treats a retrieval record as an orphan', async () => {
    const fx = await fixture();
    // Retrieval records live under the retrieved/ prefix, outside the content
    // prefix the sweep scans, and they are self-describing history in their own
    // right: a fetch happened on a date whether or not the bytes are still
    // cited.
    const before = (await fx.files.listFiles('.data')).filter((path) =>
      path.includes('/retrieved/'),
    );
    expect(before.length).toBeGreaterThan(0);

    await sweep(fx, { apply: true });

    const after = (await fx.files.listFiles('.data')).filter((path) =>
      path.includes('/retrieved/'),
    );
    expect(after).toEqual(before);
  });

  it('reports a key it does not recognise instead of deleting it', async () => {
    const fx = await fixture();
    await fx.files.writeFile(
      `.data/raw/${VERTICAL}/${SOURCE}/content/zz/mystery`,
      new TextEncoder().encode('?'),
    );
    const report = await sweep(fx, { apply: true });
    expect(report.unrecognised).toEqual([`raw/${VERTICAL}/${SOURCE}/content/zz/mystery`]);
    expect(report.deleted).toEqual([fx.orphan]);
    expect(await fx.files.exists(`.data/raw/${VERTICAL}/${SOURCE}/content/zz/mystery`)).toBe(true);
  });
});
