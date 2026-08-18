import { rawScore } from '@data-foundry/canonical-schema';
import { describe, expect, it } from 'vitest';
import {
  CsvExtractor,
  ExtractionError,
  HtmlExtractor,
  JsonExtractor,
  PdfExtractor,
  isResolvableLocator,
  type ExtractedRecord,
  type ExtractionArtifact,
  type ExtractionProvider,
  type ExtractionSchema,
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

/**
 * The conformance suite: one set of assertions every extraction provider must
 * satisfy, run against all four.
 *
 * These are the invariants that make extraction safe to build on. If a fifth
 * provider is added and it cannot pass this file unchanged, it is not an
 * `ExtractionProvider` — it is a different abstraction wearing the interface.
 */

interface Case {
  readonly name: string;
  readonly provider: ExtractionProvider;
  readonly schema: ExtractionSchema;
  readonly artifact: () => Promise<ExtractionArtifact>;
  readonly expectedRecords: number;
  readonly requiredFields: readonly string[];
}

const CASES: readonly Case[] = [
  {
    name: 'JsonExtractor',
    provider: new JsonExtractor(),
    schema: JSON_SCHEMA,
    artifact: () => Promise.resolve(jsonArtifact()),
    expectedRecords: 2,
    requiredFields: ['model_number', 'cooling_capacity_btu'],
  },
  {
    name: 'CsvExtractor',
    provider: new CsvExtractor(),
    schema: CSV_SCHEMA,
    artifact: () => Promise.resolve(csvArtifact()),
    expectedRecords: 3,
    requiredFields: ['model_number', 'cooling_capacity_btu'],
  },
  {
    name: 'HtmlExtractor',
    provider: new HtmlExtractor(),
    schema: HTML_SCHEMA,
    artifact: () => Promise.resolve(htmlArtifact()),
    expectedRecords: 2,
    requiredFields: ['model_number', 'cooling_capacity_btu'],
  },
  {
    name: 'PdfExtractor',
    provider: new PdfExtractor(),
    schema: PDF_SCHEMA,
    artifact: pdfArtifact,
    expectedRecords: 2,
    requiredFields: ['model_number', 'cooling_capacity_btu'],
  },
];

const extractFor = async (testCase: Case): Promise<ExtractedRecord[]> =>
  testCase.provider.extract(await testCase.artifact(), testCase.schema);

describe.each(CASES)('ExtractionProvider conformance: $name', (testCase) => {
  it('declares the format its schema targets', () => {
    expect(testCase.provider.format).toBe(testCase.schema.format);
    expect(testCase.provider.supports(testCase.schema)).toBe(true);
    expect(testCase.provider.version).toMatch(/^[^@]+@\d+\.\d+\.\d+$/);
  });

  it('returns one record per record scope', async () => {
    const records = await extractFor(testCase);
    expect(records).toHaveLength(testCase.expectedRecords);
    records.forEach((record, index) => {
      expect(record.ordinal).toBe(index);
      expect(record.entity_type).toBe(testCase.schema.entity_type);
    });
  });

  // AGENTS.md rule 2: a value without a locator is evidence we cannot produce.
  it('gives every extracted value a resolvable locator', async () => {
    const records = await extractFor(testCase);
    expect(records.length).toBeGreaterThan(0);
    for (const record of records) {
      expect(isResolvableLocator(record.locator)).toBe(true);
      expect(record.values.length).toBe(testCase.schema.fields.length);
      for (const value of record.values) {
        expect(value.locator).toBeDefined();
        expect(value.locator.type).toBeTypeOf('string');
        expect(value.locator.type.length).toBeGreaterThan(0);
        expect(isResolvableLocator(value.locator)).toBe(true);
      }
    }
  });

  it('gives every issue a locator too', async () => {
    const records = await extractFor(testCase);
    for (const record of records) {
      for (const issue of record.issues) {
        expect(isResolvableLocator(issue.locator)).toBe(true);
        expect(issue.message.length).toBeGreaterThan(0);
      }
    }
  });

  it('carries a locator for every non-null value into the evidence projection', async () => {
    const records = await extractFor(testCase);
    for (const record of records) {
      const populated = record.values.filter((value) => value.raw !== null);
      expect(populated.length).toBeGreaterThan(0);
      for (const value of populated) {
        expect(value.locator.type).not.toBe(undefined);
      }
    }
  });

  it('produces source-native records only: no canonical entity fields', async () => {
    const records = await extractFor(testCase);
    for (const record of records) {
      const asRecord = record as unknown as Record<string, unknown>;
      for (const forbidden of ['entity_id', 'canonical_name', 'canonical_slug', 'identity_confidence']) {
        expect(asRecord[forbidden]).toBeUndefined();
      }
      // Raw payload keys are the schema's source-native field names, nothing else.
      expect(Object.keys(record.raw_payload).sort()).toEqual(
        testCase.schema.fields.map((field) => field.field).sort(),
      );
    }
  });

  it('computes extraction_confidence from signals rather than hard-coding it', async () => {
    const records = await extractFor(testCase);
    for (const record of records) {
      const score = rawScore(record.extraction_confidence);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);
      expect(record.signals.fields_expected).toBe(testCase.schema.fields.length);
      expect(record.signals.required_expected).toBe(testCase.requiredFields.length);
    }
    // Records with different signal profiles must not share a score.
    const distinctSignals = new Set(records.map((record) => JSON.stringify(record.signals)));
    const distinctScores = new Set(records.map((record) => rawScore(record.extraction_confidence)));
    expect(distinctScores.size).toBe(distinctSignals.size);
  });

  it('is deterministic: identical input yields identical output', async () => {
    const first = await extractFor(testCase);
    const second = await extractFor(testCase);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it('refuses schemas for other formats', async () => {
    const foreign = CASES.find((candidate) => candidate.schema.format !== testCase.schema.format);
    expect(foreign).toBeDefined();
    if (foreign === undefined) return;
    expect(testCase.provider.supports(foreign.schema)).toBe(false);
    const artifact = await testCase.artifact();
    await expect(async () => testCase.provider.extract(artifact, foreign.schema)).rejects.toThrow(
      ExtractionError,
    );
  });
});
