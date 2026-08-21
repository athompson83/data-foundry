/**
 * Finding #2b — the judgment trail collapsed distinct resolution episodes.
 *
 * `#recordJudgment` deduplicated on the tuple
 * `(vertical, left_entity, left_source_record, right_entity, verdict, active)`.
 * That tuple cannot tell a *retry* of one decision apart from a *materially
 * different later decision about the same pair*, so the second one was dropped
 * on the floor:
 *
 *   run 1  record R resolves cleanly to entity A
 *          → MERGE, identity_confidence 1, "Exact normalized identifier match"
 *   run 2  R now also carries a strong identifier belonging to entity B
 *          → the candidate flips to NEEDS_REVIEW and the attachment becomes
 *            PROVISIONAL, but the tuple is unchanged, so NO judgment is written
 *
 * The reviewer then reads `resolution_candidates` and sees a conflict, reads
 * `resolution_judgments` and sees a clean certain merge. The audit trail
 * contradicts the queue, and the surviving judgment is the one that is now
 * false.
 *
 * The fix is judgment *event* identity: what the decision rested on (evidence
 * fingerprint) plus what was decided (decision fingerprint). Identical on both
 * → the same logical event, retried; different → a new episode that is appended
 * and linked to the one it supersedes. AGENTS.md rule 3: merges are auditable
 * and reversible, and nothing is deleted to undo a decision.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EntityResolver } from '../../services/ingest-worker/src/index.js';
import { createFactory, type Factory } from '../support/harness.js';

let factory: Factory;
let resolver: EntityResolver;
let verticalId: string;
let sourceId: string;
let sourceRecordId: string;

/**
 * The winner is the entity both episodes attach to. It is pinned by
 * construction: `entityA` is given both the lexicographically smaller id AND
 * the earlier `created_at`/`first_seen_at`, so it wins under the current
 * id-ordered rule and under any age-based rule that replaces it (#8/#14).
 */
const ENTITY_A = '0a111111-1111-4111-8111-111111111111';
const ENTITY_B = 'fb222222-2222-4222-8222-222222222222';
const MODEL_A = 'JUDGMENTPROBEA1';
const MODEL_B = 'JUDGMENTPROBEB2';

type JudgmentRow = {
  id: string;
  verdict: string;
  right_entity_id: string;
  identity_confidence: number;
  rationale: string;
  active: boolean;
  supersedes_judgment_id: string | null;
  episode_seq: number;
};

/** Every judgment episode for the probe record, oldest first. */
async function judgments(): Promise<JudgmentRow[]> {
  return factory.driver.query<JudgmentRow>(
    `SELECT id::text AS id, verdict, right_entity_id::text AS right_entity_id,
            identity_confidence::float8 AS identity_confidence, rationale, active,
            supersedes_judgment_id::text AS supersedes_judgment_id, episode_seq
       FROM resolution_judgments
      WHERE left_source_record_id = $1
      ORDER BY episode_seq`,
    [sourceRecordId],
  );
}

async function candidates(): Promise<
  Array<{ decision: string; explanation_features: Record<string, unknown> }>
> {
  return factory.driver.query(
    `SELECT decision, explanation_features FROM resolution_candidates
      WHERE left_source_record_id = $1`,
    [sourceRecordId],
  );
}

/** Episode 1 evidence: one strong identifier, no conflict. */
const cleanAliases = () => [
  {
    aliasType: 'model_number' as never,
    aliasValue: MODEL_A,
    normalizedValue: MODEL_A,
    strong: true,
  },
];

/** Episode 2 evidence: a second strong identifier that belongs to entity B. */
const conflictedAliases = () => [
  ...cleanAliases(),
  {
    aliasType: 'model_number' as never,
    aliasValue: MODEL_B,
    normalizedValue: MODEL_B,
    strong: true,
  },
];

async function resolveProbe(aliases: ReturnType<typeof cleanAliases>): Promise<void> {
  await resolver.resolveRecord({
    entityType: 'equipment_model' as never,
    aliases,
    manufacturer: null,
    sourceId: sourceId as never,
    sourceRecordId: sourceRecordId as never,
  });
}

