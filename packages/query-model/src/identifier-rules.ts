import type { AliasNormalizationSpec } from '@data-foundry/canonical-schema';
import { AliasNormalizer } from '@data-foundry/normalization';

/** Alias type stays attached to the result: one rule cannot widen another's identity. */
export function declaredIdentifierCandidates(raw: string, specification: AliasNormalizationSpec, aliasType?: string, entityType?: string) {
  const normalizer = new AliasNormalizer(specification);
  return normalizer.specification.rules.flatMap((rule) => {
    if (aliasType !== undefined && rule.alias_type !== aliasType) return [];
    if (entityType !== undefined && rule.applies_to.length > 0 && !rule.applies_to.includes(entityType)) return [];
    const normalized = normalizer.normalize(rule.alias_type, raw);
    if (normalized === '' || normalizer.validate(rule.alias_type, normalized) !== null) return [];
    return [{ alias_type: rule.alias_type, normalized_value: normalized, applies_to: rule.applies_to }];
  });
}
