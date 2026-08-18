import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  extractionConfidence,
  sourceArtifactId,
  sourceId,
  type SourceArtifactId,
  type SourceId,
} from '@data-foundry/canonical-schema';
import { describe, expect, it } from 'vitest';
import { normalizeRecord, type SourceNativeRecord } from '../src/index.js';
import { HVAC_RULE_SET } from './fixtures.js';

/**
 * The extraction → normalization seam.
 *
 * Normalization deliberately does **not** import `@data-foundry/extraction`: a
 * source-native record may equally arrive from a Python extractor, a replay of
 * `source_records` out of Postgres, or a future provider nobody has written yet.
 * The contract is structural, so this file restates extraction's `ExtractedRecord`
 * verbatim and proves — at compile time and at runtime — that it satisfies
 * `SourceNativeRecord`. If extraction's shape drifts, this file stops compiling,
 * which is exactly the alarm we want.
 */
interface ExtractedRecordShape {
  readonly source_id: SourceId;
  readonly artifact_id: SourceArtifactId;
  readonly source_record_key: string;
  readonly entity_type: string;
  readonly values: readonly {
    readonly field: string;
    readonly raw: string | null;
    readonly locator: { readonly type: 'CSS_SELECTOR'; readonly value: string };
    readonly ambiguous: boolean;
    readonly match_count: number;
  }[];
  readonly raw_payload: Record<string, unknown>;
  readonly extraction_confidence: ReturnType<typeof extractionConfidence>;
  readonly extractor_version: string;
  readonly locator: { readonly type: 'CSS_SELECTOR'; readonly value: string };
  readonly issues: readonly unknown[];
  readonly ordinal: number;
}

const extractionOutput: ExtractedRecordShape = {
  source_id: sourceId('11111111-1111-4111-8111-111111111111'),
  artifact_id: sourceArtifactId('44444444-4444-4444-8444-444444444444'),
  source_record_key: '24ACC636A003',
  entity_type: 'equipment_model',
  values: [
    {
      field: 'model_number',
      raw: '24ACC6-36A003',
      locator: { type: 'CSS_SELECTOR', value: 'article > h1::attr(data-model)' },
      ambiguous: false,
      match_count: 1,
    },
    {
      field: 'cooling_capacity_btu',
      raw: '36,000 BTU/h',
      locator: { type: 'CSS_SELECTOR', value: 'article > table > tbody > tr:nth-of-type(1) > td' },
      ambiguous: false,
      match_count: 1,
    },
    {
      field: 'refrigerant',
      raw: 'R410A',
      locator: { type: 'CSS_SELECTOR', value: 'article > dl > dd:nth-of-type(1)' },
      ambiguous: false,
      match_count: 1,
    },
  ],
  raw_payload: {},
  extraction_confidence: extractionConfidence(0.93),
  extractor_version: 'html-extractor@1.0.0',
  locator: { type: 'CSS_SELECTOR', value: 'article' },
  issues: [],
  ordinal: 0,
};

describe('extraction output is a valid normalization input', () => {
  // Compile-time proof: no cast, no adapter, no shared package.
  const asSourceNative: SourceNativeRecord = extractionOutput;

  it('normalizes an extraction-shaped record end to end', () => {
    const result = normalizeRecord(asSourceNative, HVAC_RULE_SET);
    expect(result.failures).toEqual([]);
    expect(result.candidates.map((item) => [item.property, item.normalized_value])).toEqual([
      ['cooling_capacity_btu', 36_000],
      ['nominal_tonnage', 3],
      ['refrigerant', 'R-410A'],
    ]);
    expect(result.identifiers[0]).toMatchObject({
      alias_type: 'model_number',
      alias_value: '24ACC6-36A003',
      normalized_value: '24ACC636A003',
    });
  });

  it('carries extraction locators through to the canonical candidates', () => {
    const result = normalizeRecord(asSourceNative, HVAC_RULE_SET);
    for (const candidate of result.candidates) {
      expect(candidate.locator.type).toBe('CSS_SELECTOR');
      expect(candidate.locator.value.length).toBeGreaterThan(0);
    }
    expect(
      result.candidates.find((item) => item.property === 'cooling_capacity_btu')?.locator.value,
    ).toBe('article > table > tbody > tr:nth-of-type(1) > td');
  });

  it('carries the extraction confidence through unchanged', () => {
    const result = normalizeRecord(asSourceNative, HVAC_RULE_SET);
    for (const candidate of result.candidates) {
      expect(Number(candidate.extraction_confidence)).toBe(0.93);
    }
  });
});

/**
 * Architecture boundary, enforced mechanically.
 *
 * AGENTS.md: "Avoid imports that cross these boundaries in the wrong direction."
 * Normalization creates typed candidates; it must not reach into canonical
 * storage or entity resolution, and it must not do I/O.
 */
describe('architecture boundary', () => {
  const sourceDir = new URL('../src/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

  const sourceFiles = (): string[] =>
    readdirSync(sourceDir, { withFileTypes: true, recursive: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
      .map((entry) => join(entry.parentPath, entry.name));

  it('imports nothing but canonical-schema and its own modules', () => {
    const forbidden = [
      '@data-foundry/canonical-store',
      '@data-foundry/entity-resolution',
      '@data-foundry/acquisition',
      '@data-foundry/extraction',
      '@data-foundry/query-model',
      'node:fs',
      'node:http',
      'node:https',
    ];
    for (const file of sourceFiles()) {
      const contents = readFileSync(file, 'utf8');
      for (const specifier of forbidden) {
        expect(contents.includes(`from '${specifier}'`)).toBe(false);
      }
    }
  });

  /** Comments discuss the banned APIs by name; only executable code is scanned. */
  const stripComments = (source: string): string =>
    source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

  it('reads no clock, rolls no dice, and consults no locale', () => {
    for (const file of sourceFiles()) {
      const code = stripComments(readFileSync(file, 'utf8'));
      expect(code, `${file} must stay deterministic`).not.toMatch(
        /Date\.now\(|new Date\(|Math\.random\(|toLocale[A-Z]|Intl\./,
      );
    }
  });
});
