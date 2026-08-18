/**
 * Provenance coverage is the measurable gate AGENTS.md's testing requirements
 * lean on. These tests prove the number is real: it is 1 while every write goes
 * through the canonical store, and it drops the moment something writes a fact
 * behind the store's back.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ProvenanceCoverageError,
  assertProvenanceCoverage,
  provenanceCoverage,
} from '../src/index.js';
import { claim, createFixtures, ts, type Fixtures } from './support.js';

let fixtures: Fixtures;

beforeAll(async () => {
  fixtures = await createFixtures();

  await claim(fixtures, 'manufacturer', {
    property: 'refrigerant',
    value: 'R-454B',
    valid_from: '2026-02-01T00:00:00Z',
  });
  await claim(fixtures, 'manufacturer', {
    property: 'seer2_rating',
    value: 16,
    value_type: 'number',
    valid_from: '2026-02-01T00:00:00Z',
  });
  await claim(fixtures, 'certifier', {
    property: 'seer2_rating',
    value: 15.2,
    value_type: 'number',
    status: 'PROPOSED',
    valid_from: '2026-02-01T00:00:00Z',
  });
});

afterAll(async () => {
  await fixtures?.driver.close();
});

describe('provenanceCoverage', () => {
  it('reports total coverage while every write goes through the store', async () => {
    const report = await provenanceCoverage(fixtures.driver);

    expect(report.facts.total).toBe(3);
    expect(report.facts.traceable).toBe(3);
    expect(report.facts.coverage).toBe(1);
    expect(report.untraceable_fact_ids).toEqual([]);
    expect(() => assertProvenanceCoverage(report)).not.toThrow();
  });

  it('breaks coverage down per entity and per vertical', async () => {
    const second = await fixtures.store.upsertEntity({
      vertical_id: fixtures.vertical.id,
      entity_type: 'equipment',
      canonical_name: 'Carrier 25VNA4',
      canonical_slug: 'carrier-25vna4',
      status: 'ACTIVE',
      quality_score: fixtures.entity.quality_score,
      first_seen_at: ts('2026-01-01T00:00:00Z'),
      last_verified_at: null,
    });
    await claim(fixtures, 'manufacturer', {
      property: 'refrigerant',
      value: 'R-454B',
      entity_id: second.id,
      valid_from: '2026-02-01T00:00:00Z',
    });

    const report = await provenanceCoverage(fixtures.driver);

    expect(report.by_vertical).toHaveLength(1);
    expect(report.by_vertical[0]?.vertical_slug).toBe('hvac');
    expect(report.by_vertical[0]?.coverage).toBe(1);

    const slugs = report.by_entity.map((cell) => cell.canonical_slug).sort();
    expect(slugs).toEqual(['carrier-25vna4', 'carrier-infinity-24anb7']);
    const primary = report.by_entity.find(
      (cell) => cell.entity_id === fixtures.entity.id,
    );
    expect(primary?.total).toBe(3);
    expect(primary?.coverage).toBe(1);
  });

  it('detects a fact written behind the store\'s back and fails the gate', async () => {
    // Exactly what the store's API makes impossible: a bare fact, no evidence.
    await fixtures.driver.query(
      `INSERT INTO facts (entity_id, property, normalized_value, value_type, valid_from, status,
                          confidence, recorded_at)
       VALUES ($1, 'smuggled_in', '"unsupported"'::jsonb, 'string', $2, 'PROPOSED', 0.99, $2)`,
      [fixtures.entity.id, ts('2026-02-01T00:00:00Z')],
    );

    const report = await provenanceCoverage(fixtures.driver);

    expect(report.facts.coverage).toBeLessThan(1);
    expect(report.untraceable_fact_ids).toHaveLength(1);
    expect(() => assertProvenanceCoverage(report)).toThrow(ProvenanceCoverageError);
    expect(() => assertProvenanceCoverage(report)).toThrow(/below the required/);

    const entityCell = report.by_entity.find((cell) => cell.entity_id === fixtures.entity.id);
    expect(entityCell?.traceable).toBe(3);
    expect(entityCell?.total).toBe(4);
  });

  it('scopes to a single entity', async () => {
    const clean = await fixtures.store.getEntityBySlug(
      fixtures.vertical.id,
      'equipment',
      'carrier-25vna4',
    );
    const report = await provenanceCoverage(fixtures.driver, { entity_id: clean!.id });

    expect(report.scope.entity_id).toBe(clean!.id);
    expect(report.facts.total).toBe(1);
    expect(report.facts.coverage).toBe(1);
    expect(() => assertProvenanceCoverage(report)).not.toThrow();
  });

  it('counts relationship provenance too', async () => {
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
    await fixtures.store.upsertRelationshipWithEvidence(
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
          locator_type: 'WHOLE_DOCUMENT',
          locator_value: '',
          observed_at: ts('2026-02-01T00:00:00Z'),
        },
      ],
    );

    const report = await provenanceCoverage(fixtures.driver);
    expect(report.relationships.total).toBe(1);
    expect(report.relationships.coverage).toBe(1);
  });
});
