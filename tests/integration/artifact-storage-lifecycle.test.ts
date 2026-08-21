/**
 * Finding #6 — date-keyed artifact storage amplified and orphaned raw evidence.
 *
 * The raw-evidence key was `raw/{vertical}/{source}/{yyyy}/{mm}/{dd}/{hash}`,
 * and `storeArtifactBytes` deduplicated on the whole key. The date is part of
 * the key, so "same bytes" only deduplicated *within one day*:
 *
 *   day 1  fetch bytes B  → writes raw/hvac/acme/2026/07/15/<hash>
 *   day 17 fetch bytes B  → writes raw/hvac/acme/2026/08/01/<hash>
 *
 * Two objects, identical content: 100% amplification per refresh cycle, growing
 * without bound over a source's life. Worse, `source_artifacts` deduplicates on
 * `(source_id, url, content_hash)`, so the second write is not merely a
 * duplicate — it is an *orphan*: no row ever points at it, and nothing knows it
 * exists to clean it up.
 *
 * The existing refresh test did not catch this because it counted
 * `key.split('/').pop()` — the digest with the date partition discarded — so
 * eight objects under four digests counted as four. These tests count physical
 * objects and cross-reference them against what the database actually cites.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  createFactory,
  RUN_1_AT,
  RUN_2_AT,
  type Factory,
} from '../support/harness.js';

let factory: Factory | null = null;

afterEach(async () => {
  await factory?.close();
  factory = null;
});

/** Every `r2_uri` the canonical layer cites as the home of some evidence. */
async function citedUris(current: Factory): Promise<Set<string>> {
  const rows = await current.driver.query<{ r2_uri: string }>(
    `SELECT r2_uri FROM source_artifacts`,
  );
  return new Set(rows.map((row) => row.r2_uri));
}

describe('#6 — raw evidence is stored once per distinct content', () => {
  it('does not write a second copy of the bytes when a later refresh returns them again', async () => {
    factory = await createFactory();
    await factory.run({ at: RUN_1_AT, runId: 'cycle-1' });
    const contentBefore = factory.artifacts.contentKeys();
    const allBefore = new Set(factory.artifacts.keys());

    // A cold refresh on a later calendar day: every byte is genuinely
    // re-fetched, and every byte is identical to what we already hold.
    await factory.run({ at: RUN_2_AT, runId: 'cycle-2' });

    expect(
      factory.artifacts.contentKeys(),
      'identical bytes on a later day must not mint a second copy of the artifact',
    ).toEqual(contentBefore);

    // The refresh is not silent — it leaves a retrieval record so the store can
    // still answer "when did we last re-check this?" — but the growth is
    // bounded by that record, not by the size of the artifact.
    const added = factory.artifacts.keys().filter((key) => !allBefore.has(key));
    expect(added.length).toBe(contentBefore.length);
    for (const key of added) expect(key).toMatch(/\/retrieved\/\d{4}\/\d{2}\/\d{2}\//);
  }, 180_000);

  it('records both retrievals of the same bytes, under their own dates', async () => {
    factory = await createFactory();
    await factory.run({ at: RUN_1_AT, runId: 'cycle-1' });
    await factory.run({ at: RUN_2_AT, runId: 'cycle-2' });

    const retrievals = factory.artifacts
      .keys()
      .filter((key) => key.includes('/retrieved/'));
    const days = new Set(retrievals.map((key) => key.split('/retrieved/')[1]?.slice(0, 10)));

    // `source_artifacts` keeps only the first retrieval — it deduplicates the
    // rest away — so without these records nothing anywhere knows the pipeline
    // re-verified the bytes on the second day.
    expect(days).toEqual(new Set([RUN_1_AT.slice(0, 10).replace(/-/g, '/'), RUN_2_AT.slice(0, 10).replace(/-/g, '/')]));
  }, 180_000);

  it('leaves no stored object that nothing in the database cites', async () => {
    factory = await createFactory();
    await factory.run({ at: RUN_1_AT, runId: 'cycle-1' });
    await factory.run({ at: RUN_2_AT, runId: 'cycle-2' });

    const cited = await citedUris(factory);
    const orphans = factory.artifacts
      .contentKeys()
      .filter((key) => !cited.has(factory!.artifacts.uriFor(key)));

    expect(orphans, `orphaned evidence objects: ${orphans.join(', ')}`).toEqual([]);
  }, 180_000);

  it('keeps the provenance pointer valid across the refresh', async () => {
    factory = await createFactory();
    await factory.run({ at: RUN_1_AT, runId: 'cycle-1' });
    const before = await factory.driver.query<{ r2_uri: string; content_hash: string }>(
      `SELECT r2_uri, content_hash FROM source_artifacts ORDER BY content_hash`,
    );

    await factory.run({ at: RUN_2_AT, runId: 'cycle-2' });
    const after = await factory.driver.query<{ r2_uri: string; content_hash: string }>(
      `SELECT r2_uri, content_hash FROM source_artifacts ORDER BY content_hash`,
    );

    // The row is unchanged, and the bytes it points at are still retrievable —
    // the pointer has to survive the refresh that revisited the same page.
    expect(after).toEqual(before);
    for (const row of after) {
      const key = row.r2_uri.replace(/^memory:\/\//, '');
      const body = await factory.artifacts.get(key);
      expect(body, `${row.r2_uri} must still resolve to its bytes`).not.toBeNull();
      expect(body?.metadata.content_hash).toBe(row.content_hash);
    }
  }, 180_000);

  it('mints a new immutable object when the content actually changes', async () => {
    factory = await createFactory();
    await factory.run({ at: RUN_1_AT, runId: 'cycle-1' });
    const before = factory.artifacts.contentKeys();

    await factory.run({
      at: RUN_2_AT,
      runId: 'cycle-3',
      fixtureOverrides: { 'acme-hvac-catalog': '{"models":[]}' },
    });
    const after = factory.artifacts.contentKeys();

    // Changed bytes are a new artifact version, never an overwrite: everything
    // that was there before is still there (rule 10), plus the new content.
    expect(after.length).toBeGreaterThan(before.length);
    for (const key of before) expect(after).toContain(key);
  }, 180_000);
});
