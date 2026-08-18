/**
 * Findings #8 / #14, at the resolution layer.
 *
 * Two decisions that shape what gets published were being made by things that
 * are not properties of the data:
 *
 *   1. which entity a conflicted record provisionally attaches to was
 *      `sort((a, b) => a.entity.id.localeCompare(b.entity.id))[0]` — the
 *      smallest random UUID. `entities.id` is `gen_random_uuid()`, so a rebuild
 *      into a fresh database attaches the same record to a different entity;
 *   2. which spelling of an identifier is published as the entity's display
 *      name broke its final tie with `localeCompare`, so the same inputs
 *      produce `MODEL abc-9001` on an `en_US` host and `MODEL ABC-9001` on a
 *      `da_DK` one. That is not a hypothetical: it is asserted below by running
 *      the real resolver in two processes under two locales.
 */
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EntityResolver } from '../../services/ingest-worker/src/index.js';
import { createFactory, REPO_ROOT, type Factory } from '../support/harness.js';

let factory: Factory;
let resolver: EntityResolver;
let sourceId: string;
let sourceRecordId: string;

/**
 * The older entity deliberately draws the *larger* id and the newer one the
 * smaller, so "longest known" and "smallest UUID" disagree and the test can
 * tell which rule is in force.
 */
const OLDER = {
  id: 'ffff1111-1111-4111-8111-111111111111',
  slug: 'determinism-probe-older',
  model: 'DETPROBEOLD1',
  seenAt: '2026-01-01T00:00:00.000Z',
};
const NEWER = {
  id: '00002222-2222-4222-8222-222222222222',
  slug: 'determinism-probe-newer',
  model: 'DETPROBENEW2',
  seenAt: '2026-05-01T00:00:00.000Z',
};

interface ProbeResult {
  locale: string;
  normalized: string;
  canonical_name: string | null;
  canonical_slug: string | null;
  alias_value: string | null;
}

/** Runs the real resolver in a child process pinned to one locale. */
function probe(locale: string): ProbeResult {
  const output = execFileSync(
    process.execPath,
    ['--import', 'tsx', join(REPO_ROOT, 'tests', 'support', 'locale-probe.ts')],
    {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { ...process.env, LC_ALL: locale, LANG: locale },
      timeout: 120_000,
    },
  );
  const line = output.trim().split('\n').at(-1) ?? '';
  return JSON.parse(line) as ProbeResult;
}

beforeAll(async () => {
  factory = await createFactory('hvac');
  await factory.run();

  const [vertical] = await factory.driver.query<{ id: string }>(
    `SELECT id FROM verticals WHERE slug = 'hvac'`,
  );
  const [seed] = await factory.driver.query<{ source_id: string; artifact_id: string }>(
    `SELECT source_id, artifact_id FROM source_records LIMIT 1`,
  );
  sourceId = seed!.source_id;

  const [record] = await factory.driver.query<{ id: string }>(
    `INSERT INTO source_records
       (source_id, artifact_id, source_record_key, entity_type, raw_payload,
        normalized_payload, extraction_confidence, extractor_version)
     VALUES ($1, $2, 'determinism-probe-0001', 'equipment_model', '{}'::jsonb,
             '{}'::jsonb, 0.9, 'test')
     RETURNING id`,
    [seed!.source_id, seed!.artifact_id],
  );
  sourceRecordId = record!.id;

  for (const entity of [OLDER, NEWER]) {
    await factory.driver.query(
      `INSERT INTO entities (id, vertical_id, entity_type, canonical_name, canonical_slug,
                             status, quality_score, first_seen_at, created_at, updated_at)
       VALUES ($1, $2, 'equipment_model', $3, $4, 'ACTIVE', 0.5, $5, $5, $5)`,
      [entity.id, vertical!.id, entity.model, entity.slug, entity.seenAt],
    );
    await factory.driver.query(
      `INSERT INTO entity_aliases (entity_id, alias_type, alias_value, normalized_value,
                                   source_id, identity_confidence, valid_from)
       VALUES ($1, 'model_number', $2, $2, $3, 0.99, $4)`,
      [entity.id, entity.model, sourceId, entity.seenAt],
    );
  }

  resolver = new EntityResolver({
    store: factory.store,
    config: factory.config,
    verticalId: vertical!.id as never,
    now: '2026-08-14T00:00:00.000Z' as never,
    authorityBySourceId: new Map(),
  });
});

