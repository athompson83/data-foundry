/** Shared identifier interpreter; the write path and query path execute one specification. */
import { AliasNormalizer as SharedAliasNormalizer } from '@data-foundry/normalization';
import type { AliasConfiguration } from '@data-foundry/normalization';
import type { AliasNormalizationSpec } from '@data-foundry/canonical-schema';
import { PipelineConfigurationError } from './errors.js';

export { IDENTIFIER_OPS, isIdentifierOp, upcMod10, slugify, type IdentifierOp } from '@data-foundry/normalization';
export type AliasNormalizationRule = NonNullable<ReturnType<SharedAliasNormalizer['rule']>>;
export class AliasNormalizer extends SharedAliasNormalizer {
  constructor(config: AliasConfiguration | AliasNormalizationSpec) {
    try { super(config); } catch (cause) {
      throw new PipelineConfigurationError('Invalid declared identifier normalization configuration', { cause });
    }
  }
}
