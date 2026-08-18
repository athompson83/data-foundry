/**
 * Finding #2 — a conflicted merge erased its own review flag.
 *
 * When one source record's strong identifiers resolved to two different
 * entities, `resolveRecord` wrote a `NEEDS_REVIEW` candidate for
 * `(sourceRecord, ids[0])` and then, a few statements later, a `MATCH`
 * candidate for `(sourceRecord, entity.id)`. Because `entity.id === ids[0]`
 * (both are the lexicographically first id), `#recordCandidate` found the first
 * row and UPDATEd it in place.
 *
 * Three compounding harms, all asserted against below:
 *   1. the review-queue entry disappeared;
 *   2. the surviving audit record was ACTIVELY FALSE — `matched_on` listed only
 *      the identifiers pointing at the winner, omitting the one that pointed
 *      elsewhere, and asserted `deterministic: true`;
 *   3. the merge judgment claimed confidence 1 for a conflicted attachment.
 *
 * AGENTS.md rule 3 requires merges to be auditable; `0006_resolution.sql:53-55`
 * requires `explanation_features` to "carry what the matcher keyed on, so a
 * human can review or reverse the decision".
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EntityResolver } from '../../services/ingest-worker/src/index.js';
import { createFactory, type Factory } from '../support/harness.js';

let factory: Factory;
let resolver: EntityResolver;
let sourceRecordId: string;
let sourceId: string;
let entityA: { id: string; alias: string };
let entityB: { id: string; alias: string };

/** The single candidate row for our synthetic record. */
async function candidates(): Promise<
  Array<{ id: string; decision: string; score: number; explanation_features: Record<string, unknown> }>
> {
  return factory.driver.query(
    `SELECT id, decision, score::float8 AS score, explanation_features
       FROM resolution_candidates
      WHERE left_source_record_id = $1
      ORDER BY created_at`,
    [sourceRecordId],
  );
}

async function judgments(): Promise<
  Array<{ verdict: string; identity_confidence: number; rationale: string }>
> {
  return factory.driver.query(
    `SELECT verdict, identity_confidence::float8 AS identity_confidence, rationale
       FROM resolution_judgments
      WHERE left_source_record_id = $1`,
    [sourceRecordId],
  );
}

beforeAll(async () => {
  factory = await createFactory('hvac');
  await factory.run();

  const [vertical] = await factory.driver.query<{ id: string }>(
    `SELECT id FROM verticals WHERE slug = 'hvac'`,
  );
  // A FRESH source record, not one the pipeline already resolved. Reusing a
  // resolved record would hit `#recordJudgment`'s append-only dedup (an active
  // MERGE for the same tuple already exists) and mask the behaviour under test.
  // A conflicted record in production is resolving for the first time.
  const [seed] = await factory.driver.query<{ source_id: string; artifact_id: string }>(
    `SELECT source_id, artifact_id FROM source_records LIMIT 1`,
  );
  sourceId = seed!.source_id;
  const [record] = await factory.driver.query<{ id: string }>(
    `INSERT INTO source_records
       (source_id, artifact_id, source_record_key, entity_type, raw_payload,
        normalized_payload, extraction_confidence, extractor_version)
     VALUES ($1, $2, 'conflict-probe-0001', 'equipment_model', '{}'::jsonb,
             '{}'::jsonb, 0.9, 'test')
     RETURNING id`,
    [seed!.source_id, seed!.artifact_id],
  );
  sourceRecordId = record!.id;

  // Two DIFFERENT equipment models, each with its own strong model_number.
  const models = await factory.driver.query<{ entity_id: string; normalized_value: string }>(
    `SELECT ea.entity_id, ea.normalized_value
       FROM entity_aliases ea
       JOIN entities e ON e.id = ea.entity_id
      WHERE ea.alias_type = 'model_number' AND e.entity_type = 'equipment_model'
      ORDER BY ea.normalized_value
      LIMIT 2`,
  );
  entityA = { id: models[0]!.entity_id, alias: models[0]!.normalized_value };
  entityB = { id: models[1]!.entity_id, alias: models[1]!.normalized_value };
  expect(entityA.id).not.toBe(entityB.id);

  resolver = new EntityResolver({
    store: factory.store,
    config: factory.config,
    verticalId: vertical!.id as never,
    now: '2026-08-14T00:00:00.000Z' as never,
    authorityBySourceId: new Map(),
  });

  // One record carrying BOTH models' strong identifiers — the conflict.
  await resolver.resolveRecord({
    entityType: 'equipment_model' as never,
    aliases: [
      { aliasType: 'model_number' as never, aliasValue: entityA.alias, normalizedValue: entityA.alias, strong: true },
      { aliasType: 'model_number' as never, aliasValue: entityB.alias, normalizedValue: entityB.alias, strong: true },
    ],
    manufacturer: null,
    sourceId: sourceId as never,
    sourceRecordId: sourceRecordId as never,
  });
});

