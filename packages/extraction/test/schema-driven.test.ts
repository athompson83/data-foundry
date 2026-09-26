import { describe, expect, it } from 'vitest';
import {
  ExtractionError,
  ExtractionSchemaError,
  createExtractionRegistry,
  parseExtractionSchema,
  type ExtractionSchema,
} from '../src/index.js';
import { CSV_SCHEMA, HTML_SCHEMA, JSON_SCHEMA, PDF_SCHEMA, artifactFixture, csvArtifact } from './fixtures.js';

/**
 * Rule 4 in practice: onboarding a *new source* of an already-supported format
 * must be a config change and nothing else. These tests add a second CSV source
 * with a different delimiter, different header names and different key fields —
 * and not one line of TypeScript.
 */
describe('schema-driven onboarding', () => {
  const SECOND_SOURCE_CSV = [
    'part_no|brand|btu|efficiency',
    '38MURA36|Bryant|36000|15.2',
    '38MURA48|Bryant|48000|14.8',
  ].join('\n');

  const SECOND_SOURCE_SCHEMA: ExtractionSchema = parseExtractionSchema({
    schema_id: 'bryant.parts.csv',
    format: 'csv',
    entity_type: 'equipment_model',
    record: { kind: 'csv_rows', header: true, delimiter: '|' },
    record_key: { fields: ['manufacturer_sku', 'model_number'], separator: '::' },
    fields: [
      { field: 'model_number', required: true, locate: { kind: 'csv_column', column: 'part_no' } },
      { field: 'manufacturer_sku', required: true, locate: { kind: 'csv_column', column: 'brand' } },
      { field: 'cooling_capacity_btu', locate: { kind: 'csv_column', column: 'btu' } },
      { field: 'seer2', locate: { kind: 'csv_column', column: 'efficiency' } },
    ],
  });

  it('extracts a brand new source with config alone', async () => {
    const registry = createExtractionRegistry();
    const artifact = artifactFixture({
      id: '66666666-6666-4666-8666-666666666666',
      mime_type: 'text/csv',
      url: 'https://bryant.example/parts.psv',
      body: SECOND_SOURCE_CSV,
      acquisition_route: 'BULK_FILE',
    });

    const records = await registry.extract(artifact, SECOND_SOURCE_SCHEMA);
    expect(records.map((record) => record.source_record_key)).toEqual([
      'Bryant::38MURA36',
      'Bryant::38MURA48',
    ]);
    expect(records[0]?.raw_payload['cooling_capacity_btu']).toBe('36000');
  });

  it('honours record_key.fallback across every provider', async () => {
    const registry = createExtractionRegistry();
    const body = ['Model,BTU', '24ACC636A003,36000', ',48000'].join('\n');
    const artifact = artifactFixture({
      id: '88888888-8888-4888-8888-888888888888',
      mime_type: 'text/csv',
      url: 'https://acme-hvac.example/partial.csv',
      body,
      acquisition_route: 'BULK_FILE',
    });

    const base = {
      format: 'csv',
      entity_type: 'equipment_model',
      record: { kind: 'csv_rows', header: true },
      fields: [
        { field: 'model_number', required: true, locate: { kind: 'csv_column', column: 'Model' } },
        { field: 'cooling_capacity_btu', locate: { kind: 'csv_column', column: 'BTU' } },
      ],
    };

    // Default `ordinal`: the keyless row survives with a synthetic key and a
    // RECORD_KEY_INCOMPLETE issue.
    const kept = await registry.extract(
      artifact,
      parseExtractionSchema({ ...base, schema_id: 'keep.csv', record_key: { fields: ['model_number'] } }),
    );
    expect(kept).toHaveLength(2);
    expect(kept[1]?.source_record_key).toBe('keep.csv#1');

    // `fail`: one keyless scope invalidates the whole extraction. Returning
    // the valid neighbor alone would let a full snapshot reinterpret the bad
    // row as an authoritative deletion.
    await expect(registry.extract(
      artifact,
      parseExtractionSchema({
        ...base,
        schema_id: 'drop.csv',
        record_key: { fields: ['model_number'], fallback: 'fail' },
      }),
    )).rejects.toThrow(/record key.*incomplete|incomplete.*record key/i);
  });

  it('supports positional columns for headerless files', async () => {
    const headerless = parseExtractionSchema({
      schema_id: 'legacy.headerless.csv',
      format: 'csv',
      entity_type: 'equipment_model',
      record: { kind: 'csv_rows', header: false },
      record_key: { fields: ['model_number'] },
      fields: [
        { field: 'model_number', required: true, locate: { kind: 'csv_index', index: 0 } },
        { field: 'cooling_capacity_btu', locate: { kind: 'csv_index', index: 2 } },
      ],
    });

    const artifact = artifactFixture({
      id: '77777777-7777-4777-8777-777777777777',
      mime_type: 'text/csv',
      url: 'https://legacy.example/dump.csv',
      body: '24ACC636A003,Infinity 16,36000\n',
      acquisition_route: 'BULK_FILE',
    });

    const records = await createExtractionRegistry().extract(artifact, headerless);
    expect(records[0]?.raw_payload).toEqual({
      model_number: '24ACC636A003',
      cooling_capacity_btu: '36000',
    });
  });

  it('composes one value from several columns, all-or-nothing, citing every cell', async () => {
    // A publisher that spells one identity across columns (make, model, year).
    const composite = parseExtractionSchema({
      schema_id: 'vehicles.composite.csv',
      format: 'csv',
      entity_type: 'vehicle_model_year',
      record: { kind: 'csv_rows', header: ['id', 'make', 'model', 'year'], delimiter: '\t' },
      record_key: { fields: ['row_id'] },
      fields: [
        { field: 'row_id', required: true, locate: { kind: 'csv_column', column: 'id' } },
        {
          field: 'make_model_year',
          locate: { kind: 'csv_columns', columns: ['make', 'model', 'year'], separator: ' ' },
        },
      ],
    });
    const artifact = artifactFixture({
      id: '88888888-8888-4888-8888-888888888888',
      mime_type: 'text/csv',
      url: 'https://synthetic.example/flat.txt',
      body: '1\tExamplar Motors\t Roadster \t2020\n2\tExamplar Motors\t\t2021\n',
      acquisition_route: 'BULK_FILE',
    });

    const records = await createExtractionRegistry().extract(artifact, composite);
    expect(records.map((record) => record.raw_payload['make_model_year'])).toEqual([
      'Examplar Motors Roadster 2020',
      // A missing part is absence, never the partial key `Examplar Motors 2021`.
      null,
    ]);
    const cited = records[0]?.values.find((value) => value.field === 'make_model_year')?.locator;
    expect(cited).toEqual({ type: 'TABLE_CELL', value: 'row=1;columns=make,model,year;indexes=1,2,3' });
  });

  it('rejects a composite selector with fewer than two columns', () => {
    expect(() =>
      parseExtractionSchema({
        schema_id: 'bad.composite',
        format: 'csv',
        entity_type: 'vehicle_model_year',
        record: { kind: 'csv_rows' },
        record_key: { fields: ['key'] },
        fields: [{ field: 'key', locate: { kind: 'csv_columns', columns: ['make'], separator: ' ' } }],
      }),
    ).toThrow(ExtractionSchemaError);
  });
});

