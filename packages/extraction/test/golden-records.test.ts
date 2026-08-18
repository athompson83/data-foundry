import { rawScore } from '@data-foundry/canonical-schema';
import { describe, expect, it } from 'vitest';
import {
  CsvExtractor,
  HtmlExtractor,
  JsonExtractor,
  PdfExtractor,
  parseLocatorValue,
  toAllExtractedEvidence,
  toSourceRecordInsert,
  type ExtractedRecord,
} from '../src/index.js';
import {
  CSV_SCHEMA,
  HTML_SCHEMA,
  JSON_SCHEMA,
  PDF_SCHEMA,
  csvArtifact,
  htmlArtifact,
  jsonArtifact,
  pdfArtifact,
} from './fixtures.js';

const rawOf = (record: ExtractedRecord, field: string): string | null =>
  record.values.find((value) => value.field === field)?.raw ?? null;

const locatorOf = (record: ExtractedRecord, field: string): { type: string; value: string } => {
  const value = record.values.find((candidate) => candidate.field === field);
  if (value === undefined) throw new Error(`no value for field ${field}`);
  return value.locator;
};

describe('JsonExtractor golden record', () => {
  it('reads an API feed into source-native records addressed by JSON pointer', async () => {
    const records = await new JsonExtractor().extract(jsonArtifact(), JSON_SCHEMA);

    expect(records.map((record) => record.source_record_key)).toEqual([
      '24ACC636A003',
      '24ACC648A003',
    ]);

    const [first, second] = records;
    if (first === undefined || second === undefined) throw new Error('expected two records');

    expect(first.locator).toEqual({ type: 'JSON_POINTER', value: '/data/models/0' });
    expect(second.locator).toEqual({ type: 'JSON_POINTER', value: '/data/models/1' });

    expect(first.raw_payload).toEqual({
      model_number: '24ACC636A003',
      series_name: 'Infinity 16',
      product_type: 'air_conditioner',
      cooling_capacity_btu: '36000',
      seer2: '15.2',
      eer2: '12.5',
      refrigerant: 'R-410A',
      sound_level_db: '72',
      stage_count: '1',
      voltage: '208/230',
      phase: '1',
      weight_lb: '189.5',
      ahri_ref: '202584720',
    });

    expect(locatorOf(first, 'seer2')).toEqual({
      type: 'JSON_POINTER',
      value: '/data/models/0/specs/seer2',
    });
    expect(locatorOf(first, 'ahri_ref')).toEqual({
      type: 'JSON_POINTER',
      value: '/data/models/0/certifications/0/reference',
    });

    // `hspf2: null` in the feed is a JSON null, not a value — the field is not
    // declared, and declared-but-null values are reported as absent, never "".
    expect(rawOf(second, 'eer2')).toBeNull();
    expect(rawOf(second, 'sound_level_db')).toBeNull();

    // The second model carries two AHRI references: a real ambiguity, flagged.
    const ahri = second.values.find((value) => value.field === 'ahri_ref');
    expect(ahri?.match_count).toBe(2);
    expect(ahri?.ambiguous).toBe(true);
    expect(ahri?.raw).toBe('202584721');
    expect(second.issues.map((issue) => issue.code)).toContain('AMBIGUOUS_MATCH');

    // Complete + unambiguous scores higher than incomplete + ambiguous.
    expect(rawScore(first.extraction_confidence)).toBe(1);
    expect(rawScore(second.extraction_confidence)).toBe(0.9157);
  });

  it('projects onto the source_records insert shape without a normalized payload', async () => {
    const [record] = await new JsonExtractor().extract(jsonArtifact(), JSON_SCHEMA);
    if (record === undefined) throw new Error('expected a record');
    const insert = toSourceRecordInsert(record);
    expect(insert.normalized_payload).toBeNull();
    expect(insert.entity_type).toBe('equipment_model');
    expect(insert.source_record_key).toBe('24ACC636A003');
    expect(insert.extractor_version).toBe('json-extractor@1.0.0');
  });
});

describe('CsvExtractor golden record', () => {
  it('maps headers to fields and addresses values by row and column', async () => {
    const records = await new CsvExtractor().extract(csvArtifact(), CSV_SCHEMA);
    expect(records).toHaveLength(3);

    const [first, , third] = records;
    if (first === undefined || third === undefined) throw new Error('expected three records');

    expect(first.source_record_key).toBe('24ACC636A003');
    expect(first.locator).toEqual({ type: 'LINE_RANGE', value: 'start=2;end=2' });

    // The quoted "36,000" survives extraction untouched: stripping the comma is
    // normalization's job, and doing it here would destroy the source value.
    expect(rawOf(first, 'cooling_capacity_btu')).toBe('36,000');

    const capacityLocator = locatorOf(first, 'cooling_capacity_btu');
    expect(capacityLocator.type).toBe('TABLE_CELL');
    expect(parseLocatorValue(capacityLocator.value)).toEqual({
      row: '2',
      column: 'Cooling Capacity (BTU/h)',
      index: '2',
    });

    // A column the config names but the file does not have is a reported
    // failure, not a silent null.
    expect(rawOf(first, 'ahri_ref')).toBeNull();
    expect(first.issues.map((issue) => issue.code)).toContain('UNKNOWN_COLUMN');
    expect(first.signals.parse_failures).toBe(1);

    // Third row has no model number: required field missing, key falls back.
    expect(third.source_record_key).toBe('acme-hvac.models.csv#2');
    expect(third.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['UNKNOWN_COLUMN', 'REQUIRED_FIELD_MISSING', 'RECORD_KEY_INCOMPLETE']),
    );
    expect(rawScore(third.extraction_confidence)).toBeLessThanOrEqual(0.5);
  });
});

