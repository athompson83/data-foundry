import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FactId, IsoDateTime } from '@data-foundry/canonical-schema';
import {
  addSyntheticEntityEvidence,
  claim,
  createQueryFixtures,
  retireSourceFixtureByCompleteSnapshot,
  seedSyntheticSurfaceRights,
  ts,
  type QueryFixtures,
} from './support.js';

const BEFORE_RETIREMENT = ts('2026-08-13T12:00:00.000Z');
const RETIRED_AT = ts('2026-08-14T12:00:00.000Z');
const AFTER_RETIREMENT = ts('2026-08-15T12:00:00.000Z');

let fixtures: QueryFixtures;
let factId: FactId;
const RETIRED_VALUE = 'retired-currency-token';

beforeAll(async () => {
  fixtures = await createQueryFixtures({ trigram: false });
  await seedSyntheticSurfaceRights(fixtures, ['PUBLIC_WEB'], ['manufacturer', 'certifier']);
  await addSyntheticEntityEvidence(fixtures, fixtures.equipment, 'manufacturer');
  await addSyntheticEntityEvidence(fixtures, fixtures.equipment, 'certifier');
  factId = (await claim(fixtures, 'manufacturer', {
    entity_id: fixtures.equipment.id,
    property: 'refrigerant',
    value: RETIRED_VALUE,
    valid_from: '2026-08-01T00:00:00.000Z',
    observed_at: '2026-08-01T00:00:00.000Z',
  })).fact.id;

  await retireSourceFixtureByCompleteSnapshot(fixtures, 'manufacturer', RETIRED_AT);
}, 120_000);

afterAll(async () => {
  await fixtures?.driver.close();
});