describe('parseExtractionSchema', () => {
  it('accepts the four shipped schemas', () => {
    for (const schema of [JSON_SCHEMA, CSV_SCHEMA, HTML_SCHEMA, PDF_SCHEMA]) {
      expect(() => parseExtractionSchema(schema)).not.toThrow();
    }
  });

  it('rejects a selector that does not belong to the declared format', () => {
    expect(() =>
      parseExtractionSchema({
        schema_id: 'bad.mix',
        format: 'json',
        entity_type: 'equipment_model',
        record: { kind: 'css', selector: '.product' },
        record_key: { fields: ['model_number'] },
        fields: [{ field: 'model_number', locate: { kind: 'json_pointer', pointer: '/m' } }],
      }),
    ).toThrow(ExtractionSchemaError);

    expect(() =>
      parseExtractionSchema({
        schema_id: 'bad.field',
        format: 'json',
        entity_type: 'equipment_model',
        record: { kind: 'whole_document' },
        record_key: { fields: ['model_number'] },
        fields: [{ field: 'model_number', locate: { kind: 'css', selector: 'h1' } }],
      }),
    ).toThrow(/not valid for format json/);
  });

  it('rejects a record key that references an undeclared field', () => {
    expect(() =>
      parseExtractionSchema({
        schema_id: 'bad.key',
        format: 'json',
        entity_type: 'equipment_model',
        record: { kind: 'whole_document' },
        record_key: { fields: ['serial_number'] },
        fields: [{ field: 'model_number', locate: { kind: 'json_pointer', pointer: '/m' } }],
      }),
    ).toThrow(/record_key field serial_number is not declared/);
  });

  it('rejects non-identifier field names and duplicates', () => {
    expect(() =>
      parseExtractionSchema({
        schema_id: 'bad.name',
        format: 'json',
        entity_type: 'equipment_model',
        record: { kind: 'whole_document' },
        record_key: { fields: ['modelNumber'] },
        fields: [{ field: 'modelNumber', locate: { kind: 'json_pointer', pointer: '/m' } }],
      }),
    ).toThrow(/lowercase snake_case/);
  });
});

describe('ExtractionProviderRegistry', () => {
  it('resolves a provider by format, not by name', () => {
    const registry = createExtractionRegistry();
    expect(registry.resolve(JSON_SCHEMA).name).toBe('json-extractor');
    expect(registry.resolve(CSV_SCHEMA).name).toBe('csv-extractor');
    expect(registry.resolve(HTML_SCHEMA).name).toBe('html-extractor');
    expect(registry.resolve(PDF_SCHEMA).name).toBe('pdf-extractor');
  });

  it('lets a later registration override an earlier one for the same format', async () => {
    const registry = createExtractionRegistry();
    registry.register({
      name: 'browser-run-html',
      format: 'html',
      version: 'browser-run-html@0.1.0',
      supports: (schema) => schema.format === 'html',
      extract: () => Promise.resolve([]),
    });
    expect(registry.resolve(HTML_SCHEMA).name).toBe('browser-run-html');
    expect(await registry.extract(csvArtifact(), CSV_SCHEMA)).toHaveLength(3);
  });

  it('fails loudly when no provider handles a format', () => {
    const registry = createExtractionRegistry([]);
    expect(() => registry.resolve(JSON_SCHEMA)).toThrow(ExtractionError);
  });
});
