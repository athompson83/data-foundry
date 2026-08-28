import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { entityQualityScore, type Entity } from '@data-foundry/canonical-schema';
import { FieldMetadataRegistry, createQueryModel, type QueryModel } from '../src/index.js';
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

  it('fails closed for an entity with no entity-level provenance', async () => {
    expect(await queryModel.getEntity(hiddenEntity.id)).not.toBeNull();
    const web = queryModel.forSurface('PUBLIC_WEB', { asOf: AS_OF });
    expect(await web.getEntity(hiddenEntity.id)).toBeNull();
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
