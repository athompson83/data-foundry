/**
 * Query-layer fixtures, layered on the same PGlite + real-migrations harness
 * the store and provenance tests use.
 *
 * The interesting part is the identifier scenario: a blower motor whose part
 * number is *written* `HK-32EA/001` but *normalized* to `hk32ea001`, next to an
 * unrelated part literally named "HK32EA001 Motor". Searching `hk32ea001` gives
 * the second one a much better text score and the first one an exact
 * identifier match — which is precisely the case AGENTS.md rule 7 exists for.
 */
import {
  entityQualityScore,
  identityConfidence,
  type Entity,
} from '@data-foundry/canonical-schema';
import { FieldMetadataRegistry, createQueryModel, type QueryModel } from '../src/index.js';
import {
  claim,
  createFixtures,
  ts,
  type Fixtures,
  type FixtureOptions,
} from '../../canonical-store/test/support.js';

export {
  claim,
  countRows,
  createFixtures,
  migrate,
  ts,
  type ClaimOptions,
  type FixtureOptions,
  type Fixtures,
  type SourceFixture,
  type SourceKey,
} from '../../canonical-store/test/support.js';

/** Doc 04 "Filter metadata" for the HVAC test vertical. */
export const HVAC_FIELDS = [
  {
    field: 'seer2_rating',
    value_type: 'number',
    unit: null,
    filter: { type: 'multi_select', facet_count: true },
    sort: true,
    search_boost: 0,
    indexable: true,
    label: 'SEER2 rating',
  },
  {
    field: 'refrigerant',
    value_type: 'string',
    unit: null,
    filter: { type: 'multi_select', facet_count: true },
    sort: false,
    search_boost: 0.4,
    indexable: true,
    label: 'Refrigerant',
  },
  {
    field: 'tonnage',
    value_type: 'number',
    unit: 'ton',
    filter: { type: 'range', facet_count: true },
    sort: true,
    search_boost: 0,
    indexable: true,
    label: 'Nominal tonnage',
  },
  {
    field: 'internal_note',
    value_type: 'string',
    unit: null,
    filter: { type: 'none', facet_count: false },
    sort: false,
    search_boost: 0,
    indexable: false,
    label: 'Internal note',
  },
] as const;

export interface QueryFixtures extends Fixtures {
  readonly qm: QueryModel;
  readonly registry: FieldMetadataRegistry;
  /** Equipment: "Carrier Infinity 24ANB7" (inherited from the base fixtures). */
  readonly equipment: Entity;
  /** Equipment: "Carrier Infinity 25VNA4". */
  readonly heatPump: Entity;
  /** Part whose identifier normalizes to `hk32ea001` but reads `HK-32EA/001`. */
  readonly motor: Entity;
  /** Unrelated part literally named "HK32EA001 Motor" — the fuzzy rival. */
  readonly rival: Entity;
}

export async function createQueryFixtures(
  options: FixtureOptions = {},
): Promise<QueryFixtures> {
  const base = await createFixtures(options);
  const { store, vertical } = base;

  const heatPump = await store.upsertEntity({
    vertical_id: vertical.id,
    entity_type: 'equipment',
    canonical_name: 'Carrier Infinity 25VNA4',
    canonical_slug: 'carrier-infinity-25vna4',
    status: 'ACTIVE',
    quality_score: entityQualityScore(0.66),
    first_seen_at: ts('2026-01-01T00:00:00Z'),
    last_verified_at: null,
  });
  await store.addAlias({
    entity_id: heatPump.id,
    alias_type: 'model_number',
    alias_value: '25VNA4',
    normalized_value: '25vna4',
    source_id: base.sources.manufacturer.source.id,
    identity_confidence: identityConfidence(0.98),
    valid_from: ts('2026-01-01T00:00:00Z'),
    valid_to: null,
  });

  const motor = await store.upsertEntity({
    vertical_id: vertical.id,
    entity_type: 'part',
    canonical_name: 'Carrier Blower Motor',
    canonical_slug: 'carrier-blower-motor',
    status: 'ACTIVE',
    quality_score: entityQualityScore(0.5),
    first_seen_at: ts('2026-01-01T00:00:00Z'),
    last_verified_at: null,
  });
  await store.addAlias({
    entity_id: motor.id,
    alias_type: 'part_number',
    // Written with punctuation by the manufacturer, normalized for lookup.
    alias_value: 'HK-32EA/001',
    normalized_value: 'hk32ea001',
    source_id: base.sources.manufacturer.source.id,
    identity_confidence: identityConfidence(0.99),
    valid_from: ts('2026-01-01T00:00:00Z'),
    valid_to: null,
  });

  const rival = await store.upsertEntity({
    vertical_id: vertical.id,
    entity_type: 'part',
    canonical_name: 'HK32EA001 Motor',
    canonical_slug: 'hk32ea001-motor-aftermarket',
    status: 'ACTIVE',
    quality_score: entityQualityScore(0.2),
    first_seen_at: ts('2026-01-01T00:00:00Z'),
    last_verified_at: null,
  });

  const fixtures: Fixtures = base;
  for (const [entity, seer, tons] of [
    [base.entity, 16, 3],
    [heatPump, 18, 4],
  ] as const) {
    await claim(fixtures, 'manufacturer', {
      property: 'seer2_rating',
      value: seer,
      value_type: 'number',
      entity_id: entity.id,
      valid_from: '2026-02-01T00:00:00Z',
    });
    await claim(fixtures, 'manufacturer', {
      property: 'refrigerant',
      value: 'R-454B',
      entity_id: entity.id,
      valid_from: '2026-02-01T00:00:00Z',
    });
    await claim(fixtures, 'manufacturer', {
      property: 'tonnage',
      value: tons,
      value_type: 'number',
      unit: 'ton',
      entity_id: entity.id,
      valid_from: '2026-02-01T00:00:00Z',
    });
  }

  // A disagreement to prove the trust surface survives the query layer.
  await claim(fixtures, 'aggregator', {
    property: 'seer2_rating',
    value: 15.2,
    value_type: 'number',
    status: 'PROPOSED',
    entity_id: base.entity.id,
    valid_from: '2026-02-01T00:00:00Z',
  });

  const registry = new FieldMetadataRegistry([...HVAC_FIELDS]);
  const qm = createQueryModel(store, { fields: registry });

  return { ...base, qm, registry, equipment: base.entity, heatPump, motor, rival };
}

/** Evidence-backed relationship helper for traversal tests. */
export async function relate(
  fixtures: QueryFixtures,
  subject: Entity,
  predicate: string,
  object: Entity,
): Promise<void> {
  await fixtures.store.upsertRelationshipWithEvidence(
    {
      vertical_id: fixtures.vertical.id,
      subject_entity_id: subject.id,
      predicate,
      object_entity_id: object.id,
      confidence: fixtures.equipment.quality_score as never,
      valid_from: ts('2026-02-01T00:00:00Z'),
      recorded_at: ts('2026-02-01T00:00:00Z'),
      status: 'ACTIVE',
    },
    [
      {
        artifact_id: fixtures.sources.manufacturer.artifact.id,
        source_record_id: fixtures.sources.manufacturer.record.id,
        source_value: `${subject.canonical_name} ${predicate} ${object.canonical_name}`,
        locator_type: 'CSS_SELECTOR',
        locator_value: `ul.${predicate} li`,
        observed_at: ts('2026-02-01T00:00:00Z'),
      },
    ],
  );
}