describe('HtmlExtractor golden record', () => {
  it('reads spec tables and definition lists with unique CSS-path locators', async () => {
    const records = await new HtmlExtractor().extract(htmlArtifact(), HTML_SCHEMA);
    expect(records.map((record) => record.source_record_key)).toEqual([
      '24ACC636A003',
      '24ACC648A003',
    ]);

    const [first, second] = records;
    if (first === undefined || second === undefined) throw new Error('expected two records');

    expect(first.raw_payload).toEqual({
      model_number: '24ACC636A003',
      cooling_capacity_btu: '36,000 BTU/h',
      seer2: '15.2',
      sound_level_db: '72 dB',
      weight_lb: '189.5 lb',
      refrigerant: 'R-410A',
      voltage: '208/230 V',
      series_name: 'Infinity 16',
    });

    // Units are carried through verbatim; extraction never strips them.
    expect(rawOf(first, 'cooling_capacity_btu')).toContain('BTU/h');
    expect(rawOf(first, 'sound_level_db')).toContain('dB');

    expect(first.locator).toEqual({
      type: 'CSS_SELECTOR',
      value: 'html > body > main > article:nth-of-type(1)',
    });
    expect(locatorOf(first, 'model_number')).toEqual({
      type: 'CSS_SELECTOR',
      value: 'html > body > main > article:nth-of-type(1) > h1::attr(data-model)',
    });
    expect(locatorOf(first, 'cooling_capacity_btu')).toEqual({
      type: 'CSS_SELECTOR',
      value:
        'html > body > main > article:nth-of-type(1) > table > tbody > tr:nth-of-type(1) > td',
    });
    expect(locatorOf(first, 'refrigerant')).toEqual({
      type: 'CSS_SELECTOR',
      value: 'html > body > main > article:nth-of-type(1) > dl > dd:nth-of-type(1)',
    });

    // The locator identifies one node, not the whole table the selector matched.
    expect(locatorOf(second, 'cooling_capacity_btu').value).toContain('article:nth-of-type(2)');
    expect(rawOf(second, 'sound_level_db')).toBeNull();
    expect(rawOf(second, 'voltage')).toBeNull();
  });
});

describe('PdfExtractor golden record', () => {
  it('reads the text layer with page-level locators and never invokes OCR', async () => {
    const records = await new PdfExtractor().extract(await pdfArtifact(), PDF_SCHEMA);
    expect(records.map((record) => record.source_record_key)).toEqual([
      '24ACC636A003',
      '24ACC648A003',
    ]);

    const [first, second] = records;
    if (first === undefined || second === undefined) throw new Error('expected two records');

    expect(first.locator).toEqual({ type: 'PAGE', value: 'page=1' });
    expect(second.locator).toEqual({ type: 'PAGE', value: 'page=2' });

    expect(first.raw_payload).toEqual({
      model_number: '24ACC636A003',
      cooling_capacity_btu: '36,000 BTU/h',
      seer2: '15.2',
      refrigerant: 'R-410A',
      ahri_ref: '202584720',
      nominal_tonnage: null,
    });

    const capacityLocator = locatorOf(first, 'cooling_capacity_btu');
    expect(capacityLocator.type).toBe('PAGE');
    expect(parseLocatorValue(capacityLocator.value)).toEqual({ page: '1', line: '3' });

    expect(parseLocatorValue(locatorOf(second, 'model_number').value)).toEqual({
      page: '2',
      line: '2',
    });

    // No text layer would mean an issue and a low score, never an OCR fallback.
    expect(first.issues.some((issue) => issue.code === 'EMPTY_TEXT_LAYER')).toBe(false);
  });

  it('reports a scanned page as an empty text layer rather than guessing', async () => {
    const artifact = await pdfArtifact();
    const blank = await import('./fixtures.js').then((module) => module.buildPdfBytes([[]]));
    const records = await new PdfExtractor().extract(
      { artifact: artifact.artifact, body: blank },
      PDF_SCHEMA,
    );
    const [record] = records;
    if (record === undefined) throw new Error('expected a record');
    expect(record.issues.map((issue) => issue.code)).toContain('EMPTY_TEXT_LAYER');
    expect(rawScore(record.extraction_confidence)).toBeLessThanOrEqual(0.5);
  });
});

describe('evidence projection', () => {
  it('produces a locator pair for every populated value across every provider', async () => {
    const results = [
      await new JsonExtractor().extract(jsonArtifact(), JSON_SCHEMA),
      await new CsvExtractor().extract(csvArtifact(), CSV_SCHEMA),
      await new HtmlExtractor().extract(htmlArtifact(), HTML_SCHEMA),
      await new PdfExtractor().extract(await pdfArtifact(), PDF_SCHEMA),
    ];

    for (const records of results) {
      for (const record of records) {
        const evidence = toAllExtractedEvidence(record);
        expect(evidence.length).toBe(record.values.filter((value) => value.raw !== null).length);
        for (const item of evidence) {
          expect(item.source_value.length).toBeGreaterThan(0);
          expect(item.locator_type.length).toBeGreaterThan(0);
        }
      }
    }
  });
});
