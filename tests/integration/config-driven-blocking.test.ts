/**
 * Candidate blocking is configuration, not HVAC code (AGENTS.md rule 4).
 *
 * The blocking pass used to hard-code `model_number`, `equipment_model` and
 * `manufactures`, and silently returned no block for any other key — so a
 * second vertical would have proposed no candidates and reported nothing. This
 * drives the real resolver, against a real database, with an inline synthetic
 * second-vertical config (vehicles-shaped; deliberately not a `verticals/`
 * directory) and proves every candidate it proposes comes from a key that
 * config declares. HVAC's own byte-identical behaviour is held by the golden,
 * factory-proof and determinism suites, which run unchanged.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  EntityResolver,
  PipelineConfigurationError,
  type VerticalConfig,
} from '../../services/ingest-worker/src/index.js';
import { createFactory, type Factory } from '../support/harness.js';

const AT = '2026-03-01T00:00:00.000Z';
const NOW = '2026-08-14T00:00:00.000Z';

const ENTITY_RESOLUTION = {
  candidate_floor: 0.55,
  hard_conflict_properties: ['fuel_type'],
  never_merge_across: [],
  blocking_keys: [
    {
      key: 'same_make',
      entity_type: 'vehicle_model_year',
      kind: 'related_entity',
      predicate: 'makes',
      role: 'object',
      reject_mismatch_as: 'makes',
    },
    {
      key: 'make_model_year',
      entity_type: 'vehicle_model_year',
      kind: 'property_values',
      properties: ['model_name', 'model_year'],
    },
    {
      key: 'epa_vehicle_id',
      entity_type: 'epa_vehicle_configuration',
      kind: 'alias',
      alias_type: 'epa_vehicle_id',
    },
    {
      key: 'campaign_year_prefix',
      entity_type: 'recall_campaign',
      kind: 'alias',
      alias_type: 'nhtsa_campaign_number',
      prefix_length: 3,
    },
  ],
};

let factory: Factory;
let verticalId: string;
let config: VerticalConfig;
let seed: { source_id: string; artifact_id: string; record_id: string };
let result: { readonly proposed: number; readonly rejected: number };

async function entity(slug: string, entityType: string): Promise<string> {
  const [row] = await factory.driver.query<{ id: string }>(
    `INSERT INTO entities (vertical_id, entity_type, canonical_name, canonical_slug,
                           status, quality_score, first_seen_at, created_at, updated_at)
     VALUES ($1, $2, $3, $3, 'ACTIVE', 0.5, $4, $4, $4)
     RETURNING id`,
    [verticalId, entityType, slug, AT],
  );
  return row!.id;
}

async function alias(entityId: string, aliasType: string, value: string): Promise<void> {
  await factory.store.addAlias({
    entity_id: entityId as never,
    alias_type: aliasType as never,
    alias_value: value,
    normalized_value: value,
    source_id: seed.source_id as never,
    identity_confidence: 0.99 as never,
    valid_from: AT as never,
    valid_to: null,
  });
}

async function fact(entityId: string, property: string, value: string | number): Promise<void> {
  await factory.store.appendFactWithEvidence(
    {
      entity_id: entityId as never,
      property: property as never,
      normalized_value: value,
      value_type: typeof value === 'number' ? 'number' : 'string',
      unit: null,
      valid_from: AT as never,
      confidence: 0.9 as never,
      recorded_at: AT as never,
      status: 'ACTIVE',
    },
    [
      {
        artifact_id: seed.artifact_id as never,
        source_record_id: seed.record_id as never,
        source_value: String(value),
        locator_type: 'JSON_POINTER',
        locator_value: `/${property}`,
        observed_at: AT as never,
      },
    ],
  );
}

async function makes(makeId: string, modelYearId: string): Promise<void> {
  await factory.store.upsertRelationshipWithEvidence(
    {
      vertical_id: verticalId as never,
      subject_entity_id: makeId as never,
      predicate: 'makes' as never,
      object_entity_id: modelYearId as never,
      confidence: 0.99 as never,
      valid_from: AT as never,
      recorded_at: AT as never,
      status: 'ACTIVE',
    },
    [
      {
        artifact_id: seed.artifact_id as never,
        source_record_id: seed.record_id as never,
        source_value: 'makes',
        locator_type: 'JSON_POINTER',
        locator_value: '/make',
        observed_at: AT as never,
      },
    ],
  );
}

function resolverFor(entityResolution: unknown): EntityResolver {
  return new EntityResolver({
    store: factory.store,
    config: { ...config, entityResolution },
    verticalId: verticalId as never,
    now: NOW as never,
    authorityBySourceId: new Map(),
  });
}

beforeAll(async () => {
  factory = await createFactory('hvac');
  await factory.run();

  const [row] = await factory.driver.query<{
    source_id: string;
    artifact_id: string;
    record_id: string;
  }>(
    `SELECT source_id, artifact_id, id AS record_id FROM source_records
      WHERE is_current AND revision_state = 'FINALIZED'
      ORDER BY id LIMIT 1`,
  );
  seed = row!;

  const vertical = await factory.store.upsertVertical({
    slug: 'vehicles-synthetic' as never,
    name: 'Synthetic vehicles (blocking test)',
    schema_version: '0.1.0' as never,
    status: 'DRAFT',
    default_refresh_policy: factory.config.defaultRefreshPolicy as never,
  });
  verticalId = vertical.id;

  config = {
    ...factory.config,
    slug: 'vehicles-synthetic',
    entityTypes: ['make', 'vehicle_model_year', 'epa_vehicle_configuration', 'recall_campaign'],
    relationshipPredicates: ['makes', 'affected_by'],
    aliasTypes: [
      {
        type: 'epa_vehicle_id',
        applies_to: ['epa_vehicle_configuration'],
        strong: true,
        scoped_to: null,
      },
      {
        type: 'nhtsa_campaign_number',
        applies_to: ['recall_campaign'],
        strong: true,
        scoped_to: null,
      },
    ],
    entityResolution: ENTITY_RESOLUTION,
  };

  const toyota = await entity('toyota', 'make');
  const honda = await entity('honda', 'make');
  const camryA = await entity('toyota-camry-2024-a', 'vehicle_model_year');
  const camryB = await entity('toyota-camry-2024-b', 'vehicle_model_year');
  const hondaCamry = await entity('honda-camry-2024', 'vehicle_model_year');
  for (const [id, make] of [
    [camryA, toyota],
    [camryB, toyota],
    [hondaCamry, honda],
  ] as const) {
    await makes(make, id);
    await fact(id, 'model_name', 'camry');
    await fact(id, 'model_year', 2024);
  }

  await alias(await entity('epa-45123-a', 'epa_vehicle_configuration'), 'epa_vehicle_id', '45123');
  await alias(await entity('epa-45123-b', 'epa_vehicle_configuration'), 'epa_vehicle_id', '45123');
  await alias(await entity('epa-45124', 'epa_vehicle_configuration'), 'epa_vehicle_id', '45124');

  await alias(await entity('recall-24v123', 'recall_campaign'), 'nhtsa_campaign_number', '24V123');
  await alias(await entity('recall-24v456', 'recall_campaign'), 'nhtsa_campaign_number', '24V456');
  await alias(await entity('recall-23v001', 'recall_campaign'), 'nhtsa_campaign_number', '23V001');

  result = await resolverFor(ENTITY_RESOLUTION).runBlockingPass();
});

afterAll(async () => {
  await factory?.close();
});

describe('a second vertical gets candidate blocking from its declared keys', () => {
  it('proposes exactly the pairs its keys block together, and rejects across makes', () => {
    // camry A/B (make_model_year, again under same_make — proposed once),
    // A/honda and B/honda (make_model_year, rejected: different makes),
    // the two EPA configurations sharing an exact id, and the two 24V recalls.
    expect(result).toEqual({ proposed: 5, rejected: 2 });
  });

  it('records every candidate under a declared key and only within one entity type', async () => {
    const rows = await factory.driver.query<{
      block: string;
      left_slug: string;
      right_slug: string;
      decision: string;
      left_type: string;
      right_type: string;
    }>(
      `SELECT c.explanation_features->>'blocking_key' AS block,
              l.canonical_slug AS left_slug, r.canonical_slug AS right_slug,
              c.decision, l.entity_type AS left_type, r.entity_type AS right_type
         FROM resolution_candidates c
         JOIN entities l ON l.id = c.left_entity_id
         JOIN entities r ON r.id = c.right_entity_id
        WHERE c.vertical_id = $1
        ORDER BY block, left_slug, right_slug`,
      [verticalId],
    );
    expect(
      rows.map((row) => [row.block, row.left_slug, row.right_slug, row.decision]),
    ).toEqual([
      ['campaign_year_prefix=24V', 'recall-24v123', 'recall-24v456', 'NEEDS_REVIEW'],
      ['epa_vehicle_id=45123', 'epa-45123-a', 'epa-45123-b', 'NEEDS_REVIEW'],
      ['make_model_year=camry:2024', 'honda-camry-2024', 'toyota-camry-2024-a', 'NO_MATCH'],
      ['make_model_year=camry:2024', 'honda-camry-2024', 'toyota-camry-2024-b', 'NO_MATCH'],
      ['make_model_year=camry:2024', 'toyota-camry-2024-a', 'toyota-camry-2024-b', 'NEEDS_REVIEW'],
    ]);
    for (const row of rows) expect(row.left_type).toBe(row.right_type);
  });

  it('writes a durable NOT_MERGE naming the declared mismatch, never a merge', async () => {
    const judgments = await factory.driver.query<{ verdict: string; rationale: string }>(
      `SELECT verdict, rationale FROM resolution_judgments WHERE vertical_id = $1 ORDER BY rationale`,
      [verticalId],
    );
    expect(judgments).toHaveLength(2);
    for (const judgment of judgments) {
      expect(judgment.verdict).toBe('NOT_MERGE');
      expect(judgment.rationale).toMatch(
        /^Blocked by make_model_year=camry:2024; rejected because different makes \((honda vs toyota|toyota vs honda)\)\.$/,
      );
    }
  });

  it('refuses to run with a key outside the declared vocabulary instead of blocking nothing', async () => {
    const undeclared = { ...ENTITY_RESOLUTION, blocking_keys: ['make_model_year'] };
    await expect(resolverFor(undeclared).runBlockingPass()).rejects.toBeInstanceOf(
      PipelineConfigurationError,
    );
    const wrongPredicate = {
      ...ENTITY_RESOLUTION,
      blocking_keys: [{ ...ENTITY_RESOLUTION.blocking_keys[0], predicate: 'manufactures' }],
    };
    await expect(resolverFor(wrongPredicate).runBlockingPass()).rejects.toThrow(
      /predicate: "manufactures" is not a declared relationship predicate/,
    );
  });
});
