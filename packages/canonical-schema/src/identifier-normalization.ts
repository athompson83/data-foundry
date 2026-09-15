import { z } from 'zod';
import { IdentifierSchema } from './primitives.js';

/** Closed, serializable identifier vocabulary shared by acquisition consumers and queries. */
export const IdentifierOperationSchema = z.discriminatedUnion('op', [
  z.object({ op: z.enum(['uppercase', 'lowercase', 'title_case', 'collapse_whitespace', 'strip_whitespace',
    'strip_non_digits', 'unicode_normalize', 'strip_format_characters', 'normalize_punctuation']) }),
  z.object({ op: z.literal('strip_characters'), characters: z.string().max(256) }),
  z.object({ op: z.literal('strip_prefix'), prefixes: z.array(z.string().min(1).max(128)).max(32) }),
  z.object({ op: z.literal('left_pad'), length: z.number().int().min(1).max(256), character: z.string().length(1).default('0') }),
]);
export type IdentifierOperation = z.infer<typeof IdentifierOperationSchema>;

export const AliasNormalizationRuleSchema = z.object({
  alias_type: IdentifierSchema,
  applies_to: z.array(IdentifierSchema).max(64).default([]),
  scoped_to: IdentifierSchema.nullable().default(null),
  strong: z.boolean().default(false),
  ops: z.array(IdentifierOperationSchema).max(32),
  validate: z.object({
    min_length: z.number().int().min(0).max(1024).optional(),
    max_length: z.number().int().min(1).max(1024).optional(),
    pattern: z.string().max(512).refine((pattern) => { try { new RegExp(pattern); return true; } catch { return false; } }, 'Invalid identifier validation pattern').optional(),
    checksum: z.literal('upc_mod10').optional(),
  }).nullable().default(null),
});
export type AliasNormalizationRule = z.infer<typeof AliasNormalizationRuleSchema>;

export const AliasNormalizationSpecSchema = z.object({
  version: z.literal(1),
  rules: z.array(AliasNormalizationRuleSchema).max(128),
}).superRefine((spec, ctx) => {
  const seen = new Set<string>();
  spec.rules.forEach((rule, index) => {
    if (seen.has(rule.alias_type)) ctx.addIssue({ code: 'custom', path: ['rules', index, 'alias_type'], message: 'Duplicate alias normalization rule' });
    seen.add(rule.alias_type);
  });
});
export type AliasNormalizationSpec = z.infer<typeof AliasNormalizationSpecSchema>;
