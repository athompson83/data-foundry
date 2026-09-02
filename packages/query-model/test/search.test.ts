/**
 * AGENTS.md rule 7 — "Exact identifiers beat semantic search."
 *
 * The load-bearing test is the first one: an exact identifier match must lead
 * the results even when a different entity scores strictly higher on text
 * similarity. `text_rank` is returned on every hit so the test can prove the
 * runner-up really did outrank the winner textually — and lost anyway.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { identityConfidence } from '@data-foundry/canonical-schema';
import { UnknownFieldError, lookupExactIdentifier } from '../src/index.js';
import {
  createQueryFixtures,
  retireSourceFixtureByCompleteSnapshot,
  ts,
  type QueryFixtures,
} from './support.js';

let fixtures: QueryFixtures;

async function recordSourceAliasClaimWithEvidence(
  current: QueryFixtures,
  input: Parameters<QueryFixtures['store']['recordSourceAliasClaim']>[0],
) {
  const claim = await current.store.recordSourceAliasClaim(input);
  const [provenance] = await current.driver.query<{
    entity_id: string;
    artifact_id: string;
  }>(
    `SELECT alias_row.entity_id, source_record.artifact_id
       FROM entity_aliases alias_row
       JOIN source_records source_record ON source_record.id = $2
      WHERE alias_row.id = $1`,
    [input.entity_alias_id, input.source_record_id],
  );
  if (provenance === undefined) throw new Error('alias search provenance fixture missing');
  await current.store.recordEntityEvidence({
    entity_id: provenance.entity_id as never,
    artifact_id: provenance.artifact_id as never,
    source_record_id: input.source_record_id,
    entity_alias_claim_id: claim.id,
    contribution_role: 'ALIAS',
    locator_type: input.locator_type,
    locator_value: input.locator_value,
    observed_at: ts('2026-08-30T00:00:00Z'),
  });
  return claim;
}

beforeAll(async () => {
  fixtures = await createQueryFixtures();
});

afterAll(async () => {
  await fixtures?.driver.close();
});

describe('exact identifiers beat fuzzy ranking', () => {
  it('returns the exact part-number match first even though a rival ranks higher textually', async () => {
    const result = await fixtures.qm.search({
      vertical_id: fixtures.vertical.id,
      text: 'hk32ea001',
      entity_type: 'part',
    });

    expect(result.exact_short_circuit).toBe(true);
    expect(result.hits.length).toBeGreaterThanOrEqual(2);

    const winner = result.hits[0];
    const runnerUp = result.hits[1];

    // The entity whose *normalized* identifier equals the query wins, even
    // though its alias reads "HK-32EA/001" and matches no text at all.
    expect(winner?.entity.id).toBe(fixtures.motor.id);
    expect(winner?.exact).toBe(true);
    expect(winner?.match_kind).toBe('EXACT_IDENTIFIER');
    expect(winner?.matched_on).toBe('HK-32EA/001');

    // The rival is literally named "HK32EA001 Motor" and scores better on text.
    expect(runnerUp?.entity.id).toBe(fixtures.rival.id);
    expect(runnerUp?.exact).toBe(false);
    expect(runnerUp?.text_rank).toBeGreaterThan(winner?.text_rank ?? 0);
  });

  it('does not need a text match at all for the exact tier to fire', async () => {
    const exact = await lookupExactIdentifier(fixtures.driver, fixtures.registry, {
      vertical_id: fixtures.vertical.id,
      text: 'HK-32EA/001',
    });
    expect(exact.map((hit) => hit.entity.id)).toEqual([fixtures.motor.id]);

    // ...and the collapsed spelling resolves to the same entity.
    const collapsed = await lookupExactIdentifier(fixtures.driver, fixtures.registry, {
      vertical_id: fixtures.vertical.id,
      text: 'HK 32EA 001',
    });
    expect(collapsed.map((hit) => hit.entity.id)).toEqual([fixtures.motor.id]);
  });

  it('excludes an unclaimed source alias from exact, full-text, and fuzzy search', async () => {
    await fixtures.store.stageSourceAlias({
      entity_id: fixtures.equipment.id,
      alias_type: 'external_id',
      alias_value: 'UNCLAIMED-ZZYX-4471',
      normalized_value: 'unclaimedzzyx4471',
      source_id: fixtures.sources.manufacturer.source.id,
      identity_confidence: identityConfidence(0.99),
      valid_from: ts('2026-08-30T00:00:00Z'),
      valid_to: null,
    });

    const exact = await lookupExactIdentifier(fixtures.driver, fixtures.registry, {
      vertical_id: fixtures.vertical.id,
      text: 'UNCLAIMED-ZZYX-4471',
    });
    expect(exact).toEqual([]);

    const ranked = await fixtures.qm.search({
      vertical_id: fixtures.vertical.id,
      text: 'UNCLAIMED ZZYX',
    });
    expect(ranked.hits.map((hit) => hit.entity.id)).not.toContain(fixtures.equipment.id);
  });

  it('returns only the winning current claim spelling from exact search', async () => {
    const current = await createQueryFixtures({ trigram: false });
    try {
      const manufacturer = current.sources.manufacturer;
      const certifier = current.sources.certifier;
      const filing = current.sources.filing;
      const alias = await current.store.stageSourceAlias({
        entity_id: current.equipment.id,
        alias_type: 'external_id',
        alias_value: 'Manufacturer search spelling',
        normalized_value: 'search-switch',
        source_id: manufacturer.source.id,
        identity_confidence: identityConfidence(0.7),
        valid_from: ts('2026-08-30T00:00:00Z'),
        valid_to: null,
      });
      await recordSourceAliasClaimWithEvidence(current, {
        entity_alias_id: alias.id,
        asserted_alias_value: 'Manufacturer search spelling',
        asserted_normalized_value: 'search-switch',
        identity_confidence: identityConfidence(0.7),
        source_record_id: manufacturer.record.id,
        locator_type: 'JSON_POINTER',
        locator_value: '/manufacturer',
      });
      await current.store.stageSourceAlias({
        entity_id: current.equipment.id,
        alias_type: 'external_id',
        alias_value: 'Certifier search spelling',
        normalized_value: 'search-switch',
        source_id: certifier.source.id,
        identity_confidence: identityConfidence(0.95),
        valid_from: ts('2026-08-30T00:00:00Z'),
        valid_to: null,
      });
      await recordSourceAliasClaimWithEvidence(current, {
        entity_alias_id: alias.id,
        asserted_alias_value: 'Certifier search spelling',
        asserted_normalized_value: 'search-switch',
        identity_confidence: identityConfidence(0.95),
        source_record_id: certifier.record.id,
        locator_type: 'TABLE_CELL',
        locator_value: 'models!A2',
      });
      await current.store.stageSourceAlias({
        entity_id: current.equipment.id,
        alias_type: 'external_id',
        alias_value: 'search-switch',
        normalized_value: 'search-switch',
        source_id: filing.source.id,
        identity_confidence: identityConfidence(1),
        valid_from: ts('2026-08-30T00:00:00Z'),
        valid_to: null,
      });

      expect(await lookupExactIdentifier(current.driver, current.registry, {
        vertical_id: current.vertical.id,
        text: 'search-switch',
      })).toContainEqual(expect.objectContaining({
        entity: expect.objectContaining({ id: current.equipment.id }),
        matched_on: 'Certifier search spelling',
      }));

      const retiredAt = ts('2026-08-30T12:00:00Z');
      await retireSourceFixtureByCompleteSnapshot(current, 'certifier', retiredAt);
      expect(await lookupExactIdentifier(current.driver, current.registry, {
        vertical_id: current.vertical.id,
        text: 'search-switch',
      })).toContainEqual(expect.objectContaining({
        entity: expect.objectContaining({ id: current.equipment.id }),
        matched_on: 'Manufacturer search spelling',
      }));
    } finally {
      await current.driver.close();
    }
  });

  it('ranks exact slug and exact name matches ahead of ranked hits too', async () => {
    const bySlug = await fixtures.qm.search({
      vertical_id: fixtures.vertical.id,
      text: 'carrier-infinity-24anb7',
    });
    expect(bySlug.hits[0]?.entity.id).toBe(fixtures.equipment.id);
    expect(bySlug.hits[0]?.match_kind).toBe('EXACT_SLUG');

    const byName = await fixtures.qm.search({
      vertical_id: fixtures.vertical.id,
      text: 'carrier infinity 25vna4',
    });
    expect(byName.hits[0]?.entity.id).toBe(fixtures.heatPump.id);
    expect(byName.hits[0]?.exact).toBe(true);
  });

  it('explains why a hit was returned', async () => {
    const result = await fixtures.qm.search({
      vertical_id: fixtures.vertical.id,
      text: 'hk32ea001',
      entity_type: 'part',
    });
    expect(result.hits[0]?.explain).toContain('rule 7');
    expect(result.hits[1]?.explain).toMatch(/Ranked/);
  });

  it('still ranks textually when nothing matches exactly', async () => {
    const result = await fixtures.qm.search({
      vertical_id: fixtures.vertical.id,
      text: 'infinity',
      entity_type: 'equipment',
    });

    expect(result.exact_short_circuit).toBe(false);
    expect(result.hits.length).toBe(2);
    expect(result.hits.every((hit) => !hit.exact)).toBe(true);
    expect(result.hits[0]?.score).toBeGreaterThan(0);
  });

  it('uses full-text search and, where available, trigram — never vectors', async () => {
    const result = await fixtures.qm.search({
      vertical_id: fixtures.vertical.id,
      text: 'infinity',
    });
    expect(result.strategy.exact_first).toBe(true);
    expect(result.strategy.full_text).toBe(true);
    expect(result.strategy.trigram).toBe(true);
    expect(result.strategy.vector).toBe(false);
  });

  it('still puts exact identifiers first on a database without pg_trgm', async () => {
    // A hosted Postgres may not have the extension. Rule 7 is structural, so
    // exactness must not depend on an optional ranking accelerator.
    const plain = await createQueryFixtures({ trigram: false });
    try {
      const result = await plain.qm.search({
        vertical_id: plain.vertical.id,
        text: 'hk32ea001',
        entity_type: 'part',
      });

      expect(result.strategy.trigram).toBe(false);
      expect(result.hits[0]?.entity.id).toBe(plain.motor.id);
      expect(result.hits[0]?.exact).toBe(true);
      expect(result.hits[1]?.entity.id).toBe(plain.rival.id);
      expect(result.hits[1]?.text_rank).toBeGreaterThan(result.hits[0]?.text_rank ?? 0);
    } finally {
      await plain.driver.close();
    }
  });

  it('contains no vector/embedding search anywhere in the package', () => {
    const root = join(import.meta.dirname, '..', 'src');
    const banned = /\b(pgvector|embedding|embeddings|cosine_similarity|<=>)\b/i;
    for (const file of readdirSync(root)) {
      if (!file.endsWith('.ts')) continue;
      const source = readFileSync(join(root, file), 'utf8');
      // The word "vector" appears only in prose explaining its absence.
      const offending = source
        .split('\n')
        .filter((line) => banned.test(line) && !line.trimStart().startsWith('*'));
      expect(offending, `${file} must not implement vector search`).toEqual([]);
    }
  });
});

describe('metadata-driven filters and facets', () => {
  it('derives facet counts from field metadata alone', async () => {
    const facets = await fixtures.qm.facets({
      vertical_id: fixtures.vertical.id,
      entity_type: 'equipment',
    });

    const properties = facets.map((facet) => facet.property).sort();
    // `internal_note` declares filter.type "none" and is therefore not a facet.
    expect(properties).toEqual(['refrigerant', 'seer2_rating', 'tonnage']);

    const refrigerant = facets.find((facet) => facet.property === 'refrigerant');
    expect(refrigerant?.label).toBe('Refrigerant');
    expect(refrigerant?.values).toEqual([{ value: 'R-454B', count: 2 }]);

    const seer = facets.find((facet) => facet.property === 'seer2_rating');
    expect(seer?.values.map((entry) => entry.value).sort()).toEqual(['15.2', '16', '18']);

    const tonnage = facets.find((facet) => facet.property === 'tonnage');
    expect(tonnage?.control).toBe('range');
    expect(tonnage?.range).toEqual({ min: 3, max: 4 });
    expect(tonnage?.unit).toBe('ton');
  });

  it('filters search results by a declared facet', async () => {
    const all = await fixtures.qm.search({
      vertical_id: fixtures.vertical.id,
      entity_type: 'equipment',
    });
    expect(all.total).toBe(2);

    const filtered = await fixtures.qm.search({
      vertical_id: fixtures.vertical.id,
      entity_type: 'equipment',
      filters: [{ property: 'tonnage', op: 'range', min: 4, max: null }],
    });
    expect(filtered.hits.map((hit) => hit.entity.id)).toEqual([fixtures.heatPump.id]);

    const byValue = await fixtures.qm.search({
      vertical_id: fixtures.vertical.id,
      entity_type: 'equipment',
      filters: [{ property: 'seer2_rating', op: 'in', values: [16] }],
    });
    expect(byValue.hits.map((hit) => hit.entity.id)).toEqual([fixtures.equipment.id]);
  });

  it('rejects a filter on an undeclared or non-filterable field instead of ignoring it', async () => {
    await expect(
      fixtures.qm.search({
        vertical_id: fixtures.vertical.id,
        filters: [{ property: 'serial_number', op: 'exists' }],
      }),
    ).rejects.toBeInstanceOf(UnknownFieldError);

    await expect(
      fixtures.qm.search({
        vertical_id: fixtures.vertical.id,
        filters: [{ property: 'internal_note', op: 'exists' }],
      }),
    ).rejects.toThrow(/no filter behaviour/);
  });

  it('lets a field\'s declared search_boost make its values searchable', async () => {
    const result = await fixtures.qm.search({
      vertical_id: fixtures.vertical.id,
      text: 'R-454B',
      entity_type: 'equipment',
    });

    // Neither entity is named "R-454B"; they match because the vertical
    // declared refrigerant with search_boost 0.4.
    expect(result.hits.map((hit) => hit.entity.id).sort()).toEqual(
      [fixtures.equipment.id, fixtures.heatPump.id].sort(),
    );
    expect(result.hits.every((hit) => hit.match_kind === 'FIELD_VALUE')).toBe(true);
  });

  it('returns facets alongside results when asked', async () => {
    const result = await fixtures.qm.search({
      vertical_id: fixtures.vertical.id,
      entity_type: 'equipment',
      include_facets: true,
    });
    expect(result.facets.length).toBe(3);
  });
});
