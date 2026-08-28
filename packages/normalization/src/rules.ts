import type { FactOutputKind, FactValueType, Identifier } from '@data-foundry/canonical-schema';
import type { IdentifierNormalizationOptions } from './identifier.js';
import type { DateFormat } from './scalars.js';
import type { CaseMode } from './text.js';
import type { VocabularyDefinition } from './vocabulary.js';

/**
 * A `NormalizationRuleSet` is **vertical configuration**, not code.
 *
 * AGENTS.md rule 4: "no vertical-specific forks of the app — add fields, filters
 * and page behaviour through vertical schemas/configuration". Adding
 * `hspf2` to the HVAC vertical, or standing up a whole new vertical, is a JSON
 * or YAML change validated by `parseNormalizationRuleSet`. Nothing in this
 * package knows what an air conditioner is.
 */

/** One declarative step in a transform chain. Every variant is pure data. */
export type TransformSpec =
  // --- layer 1: primitive cleanup ---
  | { readonly kind: 'trim' }
  | { readonly kind: 'collapse_whitespace' }
  | { readonly kind: 'unicode_nfkc' }
  | { readonly kind: 'normalize_punctuation' }
  | { readonly kind: 'decode_html_entities' }
  | { readonly kind: 'case'; readonly to: CaseMode }
  | { readonly kind: 'strip_characters'; readonly characters: string }
  | {
      readonly kind: 'replace';
      readonly pattern: string;
      readonly replacement: string;
      readonly flags?: string;
    }
  // --- layer 2: typed values ---
  | {
      readonly kind: 'number';
      readonly decimal_separator?: string;
      readonly group_separator?: string;
    }
  /**
   * Parses "value + unit" and converts to `target_unit`, retaining the source
   * unit. `default_unit` is applied only when the source wrote a bare number,
   * and doing so lowers the candidate's confidence — an assumed unit is a real
   * assumption, not a free win.
   */
  | {
      readonly kind: 'quantity';
      readonly target_unit: string;
      readonly default_unit?: string;
      readonly allow_unitless?: boolean;
    }
  | {
      readonly kind: 'boolean';
      readonly true_values?: readonly string[];
      readonly false_values?: readonly string[];
    }
  | { readonly kind: 'date'; readonly formats?: readonly DateFormat[] }
  | { readonly kind: 'datetime' }
  | { readonly kind: 'integer' }
  | { readonly kind: 'round'; readonly decimals: number }
  | { readonly kind: 'range'; readonly min?: number; readonly max?: number }
  // --- layer 4: ontology mapping ---
  | { readonly kind: 'vocabulary'; readonly vocabulary: string };

export interface PropertyRule {
  /** Canonical property identifier, e.g. `cooling_capacity_btu`. */
  readonly property: Identifier;
  /** Source-native field produced by extraction. */
  readonly source_field: Identifier;
  readonly value_type: FactValueType;
  /** Direct source-normalization by default; derived rules must name their input lineage. */
  readonly output_kind?: FactOutputKind;
  readonly derived_from_property?: Identifier;
  readonly transformation_ref?: string;
  /** Canonical unit for quantities. A rule that declares one refuses unitless values. */
  readonly unit?: string;
  readonly required?: boolean;
  readonly transforms?: readonly TransformSpec[];
}

export interface IdentifierRule {
  /** Alias type, e.g. `model_number`, `ahri_ref`, `upc`. */
  readonly alias_type: Identifier;
  readonly source_field: Identifier;
  readonly required?: boolean;
  /** Overrides the built-in profile for this alias type. */
  readonly options?: IdentifierNormalizationOptions;
}

export interface NormalizationRuleSet {
  readonly id: string;
  readonly version: string;
  readonly vertical: string;
  /** Source-native entity types this rule set applies to. */
  readonly entity_types: readonly Identifier[];
  readonly properties: readonly PropertyRule[];
  readonly identifiers: readonly IdentifierRule[];
  readonly vocabularies?: Readonly<Record<string, VocabularyDefinition>>;
}

export class NormalizationRuleSetError extends Error {
  readonly path: string;

