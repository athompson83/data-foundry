/**
 * Append-only fact versioning and ingestion idempotency.
 *
 * The Phase 1 exit criterion is that re-running ingestion over unchanged source
 * data produces no churn: no new fact versions, no duplicated evidence, no
 * rewritten values. A changed value, by contrast, must produce a *second row*
 * with the first one closed — never an UPDATE of `normalized_value`.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { currentFactVersion, factConfidence, factVersionChain } from '@data-foundry/canonical-schema';
import { FactDependencyError } from '../src/index.js';
import { claim, countRows, createFixtures, ts, type Fixtures } from './support.js';

let fixtures: Fixtures;

beforeAll(async () => {
  fixtures = await createFixtures();
});

afterAll(async () => {
  await fixtures?.driver.close();
});

describe('idempotent re-ingestion', () => {
  it('creates no new fact version when the value has not changed', async () => {
    const first = await claim(fixtures, 'manufacturer', {
      property: 'seer2_rating',
      value: 16,
      value_type: 'number',
      valid_from: '2026-02-01T00:00:00Z',
    });
    expect(first.outcome).toBe('CREATED');

    const factsAfterFirst = await countRows(fixtures.driver, 'facts');
    const evidenceAfterFirst = await countRows(fixtures.driver, 'fact_evidence');

    // Exactly the same crawl again, and again.
    const second = await claim(fixtures, 'manufacturer', {
      property: 'seer2_rating',
      value: 16,
      value_type: 'number',
      valid_from: '2026-02-01T00:00:00Z',
    });
    const third = await claim(fixtures, 'manufacturer', {
      property: 'seer2_rating',
      value: 16,
      value_type: 'number',
      valid_from: '2026-02-01T00:00:00Z',
    });

    expect(second.outcome).toBe('UNCHANGED');
    expect(third.outcome).toBe('UNCHANGED');
    expect(second.fact.id).toBe(first.fact.id);
    expect(third.fact.id).toBe(first.fact.id);
    // Nothing was written: not a version, not a duplicate evidence row.
    expect(second.added_evidence).toEqual([]);
    expect(third.added_evidence).toEqual([]);
    expect(await countRows(fixtures.driver, 'facts')).toBe(factsAfterFirst);
    expect(await countRows(fixtures.driver, 'fact_evidence')).toBe(evidenceAfterFirst);

    const versions = await fixtures.store.listFacts(fixtures.entity.id, {
      property: 'seer2_rating',
      include_history: true,
    });
    expect(versions).toHaveLength(1);
  });

  it('records a second source asserting the same value as corroboration, not a new version', async () => {
    const before = await countRows(fixtures.driver, 'facts');

    const corroborated = await claim(fixtures, 'aggregator', {
      property: 'seer2_rating',
      value: 16,
      value_type: 'number',
      valid_from: '2026-02-01T00:00:00Z',
    });

    expect(corroborated.outcome).toBe('UNCHANGED');
    expect(corroborated.added_evidence).toHaveLength(1);
    expect(corroborated.evidence).toHaveLength(2);
    expect(await countRows(fixtures.driver, 'facts')).toBe(before);
  });

  it('appends a new version and closes the old one when the value changes', async () => {
    const changed = await claim(fixtures, 'manufacturer', {
      property: 'seer2_rating',
      value: 17.2,
      value_type: 'number',
      valid_from: '2026-06-01T00:00:00Z',
    });
    expect(changed.outcome).toBe('CREATED');
    expect(changed.superseded_fact_id).not.toBeNull();

    const history = await fixtures.store.listFacts(fixtures.entity.id, {
      property: 'seer2_rating',
      include_history: true,
    });
    expect(history).toHaveLength(2);

    const previous = history.find((fact) => fact.id === changed.superseded_fact_id);
    expect(previous?.status).toBe('SUPERSEDED');
    expect(previous?.valid_to).toBe(ts('2026-06-01T00:00:00Z'));
    // The old value is still readable. Nothing was overwritten.
    expect(previous?.normalized_value).toBe(16);

    expect(changed.fact.supersedes_fact_id).toBe(previous?.id);
    expect(factVersionChain(history, changed.fact).map((fact) => fact.normalized_value)).toEqual([
      16, 17.2,
    ]);
  });

  it('answers "what was true in March" from the retained history', async () => {
    // Valid time, not transaction time: the March answer comes from the row
    // that was superseded in June, which is exactly why it was not overwritten.
    const march = await fixtures.store.listFacts(fixtures.entity.id, {
      property: 'seer2_rating',
      at: ts('2026-03-15T00:00:00Z'),
    });
    expect(march.map((fact) => fact.normalized_value)).toEqual([16]);
    expect(march[0]?.status).toBe('SUPERSEDED');

    const july = await fixtures.store.listFacts(fixtures.entity.id, {
      property: 'seer2_rating',
      at: ts('2026-07-15T00:00:00Z'),
    });
    expect(july.map((fact) => fact.normalized_value)).toEqual([17.2]);

    // The schema helper agrees about which version is current *now*.
    const history = await fixtures.store.listFacts(fixtures.entity.id, {
      property: 'seer2_rating',
      include_history: true,
    });
    expect(currentFactVersion(history, 'seer2_rating', ts('2026-07-15T00:00:00Z'))?.normalized_value)
      .toBe(17.2);
  });

  it('keeps the database-level single-open-version invariant intact', async () => {
    const open = await fixtures.driver.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM facts
        WHERE entity_id = $1 AND property = 'seer2_rating' AND valid_to IS NULL AND status = 'ACTIVE'`,
      [fixtures.entity.id],
    );
    expect(open[0]?.count).toBe('1');
  });

  it('retracts without deleting', async () => {
    const created = await claim(fixtures, 'manufacturer', {
      property: 'sound_level',
      value: 58,
      value_type: 'number',
      unit: 'dB',
      valid_from: '2026-02-01T00:00:00Z',
    });
    const retracted = await fixtures.store.retractFact(created.fact.id, ts('2026-08-01T00:00:00Z'));

    expect(retracted.status).toBe('RETRACTED');
    expect(retracted.valid_to).toBe(ts('2026-08-01T00:00:00Z'));
    expect(retracted.normalized_value).toBe(58);

    const still = await fixtures.store.getFactById(created.fact.id);
    expect(still).not.toBeNull();
    const evidence = await fixtures.store.listFactEvidence(created.fact.id);
    expect(evidence.length).toBeGreaterThan(0);
  });

  it('records relationships idempotently too', async () => {
    const part = await fixtures.store.upsertEntity({
      vertical_id: fixtures.vertical.id,
      entity_type: 'part',
      canonical_name: 'Carrier HK32EA001',
      canonical_slug: 'carrier-hk32ea001',
      status: 'ACTIVE',
      quality_score: fixtures.entity.quality_score,
      first_seen_at: ts('2026-01-01T00:00:00Z'),
      last_verified_at: null,
    });
    const evidence = [
      {
        artifact_id: fixtures.sources.manufacturer.artifact.id,
        source_record_id: fixtures.sources.manufacturer.record.id,
        source_value: 'Replacement part: HK32EA001',
        locator_type: 'CSS_SELECTOR' as const,
        locator_value: 'ul.parts li:nth-child(1)',
        observed_at: ts('2026-02-01T00:00:00Z'),
      },
    ] as const;
    const draft = {
      vertical_id: fixtures.vertical.id,
      subject_entity_id: fixtures.entity.id,
      predicate: 'uses_part',
      object_entity_id: part.id,
      confidence: fixtures.entity.quality_score as never,
      valid_from: ts('2026-02-01T00:00:00Z'),
      recorded_at: ts('2026-02-01T00:00:00Z'),
      status: 'ACTIVE' as const,
    };

    const first = await fixtures.store.upsertRelationshipWithEvidence(draft, evidence);
    const second = await fixtures.store.upsertRelationshipWithEvidence(draft, evidence);

    expect(first.outcome).toBe('CREATED');
    expect(second.outcome).toBe('UNCHANGED');
    expect(second.added_evidence).toEqual([]);
    expect(second.relationship.id).toBe(first.relationship.id);
    expect(await countRows(fixtures.driver, 'relationships')).toBe(1);
  });
});

describe('derived fact dependency identity', () => {
  const evidenceFor = (source: Fixtures['sources']['manufacturer'], property: string) => [
    {
      artifact_id: source.artifact.id,
      source_record_id: source.record.id,
      source_value: '6',
      locator_type: 'CSS_SELECTOR' as const,
      locator_value: `table.specs [data-field="${property}"]`,
      observed_at: ts('2026-03-01T00:00:00Z'),
    },
  ] as const;

  it('reuses an exact dependency set but appends the same value when the input identity changes', async () => {
    const inputA = await claim(fixtures, 'manufacturer', {
      property: 'derived_input_a',
      value: 12,
      value_type: 'number',
      valid_from: '2026-03-01T00:00:00Z',
    });
    const inputB = await claim(fixtures, 'certifier', {
      property: 'derived_input_b',
      value: 18,
      value_type: 'number',
      valid_from: '2026-03-01T00:00:00Z',
    });
    const draft = {
      entity_id: fixtures.entity.id,
      property: 'derived_output',
      normalized_value: 6,
      value_type: 'number' as const,
      unit: null,
      valid_from: ts('2026-03-01T00:00:00Z'),
      confidence: factConfidence(0.9),
      recorded_at: ts('2026-03-01T00:00:00Z'),
      status: 'ACTIVE' as const,
    };
    const first = await fixtures.store.appendDerivedFactWithEvidence(
      draft,
      evidenceFor(fixtures.sources.manufacturer, 'derived_output'),
      [{ input_fact_id: inputA.fact.id, transformation_ref: 'derive.v1' }],
    );
    const exactReplay = await fixtures.store.appendDerivedFactWithEvidence(
      draft,
      evidenceFor(fixtures.sources.manufacturer, 'derived_output'),
      [{ input_fact_id: inputA.fact.id, transformation_ref: 'derive.v1' }],
    );
    expect(exactReplay.outcome).toBe('UNCHANGED');
    expect(exactReplay.fact.id).toBe(first.fact.id);

    const changed = await fixtures.store.appendDerivedFactWithEvidence(
      {
        ...draft,
        valid_from: ts('2026-04-01T00:00:00Z'),
        recorded_at: ts('2026-04-01T00:00:00Z'),
      },
      evidenceFor(fixtures.sources.manufacturer, 'derived_output'),
      [{ input_fact_id: inputB.fact.id, transformation_ref: 'derive.v1' }],
    );
    expect(changed.outcome).toBe('CREATED');
    expect(changed.fact.id).not.toBe(first.fact.id);
    expect(changed.superseded_fact_id).toBe(first.fact.id);
    expect((await fixtures.store.getFactById(first.fact.id))?.status).toBe('SUPERSEDED');
    expect(
      await fixtures.driver.query(
        `SELECT input_fact_id, transformation_ref FROM fact_dependencies
          WHERE derived_fact_id = $1 ORDER BY input_fact_id::text COLLATE "C"`,
        [changed.fact.id],
      ),
    ).toEqual([{ input_fact_id: inputB.fact.id, transformation_ref: 'derive.v1' }]);
  });

  it('rejects two dependency edges with the same input fact even when transforms differ', async () => {
    const input = await claim(fixtures, 'manufacturer', {
      property: 'duplicate_dependency_input',
      value: 24,
      value_type: 'number',
      valid_from: '2026-05-01T00:00:00Z',
    });
    await expect(
      fixtures.store.appendDerivedFactWithEvidence(
        {
          entity_id: fixtures.entity.id,
          property: 'duplicate_dependency_output',
          normalized_value: 2,
          value_type: 'number',
          unit: null,
          valid_from: ts('2026-05-01T00:00:00Z'),
          confidence: factConfidence(0.9),
          recorded_at: ts('2026-05-01T00:00:00Z'),
          status: 'ACTIVE',
        },
        evidenceFor(fixtures.sources.manufacturer, 'duplicate_dependency_output'),
        [
          { input_fact_id: input.fact.id, transformation_ref: 'derive.first' },
          { input_fact_id: input.fact.id, transformation_ref: 'derive.second' },
        ],
      ),
    ).rejects.toBeInstanceOf(FactDependencyError);
  });
});
