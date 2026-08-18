import { extractionConfidence, type ExtractionConfidence } from '@data-foundry/canonical-schema';
import type { ConfidencePolicy } from './schema.js';
import type { ExtractionSignals } from './types.js';

/**
 * `extraction_confidence` answers exactly one question: *did we read this value
 * off the artifact correctly?* (see `confidence.ts` in `canonical-schema`).
 *
 * It is therefore computed from signals extraction actually observed, and never
 * hard-coded. A hard-coded `1` is a lie that propagates: downstream validation
 * would treat a record with three missing required fields and an ambiguous table
 * match as being as trustworthy as a clean API payload.
 *
 * The four signals:
 *
 * 1. **required-field presence** — the dominant term. Missing a required field
 *    means the extractor did not find what the schema said must be there.
 * 2. **optional-field presence** — a weaker completeness signal.
 * 3. **parse failures** — a selector matched but the value could not be read
 *    (unknown CSV column, unusable attribute, regex that did not capture).
 * 4. **ambiguity** — a selector matched more than once, so which node the value
 *    came from was a coin flip resolved by policy.
 *
 * Missing a required field additionally *caps* the score, because coverage
 * arithmetic alone lets a 20-field schema hide a missing part number.
 */
export const DEFAULT_CONFIDENCE_POLICY: Required<ConfidencePolicy> = {
  required_weight: 0.8,
  optional_weight: 0.2,
  parse_failure_penalty: 0.25,
  ambiguity_penalty: 0.15,
  missing_required_ceiling: 0.5,
  floor: 0,
  ceiling: 1,
};

/** Deterministic rounding so golden records stay byte-stable across runs. */
const round4 = (value: number): number => Math.round(value * 10_000) / 10_000;

export function computeExtractionConfidence(
  signals: ExtractionSignals,
  policy: ConfidencePolicy = {},
): ExtractionConfidence {
  const resolved = { ...DEFAULT_CONFIDENCE_POLICY, ...policy };

  const requiredCoverage =
    signals.required_expected === 0 ? 1 : signals.required_present / signals.required_expected;
  const optionalCoverage =
    signals.optional_expected === 0 ? 1 : signals.optional_present / signals.optional_expected;

  const weightSum = resolved.required_weight + resolved.optional_weight;
  const base =
    weightSum === 0
      ? requiredCoverage
      : (resolved.required_weight * requiredCoverage + resolved.optional_weight * optionalCoverage) /
        weightSum;

  const attempted = Math.max(1, signals.fields_expected);
  const failurePenalty = resolved.parse_failure_penalty * (signals.parse_failures / attempted);
  const ambiguityPenalty = resolved.ambiguity_penalty * (signals.ambiguous_fields / attempted);

  let score = base - failurePenalty - ambiguityPenalty;

  if (signals.required_present < signals.required_expected) {
    score = Math.min(score, resolved.missing_required_ceiling);
  }

  score = Math.min(resolved.ceiling, Math.max(resolved.floor, score));
  return extractionConfidence(round4(score));
}
