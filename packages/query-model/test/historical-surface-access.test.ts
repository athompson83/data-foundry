import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Identifier, IsoDateTime } from '@data-foundry/canonical-schema';
import {
  addSyntheticEntityEvidence,
  claim,
  createQueryFixtures,
  seedSyntheticSurfaceRights,
  type QueryFixtures,
} from './support.js';

const SELECTION_AT = '2026-06-01T00:00:00.000Z' as IsoDateTime;
const PUBLICATION_AT = '2026-08-14T00:00:00.000Z' as IsoDateTime;
const PROPERTY = 'historical_efficiency' as Identifier;

let fixtures: QueryFixtures;
let historicalFactId: string;

beforeAll(async () => {
  fixtures = await createQueryFixtures();
  await seedSyntheticSurfaceRights(fixtures, ['PUBLIC_WEB']);
  await addSyntheticEntityEvidence(fixtures, fixtures.equipment);

  const historical = await claim(fixtures, 'manufacturer', {
    property: PROPERTY,
    value: 17,
    value_type: 'number',
    valid_from: '2026-03-01T00:00:00Z',
  });
  historicalFactId = historical.fact.id;

  await claim(fixtures, 'manufacturer', {
    property: PROPERTY,
    value: 18,
    value_type: 'number',
    valid_from: '2026-07-01T00:00:00Z',
  });
}, 120_000);

afterAll(async () => {
  await fixtures?.driver.close();
});

describe('historical surface authorization', () => {
  it('authorizes the exact historically selected fact and evidence using current grants', async () => {
    const web = fixtures.qm.forSurface('PUBLIC_WEB', { asOf: PUBLICATION_AT });

    const explanation = await web.explainFact(fixtures.equipment.id, PROPERTY, {
      at: SELECTION_AT,
    });

    expect(explanation?.selected).toMatchObject({
      fact_id: historicalFactId,
      value: 17,
      attributions: [
        {
          publisher: fixtures.sources.manufacturer.source.publisher,
          artifact_url: fixtures.sources.manufacturer.artifact.url,
        },
      ],
    });
    expect(JSON.stringify(explanation)).not.toContain('reviewer');
  });
});
