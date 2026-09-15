import {
  AliasNormalizationSpecSchema, CORE_ALIAS_TYPES,
  type AliasNormalizationSpec, type IdentifierOperation,
} from '@data-foundry/canonical-schema';
import { applyCase, collapseWhitespace, normalizeUnicode, normalizePunctuation, stripCharacters, stripFormatCharacters } from './text.js';

export interface AliasConfiguration {
  readonly aliasTypes?: readonly { readonly type: string; readonly applies_to: readonly string[]; readonly strong: boolean; readonly scoped_to: string | null }[];
  readonly domainNormalization?: { readonly identifier_rules?: readonly unknown[] };
}

const DEFAULT_NAME_OPS = [{ op: 'collapse_whitespace' }, { op: 'uppercase' }] as const;

/** Compile once from trusted vertical data; deployed readers never load YAML. */
export function compileAliasNormalization(config: AliasConfiguration): AliasNormalizationSpec {
  const declared = config.domainNormalization?.identifier_rules ?? [];
  const metadata = new Map(config.aliasTypes?.map((alias) => [alias.type, alias]));
  const rules: Record<string, unknown>[] = declared.map((raw) => {
    if (raw === null || typeof raw !== 'object') throw new Error('Identifier rule must be an object');
    const rule = raw as Record<string, unknown>;
    const alias = metadata.get(String(rule['alias_type']));
    return { applies_to: alias?.applies_to ?? [], scoped_to: alias?.scoped_to ?? null, ...rule };
  });
  const seen = new Set(rules.map((rule) => rule['alias_type']));
  for (const type of new Set([...CORE_ALIAS_TYPES, ...metadata.keys()])) {
    if (seen.has(type)) continue;
    const alias = metadata.get(type);
    rules.push({ alias_type: type, applies_to: alias?.applies_to ?? [], scoped_to: alias?.scoped_to ?? null, strong: alias?.strong ?? false, ops: DEFAULT_NAME_OPS } as typeof rules[number]);
  }
  return AliasNormalizationSpecSchema.parse({ version: 1, rules });
}

const OP_MEMBERSHIP = {
  uppercase: true, lowercase: true, title_case: true, collapse_whitespace: true,
  strip_whitespace: true, strip_characters: true, strip_non_digits: true, strip_prefix: true,
  left_pad: true, unicode_normalize: true, strip_format_characters: true, normalize_punctuation: true,
} satisfies Record<IdentifierOperation['op'], true>;
export type IdentifierOp = IdentifierOperation['op'];
export const IDENTIFIER_OPS = Object.keys(OP_MEMBERSHIP) as readonly IdentifierOp[];
export const isIdentifierOp = (name: string): name is IdentifierOp => Object.prototype.hasOwnProperty.call(OP_MEMBERSHIP, name);

function applyOp(value: string, step: IdentifierOperation): string {
  switch (step.op) {
    case 'uppercase': return applyCase(value, 'upper');
    case 'lowercase': return applyCase(value, 'lower');
    case 'title_case': return applyCase(value, 'title');
    case 'collapse_whitespace': return collapseWhitespace(value);
    case 'strip_whitespace': return value.trim();
    case 'strip_characters': return stripCharacters(value, step.characters);
    case 'strip_non_digits': return value.replace(/\D+/g, '');
    case 'strip_prefix': {
      const prefix = step.prefixes.find((candidate) => value.startsWith(candidate));
      return prefix === undefined ? value : value.slice(prefix.length);
    }
    case 'left_pad': return value.padStart(step.length, step.character);
    case 'unicode_normalize': return normalizeUnicode(value);
    case 'strip_format_characters': return stripFormatCharacters(value);
    case 'normalize_punctuation': return normalizePunctuation(value);
  }
}

/** Same pure operation interpreter used to persist and to seek normalized keys. */
export class AliasNormalizer {
  readonly specification: AliasNormalizationSpec;
  constructor(config: AliasConfiguration | AliasNormalizationSpec) {
    this.specification = 'version' in config ? AliasNormalizationSpecSchema.parse(config) : compileAliasNormalization(config);
  }
  rule(aliasType: string) {
    const rule = this.specification.rules.find((candidate) => candidate.alias_type === aliasType);
    return rule === undefined ? null : { ...rule, aliasType: rule.alias_type };
  }
  normalize(aliasType: string, raw: string): string {
    const ops = this.rule(aliasType)?.ops ?? DEFAULT_NAME_OPS;
    return ops.reduce((value, step) => applyOp(value, step), normalizeUnicode(raw));
  }
  validate(aliasType: string, value: string): string | null {
    const rule = this.rule(aliasType)?.validate;
    if (rule == null) return null;
    if (rule.min_length !== undefined && value.length < rule.min_length) return `"${value}" is shorter than the declared minimum length ${rule.min_length}`;
    if (rule.max_length !== undefined && value.length > rule.max_length) return `"${value}" is longer than the declared maximum length ${rule.max_length}`;
    if (rule.pattern !== undefined && !new RegExp(rule.pattern).test(value)) return `"${value}" does not match the declared pattern ${rule.pattern}`;
    if (rule.checksum === 'upc_mod10' && !upcMod10(value)) return `"${value}" fails the UPC mod-10 check digit`;
    return null;
  }
}

export function upcMod10(digits: string): boolean {
  if (!/^\d{12,14}$/.test(digits)) return false;
  let sum = 0;
  for (let index = digits.length - 2, weight = 3; index >= 0; index -= 1, weight = weight === 3 ? 1 : 3) sum += Number(digits[index]) * weight;
  return (10 - (sum % 10)) % 10 === Number(digits.slice(-1));
}

export function slugify(raw: string): string {
  return collapseWhitespace(normalizeUnicode(raw)).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
