import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { entityQualityScore, identityConfidence, type Entity } from '@data-foundry/canonical-schema';
import type {
  SqlParam,
  SqlRow,
  SqlTransactionExecutor,
} from '@data-foundry/canonical-store';
import {
  FieldMetadataRegistry,
  createQueryModel,
  type QueryModel,
  type SurfaceQueryModel,
} from '../src/index.js';
import { claim, createFixtures, ts, type Fixtures } from '../../canonical-store/test/support.js';

const AS_OF = ts('2026-08-15T12:00:00.000Z');
const EFFECTIVE = ts('2026-08-01T00:00:00.000Z');
const RECHECK = ts('2027-08-01T00:00:00.000Z');
const PUBLISHER = '82000000-0000-4000-8000-000000000001';
const TERMS_EVIDENCE = '82000000-0000-4000-8000-000000000002';
const REVIEW_EVIDENCE = '82000000-0000-4000-8000-000000000003';
const TERMS_CELL = '82000000-0000-4000-8000-000000000004';
const TERMS_VERSION = '82000000-0000-4000-8000-000000000005';
const PUBLIC_CELL = '82000000-0000-4000-8000-000000000006';
const PUBLIC_ALLOW = '82000000-0000-4000-8000-000000000007';

let fixtures: Fixtures;
let queryModel: QueryModel;
let hiddenEntity: Entity;

async function seedPublicWebGrant(): Promise<void> {
  const source = fixtures.sources.manufacturer.source;
  await fixtures.driver.query(
    `INSERT INTO rights_publishers (id, publisher_key, legal_name, status)
     VALUES ($1, 'surface-test-publisher', 'Surface Test Publisher', 'ACTIVE')`,
    [PUBLISHER],
  );
  await fixtures.driver.query(
    `INSERT INTO rights_evidence_artifacts
       (id, kind, canonical_uri, storage_uri, content_sha256, mime_type, captured_at, created_by)
     VALUES ($1, 'TERMS', 'repo://terms/surface-v1', 'repo://terms/surface-v1.txt', $3,
             'text/plain', $5, 'test-owner'),
            ($2, 'REVIEW_MEMO', 'repo://reviews/surface-v1', 'repo://reviews/surface-v1.txt', $4,
             'text/plain', $5, 'test-owner')`,
    [TERMS_EVIDENCE, REVIEW_EVIDENCE, 'a'.repeat(64), 'b'.repeat(64), EFFECTIVE],
  );
  await fixtures.driver.query(
    `UPDATE sources
        SET rights_publisher_id = $1,
            rights_publisher_mapping_evidence_artifact_id = $3,
            rights_publisher_mapping_reviewer_type = 'HUMAN',
            rights_publisher_mapping_reviewed_by = 'test-owner',
            rights_publisher_mapping_reviewed_at = $4
      WHERE id = $2`,
    [PUBLISHER, source.id, REVIEW_EVIDENCE, EFFECTIVE],
  );
  await fixtures.driver.query(
    `INSERT INTO rights_terms_cells
       (id, source_id, acquisition_route, created_by)
     VALUES ($1, $2, 'DIRECT_HTTP', 'test-owner')`,
    [TERMS_CELL, source.id],
  );
  await fixtures.driver.query(
    `INSERT INTO rights_terms_versions
       (id, terms_cell_id, evidence_artifact_id, content_sha256, version_label,
        effective_from, recheck_at, created_by)
     VALUES ($1, $2, $3, $4, 'v1', $5, $6, 'test-owner')`,
    [TERMS_VERSION, TERMS_CELL, TERMS_EVIDENCE, 'a'.repeat(64), EFFECTIVE, RECHECK],
  );
  await fixtures.driver.query(
    `SELECT activate_rights_terms($1, 'HUMAN', 'test-owner', 'fixture terms', $2)`,
    [TERMS_VERSION, EFFECTIVE],
  );

  await fixtures.driver.exec('BEGIN');
  try {
    await fixtures.driver.query(
      `INSERT INTO rights_cells
         (id, source_id, acquisition_route, operation, channel, created_by)
       VALUES ($1, $2, 'DIRECT_HTTP', 'DISPLAY_PUBLICLY', 'PUBLIC_WEBSITE', 'test-owner')`,
      [PUBLIC_CELL, source.id],
    );
    await fixtures.driver.query(
      `INSERT INTO rights_decisions
         (id, cell_id, state, controlling_terms_version_id, evidence_artifact_id, clause_ref,
          review_status, reviewer_type, reviewed_by, reviewed_at, effective_from, recheck_at,
          rationale, created_by)
       VALUES ($1, $2, 'ALLOW', $3, $4, 'section 1', 'APPROVED', 'HUMAN',
               'test-owner', $5, $5, $6, 'public web fixture permission', 'test-owner')`,
      [PUBLIC_ALLOW, PUBLIC_CELL, TERMS_VERSION, REVIEW_EVIDENCE, EFFECTIVE, RECHECK],
    );
    await fixtures.driver.query(
      `SELECT activate_rights_decision($1, 'HUMAN', 'test-owner', 'activate public grant', $2)`,
      [PUBLIC_ALLOW, EFFECTIVE],
    );
    await fixtures.driver.exec('COMMIT');
  } catch (error) {
    await fixtures.driver.exec('ROLLBACK');
    throw error;
  }
}

