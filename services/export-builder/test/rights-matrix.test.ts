/**
 * Bulk export is its own rights surface. A source may lawfully power a public
 * page or a direct API while remaining unavailable for redistribution as a
 * downloadable dataset; those neighboring grants must never be treated as a
 * bulk grant simply because the legacy source classification is GREEN.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ExportRefusedError,
  buildDatasetExport,
  createMemorySink,
} from '../src/index.js';
import {
  GENERATED_AT,
  baseOptions,
  createExportFixtures,
  type ExportFixtures,
} from './support.js';

let neighboring: ExportFixtures;

beforeAll(async () => {
  neighboring = await createExportFixtures({
    surfaceRights: ['PUBLIC_WEB', 'API_PAID', 'MCP'],
  });
}, 120_000);

afterAll(async () => {
  await neighboring?.driver.close();
});

describe('surface-specific bulk-export permission', () => {
  it('proves the neighboring grants are real rather than an empty fixture', async () => {
    for (const surface of ['PUBLIC_WEB', 'API_PAID', 'MCP'] as const) {
      const model = neighboring.qm.forSurface(surface, { asOf: GENERATED_AT });
      expect(await model.getEntity(neighboring.entity.id), surface).not.toBeNull();
      expect(
        (await model.canonicalFacts(neighboring.entity.id, { at: GENERATED_AT })).length,
        surface,
      ).toBeGreaterThan(0);
    }

    const bulk = neighboring.qm.forSurface('BULK_EXPORT', { asOf: GENERATED_AT });
    expect(await bulk.getEntity(neighboring.entity.id)).toBeNull();
    expect(await bulk.canonicalFacts(neighboring.entity.id, { at: GENERATED_AT })).toEqual([]);
  });

  it('refuses the whole artifact when only neighboring surfaces are granted', async () => {
    const sink = createMemorySink('neighboring-rights');
    let failure: unknown;

    try {
      await buildDatasetExport({
        ...baseOptions(neighboring),
        sink,
      });
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(ExportRefusedError);
    expect((failure as ExportRefusedError).refusals.some((entry) =>
      entry.code === 'ENTITY_RIGHTS_MATRIX_REFUSED' ||
      entry.code === 'FACT_RIGHTS_MATRIX_REFUSED',
    )).toBe(true);
    expect(sink.files.size, 'a refused matrix check must write no partial artifact').toBe(0);
  });
});
