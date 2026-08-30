import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Identifier, IsoDateTime } from '@data-foundry/canonical-schema';
import { buildDatasetExport, createMemorySink } from '../src/index.js';
import {
  GENERATED_AT,
  baseOptions,
  claim,
  createExportFixtures,
  type ExportFixtures,
} from './support.js';

const SELECTION_AT = '2026-06-01T00:00:00.000Z' as IsoDateTime;
const PROPERTY = 'warranty_years' as Identifier;

let fixtures: ExportFixtures;
let historicalFactId: string;

beforeAll(async () => {
  fixtures = await createExportFixtures();
  const historical = (await fixtures.store.loadFactCandidates(
    fixtures.equipment.id,
    PROPERTY,
    SELECTION_AT,
  )).find((candidate) => candidate.fact.normalized_value === 10);
  if (historical === undefined) throw new Error('Missing historical warranty fixture.');
  historicalFactId = historical.fact.id;

  await claim(fixtures, 'aggregator', {
    property: PROPERTY,
    value: 12,
    value_type: 'number',
    valid_from: '2026-07-01T00:00:00Z',
  });
}, 120_000);

afterAll(async () => {
  await fixtures?.driver.close();
});

describe('historical bulk-export selection', () => {
  it('publishes the historically selected fact when grants are current at generation time', async () => {
    const result = await buildDatasetExport({
      ...baseOptions(fixtures),
      generatedAt: GENERATED_AT,
      selection: { at: SELECTION_AT },
      sink: createMemorySink('historical-selection'),
    });

    expect(result.rows).toContainEqual(
      expect.objectContaining({
        fact_id: historicalFactId,
        property: PROPERTY,
        value: '10',
      }),
    );
  });
});
