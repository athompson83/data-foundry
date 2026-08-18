import { rawScore } from '@data-foundry/canonical-schema';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CONFIDENCE_POLICY,
  computeExtractionConfidence,
  type ExtractionSignals,
} from '../src/index.js';

const signals = (overrides: Partial<ExtractionSignals> = {}): ExtractionSignals => ({
  fields_expected: 10,
  required_expected: 2,
  required_present: 2,
  optional_expected: 8,
  optional_present: 8,
  parse_failures: 0,
  ambiguous_fields: 0,
  ...overrides,
});

const score = (overrides: Partial<ExtractionSignals> = {}): number =>
  rawScore(computeExtractionConfidence(signals(overrides)));

describe('computeExtractionConfidence', () => {
  it('is driven by real signals, not a constant', () => {
    const perfect = score();
    const missingOptional = score({ optional_present: 4 });
    const ambiguous = score({ ambiguous_fields: 3 });
    const failing = score({ parse_failures: 3 });

    expect(new Set([perfect, missingOptional, ambiguous, failing]).size).toBe(4);
    expect(missingOptional).toBeLessThan(perfect);
    expect(ambiguous).toBeLessThan(perfect);
    expect(failing).toBeLessThan(perfect);
  });

  it('caps a record that is missing a required field', () => {
    const missingRequired = score({ required_present: 1 });
    expect(missingRequired).toBeLessThanOrEqual(DEFAULT_CONFIDENCE_POLICY.missing_required_ceiling);

    // Coverage arithmetic alone would hide one missing part number in a wide
    // schema; the cap is what stops that.
    const wideSchema = score({
      fields_expected: 40,
      required_expected: 2,
      required_present: 1,
      optional_expected: 38,
      optional_present: 38,
    });
    expect(wideSchema).toBeLessThanOrEqual(0.5);
  });

  it('penalises parse failures more heavily than ambiguity', () => {
    expect(score({ parse_failures: 2 })).toBeLessThan(score({ ambiguous_fields: 2 }));
  });

  it('stays inside the unit interval under pathological signals', () => {
    expect(
      score({ parse_failures: 100, ambiguous_fields: 100, optional_present: 0, required_present: 0 }),
    ).toBe(0);
    expect(
      rawScore(
        computeExtractionConfidence(signals(), { required_weight: 5, optional_weight: 5 }),
      ),
    ).toBe(1);
  });

  it('treats a schema with no required fields as fully covered on that axis', () => {
    expect(score({ required_expected: 0, required_present: 0, optional_expected: 0, optional_present: 0 })).toBe(1);
  });

  it('honours a vertical-supplied confidence policy', () => {
    const strict = rawScore(
      computeExtractionConfidence(signals({ ambiguous_fields: 1 }), {
        ambiguity_penalty: 0.9,
        ceiling: 0.95,
      }),
    );
    expect(strict).toBeLessThan(0.95);
  });

  it('rounds deterministically so golden records stay stable', () => {
    const first = computeExtractionConfidence(signals({ optional_present: 7 }));
    const second = computeExtractionConfidence(signals({ optional_present: 7 }));
    expect(rawScore(first)).toBe(rawScore(second));
    expect(String(rawScore(first)).split('.')[1]?.length ?? 0).toBeLessThanOrEqual(4);
  });
});
