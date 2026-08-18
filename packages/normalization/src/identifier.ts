import { fail, ok, type Normalized } from './failures.js';
import { normalizePunctuation, normalizeUnicode } from './text.js';

/**
 * Identifier normalization — the rule-7 hot path.
 *
 * AGENTS.md rule 7: *"Exact identifiers beat semantic search. Never replace
 * deterministic matching with vector similarity."* That rule is only enforceable
 * if "exact" survives the way real sources write identifiers. The same air
 * conditioner appears as `24ACC636A003`, `24acc6-36a003` and `24ACC6 36A003`
 * across a manufacturer page, a distributor feed and a submittal PDF. Those are
 * one identifier written three ways, and matching them must be deterministic,
 * cheap and testable — not a similarity score.
 *
 * The contract, in two halves:
 *
 * - `normalized` — punctuation, spacing and case removed, for **matching only**.
 * - `display`   — the original string, byte for byte, **always** preserved.
 *
 * Losing the display form is not a cosmetic bug. `entity_aliases.alias_value`
 * feeds page titles, search results and exports; a catalogue that renders
 * `24ACC636A003` as `24acc636a003` looks broken to exactly the professional
 * audience it is for.
 */

export const IDENTIFIER_KEEP_MODES = ['alphanumeric', 'digits', 'letters'] as const;
export type IdentifierKeepMode = (typeof IDENTIFIER_KEEP_MODES)[number];

export const IDENTIFIER_CASE_MODES = ['upper', 'lower', 'preserve'] as const;
export type IdentifierCaseMode = (typeof IDENTIFIER_CASE_MODES)[number];

export interface IdentifierNormalizationOptions {
  /** Which character classes survive into the matching form. Default `alphanumeric`. */
  readonly keep?: IdentifierKeepMode;
  /** Case folding for the matching form. Default `upper`. */
  readonly case?: IdentifierCaseMode;
  /** Drop leading zeros — correct for numeric references, wrong for UPCs. */
  readonly strip_leading_zeros?: boolean;
  /** Left-pad to a fixed width (UPC-A is 12 digits, GTIN-14 is 14). */
  readonly pad_to?: number;
  readonly pad_char?: string;
  readonly max_length?: number;
}

export interface NormalizedIdentifier {
  /** The input, unchanged. This is what humans and exports see. */
  readonly display: string;
  /** The matching form. This is what entity resolution compares. */
  readonly normalized: string;
  /** True when nothing survived normalization (`"N/A"`, `"-"`, `"..."`). */
  readonly empty: boolean;
}

const KEEP_PATTERNS: Readonly<Record<IdentifierKeepMode, RegExp>> = {
  alphanumeric: /[^0-9A-Za-z]/g,
  digits: /[^0-9]/g,
  letters: /[^A-Za-z]/g,
};

/**
 * Produces the matching form while preserving the display form.
 *
 * Order matters: NFKC first (so full-width and ligature forms collapse), then
 * typographic punctuation → ASCII (so a non-breaking hyphen from a PDF becomes a
 * plain one), then class filtering, then case folding.
 */
export function normalizeIdentifier(
  value: string,
  options: IdentifierNormalizationOptions = {},
): NormalizedIdentifier {
  const keep = options.keep ?? 'alphanumeric';
  const caseMode = options.case ?? 'upper';

  let normalized = normalizePunctuation(normalizeUnicode(value)).replace(KEEP_PATTERNS[keep], '');

  if (caseMode === 'upper') normalized = normalized.toUpperCase();
  else if (caseMode === 'lower') normalized = normalized.toLowerCase();

  if (options.strip_leading_zeros === true && normalized.length > 0) {
    const stripped = normalized.replace(/^0+/, '');
    // All-zero identifiers keep a single zero rather than vanishing.
    normalized = stripped === '' ? '0' : stripped;
  }

  if (options.pad_to !== undefined && normalized.length > 0 && normalized.length < options.pad_to) {
    normalized = normalized.padStart(options.pad_to, options.pad_char ?? '0');
  }

  if (options.max_length !== undefined) normalized = normalized.slice(0, options.max_length);

  return { display: value, normalized, empty: normalized.length === 0 };
}

/**
 * The equivalence-class key. Two identifiers belong to the same class iff this
 * returns the same string for both.
 */
export const identifierEquivalenceKey = (
  value: string,
  options: IdentifierNormalizationOptions = {},
): string => normalizeIdentifier(value, options).normalized;

/**
 * First-class, deterministic identifier equality.
 *
 * Entity resolution's step 1 ("strong identifier exact match", doc 06) is this
 * predicate and nothing more. Empty-vs-empty is deliberately `false`: two values
 * that both normalized away to nothing are not evidence of anything, and
 * returning `true` there would merge every record whose part number was `"N/A"`.
 */
export function identifiersMatch(
  left: string,
  right: string,
  options: IdentifierNormalizationOptions = {},
): boolean {
  const a = normalizeIdentifier(left, options);
  const b = normalizeIdentifier(right, options);
  if (a.empty || b.empty) return false;
  return a.normalized === b.normalized;
}

/**
 * Per-alias-type profiles for the shared HVAC vocabulary.
 *
 * These are defaults, not a hardcoded platform enum — a vertical's rule set may
 * override `options` per identifier rule (AGENTS.md rule 4).
 */
export const IDENTIFIER_PROFILES: Readonly<Record<string, IdentifierNormalizationOptions>> = {
  /** `24ACC6-36A003` / `24acc6 36a003` → `24ACC636A003`. */
  model_number: { keep: 'alphanumeric', case: 'upper' },
  /** AHRI certified reference numbers are numeric; leading zeros are formatting. */
  ahri_ref: { keep: 'digits', strip_leading_zeros: true },
  manufacturer_sku: { keep: 'alphanumeric', case: 'upper' },
  /** UPC-A is exactly 12 digits; a feed that drops the leading zero still matches. */
  upc: { keep: 'digits', pad_to: 12 },
  series_name: { keep: 'alphanumeric', case: 'upper' },
};

export const identifierProfile = (aliasType: string): IdentifierNormalizationOptions =>
  IDENTIFIER_PROFILES[aliasType] ?? { keep: 'alphanumeric', case: 'upper' };

/** Normalizes for an alias type, failing when nothing usable survives. */
export function normalizeIdentifierForAlias(
  aliasType: string,
  value: string,
  overrides?: IdentifierNormalizationOptions,
): Normalized<NormalizedIdentifier> {
  const options = { ...identifierProfile(aliasType), ...(overrides ?? {}) };
  const result = normalizeIdentifier(value, options);
  if (result.empty) {
    return fail(
      'IDENTIFIER_EMPTY_AFTER_NORMALIZATION',
      `${JSON.stringify(value)} contains no ${options.keep ?? 'alphanumeric'} characters and cannot serve as a ${aliasType}`,
    );
  }
  return ok(result);
}
