import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { factConfidence } from '@data-foundry/canonical-schema';
import { citation, entityLineage, factLineage, relationshipLineage } from '../src/index.js';
import { claim, createFixtures, ts, type Fixtures } from './support.js';

let fixtures: Fixtures;

beforeAll(async () => {
  fixtures = await createFixtures();
});

afterAll(async () => {
  await fixtures?.driver.close();
});

describe('field-level lineage', () => {
  it('walks fact → evidence → record → artifact → source with locator and retrieved_at', async () => {
    const written = await claim(fixtures, 'manufacturer', {
      property: 'refrigerant',
      value: 'R-454B',
      source_value: 'Refrigerant: R-454B',
      valid_from: '2026-02-01T00:00:00Z',
      observed_at: '2026-02-02T00:00:00Z',
    });

    const lineage = await factLineage(fixtures.driver, written.fact.id);
    expect(lineage).not.toBeNull();
    expect(lineage?.traceable).toBe(true);
    expect(lineage?.chain).toHaveLength(1);

    const link = lineage?.chain[0];
    expect(link?.source.publisher).toBe('Acme Climate');
    expect(link?.source.domain).toBe('catalog.acme-climate.example.com');
    expect(link?.source_record.source_record_key).toBe('manufacturer-24ANB7');
    expect(link?.artifact.url).toBe(fixtures.sources.manufacturer.artifact.url);
    // The two things that make a claim re-checkable without re-crawling.
    expect(link?.locator).toEqual({
      type: 'CSS_SELECTOR',
      value: 'table.specs [data-field="refrigerant"]',
    });
    expect(link?.retrieved_at).toBe(ts('2026-01-05T00:00:00Z'));
    expect(link?.source_value).toBe('Refrigerant: R-454B');
    expect(link?.observed_at).toBe(ts('2026-02-02T00:00:00Z'));
    expect(link?.publishable).toBe(true);
  });

  it('counts corroborating sources and flags rights-blocked evidence', async () => {
    await claim(fixtures, 'aggregator', {
      property: 'refrigerant',
      value: 'R-454B',
      valid_from: '2026-02-01T00:00:00Z',
    });
    const blocked = await claim(fixtures, 'blocked', {
      property: 'refrigerant',
      value: 'R-454B',
      valid_from: '2026-02-01T00:00:00Z',
    });

    const lineage = await factLineage(fixtures.driver, blocked.fact.id);
    expect(lineage?.distinct_sources).toBe(3);
    // The forum's evidence is preserved (rule 10) but cannot back a publish (rule 1).
    expect(lineage?.publishable_sources).toBe(2);
    expect(lineage?.chain.some((link) => !link.publishable)).toBe(true);
  });

  it('renders a one-line citation', async () => {
    const facts = await fixtures.store.listFacts(fixtures.entity.id, { property: 'refrigerant' });
    const lineage = await factLineage(fixtures.driver, facts[0]!.id);
    const manufacturer = lineage!.chain.find(
      (link) => link.source.domain === 'catalog.acme-climate.example.com',
    );
    const line = citation(manufacturer!);
    expect(line).toContain('Acme Climate');
    expect(line).toContain('CSS_SELECTOR');
    expect(line).toContain('retrieved');
    expect(line).toContain(fixtures.sources.manufacturer.artifact.url);
  });

  it('traces relationships as well as facts', async () => {
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

    const written = await fixtures.store.upsertRelationshipWithEvidence(
      {
        vertical_id: fixtures.vertical.id,
        subject_entity_id: fixtures.entity.id,
        predicate: 'uses_part',
        object_entity_id: part.id,
        confidence: fixtures.entity.quality_score as never,
        valid_from: ts('2026-02-01T00:00:00Z'),
        recorded_at: ts('2026-02-01T00:00:00Z'),
        status: 'ACTIVE',
      },
      [
        {
          artifact_id: fixtures.sources.manufacturer.artifact.id,
          source_record_id: fixtures.sources.manufacturer.record.id,
          source_value: 'Uses part HK32EA001',
          locator_type: 'CSS_SELECTOR',
          locator_value: 'ul.parts li:nth-child(1)',
          observed_at: ts('2026-02-01T00:00:00Z'),
        },
      ],
    );

    const lineage = await relationshipLineage(fixtures.driver, written.relationship.id);
    expect(lineage?.traceable).toBe(true);
    expect(lineage?.chain[0]?.source.publisher).toBe('Acme Climate');
    expect(lineage?.chain[0]?.locator.value).toBe('ul.parts li:nth-child(1)');
  });

  it('returns lineage for every current fact of an entity', async () => {
    await claim(fixtures, 'manufacturer', {
      property: 'seer2_rating',
      value: 16,
      value_type: 'number',
      valid_from: '2026-02-01T00:00:00Z',
    });
    const all = await entityLineage(fixtures.driver, fixtures.entity.id);
    expect(all.size).toBeGreaterThanOrEqual(2);
    for (const lineage of all.values()) {
      expect(lineage.traceable).toBe(true);
    }
  });

  it('returns null for a fact that does not exist', async () => {
    const missing = await factLineage(
      fixtures.driver,
      '00000000-0000-4000-8000-00000000dead' as never,
    );
    expect(missing).toBeNull();
  });

  it('recursively carries dependency facts, transforms, and every dependency source', async () => {
    const inputA = await claim(fixtures, 'manufacturer', {
      property: 'lineage_input_a',
      value: 12,
      value_type: 'number',
      valid_from: '2026-03-01T00:00:00Z',
    });
    const inputB = await claim(fixtures, 'certifier', {
      property: 'lineage_input_b',
      value: 18,
      value_type: 'number',
      valid_from: '2026-03-01T00:00:00Z',
    });
    const intermediateSource = fixtures.sources.aggregator;
    const intermediate = await fixtures.store.appendDerivedFactWithEvidence(
      {
        entity_id: fixtures.entity.id,
        property: 'lineage_intermediate',
        normalized_value: 6,
        value_type: 'number',
        unit: null,
        valid_from: ts('2026-03-01T00:00:00Z'),
        confidence: factConfidence(0.9),
        recorded_at: ts('2026-03-01T00:00:00Z'),
        status: 'ACTIVE',
      },
      [{
        artifact_id: intermediateSource.artifact.id,
        source_record_id: intermediateSource.record.id,
        source_value: '6',
        locator_type: 'WHOLE_DOCUMENT',
        locator_value: '',
        observed_at: ts('2026-03-01T00:00:00Z'),
      }],
      [{ input_fact_id: inputA.fact.id, transformation_ref: 'lineage.divide.v1' }],
    );
    const outputSource = fixtures.sources.manufacturer;
    const output = await fixtures.store.appendDerivedFactWithEvidence(
      {
        entity_id: fixtures.entity.id,
        property: 'lineage_output',
        normalized_value: 24,
        value_type: 'number',
        unit: null,
        valid_from: ts('2026-03-01T00:00:00Z'),
        confidence: factConfidence(0.9),
        recorded_at: ts('2026-03-01T00:00:00Z'),
        status: 'ACTIVE',
      },
      [{
        artifact_id: outputSource.artifact.id,
        source_record_id: outputSource.record.id,
        source_value: '24',
        locator_type: 'WHOLE_DOCUMENT',
        locator_value: '',
        observed_at: ts('2026-03-01T00:00:00Z'),
      }],
      [
        { input_fact_id: intermediate.fact.id, transformation_ref: 'lineage.multiply.v1' },
        { input_fact_id: inputB.fact.id, transformation_ref: 'lineage.add.v1' },
      ],
    );

    const lineage = await factLineage(fixtures.driver, output.fact.id);
    expect(lineage?.direct_chain).toHaveLength(1);
    expect(lineage?.dependencies.map((dependency) => ({
      input_fact_id: dependency.input_fact_id,
      transformation_ref: dependency.transformation_ref,
    }))).toEqual([
      { input_fact_id: inputB.fact.id, transformation_ref: 'lineage.add.v1' },
      { input_fact_id: intermediate.fact.id, transformation_ref: 'lineage.multiply.v1' },
    ].sort((left, right) => left.input_fact_id < right.input_fact_id ? -1 : 1));
    expect(lineage?.dependencies.find(
      (dependency) => dependency.input_fact_id === intermediate.fact.id,
    )?.lineage?.dependencies[0]?.transformation_ref).toBe('lineage.divide.v1');
    expect(new Set(lineage?.chain.map((link) => link.source.publisher))).toEqual(new Set([
      'Acme Climate',
      'Ratings Directory',
      'SpecAggregator',
    ]));
    expect(lineage?.distinct_sources).toBe(3);
    expect(lineage?.traceable).toBe(true);
    expect(lineage?.cycle_detected).toBe(false);
  });

  it('terminates and marks a corrupted recursive dependency cycle', async () => {
    const first = await claim(fixtures, 'manufacturer', {
      property: 'cycle_lineage_first', value: 1, value_type: 'number',
    });
    const second = await claim(fixtures, 'certifier', {
      property: 'cycle_lineage_second', value: 2, value_type: 'number',
    });
    await fixtures.driver.exec(
      'ALTER TABLE fact_dependencies DISABLE TRIGGER fact_dependencies_reject_cycle_insert',
    );
    await fixtures.driver.exec(
      'ALTER TABLE fact_dependencies DISABLE TRIGGER fact_dependencies_require_open_classification_insert',
    );
    try {
      await fixtures.driver.query(
        `INSERT INTO fact_dependencies (derived_fact_id, input_fact_id, transformation_ref)
         VALUES ($1, $2, 'corrupt.forward'), ($2, $1, 'corrupt.backward')`,
        [first.fact.id, second.fact.id],
      );
      const lineage = await factLineage(fixtures.driver, first.fact.id);
      expect(lineage?.cycle_detected).toBe(true);
      expect(lineage?.traceable).toBe(false);
      expect(lineage?.dependencies[0]?.lineage?.dependencies[0]?.cycle_detected).toBe(true);
    } finally {
      await fixtures.driver.exec(
        'ALTER TABLE fact_dependencies ENABLE TRIGGER fact_dependencies_require_open_classification_insert',
      );
      await fixtures.driver.exec(
        'ALTER TABLE fact_dependencies ENABLE TRIGGER fact_dependencies_reject_cycle_insert',
      );
    }
  });
});