describe('fact source-record currency', () => {
  it('withholds a fact after its sole source record is retired but preserves pre-retirement history', async () => {
    const web = fixtures.qm.forSurface('PUBLIC_WEB', { asOf: AFTER_RETIREMENT });

    expect(await web.getEntity(fixtures.equipment.id), 'the independent certifier keeps identity current')
      .not.toBeNull();
    expect(
      (await web.canonicalFacts(fixtures.equipment.id, { at: AFTER_RETIREMENT }))
        .map((fact) => fact.fact_id),
    ).not.toContain(factId);
    expect(
      (await web.canonicalFacts(fixtures.equipment.id, { at: BEFORE_RETIREMENT }))
        .map((fact) => fact.fact_id),
    ).toContain(factId);
  });

  it('uses half-open retirement time: authority ends exactly at the recorded instant', async () => {
    const web = fixtures.qm.forSurface('PUBLIC_WEB', { asOf: AFTER_RETIREMENT });
    expect(
      (await web.canonicalFacts(fixtures.equipment.id, { at: RETIRED_AT as IsoDateTime }))
        .map((fact) => fact.fact_id),
    ).not.toContain(factId);
  });

  it('does not leak the retired claim through explanations, search boosts, filters, or facets', async () => {
    const web = fixtures.qm.forSurface('PUBLIC_WEB', { asOf: AFTER_RETIREMENT });
    const explanation = await web.explainFact(
      fixtures.equipment.id,
      'refrigerant' as never,
      { at: AFTER_RETIREMENT },
    );
    const serialized = JSON.stringify(explanation);
    expect(serialized).not.toContain(factId);
    expect(serialized).not.toContain(RETIRED_VALUE);
    expect(serialized).not.toContain(fixtures.sources.manufacturer.artifact.url);

    const boosted = await web.search({
      vertical_id: fixtures.vertical.id,
      entity_type: 'equipment' as never,
      text: RETIRED_VALUE,
    });
    expect(boosted.hits.map((hit) => hit.entity.id)).not.toContain(fixtures.equipment.id);

    const filtered = await web.search({
      vertical_id: fixtures.vertical.id,
      entity_type: 'equipment' as never,
      filters: [{ property: 'refrigerant' as never, op: 'in', values: [RETIRED_VALUE] }],
    });
    expect(filtered.hits.map((hit) => hit.entity.id)).not.toContain(fixtures.equipment.id);

    const facets = await web.facets({
      vertical_id: fixtures.vertical.id,
      entity_type: 'equipment' as never,
    });
    expect(facets.find((facet) => facet.property === 'refrigerant')?.values)
      .not.toContainEqual(expect.objectContaining({ value: RETIRED_VALUE }));
  });

  it('keeps immutable by-id history separate from authority-at evidence', async () => {
    const immutable = await fixtures.store.loadFactCandidateById(factId);
    expect(immutable?.evidence).toHaveLength(1);

    const authorityAt = await fixtures.store.loadFactCandidateByIdAtAuthority(
      factId,
      AFTER_RETIREMENT,
    );
    expect(authorityAt?.evidence).toEqual([]);
  });

  it('does not launder a retired ungranted entity contribution through a current allowed source', async () => {
    const current = await createQueryFixtures({ trigram: false });
    try {
      await seedSyntheticSurfaceRights(current, ['PUBLIC_WEB'], ['manufacturer']);
      await addSyntheticEntityEvidence(current, current.equipment, 'manufacturer');

      const before = current.qm.forSurface('PUBLIC_WEB', { asOf: AFTER_RETIREMENT });
      expect(await before.getEntity(current.equipment.id)).not.toBeNull();

      await addSyntheticEntityEvidence(current, current.equipment, 'certifier');

      const whileDeniedContributionIsCurrent = current.qm.forSurface('PUBLIC_WEB', {
        asOf: BEFORE_RETIREMENT,
      });
      expect(await whileDeniedContributionIsCurrent.getEntity(current.equipment.id)).toBeNull();

      await retireSourceFixtureByCompleteSnapshot(current, 'certifier', RETIRED_AT);

      const after = current.qm.forSurface('PUBLIC_WEB', { asOf: AFTER_RETIREMENT });
      expect(await after.getEntity(current.equipment.id)).toBeNull();
    } finally {
      await current.driver.close();
    }
  });

  it('does not launder a retired ungranted fact contribution through a current allowed source', async () => {
    const current = await createQueryFixtures({ trigram: false });
    try {
      await seedSyntheticSurfaceRights(current, ['PUBLIC_WEB'], ['manufacturer']);
      await addSyntheticEntityEvidence(current, current.equipment, 'manufacturer');

      const allowedClaim = await claim(current, 'manufacturer', {
        entity_id: current.equipment.id,
        property: 'retained_contribution_control',
        value: 'shared-canonical-value',
        valid_from: '2026-08-01T00:00:00.000Z',
        observed_at: '2026-08-01T00:00:00.000Z',
      });
      const retiredDeniedClaim = await claim(current, 'aggregator', {
        entity_id: current.equipment.id,
        property: 'retained_contribution_control',
        value: 'shared-canonical-value',
        valid_from: '2026-08-01T00:00:00.000Z',
        observed_at: '2026-08-01T00:00:00.000Z',
      });
      expect(retiredDeniedClaim.fact.id).toBe(allowedClaim.fact.id);

      await retireSourceFixtureByCompleteSnapshot(current, 'aggregator', RETIRED_AT);

      const web = current.qm.forSurface('PUBLIC_WEB', { asOf: AFTER_RETIREMENT });
      expect(await web.getEntity(current.equipment.id)).not.toBeNull();
      expect(
        (await web.canonicalFacts(current.equipment.id, { at: AFTER_RETIREMENT }))
          .map((fact) => fact.fact_id),
      ).not.toContain(allowedClaim.fact.id);
    } finally {
      await current.driver.close();
    }
  });

  it('does not select a fact before the platform recorded it, while preserving valid time', async () => {
    const current = await createQueryFixtures({ trigram: false });
    try {
      await seedSyntheticSurfaceRights(current, ['PUBLIC_WEB'], ['manufacturer']);
      await addSyntheticEntityEvidence(current, current.equipment, 'manufacturer');
      const learnedLater = await claim(current, 'manufacturer', {
        entity_id: current.equipment.id,
        property: 'knowledge_time_control',
        value: 'known-later',
        valid_from: '2026-08-01T00:00:00.000Z',
        observed_at: '2026-08-01T00:00:00.000Z',
        recorded_at: '2026-08-20T00:00:00.000Z',
      });
      const web = current.qm.forSurface('PUBLIC_WEB', {
        asOf: ts('2026-08-25T00:00:00.000Z'),
      });

      expect(
        (await web.canonicalFacts(current.equipment.id, {
          at: ts('2026-08-10T00:00:00.000Z'),
        })).map((fact) => fact.fact_id),
      ).not.toContain(learnedLater.fact.id);
      expect(
        (await web.canonicalFacts(current.equipment.id, {
          at: ts('2026-08-21T00:00:00.000Z'),
        })).map((fact) => fact.fact_id),
      ).toContain(learnedLater.fact.id);
    } finally {
      await current.driver.close();
    }
  });

  it('renders only authority-at direct evidence while keeping quote checks contribution-complete', async () => {
    const current = await createQueryFixtures({ trigram: false });
    try {
      await seedSyntheticSurfaceRights(
        current,
        ['PUBLIC_WEB'],
        ['manufacturer', 'certifier'],
      );
      await addSyntheticEntityEvidence(current, current.equipment, 'manufacturer');
      await addSyntheticEntityEvidence(current, current.equipment, 'certifier');
      await grantPublicQuote(current, 'manufacturer');

      const currentClaim = await claim(current, 'manufacturer', {
        entity_id: current.equipment.id,
        property: 'partial_currency_control',
        value: 'shared-normalized-value',
        source_value: 'CURRENT-A-QUOTED-TEXT',
        valid_from: '2026-08-01T00:00:00.000Z',
        observed_at: '2026-08-01T00:00:00.000Z',
      });
      const retiredClaim = await claim(current, 'certifier', {
        entity_id: current.equipment.id,
        property: 'partial_currency_control',
        value: 'shared-normalized-value',
        source_value: 'RETIRED-B-UNGRANTED-TEXT',
        valid_from: '2026-08-01T00:00:00.000Z',
        observed_at: '2026-08-01T00:00:00.000Z',
      });
      expect(retiredClaim.fact.id).toBe(currentClaim.fact.id);

      const retired = current.sources.certifier;
      await retireSourceFixtureByCompleteSnapshot(current, 'certifier', RETIRED_AT);

      const web = current.qm.forSurface('PUBLIC_WEB', { asOf: AFTER_RETIREMENT });
      const view = (await web.canonicalFacts(current.equipment.id, {
        at: AFTER_RETIREMENT,
      })).find((fact) => fact.fact_id === currentClaim.fact.id);
      expect(view?.sources).toEqual(['Acme Climate']);

      const explanation = await web.explainFact(
        current.equipment.id,
        'partial_currency_control' as never,
        { at: AFTER_RETIREMENT },
      );
      expect(explanation?.selected?.attributions).toEqual([
        expect.objectContaining({
          publisher: 'Acme Climate',
          source_value: 'CURRENT-A-QUOTED-TEXT',
        }),
      ]);
      const rendered = JSON.stringify(explanation);
      expect(rendered).not.toContain('Ratings Directory');
      expect(rendered).not.toContain('RETIRED-B-UNGRANTED-TEXT');
      expect(rendered).not.toContain(retired.artifact.url);
    } finally {
      await current.driver.close();
    }
  });
});