  constructor(message: string, path: string) {
    super(`${path}: ${message}`);
    this.name = 'NormalizationRuleSetError';
    this.path = path;
  }
}

const IDENTIFIER_PATTERN = /^[a-z][a-z0-9_]*$/;

const VALUE_TYPES: readonly string[] = [
  'string',
  'number',
  'integer',
  'boolean',
  'date',
  'datetime',
  'enum',
  'url',
  'quantity',
  'array',
  'object',
];

/** A transform name the pipeline actually dispatches. */
export type TransformKind = TransformSpec['kind'];

/**
 * The value-transform vocabulary, tied to `TransformSpec` by the type system
 * rather than by a promise in a comment.
 *
 * This used to be a hand-written `readonly string[]` sitting next to the union
 * it was supposed to mirror, with nothing checking that it did. Declaring it as
 * a total `Record<TransformKind, true>` makes both directions of drift a
 * compile error: a variant added to `TransformSpec` without a key here is a
 * missing property, and a key here that no variant declares is an excess one.
 * `applyTransform`'s switch is exhaustive over the same union (it has no
 * `default`, so a missing case fails `noImplicitReturns`), which chains the
 * three together — vocabulary, union and dispatch cannot disagree.
 */
const TRANSFORM_KIND_MEMBERSHIP: Readonly<Record<TransformKind, true>> = {
  trim: true,
  collapse_whitespace: true,
  unicode_nfkc: true,
  normalize_punctuation: true,
  decode_html_entities: true,
  case: true,
  strip_characters: true,
  replace: true,
  number: true,
  quantity: true,
  boolean: true,
  date: true,
  datetime: true,
  integer: true,
  round: true,
  range: true,
  vocabulary: true,
};

/**
 * The value transforms this package implements, for anything that has to check
 * a vertical's declaration before a pipeline run.
 *
 * This is the property/value stage vocabulary (doc 06 layers 1, 2 and 4). It is
 * NOT the identifier-op vocabulary that the ingest worker dispatches for alias
 * join keys: those are different names for a different stage, and a checker
 * that pooled the two would accept `left_pad` as a value transform.
 */
export const TRANSFORM_KINDS: readonly TransformKind[] = Object.keys(
  TRANSFORM_KIND_MEMBERSHIP,
) as readonly TransformKind[];

/** Narrowing membership test over the same table `TRANSFORM_KINDS` is built from. */
export const isTransformKind = (name: string): name is TransformKind =>
  Object.prototype.hasOwnProperty.call(TRANSFORM_KIND_MEMBERSHIP, name);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const requireIdentifier = (value: unknown, path: string): Identifier => {
  if (typeof value !== 'string' || !IDENTIFIER_PATTERN.test(value)) {
    throw new NormalizationRuleSetError('must be a lowercase snake_case identifier', path);
  }
  return value;
};

const requireString = (value: unknown, path: string): string => {
  if (typeof value !== 'string' || value.length === 0) {
    throw new NormalizationRuleSetError('must be a non-empty string', path);
  }
  return value;
};

/**
 * Validates a rule set loaded from vertical configuration.
 *
 * Fails loudly and by path. A rule set that references a vocabulary that does
 * not exist, or declares a unit the registry has never heard of, would otherwise
 * only surface as a pile of runtime failures on the first real crawl.
 */
