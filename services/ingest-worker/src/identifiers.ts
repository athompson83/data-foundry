/**
 * Alias normalization, driven by the vertical's declared op chain.
 *
 * AGENTS.md rule 7 is only enforceable if "exact" survives the way real sources
 * write identifiers, and the *shape* of that survival is a vertical decision:
 * `normalizers/03-domain-normalization.yaml` states, per alias type, exactly
 * which ops run and in which order. This module executes that declaration using
 * the primitives `@data-foundry/normalization` exports, so the vertical's YAML
 * is the specification and this file is only its interpreter.
 *
 * Why not `normalizeIdentifier()` alone: its `IdentifierNormalizationOptions`
 * can express "keep alphanumerics, upper-case, pad, strip leading zeros" — which
 * covers `model_number`, `ahri_ref` and `upc` — but has no separator-preserving
 * keep mode and no title case, so it cannot express this vertical's declared
 * rules for `manufacturer_sku` (hyphens are structural and must be retained) or
 * `series_name` (title case with spaces). Silently normalizing those the other
 * way would change published join keys and display values. The package's
 * `identifiersMatch()` is still used as the match predicate corroboration in
 * `resolution.ts`, so the deterministic-matching claim is checked twice.
 */
import { applyCase, collapseWhitespace, normalizeUnicode, stripCharacters } from '@data-foundry/normalization';
import type { VerticalConfig } from './config.js';
import { PipelineConfigurationError } from './errors.js';

/** One declared op from the vertical rule, e.g. `{ op: strip_characters, characters: ... }`. */
type Yaml = any;

export interface AliasNormalizationRule {
  readonly aliasType: string;
  readonly strong: boolean;
  readonly ops: readonly Yaml[];
  readonly validate: Yaml | null;
}

/**
 * Default chain for alias types the vertical does not give explicit ops for —
 * the platform's `CORE_ALIAS_TYPES` (`legal_name`, `name`, `abbreviation`, …),
 * which are names rather than part numbers. Case-folding and whitespace
 * collapsing is the whole of it: stripping separators would make
 * "Acme Climate Systems" and "AcmeClimateSystems" the same string, and the
 * publisher table is what resolves company identity here, not the alias key.
 */
const DEFAULT_NAME_OPS: readonly Yaml[] = [{ op: 'collapse_whitespace' }, { op: 'uppercase' }];

export class AliasNormalizer {
  readonly #rules: ReadonlyMap<string, AliasNormalizationRule>;

  constructor(config: VerticalConfig) {
    const rules = new Map<string, AliasNormalizationRule>();
    for (const rule of config.domainNormalization?.identifier_rules ?? []) {
      rules.set(String(rule.alias_type), {
        aliasType: String(rule.alias_type),
        strong: rule.strong === true,
        ops: rule.ops ?? [],
        validate: rule.validate ?? null,
      });
    }
    this.#rules = rules;
  }

  rule(aliasType: string): AliasNormalizationRule | null {
    return this.#rules.get(aliasType) ?? null;
  }

  /**
   * Produces the matching form. The display form is *never* derived from this:
   * `entity_aliases.alias_value` keeps the source's own spelling byte for byte,
   * because it feeds page titles, search results and exports.
   */
  normalize(aliasType: string, raw: string): string {
    const ops = this.#rules.get(aliasType)?.ops ?? DEFAULT_NAME_OPS;
    let value = normalizeUnicode(raw);
    for (const op of ops) {
      value = applyOp(value, op);
    }
    return value;
  }

  /**
   * `validate` from the vertical's rule. A value that fails is quarantined by
   * the caller, never written as a join key — a garbage key silently creates a
   * duplicate entity, which is far more expensive than a rejected record.
   */
  validate(aliasType: string, normalized: string): string | null {
    const validate = this.#rules.get(aliasType)?.validate;
    if (validate === undefined || validate === null) return null;
    if (typeof validate.min_length === 'number' && normalized.length < validate.min_length) {
      return `"${normalized}" is shorter than the declared minimum length ${validate.min_length}`;
    }
    if (typeof validate.max_length === 'number' && normalized.length > validate.max_length) {
      return `"${normalized}" is longer than the declared maximum length ${validate.max_length}`;
    }
    if (typeof validate.pattern === 'string' && !new RegExp(validate.pattern).test(normalized)) {
      return `"${normalized}" does not match the declared pattern ${validate.pattern}`;
    }
    if (validate.checksum === 'upc_mod10' && !upcMod10(normalized)) {
      return `"${normalized}" fails the UPC mod-10 check digit`;
    }
    return null;
  }
}

function applyOp(value: string, op: Yaml): string {
  const kind = String(op.op);
  switch (kind) {
    case 'uppercase':
      return applyCase(value, 'upper');
    case 'lowercase':
      return applyCase(value, 'lower');
    case 'title_case':
      return applyCase(value, 'title');
    case 'collapse_whitespace':
      return collapseWhitespace(value);
    case 'strip_whitespace':
      // Trim, not "delete every space". Interior spaces are removed by the
      // `strip_characters` op, whose character class names the space
      // explicitly — reading this as a global delete would silently turn the
      // declared `series_name` key "Comfort 16" into "Comfort16".
      return value.trim();
    case 'strip_characters':
      return stripCharacters(value, String(op.characters ?? ''));
    case 'strip_non_digits':
      return value.replace(/\D+/g, '');
    case 'strip_prefix': {
      for (const prefix of op.prefixes ?? []) {
        const candidate = String(prefix);
        if (candidate !== '' && value.startsWith(candidate)) return value.slice(candidate.length);
      }
      return value;
    }
    case 'left_pad': {
      const length = Number(op.length ?? 0);
      const character = String(op.character ?? '0');
      return value.length >= length ? value : value.padStart(length, character);
    }
    case 'unicode_normalize':
      return normalizeUnicode(value);
    default:
      throw new PipelineConfigurationError(
        `identifier op "${kind}" is declared by the vertical but not implemented by the ingest worker`,
      );
  }
}

/**
 * UPC-A / GTIN mod-10 check digit. A mistyped barcode that reaches the alias
 * index attaches one product's identity to another, so the check that the
 * barcode carries is used rather than trusting the digits.
 */
export function upcMod10(digits: string): boolean {
  if (!/^\d{12,14}$/.test(digits)) return false;
  const body = digits.slice(0, -1);
  const check = Number(digits.slice(-1));
  let sum = 0;
  // Weights alternate 3/1 from the right-most body digit inwards.
  for (let index = body.length - 1, weight = 3; index >= 0; index -= 1, weight = weight === 3 ? 1 : 3) {
    sum += Number(body[index]) * weight;
  }
  return (10 - (sum % 10)) % 10 === check;
}

/** `Acme Climate Systems` → `acme-climate-systems`. */
export function slugify(raw: string): string {
  return collapseWhitespace(normalizeUnicode(raw))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