async function addEntityEvidence(entity: Entity): Promise<void> {
  const source = fixtures.sources.manufacturer;
  await fixtures.driver.query(
    `INSERT INTO entity_evidence
       (entity_id, artifact_id, source_record_id, contribution_role,
        locator_type, locator_value, observed_at)
     VALUES ($1, $2, $3, 'EXISTENCE', 'WHOLE_DOCUMENT', '', $4)`,
    [entity.id, source.artifact.id, source.record.id, source.artifact.retrieved_at],
  );
}

beforeAll(async () => {
  fixtures = await createFixtures({ trigram: false });
  await seedPublicWebGrant();
  await addEntityEvidence(fixtures.entity);
  await claim(fixtures, 'manufacturer', {
    property: 'seer2_rating',
    value: 17,
    value_type: 'number',
  });

  hiddenEntity = await fixtures.store.upsertEntity({
    vertical_id: fixtures.vertical.id,
    entity_type: 'equipment',
    canonical_name: 'Hidden Rights Test Unit',
    canonical_slug: 'hidden-rights-test-unit',
    status: 'ACTIVE',
    quality_score: entityQualityScore(0.4),
    first_seen_at: ts('2026-01-01T00:00:00Z'),
    last_verified_at: null,
  });
  await claim(fixtures, 'manufacturer', {
    entity_id: hiddenEntity.id,
    property: 'seer2_rating',
    value: 19,
    value_type: 'number',
  });

  queryModel = createQueryModel(fixtures.store, {
    fields: new FieldMetadataRegistry([
      {
        field: 'seer2_rating',
        value_type: 'number',
        unit: null,
        filter: { type: 'multi_select', facet_count: true },
        sort: true,
        search_boost: 0,
        indexable: true,
        label: 'SEER2',
      },
    ]),
  });
});

afterAll(async () => {
  await fixtures?.driver.close();
});

