import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RightsSurface } from '@data-foundry/rights-engine';
import {
  addSyntheticEntityEvidence,
  createQueryFixtures,
  relate,
  seedSyntheticSurfaceRights,
  ts,
  type QueryFixtures,
} from './support.js';

const AS_OF = ts('2026-08-15T12:00:00.000Z');
const SURFACES = [
  'PUBLIC_WEB',
  'SEARCH_INDEX',
  'API_FREE',
  'API_PAID',
  'RAPIDAPI',
  'MCP',
  'BULK_EXPORT',
  'PARTNER_DELIVERY',
  'MODEL_TRAINING',
  'MODEL_EVALUATION',
] as const satisfies readonly RightsSurface[];

let fixtures: QueryFixtures;

beforeAll(async () => {
  fixtures = await createQueryFixtures({ trigram: false });
  await seedSyntheticSurfaceRights(fixtures, SURFACES, ['manufacturer']);
  await addSyntheticEntityEvidence(fixtures, fixtures.equipment, 'manufacturer');
  await addSyntheticEntityEvidence(fixtures, fixtures.heatPump, 'manufacturer');
  await relate(fixtures, fixtures.equipment, 'related_model', fixtures.heatPump, 'manufacturer');
});

afterAll(async () => {
  await fixtures?.driver.close();
});

describe('persisted source kill switch', () => {
  it.each(SURFACES)('refuses entity, fact, search, and relationship evidence on %s', async (surface) => {
    const before = fixtures.qm.forSurface(surface, { asOf: AS_OF });
    expect(await before.getEntity(fixtures.equipment.id)).not.toBeNull();
    expect(await before.canonicalFacts(fixtures.equipment.id, { at: AS_OF })).not.toEqual([]);

    await fixtures.driver.query(
      `UPDATE sources SET kill_switch_engaged = TRUE WHERE id = $1`,
      [fixtures.sources.manufacturer.source.id],
    );
    try {
      const killed = fixtures.qm.forSurface(surface, { asOf: AS_OF });
      expect(await killed.getEntity(fixtures.equipment.id)).toBeNull();
      expect(await killed.canonicalFacts(fixtures.equipment.id, { at: AS_OF })).toEqual([]);
      expect(
        await killed.search({
          vertical_id: fixtures.vertical.id,
          text: fixtures.equipment.canonical_name,
        }),
      ).toMatchObject({ hits: [], total: 0 });
      expect(
        await killed.relationships({
          entity_id: fixtures.equipment.id,
          predicate: 'related_model',
        }),
      ).toMatchObject({ edges: [] });
    } finally {
      await fixtures.driver.query(
        `UPDATE sources SET kill_switch_engaged = FALSE WHERE id = $1`,
        [fixtures.sources.manufacturer.source.id],
      );
    }
  });
});
