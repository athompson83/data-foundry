/**
 * The declarative `csv_rows.where` row filter: generic record selection by one
 * column's exact value, applied before field extraction. It names no source
 * and no vertical.
 */
import { describe, expect, it } from 'vitest';
import {
  ExtractionError,
  ExtractionSchemaError,
  createExtractionRegistry,
  parseExtractionSchema,
} from '../src/index.js';
import { artifactFixture } from './fixtures.js';

const BODY = [
  'id,kind,name',
  '1,V,alpha',
  '2,E,bravo',
  '3, V ,charlie',
  '4,v,delta',
  '5,T,echo',
].join('\n');

const artifact = artifactFixture({
  id: '99999999-9999-4999-8999-999999999991',
  mime_type: 'text/csv',
  url: 'https://publisher.example/rows.csv',
  body: BODY,
  acquisition_route: 'BULK_FILE',
});

function schema(where: unknown, header: unknown = true) {
  return parseExtractionSchema({
    schema_id: 'filtered.csv',
    format: 'csv',
    entity_type: 'thing',
    record: { kind: 'csv_rows', header, trim: true, where },
    record_key: { fields: ['id'] },
    fields: [
      { field: 'id', required: true, locate: { kind: 'csv_column', column: 'id' } },
      { field: 'name', locate: { kind: 'csv_column', column: 'name' } },
    ],
  });
}

describe('csv_rows.where', () => {
  it('keeps only rows whose column value is exactly one of the listed values', async () => {
    const records = await createExtractionRegistry().extract(artifact, schema({ column: 'kind', in: ['V'] }));
    // Row 3 is ` V ` trimmed by the selector; row 4's lower-case `v` is not `V`.
    expect(records.map((record) => record.raw_payload['name'])).toEqual(['alpha', 'charlie']);
    // Provenance still points at the row's own physical line.
    expect(records.map((record) => record.locator)).toEqual([
      { type: 'LINE_RANGE', value: 'start=2;end=2' },
      { type: 'LINE_RANGE', value: 'start=4;end=4' },
    ]);
  });

  it('accepts several values and keeps file order', async () => {
    const records = await createExtractionRegistry().extract(artifact, schema({ column: 'kind', in: ['T', 'E'] }));
    expect(records.map((record) => record.raw_payload['name'])).toEqual(['bravo', 'echo']);
  });

  it('keeps ordinal-based fallback keys stable when rows are excluded', async () => {
    const body = ['id,kind,name', '1,E,bravo', ',V,nokey'].join('\n');
    const records = await createExtractionRegistry().extract(
      artifactFixture({
        id: '99999999-9999-4999-8999-999999999992',
        mime_type: 'text/csv',
        url: 'https://publisher.example/fallback.csv',
        body,
        acquisition_route: 'BULK_FILE',
      }),
      parseExtractionSchema({
        schema_id: 'fallback.csv',
        format: 'csv',
        entity_type: 'thing',
        record: { kind: 'csv_rows', header: true, where: { column: 'kind', in: ['V'] } },
        record_key: { fields: ['id'], fallback: 'ordinal' },
        fields: [
          { field: 'id', locate: { kind: 'csv_column', column: 'id' } },
          { field: 'name', locate: { kind: 'csv_column', column: 'name' } },
        ],
      }),
    );
    expect(records.map((record) => record.source_record_key)).toEqual(['fallback.csv#1']);
  });

  it('fails closed when the filter column is not in the header instead of passing rows through', async () => {
    await expect(
      createExtractionRegistry().extract(artifact, schema({ column: 'RCLTYPECD', in: ['V'] })),
    ).rejects.toThrow(ExtractionError);
  });

  it('works on a headerless file with declared column names', async () => {
    const headerless = artifactFixture({
      id: '99999999-9999-4999-8999-999999999993',
      mime_type: 'text/tab-separated-values',
      url: 'https://publisher.example/flat.txt',
      body: ['1\tV\talpha', '2\tC\tbravo'].join('\n'),
      acquisition_route: 'BULK_FILE',
    });
    const parsed = parseExtractionSchema({
      schema_id: 'flat.txt',
      format: 'csv',
      entity_type: 'thing',
      record: { kind: 'csv_rows', header: ['id', 'kind', 'name'], delimiter: '\t', where: { column: 'kind', in: ['V'] } },
      record_key: { fields: ['id'] },
      fields: [{ field: 'id', required: true, locate: { kind: 'csv_column', column: 'id' } }],
    });
    const records = await createExtractionRegistry().extract(headerless, parsed);
    expect(records.map((record) => record.source_record_key)).toEqual(['1']);
  });

  it.each([
    [{ column: 'kind' }],
    [{ column: 'kind', in: [] }],
    [{ column: '', in: ['V'] }],
    [{ column: 'kind', in: [1] }],
    [{ column: 'kind', in: ['V', 'V'] }],
    [{ column: 'kind', in: ['V'], not_in: ['E'] }],
    ['kind = V'],
  ])('refuses the malformed filter %j', (where) => {
    expect(() => schema(where)).toThrow(ExtractionSchemaError);
  });
});