afterAll(async () => {
  await factory?.close();
});

describe('#8 — a provisional attachment is chosen by age, not by random UUID', () => {
  it('attaches the conflicted record to the longest-known entity', async () => {
    const resolved = await resolver.resolveRecord({
      entityType: 'equipment_model' as never,
      aliases: [OLDER, NEWER].map((entity) => ({
        aliasType: 'model_number' as never,
        aliasValue: entity.model,
        normalizedValue: entity.model,
        strong: true,
      })),
      manufacturer: null,
      sourceId: sourceId as never,
      sourceRecordId: sourceRecordId as never,
    });

    expect(
      resolved.entity.id,
      'the record must attach to the entity we have known longest, not the one that ' +
        'happened to draw the smallest uuid',
    ).toBe(OLDER.id);
  });

  it('still records the attachment as provisional and keeps both entities in evidence', async () => {
    const [candidate] = await factory.driver.query<{
      decision: string;
      explanation_features: Record<string, unknown>;
    }>(
      `SELECT decision, explanation_features FROM resolution_candidates
        WHERE left_source_record_id = $1`,
      [sourceRecordId],
    );
    expect(candidate!.decision).toBe('NEEDS_REVIEW');
    expect(candidate!.explanation_features['conflicting_entities']).toEqual(
      expect.arrayContaining([OLDER.id, NEWER.id]),
    );
  });
});

describe('#14 — the published display name does not depend on the host locale', () => {
  // Two child processes, each booting a real PGlite database and running the
  // real resolver. Slower than an in-process assertion, and the only way to
  // observe a collator: `Intl`'s default locale is fixed at process start.
  let english: ProbeResult;
  let danish: ProbeResult;

  beforeAll(() => {
    english = probe('en_US.UTF-8');
    danish = probe('da_DK.UTF-8');
  }, 300_000);

  it('actually compared two different locales', () => {
    expect(
      danish.locale,
      'the runtime resolved both probes to the same locale, so this test proved nothing',
    ).not.toBe(english.locale);
  });

  it('publishes the same canonical name under either locale', () => {
    expect(danish.canonical_name).toBe(english.canonical_name);
    expect(danish.alias_value).toBe(english.alias_value);
    expect(danish.canonical_slug).toBe(english.canonical_slug);
  });

  it('breaks the tie in codepoint order rather than collation order', () => {
    // ICU in en_US puts "abc-9001" first; codepoint order puts "ABC-9001"
    // first. Pinning the codepoint answer is what makes the result a function
    // of the data alone.
    expect(english.alias_value).toBe('ABC-9001');
    expect(english.canonical_name).toBe('MODEL ABC-9001');
  });
});

describe('#8 — the blocking pass names pairs in a reproducible direction', () => {
  it('orders every negative judgment by slug, not by random entity id', async () => {
    const rows = await factory.driver.query<{
      left_slug: string;
      right_slug: string;
      left_id: string;
      right_id: string;
    }>(
      `SELECT l.canonical_slug AS left_slug, r.canonical_slug AS right_slug,
              j.left_entity_id::text AS left_id, j.right_entity_id::text AS right_id
         FROM resolution_judgments j
         JOIN entities l ON l.id = j.left_entity_id
         JOIN entities r ON r.id = j.right_entity_id
        WHERE j.verdict = 'NOT_MERGE'`,
    );
    expect(rows.length).toBeGreaterThan(0);

    for (const row of rows) {
      expect(
        row.left_slug < row.right_slug,
        `${row.left_slug} should precede ${row.right_slug}`,
      ).toBe(true);
    }

    // Not vacuous: at least one pair would have been recorded the other way
    // round under the old id ordering, so the assertion above is doing work.
    const wouldHaveFlipped = rows.filter((row) => row.left_id > row.right_id);
    expect(wouldHaveFlipped.length).toBeGreaterThan(0);
  });
});