beforeAll(async () => {
  factory = await createFactory('hvac');
  await factory.run();

  const [vertical] = await factory.driver.query<{ id: string }>(
    `SELECT id FROM verticals WHERE slug = 'hvac'`,
  );
  verticalId = vertical!.id;

  const [seed] = await factory.driver.query<{ source_id: string; artifact_id: string }>(
    `SELECT source_id, artifact_id FROM source_records LIMIT 1`,
  );
  sourceId = seed!.source_id;

  const [record] = await factory.driver.query<{ id: string }>(
    `INSERT INTO source_records
       (source_id, artifact_id, source_record_key, entity_type, raw_payload,
        normalized_payload, extraction_confidence, extractor_version)
     VALUES ($1, $2, 'judgment-history-probe-0001', 'equipment_model', '{}'::jsonb,
             '{}'::jsonb, 0.9, 'test')
     RETURNING id`,
    [seed!.source_id, seed!.artifact_id],
  );
  sourceRecordId = record!.id;

  // Two entities with pinned ids and ages so the attachment winner is the same
  // in both episodes — which is exactly the case the tuple-only dedup collapsed.
  for (const [id, slug, model, seenAt] of [
    [ENTITY_A, 'judgment-probe-a', MODEL_A, '2026-01-01T00:00:00.000Z'],
    [ENTITY_B, 'judgment-probe-b', MODEL_B, '2026-02-01T00:00:00.000Z'],
  ] as const) {
    await factory.driver.query(
      `INSERT INTO entities (id, vertical_id, entity_type, canonical_name, canonical_slug,
                             status, quality_score, first_seen_at, created_at, updated_at)
       VALUES ($1, $2, 'equipment_model', $3, $4, 'ACTIVE', 0.5, $5, $5, $5)`,
      [id, verticalId, model, slug, seenAt],
    );
    await factory.driver.query(
      `INSERT INTO entity_aliases (entity_id, alias_type, alias_value, normalized_value,
                                   source_id, identity_confidence, valid_from)
       VALUES ($1, 'model_number', $2, $2, $3, 0.99, $4)`,
      [id, model, sourceId, seenAt],
    );
  }

  resolver = new EntityResolver({
    store: factory.store,
    config: factory.config,
    verticalId: verticalId as never,
    now: '2026-08-14T00:00:00.000Z' as never,
    authorityBySourceId: new Map(),
  });
});

afterAll(async () => {
  await factory?.close();
});

describe('#2b — a resolution judgment trail keeps every distinct episode', () => {
  it('records the first clean attachment as one certain MERGE', async () => {
    await resolveProbe(cleanAliases());

    const rows = await judgments();
    expect(rows.length).toBe(1);
    expect(rows[0]!.verdict).toBe('MERGE');
    expect(rows[0]!.right_entity_id).toBe(ENTITY_A);
    expect(rows[0]!.identity_confidence).toBe(1);
    expect(rows[0]!.rationale).not.toMatch(/PROVISIONAL/);
    expect(rows[0]!.active).toBe(true);
    expect(rows[0]!.supersedes_judgment_id).toBeNull();
    expect(rows[0]!.episode_seq).toBe(1);
  });

  it('treats a retry of the same evidence and decision as the same event', async () => {
    const before = await judgments();
    await resolveProbe(cleanAliases());
    await resolveProbe(cleanAliases());

    const after = await judgments();
    expect(after.length).toBe(before.length);
    // Not merely the same count: the same row, untouched.
    expect(after.map((row) => row.id)).toEqual(before.map((row) => row.id));
  });

  it('appends a new episode when later evidence turns the merge provisional', async () => {
    await resolveProbe(conflictedAliases());

    const rows = await judgments();
    expect(
      rows.length,
      'a materially different decision must not be swallowed by the earlier one',
    ).toBe(2);

    // The scenario only bites when both episodes attach to the same entity.
    expect(rows[1]!.right_entity_id).toBe(ENTITY_A);
    expect(rows[1]!.rationale).toMatch(/PROVISIONAL/);
    expect(rows[1]!.identity_confidence).toBeLessThan(1);
  });

  it('keeps the superseded episode verbatim instead of rewriting it', async () => {
    const [first, second] = await judgments();

    // Append-only: the earlier decision is still readable exactly as decided.
    expect(first!.rationale).toMatch(/Exact normalized identifier match/);
    expect(first!.identity_confidence).toBe(1);
    expect(first!.verdict).toBe('MERGE');

    // ...and it is no longer the current one.
    expect(first!.active).toBe(false);
    expect(second!.active).toBe(true);
    expect(second!.supersedes_judgment_id).toBe(first!.id);
  });

  it('orders history deterministically rather than by wall-clock tie', async () => {
    const rows = await judgments();
    expect(rows.map((row) => row.episode_seq)).toEqual([1, 2]);

    // Exactly one current judgment per logical pair — what every consumer that
    // filters on `active` already assumes.
    expect(rows.filter((row) => row.active).length).toBe(1);
  });

  it('shows the conflict in the candidate state and in the judgment history', async () => {
    const [candidate] = await candidates();
    expect(candidate!.decision).toBe('NEEDS_REVIEW');
    expect(candidate!.explanation_features['conflicting_entities']).toEqual(
      expect.arrayContaining([ENTITY_A, ENTITY_B]),
    );

    const current = (await judgments()).find((row) => row.active);
    expect(current!.rationale).toContain(ENTITY_B);
    expect(current!.rationale).toMatch(/pending review/i);
  });

  it('is idempotent again once the conflicted decision is the current one', async () => {
    const before = await judgments();
    await resolveProbe(conflictedAliases());
    await resolveProbe(conflictedAliases());

    const after = await judgments();
    expect(after.length).toBe(before.length);
    expect(after.map((row) => row.id)).toEqual(before.map((row) => row.id));
  });
});
