/**
 * Incremental refresh.
 *
 * Doc 05's refresh strategy says an unchanged source should cost a 304, not a
 * full download. That is an economic claim, but it is also a correctness one:
 * a refresh loop that re-downloads and re-writes everything every cycle is
 * exactly the loop most likely to duplicate rows, so the cheap path and the
 * safe path have to be the same path.
 *
 * Both halves are checked here — the conditional short-circuit when validators
 * are warm, and identical canonical output when they are cold and every byte is
 * genuinely re-fetched.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { InMemoryValidatorCache } from '../../packages/acquisition/src/index.js';
import {
  createFactory,
  snapshotCanonical,
  RUN_1_AT,
  RUN_2_AT,
  type Factory,
} from '../support/harness.js';

let factory: Factory | null = null;

afterEach(async () => {
  await factory?.close();
  factory = null;
});

describe('incremental refresh', () => {
  it('answers 304 and stores nothing when the validators are unchanged', async () => {
    factory = await createFactory();
    const validatorCache = new InMemoryValidatorCache();

    const first = await factory.run({ at: RUN_1_AT, runId: 'cycle-1', validatorCache });
    expect(first.sources.every((source) => source.outcome === 'FETCHED')).toBe(true);
    const before = await snapshotCanonical(factory.driver);

    const second = await factory.run({ at: RUN_2_AT, runId: 'cycle-2', validatorCache });
    // Nothing changed upstream, and the pipeline did not have to download
    // anything to find that out.
    expect(second.sources.map((source) => source.outcome)).toEqual([
      'NOT_MODIFIED',
      'NOT_MODIFIED',
      'NOT_MODIFIED',
      'NOT_MODIFIED',
    ]);
    expect(second.sources.every((source) => source.artifacts === 0)).toBe(true);
    expect(second.sources.every((source) => source.finalState === 'PUBLISHED')).toBe(true);

    const after = await snapshotCanonical(factory.driver);
    expect(after).toEqual(before);
  }, 180_000);

  it('re-acquires identical bytes without minting a second artifact', async () => {
    factory = await createFactory();
    await factory.run({ at: RUN_1_AT, runId: 'cycle-1' });
    const before = await factory.driver.query<{ id: string; content_hash: string }>(
      `SELECT id::text AS id, content_hash FROM source_artifacts ORDER BY content_hash`,
    );

    // Cold cache: every source is genuinely fetched again.
    const second = await factory.run({ at: RUN_2_AT, runId: 'cycle-2' });
    expect(second.sources.every((source) => source.outcome === 'FETCHED')).toBe(true);

    const after = await factory.driver.query<{ id: string; content_hash: string }>(
      `SELECT id::text AS id, content_hash FROM source_artifacts ORDER BY content_hash`,
    );
    // Same bytes, same URL, same source: the same artifact, with the same id and
    // the same first-retrieval metadata. Content addressing, not luck.
    expect(after).toEqual(before);

    // The evidence store is content-addressed: four sources, four digests, four
    // objects, however many times and on however many days they are fetched.
    //
    // This assertion used to count `key.split('/').pop()` — the digest with the
    // date partition discarded — which reported four while the store actually
    // held eight, and hid 100% amplification per refresh behind a green test
    // (finding #6). Count the objects.
    const contentKeys = factory.artifacts.contentKeys();
    expect(contentKeys.length).toBe(4);
    const digests = new Set(contentKeys.map((key) => key.split('/').pop()));
    expect(digests.size).toBe(4);
    expect([...digests].every((digest) => /^[0-9a-f]{64}$/.test(String(digest)))).toBe(true);
  }, 180_000);

  it('updates freshness on a re-run without touching first_seen_at', async () => {
    factory = await createFactory();
    await factory.run({ at: RUN_1_AT, runId: 'cycle-1' });
    const before = await factory.driver.query<{ first_seen_at: string; last_verified_at: string }>(
      `SELECT first_seen_at::text AS first_seen_at, last_verified_at::text AS last_verified_at
         FROM entities WHERE canonical_slug = 'acme-climate-systems-24acc636a003'`,
    );

    await factory.run({ at: RUN_2_AT, runId: 'cycle-2' });
    const after = await factory.driver.query<{ first_seen_at: string; last_verified_at: string }>(
      `SELECT first_seen_at::text AS first_seen_at, last_verified_at::text AS last_verified_at
         FROM entities WHERE canonical_slug = 'acme-climate-systems-24acc636a003'`,
    );

    expect(new Date(String(after[0]?.first_seen_at)).toISOString()).toBe(
      new Date(String(before[0]?.first_seen_at)).toISOString(),
    );
    // "We checked and it is unchanged" is a different statement from "we have
    // not checked", and freshness is where the difference lives.
    expect(new Date(String(after[0]?.last_verified_at)).toISOString()).toBe(RUN_2_AT);
    expect(new Date(String(before[0]?.last_verified_at)).toISOString()).toBe(RUN_1_AT);
  }, 180_000);
});
