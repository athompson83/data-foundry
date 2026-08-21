/**
 * A source record that changes which entity it belongs to.
 *
 * Migration 0009 gave judgments episode identity so that a later, materially
 * different decision supersedes the earlier one instead of being dropped. It
 * keyed that identity on the tuple
 *
 *   (vertical, left entity, left source record, right entity, verdict)
 *
 * and for a record-attachment judgment `right_entity_id` is the ANSWER, not the
 * question. The question a record asks is "where do I belong?". Keying identity
 * on the answer means that when the answer changes — the record stops matching
 * one entity and starts matching another — the lookup finds no current episode
 * and appends a *fresh* one, leaving the old judgment `active`.
 *
 * The result is two live judgments claiming one record belongs to two different
 * entities, one of them a certain (confidence 1.0) merge into an entity the
 * record is no longer attached to. That is the same contradiction #2b set out
 * to remove, reached along the entity axis rather than the evidence axis.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EntityResolver } from '../../services/ingest-worker/src/index.js';
import { createFactory, type Factory } from '../support/harness.js';

let factory: Factory;
let resolver: EntityResolver;
let sourceId: string;
let sourceRecordId: string;

/** A is known longer, so once both match it wins the age-ordered tiebreak. */
const OLDER = {
  id: '0a111111-1111-4111-8111-111111111111',
  slug: 'attachment-move-older',
  model: 'MOVEPROBEOLD1',
  seenAt: '2026-01-01T00:00:00.000Z',
};
const NEWER = {
  id: 'fb222222-2222-4222-8222-222222222222',
  slug: 'attachment-move-newer',
  model: 'MOVEPROBENEW2',
  seenAt: '2026-02-01T00:00:00.000Z',
};

const alias = (model: string) => ({
  aliasType: 'model_number' as never,
  aliasValue: model,
  normalizedValue: model,
  strong: true,
});

const resolve = (models: readonly string[]) =>
  resolver.resolveRecord({
    entityType: 'equipment_model' as never,
    aliases: models.map(alias),
    manufacturer: null,
    sourceId: sourceId as never,
    sourceRecordId: sourceRecordId as never,
  });

type JudgmentRow = {
  id: string;
  right_entity_id: string;
  active: boolean;
  episode_seq: number;
  supersedes_judgment_id: string | null;
  identity_confidence: number;
};

const judgments = (): Promise<JudgmentRow[]> =>
  factory.driver.query<JudgmentRow>(
    `SELECT id::text AS id, right_entity_id::text AS right_entity_id, active, episode_seq,
            supersedes_judgment_id::text AS supersedes_judgment_id, identity_confidence
       FROM resolution_judgments
      WHERE left_source_record_id = $1
      ORDER BY episode_seq`,
    [sourceRecordId],
  );

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
     VALUES ($1, $2, 'attachment-move-0001', 'equipment_model', '{}'::jsonb,
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

  // Pass 1: the record carries only the newer entity's identifier, and attaches
  // to it cleanly. Pass 2: it now also carries the older entity's identifier,
  // so the identifiers conflict and it attaches to the entity known longest.
  await resolve([NEWER.model]);
  await resolve([OLDER.model, NEWER.model]);
}, 300_000);

afterAll(async () => {
  await factory?.close();
});

describe('a record that moves between entities supersedes its own judgment', () => {
  it('actually moved — the two passes reached different entities', async () => {
    const rows = await judgments();
    const targets = new Set(rows.map((row) => row.right_entity_id));
    expect(
      targets.size,
      'both passes attached to the same entity, so this test proves nothing',
    ).toBe(2);
    expect(targets).toEqual(new Set([OLDER.id, NEWER.id]));
  });

  it('leaves exactly one active judgment for the record', async () => {
    const active = (await judgments()).filter((row) => row.active);
    expect(
      active.length,
      'a record cannot be currently attached to two different entities at once',
    ).toBe(1);
  });

  it('keeps the current judgment pointing where the record actually is', async () => {
    const [active] = (await judgments()).filter((row) => row.active);
    expect(active!.right_entity_id).toBe(OLDER.id);
  });

  it('retires the earlier decision without deleting it', async () => {
    const rows = await judgments();
    expect(rows.length).toBe(2);

    const retired = rows.find((row) => row.right_entity_id === NEWER.id);
    expect(retired).toBeDefined();
    expect(retired!.active).toBe(false);
    // Every byte of what was decided survives, including the certainty it was
    // decided with. Only its currency changed.
    expect(retired!.identity_confidence).toBe(1);
  });

  it('links the episodes so the move is reconstructable', async () => {
    const rows = await judgments();
    const retired = rows.find((row) => !row.active);
    const current = rows.find((row) => row.active);

    expect(current!.supersedes_judgment_id).toBe(retired!.id);
    expect(current!.episode_seq).toBeGreaterThan(retired!.episode_seq);
  });
});
