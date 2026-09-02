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
  type IsoDateTime,
  type RightsClassification,
  type SourceType,
} from '@data-foundry/canonical-schema';
import { FieldMetadataRegistry, createQueryModel, type QueryModel } from '../src/index.js';
import { rightsRequirementsForSurface, type RightsSurface } from '@data-foundry/rights-engine';
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
    kill_switch_engaged: false,
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
    acquisition_route: 'DIRECT_HTTP',
    account_or_product_plan: null,
    acquisition_jurisdiction: null,
  });
  const record = await fixtures.store.recordSourceRecord({
    source_id: source.id,
    artifact_id: artifact.id,
    source_record_key: `${spec.key}-24ANB7`,
    source_stream: 'fixture_records',
    entity_type: 'equipment',
    raw_payload: { model: '24ANB7' },
    normalized_payload: null,
    extraction_confidence: extractionConfidence(0.95),
    extractor_version: 'html-1.0.0',
  });
  return { source, artifact, record };
}

/**
 * Retire one synthetic current record through an accepted complete-snapshot
 * omission. Tests must build the same terminal lineage as production rather
 * than disabling or bypassing the deferred currentness guards.
 */
export async function retireSourceFixtureByCompleteSnapshot(
  fixtures: QueryFixtures,
  sourceKey: SourceKey,
  retiredAt: IsoDateTime,
): Promise<void> {
  const fixture = fixtures.sources[sourceKey];
  const sourceStream = fixture.record.source_stream;
  if (sourceStream === null) throw new Error('a current synthetic source record requires a stream');

  const acceptanceId = crypto.randomUUID();
  const digest = (): string => crypto.randomUUID().replaceAll('-', '').repeat(2);
  const snapshotDigest = digest();
  const terminalArtifact = await fixtures.store.recordSourceArtifact({
    source_id: fixture.source.id,
    url: `https://${fixture.source.domain}/snapshots/${acceptanceId}.json`,
    retrieved_at: retiredAt,
    content_hash: digest(),
    mime_type: 'application/json',
    r2_uri: `r2://test-snapshots/${fixture.source.id}/${acceptanceId}.json`,
    http_status: 200,
    extractor_version: 'snapshot-test-1.0.0',
    policy_snapshot_id: fixture.artifact.policy_snapshot_id,
    byte_size: 2,
    acquisition_provider: fixture.artifact.acquisition_provider,
    acquisition_route: fixture.artifact.acquisition_route,
    account_or_product_plan: fixture.artifact.account_or_product_plan,
    acquisition_jurisdiction: fixture.artifact.acquisition_jurisdiction,
  });

  await fixtures.driver.exec('BEGIN');
  try {
    await fixtures.driver.query(
      `INSERT INTO source_stream_snapshot_acceptances
         (id, source_id, source_stream, observed_at, snapshot_digest,
          artifact_set_digest, mapping_digest, record_set_digest,
          retrieval_count, accepted_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 1, $4)`,
      [
        acceptanceId,
        fixture.source.id,
        sourceStream,
        retiredAt,
        snapshotDigest,
        digest(),
        digest(),
        digest(),
      ],
    );
    await fixtures.driver.query(
      `INSERT INTO source_stream_snapshot_acceptance_artifacts
         (acceptance_id, artifact_id, retrieval_key, retrieval_receipt_id, created_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [acceptanceId, terminalArtifact.id, terminalArtifact.url, digest(), retiredAt],
    );
    await fixtures.driver.query(
      `UPDATE source_records
          SET is_current = FALSE, updated_at = $2
        WHERE id = $1`,
      [fixture.record.id, retiredAt],
    );
    await fixtures.driver.query(
      `INSERT INTO source_record_snapshot_retirements
         (source_record_id, snapshot_acceptance_id, artifact_id, source_id,
          source_stream, retired_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $6)`,
      [
        fixture.record.id,
        acceptanceId,
        terminalArtifact.id,
        fixture.source.id,
        sourceStream,
        retiredAt,
      ],
    );
    await fixtures.driver.exec('COMMIT');
  } catch (error) {
    await fixtures.driver.exec('ROLLBACK');
    throw error;
  }
}

const SYNTHETIC_RIGHTS_EFFECTIVE = ts('2026-01-01T00:00:00Z');
const SYNTHETIC_RIGHTS_RECHECK = ts('2027-01-01T00:00:00Z');

export interface SyntheticSurfaceRightsOptions {
  readonly termsRecheckAt?: IsoDateTime;
  readonly decisionRecheckAt?: IsoDateTime;
  readonly decisionRecheckAtByRequirement?: Readonly<Record<string, IsoDateTime>>;
}

/**
 * Explicit grants for synthetic test publishers. This is intentionally test
 * data, never a migration/backfill: production legacy rows remain UNKNOWN.
 */
export async function seedSyntheticSurfaceRights(
  fixtures: QueryFixtures,
  surfaces: readonly RightsSurface[],
  sourceKeys: readonly SourceKey[] = Object.keys(fixtures.sources) as SourceKey[],
  options: SyntheticSurfaceRightsOptions = {},
): Promise<void> {
  const termsRecheckAt = options.termsRecheckAt ?? SYNTHETIC_RIGHTS_RECHECK;
  const decisionRecheckAt = options.decisionRecheckAt ?? SYNTHETIC_RIGHTS_RECHECK;
  const requirements = new Map(
    [
      ...surfaces.flatMap((surface) => rightsRequirementsForSurface(surface)),
      ...(surfaces.includes('MCP')
        ? [{ id: 'mcp-excerpt', operation: 'QUOTE_OR_EXCERPT', channel: 'MCP_AGENT' } as const]
        : []),
    ]
      .map((entry) => [`${entry.operation}:${entry.channel}`, entry] as const),
  );

  let sourceIndex = 0;
  for (const [sourceKey, fixture] of Object.entries(fixtures.sources)) {
    if (!sourceKeys.includes(sourceKey as SourceKey)) continue;
    if (!canPublish(fixture.source.rights_classification) || fixture.source.status !== 'ACTIVE') {
      continue;
    }
    sourceIndex += 1;
    const publisherId = crypto.randomUUID();
    const termsEvidenceId = crypto.randomUUID();
    const reviewEvidenceId = crypto.randomUUID();
    const termsCellId = crypto.randomUUID();
    const termsVersionId = crypto.randomUUID();
    const termsHash = sourceIndex.toString(16).padStart(64, '0');
    const reviewHash = (sourceIndex + 100).toString(16).padStart(64, '0');

    await fixtures.driver.query(
      `INSERT INTO rights_publishers (id, publisher_key, legal_name, status)
       VALUES ($1, $2, $3, 'ACTIVE')`,
      [
        publisherId,
        `synthetic-${sourceKey.replaceAll('_', '-')}`,
        `${fixture.source.publisher} synthetic rights`,
      ],
    );
    await fixtures.driver.query(
      `INSERT INTO rights_evidence_artifacts
         (id, kind, canonical_uri, storage_uri, content_sha256, mime_type,
          captured_at, created_by)
       VALUES ($1, 'TERMS', $3, $4, $5, 'text/plain', $7, 'test-fixture'),
              ($2, 'REVIEW_MEMO', $6, $6, $8, 'text/plain', $7, 'test-fixture')`,
      [
        termsEvidenceId,
        reviewEvidenceId,
        `fixture://terms/${sourceKey}`,
        `fixture://terms/${sourceKey}.txt`,
        termsHash,
        `fixture://review/${sourceKey}`,
        SYNTHETIC_RIGHTS_EFFECTIVE,
        reviewHash,
      ],
    );
    await fixtures.driver.query(
      `UPDATE sources
          SET rights_publisher_id = $1,
              rights_publisher_mapping_evidence_artifact_id = $3,
              rights_publisher_mapping_reviewer_type = 'HUMAN',
              rights_publisher_mapping_reviewed_by = 'test-fixture',
              rights_publisher_mapping_reviewed_at = $4
        WHERE id = $2`,
      [publisherId, fixture.source.id, reviewEvidenceId, SYNTHETIC_RIGHTS_EFFECTIVE],
    );
    await fixtures.driver.query(
      `INSERT INTO rights_terms_cells (id, source_id, acquisition_route, created_by)
       VALUES ($1, $2, 'DIRECT_HTTP', 'test-fixture')`,
      [termsCellId, fixture.source.id],
    );
    await fixtures.driver.query(
      `INSERT INTO rights_terms_versions
         (id, terms_cell_id, evidence_artifact_id, content_sha256, version_label,
          effective_from, recheck_at, created_by)
       VALUES ($1, $2, $3, $4, 'synthetic-v1', $5, $6, 'test-fixture')`,
      [
        termsVersionId,
        termsCellId,
        termsEvidenceId,
        termsHash,
        SYNTHETIC_RIGHTS_EFFECTIVE,
        termsRecheckAt,
      ],
    );
    await fixtures.driver.query(
      `SELECT activate_rights_terms($1, 'HUMAN', 'test-fixture',
                                    'synthetic fixture terms', $2)`,
      [termsVersionId, SYNTHETIC_RIGHTS_EFFECTIVE],
    );

    await fixtures.driver.exec('BEGIN');
    try {
      for (const entry of requirements.values()) {
        const cellId = crypto.randomUUID();
        const decisionId = crypto.randomUUID();
        const requirementKey = `${entry.operation}:${entry.channel}`;
        const requirementRecheckAt =
          options.decisionRecheckAtByRequirement?.[requirementKey] ?? decisionRecheckAt;
        await fixtures.driver.query(
          `INSERT INTO rights_cells
             (id, source_id, acquisition_route, operation, channel, created_by)
           VALUES ($1, $2, 'DIRECT_HTTP', $3, $4, 'test-fixture')`,
          [cellId, fixture.source.id, entry.operation, entry.channel],
        );
        await fixtures.driver.query(
          `INSERT INTO rights_decisions
             (id, cell_id, state, controlling_terms_version_id, evidence_artifact_id,
              clause_ref, review_status, reviewer_type, reviewed_by, reviewed_at,
              effective_from, recheck_at, rationale, created_by)
           VALUES ($1, $2, 'ALLOW', $3, $4, 'synthetic fixture only', 'APPROVED',
                   'HUMAN', 'test-fixture', $5, $5, $6,
                   'explicit synthetic surface grant', 'test-fixture')`,
          [
            decisionId,
            cellId,
            termsVersionId,
            reviewEvidenceId,
            SYNTHETIC_RIGHTS_EFFECTIVE,
            requirementRecheckAt,
          ],
        );
        await fixtures.driver.query(
          `SELECT activate_rights_decision($1, 'HUMAN', 'test-fixture',
                                           'activate synthetic grant', $2)`,
          [decisionId, SYNTHETIC_RIGHTS_EFFECTIVE],
        );
      }
      await fixtures.driver.exec('COMMIT');
    } catch (error) {
      await fixtures.driver.exec('ROLLBACK');
      throw error;
    }
  }
}

/** Attach explicit synthetic identity provenance to an entity used by a surface test. */
export async function addSyntheticEntityEvidence(
  fixtures: QueryFixtures,
  entity: Entity,
  source: SourceKey = 'manufacturer',
): Promise<void> {
  const fixture = fixtures.sources[source];
  await fixtures.driver.query(
    `INSERT INTO entity_evidence
       (entity_id, artifact_id, source_record_id, contribution_role,
        locator_type, locator_value, observed_at)
     VALUES ($1, $2, $3, 'EXISTENCE', 'WHOLE_DOCUMENT', '', $4)
     ON CONFLICT DO NOTHING`,
    [entity.id, fixture.artifact.id, fixture.record.id, fixture.artifact.retrieved_at],
  );
}

/** 64 hex characters derived from a seed, matching the shared fixtures' shape. */
const contentHash = (seed: string): string =>
  seed
    .repeat(64)
    .slice(0, 64)
    .split('')
    .map((character) => (/[0-9a-f]/.test(character) ? character : '0'))
    .join('');