afterAll(async () => {
  await factory?.close();
});

describe('conflicted resolution keeps its review flag and tells the truth', () => {
  it('writes exactly one candidate row for the record, not two that overwrite', async () => {
    const rows = await candidates();
    expect(rows.length).toBe(1);
  });

  it('retains NEEDS_REVIEW instead of being downgraded to MATCH', async () => {
    const [row] = await candidates();
    expect(row!.decision).toBe('NEEDS_REVIEW');
    expect(row!.score).toBeLessThan(1);
  });

  it('records every entity the identifiers pointed at', async () => {
    const [row] = await candidates();
    const conflicting = row!.explanation_features['conflicting_entities'] as string[];
    expect(conflicting).toEqual(expect.arrayContaining([entityA.id, entityB.id]));
    expect(conflicting.length).toBeGreaterThanOrEqual(2);
  });

  it('does not claim a deterministic match, and names the identifier that disagreed', async () => {
    const [row] = await candidates();
    // The old row asserted `deterministic: true` while omitting the conflicting
    // identifier — the two lies that made the audit record worse than useless.
    expect(row!.explanation_features['deterministic']).toBe(false);

    const matchedOn = (row!.explanation_features['matched_on'] as string[]).join(' ');
    expect(matchedOn).toContain(entityA.alias);
    expect(matchedOn).toContain(entityB.alias);
  });

  it('records the merge as provisional rather than certain', async () => {
    const rows = await judgments();
    const provisional = rows.filter(
      (row) => row.verdict === 'MERGE' && /PROVISIONAL/.test(row.rationale),
    );
    expect(provisional.length).toBe(1);

    // A merge did happen (the record had to attach somewhere) so it stays
    // auditable and reversible — but it must not claim certainty.
    expect(provisional[0]!.identity_confidence).toBeLessThan(1);
    expect(provisional[0]!.rationale).toMatch(/pending review/i);
  });

  it('surfaces the conflict as a diagnostic', () => {
    expect(resolver.diagnostics.join('\n')).toMatch(/matched 2 entities on strong identifiers/);
  });

  it('will not let a later automated pass clear a pending review', async () => {
    // Defence in depth behind the structural fix: even if some future code path
    // proposes a decision for the same tuple, a queued human review may only be
    // resolved by a human decision, never by a re-run.
    await resolver.resolveRecord({
      entityType: 'equipment_model' as never,
      aliases: [
        {
          aliasType: 'model_number' as never,
          aliasValue: entityA.alias,
          normalizedValue: entityA.alias,
          strong: true,
        },
      ],
      manufacturer: null,
      sourceId: sourceId as never,
      sourceRecordId: sourceRecordId as never,
    });

    const rows = await candidates();
    const review = rows.find((row) => row.decision === 'NEEDS_REVIEW');
    expect(review, 'the review flag must survive a later clean pass').toBeDefined();
    expect(review!.explanation_features['conflicting_entities']).toBeDefined();
  });
});