export function parseNormalizationRuleSet(
  input: unknown,
  path = 'rule_set',
): NormalizationRuleSet {
  if (!isRecord(input)) throw new NormalizationRuleSetError('must be an object', path);

  requireString(input['id'], `${path}.id`);
  requireString(input['version'], `${path}.version`);
  requireString(input['vertical'], `${path}.vertical`);

  const entityTypes = input['entity_types'];
  if (!Array.isArray(entityTypes) || entityTypes.length === 0) {
    throw new NormalizationRuleSetError(
      'must be a non-empty array of entity types',
      `${path}.entity_types`,
    );
  }
  entityTypes.forEach((entityType, index) =>
    requireIdentifier(entityType, `${path}.entity_types[${index}]`),
  );

  const vocabularies = input['vocabularies'];
  if (vocabularies !== undefined && !isRecord(vocabularies)) {
    throw new NormalizationRuleSetError('must be an object', `${path}.vocabularies`);
  }
  const vocabularyIds = new Set(Object.keys(vocabularies ?? {}));

  const properties = input['properties'];
  if (!Array.isArray(properties)) {
    throw new NormalizationRuleSetError('must be an array', `${path}.properties`);
  }

  const seenProperties = new Set<string>();
  properties.forEach((rule, index) => {
    const rulePath = `${path}.properties[${index}]`;
    if (!isRecord(rule)) throw new NormalizationRuleSetError('must be an object', rulePath);

    const property = requireIdentifier(rule['property'], `${rulePath}.property`);
    if (seenProperties.has(property)) {
      throw new NormalizationRuleSetError(`duplicate property ${property}`, rulePath);
    }
    seenProperties.add(property);
    requireIdentifier(rule['source_field'], `${rulePath}.source_field`);

    const outputKind = rule['output_kind'] ?? 'NORMALIZED_FACT';
    if (outputKind !== 'NORMALIZED_FACT' && outputKind !== 'DERIVED_METRIC') {
      throw new NormalizationRuleSetError(
        'must be NORMALIZED_FACT or DERIVED_METRIC',
        `${rulePath}.output_kind`,
      );
    }
    if (outputKind === 'DERIVED_METRIC') {
      requireIdentifier(rule['derived_from_property'], `${rulePath}.derived_from_property`);
      requireString(rule['transformation_ref'], `${rulePath}.transformation_ref`);
    }

    const valueType = rule['value_type'];
    if (typeof valueType !== 'string' || !VALUE_TYPES.includes(valueType)) {
      throw new NormalizationRuleSetError(
        `must be one of ${VALUE_TYPES.join('|')}`,
        `${rulePath}.value_type`,
      );
    }

    const transforms = rule['transforms'];
    if (transforms !== undefined) {
      if (!Array.isArray(transforms)) {
        throw new NormalizationRuleSetError('must be an array', `${rulePath}.transforms`);
      }
      transforms.forEach((transform, transformIndex) => {
        const transformPath = `${rulePath}.transforms[${transformIndex}]`;
        if (!isRecord(transform) || typeof transform['kind'] !== 'string') {
          throw new NormalizationRuleSetError('must be an object with a kind', transformPath);
        }
        const kind = transform['kind'];
        if (!isTransformKind(kind)) {
          throw new NormalizationRuleSetError(`unknown transform kind ${kind}`, transformPath);
        }
        if (kind === 'vocabulary') {
          const vocabularyId = requireString(transform['vocabulary'], `${transformPath}.vocabulary`);
          if (!vocabularyIds.has(vocabularyId)) {
            throw new NormalizationRuleSetError(
              `vocabulary ${vocabularyId} is not declared in ${path}.vocabularies`,
              transformPath,
            );
          }
        }
        if (kind === 'quantity') {
          requireString(transform['target_unit'], `${transformPath}.target_unit`);
        }
        if (kind === 'replace') {
          const pattern = requireString(transform['pattern'], `${transformPath}.pattern`);
          try {
            new RegExp(pattern);
          } catch (error) {
            throw new NormalizationRuleSetError(
              `invalid regular expression: ${String(error)}`,
              `${transformPath}.pattern`,
            );
          }
        }
      });
    }
  });

  const identifiers = input['identifiers'];
  if (!Array.isArray(identifiers)) {
    throw new NormalizationRuleSetError('must be an array', `${path}.identifiers`);
  }
  identifiers.forEach((rule, index) => {
    const rulePath = `${path}.identifiers[${index}]`;
    if (!isRecord(rule)) throw new NormalizationRuleSetError('must be an object', rulePath);
    requireIdentifier(rule['alias_type'], `${rulePath}.alias_type`);
    requireIdentifier(rule['source_field'], `${rulePath}.source_field`);
  });

  return input as unknown as NormalizationRuleSet;
}

/** Rule sets are keyed by source-native entity type. */
export const ruleSetAppliesTo = (ruleSet: NormalizationRuleSet, entityType: string): boolean =>
  ruleSet.entity_types.includes(entityType);