async function grantPublicQuote(
  current: QueryFixtures,
  sourceKey: keyof QueryFixtures['sources'],
): Promise<void> {
  const source = current.sources[sourceKey].source;
  const [lineage] = await current.driver.query<{
    terms_version_id: string;
    review_evidence_id: string;
  }>(
    `SELECT terms.id AS terms_version_id,
            source.rights_publisher_mapping_evidence_artifact_id AS review_evidence_id
       FROM sources source
       JOIN rights_terms_cells cell ON cell.source_id = source.id
       JOIN rights_terms_versions terms ON terms.terms_cell_id = cell.id
       JOIN rights_terms_activation_events activation ON activation.terms_version_id = terms.id
      WHERE source.id = $1 AND activation.state = 'ACTIVE'
      ORDER BY activation.sequence_no DESC
      LIMIT 1`,
    [source.id],
  );
  if (lineage === undefined) throw new Error('synthetic rights terms not found');

  const cellId = crypto.randomUUID();
  const decisionId = crypto.randomUUID();
  const effective = ts('2026-01-01T00:00:00.000Z');
  const recheck = ts('2027-01-01T00:00:00.000Z');
  await current.driver.exec('BEGIN');
  try {
    await current.driver.query(
      `INSERT INTO rights_cells
         (id, source_id, acquisition_route, operation, channel, created_by)
       VALUES ($1, $2, 'DIRECT_HTTP', 'QUOTE_OR_EXCERPT', 'PUBLIC_WEBSITE', 'test-fixture')`,
      [cellId, source.id],
    );
    await current.driver.query(
      `INSERT INTO rights_decisions
         (id, cell_id, state, controlling_terms_version_id, evidence_artifact_id,
          clause_ref, review_status, reviewer_type, reviewed_by, reviewed_at,
          effective_from, recheck_at, rationale, created_by)
       VALUES ($1, $2, 'ALLOW', $3, $4, 'synthetic fixture only', 'APPROVED',
               'HUMAN', 'test-fixture', $5, $5, $6,
               'explicit synthetic quote grant', 'test-fixture')`,
      [
        decisionId,
        cellId,
        lineage.terms_version_id,
        lineage.review_evidence_id,
        effective,
        recheck,
      ],
    );
    await current.driver.query(
      `SELECT activate_rights_decision($1, 'HUMAN', 'test-fixture',
                                       'activate synthetic quote grant', $2)`,
      [decisionId, effective],
    );
    await current.driver.exec('COMMIT');
  } catch (error) {
    await current.driver.exec('ROLLBACK');
    throw error;
  }
}
