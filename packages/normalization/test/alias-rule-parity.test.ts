import { describe, expect, it } from 'vitest';
import { AliasNormalizationRuleSchema, extractionConfidence } from '@data-foundry/canonical-schema';
import { normalizeRecord, parseNormalizationRuleSet } from '../src/index.js';

describe('declared identifier normalization before entity resolution', () => {
  const normalization = AliasNormalizationRuleSchema.parse({ alias_type: 'reference', ops: [{ op: 'uppercase' }, { op: 'strip_prefix', prefixes: ['LAB:'] }], validate: { pattern: '^Δ-[0-9]+$' } });
  const rules = () => parseNormalizationRuleSet({ id: 'synthetic', version: '1', vertical: 'synthetic', entity_types: ['specimen'], properties: [], identifiers: [{ alias_type: 'reference', source_field: 'ref', normalization }] });
  const record = (raw: string) => ({ source_record_key: 'one', entity_type: 'specimen', extraction_confidence: extractionConfidence(1), raw_payload: {}, values: [{ field: 'ref', raw, locator: { type: 'WHOLE_DOCUMENT' as const, value: '' } }] });
  it('preserves a declared non-ASCII identifier and structural separator instead of applying an ASCII profile first', () => {
    const result = normalizeRecord(record('LAB:δ-12'), rules());
    expect(result.identifiers).toMatchObject([{ alias_value: 'LAB:δ-12', normalized_value: 'Δ-12' }]);
    expect(result.failures).toEqual([]);
  });
  it('rejects an identifier outside the same declared validation used for lookup', () => {
    const result = normalizeRecord(record('LAB:abc-12'), rules());
    expect(result.identifiers).toEqual([]);
    expect(result.failures).toMatchObject([{ reason: 'IDENTIFIER_VALIDATION_FAILED', source_value: 'LAB:abc-12' }]);
  });
});
