import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
});