describe('surface-bound query model', () => {
  it('serves entity identity and facts only through an exact public-web grant', async () => {
    const web = queryModel.forSurface('PUBLIC_WEB', { asOf: AS_OF });
    expect((await web.getEntity(fixtures.entity.id))?.entity.id).toBe(fixtures.entity.id);
    expect(await web.canonicalFacts(fixtures.entity.id, { at: AS_OF })).toMatchObject([
      { property: 'seer2_rating', value: 17 },
    ]);
  });

  it('does not let public-web permission imply free, paid, or RapidAPI access', async () => {
    for (const surface of ['API_FREE', 'API_PAID', 'RAPIDAPI'] as const) {
      const model = queryModel.forSurface(surface, { asOf: AS_OF });
      expect(await model.getEntity(fixtures.entity.id), surface).toBeNull();
      expect(await model.canonicalFacts(fixtures.entity.id, { at: AS_OF }), surface).toEqual([]);
    }
  });

  it('does not launder a denied source alias through an otherwise authorized entity', async () => {
    const entity = await fixtures.store.upsertEntity({
      vertical_id: fixtures.vertical.id,
      entity_type: 'equipment',
      canonical_name: 'Alias Rights Isolation Unit',
      canonical_slug: 'alias-rights-isolation-unit',
      status: 'ACTIVE',
      quality_score: entityQualityScore(0.7),
      first_seen_at: ts('2026-01-01T00:00:00Z'),
      last_verified_at: null,
    });
    await addEntityEvidence(entity);
    await claim(fixtures, 'manufacturer', {
      entity_id: entity.id,
      property: 'seer2_rating',
      value: 18,
      value_type: 'number',
    });
    await fixtures.store.upsertRelationshipWithEvidence(
      {
        vertical_id: fixtures.vertical.id,
        subject_entity_id: entity.id,
        predicate: 'related_to',
        object_entity_id: fixtures.entity.id,
        confidence: entity.quality_score as never,
        valid_from: ts('2026-01-01T00:00:00Z'),
        recorded_at: ts('2026-01-01T00:00:00Z'),
        status: 'ACTIVE',
      },
      [{
        artifact_id: fixtures.sources.manufacturer.artifact.id,
        source_record_id: fixtures.sources.manufacturer.record.id,
        source_value: 'Alias Rights Isolation Unit related to fixture entity',
        locator_type: 'JSON_POINTER',
        locator_value: '/relationships/0',
        observed_at: fixtures.sources.manufacturer.artifact.retrieved_at,
      }],
    );

    const deniedSource = fixtures.sources.certifier;
    const alias = await fixtures.store.stageSourceAlias({
      entity_id: entity.id,
      alias_type: 'external_id',
      alias_value: 'DENIED-ALIAS-ZZYX-9917',
      normalized_value: 'deniedaliaszzyx9917',
      source_id: deniedSource.source.id,
      identity_confidence: identityConfidence(0.99),
      valid_from: ts('2026-01-01T00:00:00Z'),
      valid_to: null,
    });
    const aliasClaim = await fixtures.store.recordSourceAliasClaim({
      entity_alias_id: alias.id,
      asserted_alias_value: 'DENIED-ALIAS-ZZYX-9917',
      asserted_normalized_value: 'deniedaliaszzyx9917',
      identity_confidence: identityConfidence(0.99),
      source_record_id: deniedSource.record.id,
      locator_type: 'TABLE_CELL',
      locator_value: 'aliases!A2',
    });

    const web = queryModel.forSurface('PUBLIC_WEB', { asOf: AS_OF });
    expect((await web.getEntity(entity.id))?.entity.id).toBe(entity.id);
    expect(await web.canonicalFacts(entity.id, { at: AS_OF })).toHaveLength(1);
    expect((await web.relationships({ entity_id: entity.id })).edges).toHaveLength(1);
    expect((await web.search({
      vertical_id: fixtures.vertical.id,
      text: 'DENIED-ALIAS-ZZYX-9917',
    })).hits).toEqual([]);

    await fixtures.store.recordEntityEvidence({
      entity_id: entity.id,
      artifact_id: deniedSource.artifact.id,
      source_record_id: deniedSource.record.id,
      entity_alias_claim_id: aliasClaim.id,
      contribution_role: 'ALIAS',
      locator_type: 'TABLE_CELL',
      locator_value: 'aliases!A2',
      observed_at: deniedSource.artifact.retrieved_at,
    });

    expect(await web.canonicalFacts(entity.id, { at: AS_OF })).toEqual([]);
    expect((await web.relationships({ entity_id: entity.id })).edges).toEqual([]);
    expect((await web.search({
      vertical_id: fixtures.vertical.id,
      text: 'DENIED-ALIAS-ZZYX-9917',
    })).hits).toEqual([]);
    const nextRequest = queryModel.forSurface('PUBLIC_WEB', { asOf: AS_OF });
    expect(await nextRequest.getEntity(entity.id)).toBeNull();
  });

  it('fails closed for an entity with no entity-level provenance', async () => {
    expect(await queryModel.getEntity(hiddenEntity.id)).not.toBeNull();
    const web = queryModel.forSurface('PUBLIC_WEB', { asOf: AS_OF });
    expect(await web.getEntity(hiddenEntity.id)).toBeNull();
  });

  it('keyset-scans bounded raw entity pages without exposing denied rows', async () => {
    const seeded = await Promise.all(
      Array.from({ length: 3 }, (_, index) =>
        fixtures.store.upsertEntity({
          vertical_id: fixtures.vertical.id,
          entity_type: 'listing_probe',
          canonical_name: `Surface Listing Probe ${index}`,
          canonical_slug: `surface-listing-probe-${index}`,
          status: 'ACTIVE',
          quality_score: entityQualityScore(0.7),
          first_seen_at: ts('2026-01-01T00:00:00Z'),
          last_verified_at: null,
        }),
      ),
    );
    const ordered = seeded.toSorted((left, right) => left.id.localeCompare(right.id));
    await addEntityEvidence(ordered[1]!);

    const web = queryModel.forSurface('PUBLIC_WEB', { asOf: AS_OF });
    const first = await web.listEntities({
      vertical_id: fixtures.vertical.id,
      entity_type: 'listing_probe',
      limit: 2,
    });
    expect(first.entities.map((entity) => entity.id)).toEqual([ordered[1]!.id]);
    expect(first.next_after_id).toBe(ordered[1]!.id);

    const second = await web.listEntities({
      vertical_id: fixtures.vertical.id,
      entity_type: 'listing_probe',
      limit: 2,
      after_id: first.next_after_id!,
    });
    expect(second).toEqual({ entities: [], next_after_id: null });
  });

  it('ends an exactly full raw entity page without requiring a phantom follow-up scan', async () => {
    const seeded = await Promise.all(
      Array.from({ length: 2 }, async (_, index) => {
        const entity = await fixtures.store.upsertEntity({
          vertical_id: fixtures.vertical.id,
          entity_type: 'exact_page_probe',
          canonical_name: `Exact Page Probe ${index}`,
          canonical_slug: `exact-page-probe-${index}`,
          status: 'ACTIVE',
          quality_score: entityQualityScore(0.7),
          first_seen_at: ts('2026-01-01T00:00:00Z'),
          last_verified_at: null,
        });
        await addEntityEvidence(entity);
        return entity;
      }),
    );

    const web = queryModel.forSurface('PUBLIC_WEB', { asOf: AS_OF });
    const page = await web.listEntities({
      vertical_id: fixtures.vertical.id,
      entity_type: 'exact_page_probe',
      limit: seeded.length,
    });

    expect(page.entities).toHaveLength(2);
    expect(page.next_after_id).toBeNull();
  });

  it('constrains exact search and facets before values can become an oracle', async () => {
    const web = queryModel.forSurface('PUBLIC_WEB', { asOf: AS_OF });
    const search = await web.search({
      vertical_id: fixtures.vertical.id,
      text: 'Hidden Rights Test Unit',
      // A trusted caller restriction may narrow access, never widen it.
      authorized_entity_ids: [hiddenEntity.id],
      include_facets: true,
    });
    expect(search.hits).toEqual([]);
    expect(search.total).toBe(0);
    expect(search.facets[0]?.entity_count).toBe(0);
  });

  it('aggregates entity-type counts after surface authorization in one operation', async () => {
    const web = queryModel.forSurface('PUBLIC_WEB', { asOf: AS_OF });
    const counts = await web.entityTypeCounts(fixtures.vertical.id);
    const search = await web.search({ vertical_id: fixtures.vertical.id, limit: 1 });

    expect(counts.get(fixtures.entity.entity_type)).toBe(1);
    expect([...counts.values()].reduce((total, count) => total + count, 0)).toBe(search.total);
  });

  it('uses set-based catalog authorization instead of one evidence query per entity and fact', async () => {
    const seededEntities: Entity[] = [];
    for (let index = 0; index < 12; index += 1) {
      const entity = await fixtures.store.upsertEntity({
        vertical_id: fixtures.vertical.id,
        entity_type: 'equipment',
        canonical_name: `Authorization Fanout Unit ${String(index).padStart(2, '0')}`,
        canonical_slug: `authorization-fanout-unit-${String(index).padStart(2, '0')}`,
        status: 'ACTIVE',
        quality_score: entityQualityScore(0.7),
        first_seen_at: ts('2026-01-01T00:00:00Z'),
        last_verified_at: null,
      });
      await addEntityEvidence(entity);
      await claim(fixtures, 'manufacturer', {
        entity_id: entity.id,
        property: 'seer2_rating',
        value: 14 + index,
        value_type: 'number',
      });
      seededEntities.push(entity);
    }

    const originalQueryMethod = fixtures.driver.query;
    const originalQuery = originalQueryMethod.bind(fixtures.driver);
    const originalTransactionMethod = fixtures.driver.transaction;
    const originalTransaction = originalTransactionMethod.bind(fixtures.driver);
    let perEntityEvidenceReads = 0;
    let perFactReads = 0;
    let snapshotReads = 0;
    let entityBatchParameterCount: number | null = null;
    let factFrontierParameterCount: number | null = null;
    let factEvidenceParameterCount: number | null = null;
    const observedQuery = async <R extends SqlRow = SqlRow>(
      sql: string,
      params?: readonly SqlParam[],
      execute?: () => Promise<R[]>,
    ): Promise<R[]> => {
      snapshotReads += 1;
      if (
        sql.includes('WHERE evidence.entity_id = $1') ||
        sql.includes('WHERE ee.entity_id = $1')
      ) {
        perEntityEvidenceReads += 1;
      }
      if (sql.includes('FROM facts WHERE id = $1')) perFactReads += 1;
      if (sql.includes('FROM entity_evidence ee') && sql.includes('jsonb_array_elements_text($1::jsonb)')) {
        entityBatchParameterCount = params?.length ?? 0;
      }
      if (sql.includes('dependency_frontier')) factFrontierParameterCount = params?.length ?? 0;
      if (sql.includes('FROM fact_evidence fe')) factEvidenceParameterCount = params?.length ?? 0;
      return execute?.() ?? originalQuery<R>(sql, params);
    };
    fixtures.driver.query = (async <R extends SqlRow = SqlRow>(
      sql: string,
      params?: readonly SqlParam[],
    ): Promise<R[]> => observedQuery<R>(sql, params)) as typeof fixtures.driver.query;
    fixtures.driver.transaction = (async <T>(
      run: (tx: SqlTransactionExecutor) => Promise<T>,
    ): Promise<T> => originalTransaction(async (transaction) => run({
      query: async <R extends SqlRow = SqlRow>(
        sql: string,
        params?: readonly SqlParam[],
      ): Promise<R[]> => observedQuery<R>(
        sql,
        params,
        () => transaction.query<R>(sql, params),
      ),
    } as SqlTransactionExecutor))) as typeof fixtures.driver.transaction;

    try {
      const web = queryModel.forSurface('PUBLIC_WEB', { asOf: AS_OF });
      const result = await web.search({
        vertical_id: fixtures.vertical.id,
        entity_type: 'equipment',
        limit: 1,
      });

      // Set-based reads must preserve the exact rights-safe total rather than
      // turning authorization into an early-exit page scan.
      expect(result.hits).toHaveLength(1);
      expect(result.total).toBe(seededEntities.length + 1);
    } finally {
      fixtures.driver.query = originalQueryMethod;
      fixtures.driver.transaction = originalTransactionMethod;
    }

    expect(perEntityEvidenceReads).toBe(0);
    expect(perFactReads).toBe(0);
    // One JSON candidate set plus one deterministic authorization-row ceiling.
    expect(entityBatchParameterCount).toBe(2);
    expect(factFrontierParameterCount).toBe(2);
    expect(factEvidenceParameterCount).toBe(2);
    // One source needs a fixed rights-context read set; the remaining budget
    // covers the catalog, batched evidence, search, ranking, and facet queries.
    // The former per-row implementation exceeds this bound with this fixture.
    expect(snapshotReads).toBeLessThanOrEqual(40);
  });

  it('selects and explains only over candidates authorized for this surface', async () => {
    await claim(fixtures, 'aggregator', {
      property: 'seer2_rating',
      value: 19,
      value_type: 'number',
      status: 'PROPOSED',
    });

    const web = queryModel.forSurface('PUBLIC_WEB', { asOf: AS_OF });
    const facts = await web.canonicalFacts(fixtures.entity.id, { at: AS_OF });
    expect(facts).toMatchObject([{ property: 'seer2_rating', value: 17 }]);
    expect(facts[0]?.conflicts).toEqual([]);
    expect(facts[0]?.unresolved_conflict).toBe(false);

    const explanation = await web.explainFact(fixtures.entity.id, 'seer2_rating', {
      at: AS_OF,
    });
    expect(explanation?.claims.map((claim) => claim.value)).toEqual([17]);
    expect(explanation?.claims[0]?.attributions[0]?.source_value).toBeNull();
    expect(explanation?.conflicts).toEqual([]);
    expect(explanation?.unresolved_conflict).toBe(false);
    expect(explanation?.narrative.join('\n')).not.toContain(
      fixtures.sources.aggregator.source.publisher,
    );
    expect(explanation).not.toHaveProperty('excluded');
    expect(JSON.stringify(explanation)).not.toContain('reviewer');
  });

  it('refuses the selected fact when a neighboring provenance contribution has no grant', async () => {
    await claim(fixtures, 'aggregator', {
      property: 'seer2_rating',
      value: 17,
      value_type: 'number',
    });
    const web = queryModel.forSurface('PUBLIC_WEB', { asOf: AS_OF });
    expect(await web.getEntity(fixtures.entity.id)).not.toBeNull();
    expect(await web.canonicalFacts(fixtures.entity.id, { at: AS_OF })).toEqual([]);
  });
});
