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
  canPublish,
  entityQualityScore,
  extractionConfidence,
  identityConfidence,
  type Entity,
  type RightsClassification,
  type SourceType,
} from '@data-foundry/canonical-schema';
import { FieldMetadataRegistry, createQueryModel, type QueryModel } from '../src/index.js';
import {
  claim,
  createFixtures,
  ts,
  type Fixtures,
  type FixtureOptions,
  type SourceFixture,
  type SourceKey,
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

/**
 * Evidence-backed relationship helper for traversal tests.
 *
 * `source` defaults to `manufacturer` — the GREEN source every caller of this
 * helper used to get unconditionally — so existing callers are unchanged. It is
 * a parameter because the helper previously could not express the case AGENTS.md
 * rule 1 is about: an edge whose evidence comes from a source that may not
 * publish. A helper that can only build the passing case is why the traversal
 * shipped with no rights filter and no test noticed.
 *
 * Called twice for the same triple with two different sources, it appends a
 * second evidence row rather than replacing the first (the evidence uniqueness
 * index keys on `source_record_id`), which is how a mixed-rights edge is built.
 */
export async function relate(
  fixtures: QueryFixtures,
  subject: Entity,
  predicate: string,
  object: Entity,
  source: SourceKey | SourceFixture = 'manufacturer',
): Promise<void> {
  const fixture = typeof source === 'string' ? fixtures.sources[source] : source;
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
        artifact_id: fixture.artifact.id,
        source_record_id: fixture.record.id,
        source_value: `${subject.canonical_name} ${predicate} ${object.canonical_name}`,
        locator_type: 'CSS_SELECTOR',
        locator_value: `ul.${predicate} li`,
        observed_at: ts('2026-02-01T00:00:00Z'),
      },
    ],
  );
}

/**
 * A source fixture beyond the shared set, for rights cases the shared set does
 * not carry. The shared fixtures are GREEN or UNREVIEWED only; AMBER is the
 * classification a rights filter written as `= 'GREEN'` would wrongly refuse,
 * so a test needs to be able to mint one.
 */
export async function addSourceFixture(
  fixtures: Fixtures,
  spec: {
    readonly key: string;
    readonly publisher: string;
    readonly domain: string;
    readonly source_type: SourceType;
    readonly authority_rank: number;
    readonly rights: RightsClassification;
  },
): Promise<SourceFixture> {
  const source = await fixtures.store.upsertSource({
    vertical_id: fixtures.vertical.id,
    publisher: spec.publisher,
    domain: spec.domain,
    source_type: spec.source_type,
    authority_rank: spec.authority_rank,
    rights_classification: spec.rights,
    attribution_requirement: { required: false, text: null, url: null },
    robots_policy: {
      respect_robots: true,
      user_agent: 'data-foundry-bot',
      crawl_delay_seconds: 1,
      disallowed_paths: [],
      allowed_paths: [],
      robots_url: null,
      snapshot_hash: null,
      snapshot_at: null,
    },
    refresh_cadence: 'WEEKLY',
    // Same rule-1 storage posture as the shared fixtures: only a source with a
    // rights decision that permits publication may be ACTIVE. Asked of
    // `canPublish` rather than restated as a literal set — a second copy of
    // "GREEN or AMBER" in a test helper is the same duplication the traversal
    // gate is written to avoid, and it would go on agreeing with itself after
    // the real rule changed.
    status: canPublish(spec.rights) ? 'ACTIVE' : 'UNDER_REVIEW',
  });
  const artifact = await fixtures.store.recordSourceArtifact({
    source_id: source.id,
    url: `https://${spec.domain}/products/24anb7`,
    retrieved_at: ts('2026-01-05T00:00:00Z'),
    content_hash: contentHash(spec.key),
    mime_type: 'text/html',
    r2_uri: `r2://raw/hvac/${spec.key}/24anb7.html`,
    http_status: 200,
    extractor_version: 'html-1.0.0',
    policy_snapshot_id: null,
    byte_size: 4096,
    acquisition_provider: 'http',
  });
  const record = await fixtures.store.recordSourceRecord({
    source_id: source.id,
    artifact_id: artifact.id,
    source_record_key: `${spec.key}-24ANB7`,
    entity_type: 'equipment',
    raw_payload: { model: '24ANB7' },
    normalized_payload: null,
    extraction_confidence: extractionConfidence(0.95),
    extractor_version: 'html-1.0.0',
  });
  return { source, artifact, record };
}

/** 64 hex characters derived from a seed, matching the shared fixtures' shape. */
const contentHash = (seed: string): string =>
  seed
    .repeat(64)
    .slice(0, 64)
    .split('')
    .map((character) => (/[0-9a-f]/.test(character) ? character : '0'))
    .join('');
