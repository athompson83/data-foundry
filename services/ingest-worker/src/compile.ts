/**
 * The source-mapping compiler.
 *
 * `normalizers/source-mappings.yaml` is the only file in a vertical that knows
 * how a *specific* source spells things. This module turns that declaration
 * into the two contracts the platform packages actually consume:
 *
 *   * an `ExtractionSchema`      → `@data-foundry/extraction`
 *   * a `NormalizationRuleSet`   → `@data-foundry/normalization`
 *
 * plus the alias / relationship / naming plans the resolution and publish
 * stages need. Every branch below is on a *dialect construct* (`format`,
 * `label`, `extract_with`, `map_with`), never on a vertical, a source key or a
 * property name. Onboarding a fifth HVAC source, or a first source of a second
 * vertical, must not touch this file (AGENTS.md rule 4).
 *
 * Two derivations are worth calling out because they are easy to get silently
 * wrong:
 *
 *   * **Derived properties.** Layer 2 declares `nominal_tonnage ← capacity/12000`
 *     with `only_if_absent`. "Absent" is evaluated per *stream*: a stream that
 *     publishes BTU/h and not tons gets a tonnage rule reading the BTU/h field
 *     with a unit conversion; a stream that publishes both gets neither. A
 *     derived value therefore carries the evidence of the value it came from,
 *     and a directly published figure is never displaced by arithmetic.
 *   * **Relationship endpoints.** An endpoint that reads the record's own strong
 *     identifier is the record's own entity (`self`); one resolved through
 *     `publisher_aliases` is a manufacturer; anything else is a lookup by the
 *     target entity type's primary alias. `supersedes` in this vertical is
 *     declared inverted (successor → predecessor) and that inversion is data,
 *     not code.
 */
import type { ExtractionSchema, FieldRule, FieldSelector } from '@data-foundry/extraction';
import type {
  NormalizationRuleSet,
  PropertyRule,
  TransformSpec,
  VocabularyDefinition,
} from '@data-foundry/normalization';
import { parseNormalizationRuleSet } from '@data-foundry/normalization';
import type { FactValueType, Identifier } from '@data-foundry/canonical-schema';
import { MappingCompilationError } from './errors.js';
import { primaryAliasType, type VerticalConfig } from './config.js';

/** YAML arrives untyped; every reader below narrows what it needs and fails by path. */
type Yaml = any;

export interface AliasPlan {
  readonly aliasType: Identifier;
  readonly field: Identifier;
  readonly strong: boolean;
}

export type EndpointPlan =
  /** The entity this record is about. */
  | { readonly kind: 'self' }
  /** A manufacturer resolved through the deterministic publisher alias table. */
  | { readonly kind: 'publisher'; readonly field: Identifier | null; readonly literal: string | null }
  /** Another entity, named by its primary alias in a field of this record. */
  | {
      readonly kind: 'alias';
      readonly entityType: Identifier;
      readonly aliasType: Identifier;
      readonly field: Identifier;
    };

export interface RelationshipPlan {
  readonly predicate: Identifier;
  readonly subject: EndpointPlan;
  readonly object: EndpointPlan;
  /** Field holding the edge's `valid_from` date, when the source publishes one. */
  readonly validFromField: Identifier | null;
  /** Drop the edge (rather than fail) when this endpoint's field is empty. */
  readonly skipWhenNull: 'subject' | 'object' | null;
}

export interface StreamPlan {
  readonly sourceKey: string;
  readonly stream: string;
  readonly entityType: Identifier;
  readonly schema: ExtractionSchema;
  readonly ruleSet: NormalizationRuleSet;
  readonly aliases: readonly AliasPlan[];
  readonly relationships: readonly RelationshipPlan[];
  /** CSV preamble filter; resolved against the artifact body at extraction time. */
  readonly skipLinesMatching: string | null;
  readonly diagnostics: readonly string[];
}

export interface SourcePlan {
  readonly sourceKey: string;
  readonly format: string;
  readonly streams: readonly StreamPlan[];
}

const IDENTIFIER = /^[a-z][a-z0-9_]*$/;

const asIdentifier = (raw: string, path: string): Identifier => {
  if (!IDENTIFIER.test(raw)) {
    throw new MappingCompilationError(path, `"${raw}" is not a lowercase snake_case identifier`);
  }
  return raw as Identifier;
};

const escapeRegex = (raw: string): string => raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Compile every source declared in `source-mappings.yaml`. */
export function compileSourcePlans(config: VerticalConfig): SourcePlan[] {
  const sources: Yaml[] = config.sourceMappings?.sources ?? [];
  return sources.map((source) => compileSourcePlan(config, source));
}

export function compileSourcePlan(config: VerticalConfig, source: Yaml): SourcePlan {
  const sourceKey = String(source.source_key);
  const format = String(source.format);
  const streams: StreamPlan[] = (source.records ?? []).map((record: Yaml, index: number) =>
    compileStreamPlan(config, source, record, `sources.${sourceKey}.records[${index}]`),
  );
  return { sourceKey, format, streams };
}

/**
 * A per-stream registry of extraction fields.
 *
 * Two mappings that read the same place in an artifact share one field, so the
 * value is read once and both facts cite the *same* locator. Voltage and phase
 * both come from `208/230-1-60`, and evidence for either has to point a human
 * at that one string.
 */
class FieldRegistry {
  readonly #byKey = new Map<string, Identifier>();
  readonly #rules: FieldRule[] = [];

  add(name: string, locate: FieldSelector, extract?: { readonly pattern: string }): Identifier {
    const key = `${JSON.stringify(locate)}|${extract?.pattern ?? ''}`;
    const existing = this.#byKey.get(key);
    if (existing !== undefined) return existing;

    let field = asIdentifier(name, `field.${name}`);
    let suffix = 2;
    while (this.#rules.some((rule) => rule.field === field)) {
      field = `${name}_${suffix}` as Identifier;
      suffix += 1;
    }
    this.#byKey.set(key, field);
    this.#rules.push({
      field,
      locate,
      ...(extract === undefined ? {} : { extract }),
    });
    return field;
  }

  get rules(): readonly FieldRule[] {
    return this.#rules;
  }

  has(field: Identifier): boolean {
    return this.#rules.some((rule) => rule.field === field);
  }
}

function compileStreamPlan(
  config: VerticalConfig,
  source: Yaml,
  record: Yaml,
  path: string,
): StreamPlan {
  const sourceKey = String(source.source_key);
  const format = String(source.format);
  const stream = String(record.stream);
  const entityType = asIdentifier(String(record.entity_type), `${path}.entity_type`);
  const entityDef = config.entities[entityType];
  if (entityDef === undefined) {
    throw new MappingCompilationError(
      `${path}.entity_type`,
      `entity type "${entityType}" is not declared by this vertical`,
    );
  }

  const fields = new FieldRegistry();
  const diagnostics: string[] = [];
  const aliases: AliasPlan[] = [];
  const identifierRules: NormalizationRuleSet['identifiers'][number][] = [];
  const propertyRules: PropertyRule[] = [];
  const usedVocabularies = new Set<string>();

  /** Path → extraction field, with the format's selector dialect applied. */
  const locateFor = (mapping: Yaml, name: string, mappingPath: string): Identifier => {
    const rawPath = mapping.path === undefined ? undefined : String(mapping.path);
    const label = mapping.label === undefined ? undefined : String(mapping.label);
    const pattern = mapping.pattern === undefined ? undefined : String(mapping.pattern);

    switch (format) {
      case 'json': {
        if (rawPath === undefined) {
          throw new MappingCompilationError(mappingPath, 'json mappings require a `path`');
        }
        return fields.add(
          name,
          { kind: 'json_pointer', pointer: rawPath },
          pattern === undefined ? undefined : { pattern },
        );
      }
      case 'csv': {
        if (rawPath === undefined) {
          throw new MappingCompilationError(mappingPath, 'csv mappings require a `path` (column name)');
        }
        return fields.add(
          name,
          { kind: 'csv_column', column: rawPath },
          pattern === undefined ? undefined : { pattern },
        );
      }
      case 'html': {
        if (rawPath === undefined) {
          throw new MappingCompilationError(mappingPath, 'html mappings require a `path` (selector)');
        }
        return fields.add(
          name,
          { kind: 'css', selector: rawPath },
          pattern === undefined ? undefined : { pattern },
        );
      }
      case 'pdf': {
        // A spec sheet writes `Sound Level      72 dB` — label and value
        // separated by horizontal position, not punctuation. The extraction
        // package's `pdf_label` selector requires a separator character, so a
        // column-aligned label compiles to an anchored line regex instead.
        if (label !== undefined) {
          return fields.add(name, {
            kind: 'pdf_regex',
            pattern: `^${escapeRegex(label)}\\s+(.+)$`,
            group: 1,
          });
        }
        if (rawPath === undefined) {
          throw new MappingCompilationError(mappingPath, 'pdf mappings require a `label` or a `path`');
        }
        return fields.add(name, {
          kind: 'pdf_regex',
          pattern: pattern ?? '^(.+)$',
          group: 1,
        });
      }
      default:
        throw new MappingCompilationError(mappingPath, `unsupported format "${format}"`);
    }
  };

  // ---- aliases -------------------------------------------------------------
  for (const [index, alias] of (record.aliases ?? []).entries()) {
    const aliasPath = `${path}.aliases[${index}]`;
    const aliasType = asIdentifier(String(alias.alias_type), `${aliasPath}.alias_type`);
    const field = locateFor(alias, `alias_${aliasType}`, aliasPath);
    aliases.push({ aliasType, field, strong: alias.strong === true });
    identifierRules.push({ alias_type: aliasType, source_field: field });
  }

  // ---- properties ----------------------------------------------------------
  const declaredProperties = new Map<string, Yaml>(
    (entityDef.properties ?? []).map((property: Yaml) => [String(property.name), property]),
  );
  /** Property → the extraction field it reads, for the derived-property pass. */
  const propertyFields = new Map<string, { field: Identifier; sourceUnit: string | null }>();

  for (const [index, mapping] of (record.properties ?? []).entries()) {
    const mappingPath = `${path}.properties[${index}]`;
    const property = asIdentifier(String(mapping.property), `${mappingPath}.property`);
    const declared = declaredProperties.get(property);
    if (declared === undefined) {
      throw new MappingCompilationError(
        mappingPath,
        `property "${property}" is not declared on entity type "${entityType}"`,
      );
    }

    const field = locateFor(mapping, `prop_${property}`, mappingPath);
    const sourceUnit = mapping.source_unit === undefined ? null : String(mapping.source_unit);
    propertyFields.set(property, { field, sourceUnit });

    propertyRules.push(
      buildPropertyRule({
        config,
        property,
        field,
        declared,
        mapping,
        sourceUnit,
        mappingPath,
        usedVocabularies,
      }),
    );
  }

  // ---- derived properties (layer 2, `only_if_absent`) ----------------------
  // A declaration may name another derived output as its parent and may be
  // written before that parent. Compile the per-stream graph to a fixed point;
  // every emitted output becomes available to later descendants. The field
  // and source unit remain those of the root extraction value because the
  // normalization contract reads source fields, while dependency identity is
  // carried separately by `derived_from_property`.
  const pendingDerived: Yaml[] = (config.typedValues?.derived_properties ?? [])
    .filter((derived: Yaml) => {
      const property = String(derived.property);
      if (!declaredProperties.has(property)) return false;
      return !(derived.only_if_absent === true && propertyFields.has(property));
    });
  while (pendingDerived.length > 0) {
    let progressed = false;
    for (let index = 0; index < pendingDerived.length;) {
      const derived = pendingDerived[index] as Yaml;
      const property = String(derived.property);
      const from = String(derived.from);
      if (derived.only_if_absent === true && propertyFields.has(property)) {
        pendingDerived.splice(index, 1);
        progressed = true;
        continue;
      }
      const origin = propertyFields.get(from);
      if (origin === undefined) {
        index += 1;
        continue;
      }

      const declared = declaredProperties.get(property) as Yaml;
      const unit = declared.unit === null || declared.unit === undefined ? null : String(declared.unit);
      if (unit === null) {
        throw new MappingCompilationError(
          `${path}.derived_properties.${property}`,
          'derived quantity requires a declared canonical unit',
        );
      }
      const transforms: TransformSpec[] = [
        {
          kind: 'quantity',
          target_unit: unit,
          default_unit: origin.sourceUnit ?? unit,
        },
      ];
      if (typeof derived.round_to === 'number') {
        transforms.push({ kind: 'round', decimals: derived.round_to });
      }
      propertyRules.push({
        property: asIdentifier(property, `derived.${property}`),
        source_field: origin.field,
        value_type: String(declared.value_type) as FactValueType,
        output_kind: 'DERIVED_METRIC',
        derived_from_property: asIdentifier(from, `derived.${property}.from`),
        transformation_ref: `${config.slug}.${property}.from.${from}.v1`,
        unit,
        transforms,
      });
      propertyFields.set(property, origin);
      pendingDerived.splice(index, 1);
      progressed = true;
    }
    if (!progressed) {
      const unresolved = pendingDerived.map(
        (derived) => `${String(derived.property)} <- ${String(derived.from)} (parent unavailable)`,
      );
      throw new MappingCompilationError(
        `${path}.derived_properties`,
        `unresolved derived graph (missing parent or cycle): ${unresolved.join(', ')}`,
      );
    }
  }

  // ---- relationships -------------------------------------------------------
  // An endpoint that names the same path as one of this stream's strong
  // aliases is the record's own entity. Matching on the declared *path* rather
  // than on the compiled field is what makes that true for PDF pseudo-paths
  // (`page_heading`), where the alias carries an extraction pattern the
  // relationship declaration does not repeat.
  const aliasFieldByPath = new Map<string, AliasPlan>();
  for (const [index, alias] of (record.aliases ?? []).entries()) {
    if (alias.path === undefined) continue;
    const plan = aliases[index];
    if (plan !== undefined) aliasFieldByPath.set(String(alias.path), plan);
  }

  const relationships: RelationshipPlan[] = (record.relationships ?? []).map(
    (relationship: Yaml, index: number) =>
      compileRelationship(config, relationship, `${path}.relationships[${index}]`, {
        entityType,
        aliasFieldByPath,
        locateFor,
      }),
  );

  // ---- record key ----------------------------------------------------------
  const declaredKey = record.source_record_key === undefined ? null : String(record.source_record_key);
  let keyField: Identifier | null = null;
  if (declaredKey !== null) {
    const match = [...(record.aliases ?? []), ...(record.properties ?? [])].find(
      (mapping: Yaml) => mapping.path !== undefined && String(mapping.path) === declaredKey,
    );
    if (match !== undefined) {
      keyField = locateFor(match, `key_${stream}`, `${path}.source_record_key`);
    } else if (format !== 'pdf' && !declaredKey.startsWith('[')) {
      keyField = locateFor({ path: declaredKey }, 'record_key', `${path}.source_record_key`);
    } else if (format === 'pdf') {
      // `page_heading` and friends are positional pseudo-paths; reuse the
      // stream's strong alias, which is read from the same line.
      keyField = aliases.find((alias) => alias.strong)?.field ?? null;
    }
  }
  if (keyField === null) {
    // The declared key is an attribute of the record element itself
    // (`[data-item]`), which no field selector in the extraction contract can
    // reach. Falling back to the stream's strong identifier keeps the key
    // stable and source-scoped, which is what `source_record_key` is for.
    const fallback = aliases.find((alias) => alias.strong);
    if (fallback === undefined) {
      throw new MappingCompilationError(
        `${path}.source_record_key`,
        `cannot locate "${String(declaredKey)}" and the stream declares no strong alias to fall back on`,
      );
    }
    keyField = fallback.field;
    diagnostics.push(
      `${sourceKey}/${stream}: source_record_key "${String(declaredKey)}" is not reachable by any ` +
        `field selector; using the strong alias field "${keyField}" as the source-native key.`,
    );
  }

  const schema: ExtractionSchema = {
    schema_id: `${sourceKey}:${stream}`,
    format: format as ExtractionSchema['format'],
    entity_type: entityType,
    record: recordSelector(format, record, source, path),
    record_key: { fields: [keyField], fallback: 'fail' },
    fields: [...fields.rules],
  };

  const vocabularies: Record<string, VocabularyDefinition> = {};
  for (const id of usedVocabularies) {
    const vocabulary = config.vocabularies[id];
    if (vocabulary === undefined) {
      throw new MappingCompilationError(path, `vocabulary "${id}" is not declared by this vertical`);
    }
    vocabularies[id] = vocabulary;
  }

  const ruleSet = parseNormalizationRuleSet({
    id: `${config.slug}:${sourceKey}:${stream}`,
    version: config.schemaVersion,
    vertical: config.slug,
    entity_types: [entityType],
    properties: propertyRules,
    identifiers: identifierRules,
    vocabularies,
  }, `${path}.rule_set`);

  return {
    sourceKey,
    stream,
    entityType,
    schema,
    ruleSet,
    aliases,
    relationships,
    skipLinesMatching:
      source.parsing?.skip_lines_matching === undefined
        ? null
        : String(source.parsing.skip_lines_matching),
    diagnostics,
  };
}

function recordSelector(
  format: string,
  record: Yaml,
  source: Yaml,
  path: string,
): ExtractionSchema['record'] {
  const recordPath = record.record_path === undefined ? null : String(record.record_path);
  switch (format) {
    case 'json':
      if (recordPath === null) return { kind: 'whole_document' };
      return { kind: 'json_pointer', pointer: recordPath };
    case 'html':
      if (recordPath === null) return { kind: 'whole_document' };
      return { kind: 'css', selector: recordPath };
    case 'csv':
      return {
        kind: 'csv_rows',
        header: source.parsing?.header_row !== false,
        ...(source.parsing?.delimiter === undefined
          ? {}
          : { delimiter: String(source.parsing.delimiter) }),
        trim: true,
      };
    case 'pdf':
      return source.parsing?.record_per === 'page' ? { kind: 'pdf_pages' } : { kind: 'whole_document' };
    default:
      throw new MappingCompilationError(path, `unsupported format "${format}"`);
  }
}

interface PropertyRuleInput {
  readonly config: VerticalConfig;
  readonly property: Identifier;
  readonly field: Identifier;
  readonly declared: Yaml;
  readonly mapping: Yaml;
  readonly sourceUnit: string | null;
  readonly mappingPath: string;
  readonly usedVocabularies: Set<string>;
}

/**
 * Builds one `PropertyRule`.
 *
 * The transform chain is derived, in order, from three declarative signals:
 * a `notation.*` rule that splits one string into several canonical properties,
 * a `map_with: ontology.*` controlled vocabulary, and the canonical `unit` the
 * entity schema declares for the property. Anything the chain cannot handle
 * becomes a recorded normalization failure at run time, never a coerced value.
 */
function buildPropertyRule(input: PropertyRuleInput): PropertyRule {
  const { config, property, field, declared, mapping, sourceUnit, mappingPath, usedVocabularies } =
    input;

  const valueType = String(declared.value_type) as FactValueType;
  const unit = declared.unit === null || declared.unit === undefined ? null : String(declared.unit);
  const transforms: TransformSpec[] = [];

  const extractWith = mapping.extract_with === undefined ? null : String(mapping.extract_with);
  if (extractWith !== null) {
    const notation = findNotationRule(config, extractWith);
    if (notation !== null && mapping.emits !== undefined) {
      // A packed notation such as `208/230-1-60` carries several canonical
      // properties. The capture named by `emits` is pulled out here; the whole
      // original string still becomes `fact_evidence.source_value`, so the
      // dual voltage rating is recoverable without being a second fact.
      const emits = String(mapping.emits);
      const capture = (notation.emits ?? []).find((entry: Yaml) => String(entry.property) === emits);
      if (capture === undefined) {
        throw new MappingCompilationError(
          `${mappingPath}.emits`,
          `notation rule "${extractWith}" emits no property "${emits}"`,
        );
      }
      transforms.push({
        kind: 'replace',
        pattern: String(notation.pattern),
        replacement: `$<${String(capture.from)}>`,
      });
    }
  }

  const mapWith = mapping.map_with === undefined ? null : String(mapping.map_with);
  if (mapWith !== null) {
    const vocabularyId = mapWith.startsWith('ontology.') ? mapWith.slice('ontology.'.length) : mapWith;
    usedVocabularies.add(vocabularyId);
    transforms.push({ kind: 'vocabulary', vocabulary: vocabularyId });
  } else if (unit !== null) {
    transforms.push({
      kind: 'quantity',
      target_unit: unit,
      // A declared `source_unit` is the vertical stating what the column means;
      // absent that, a bare number is read as already being in canonical units.
      default_unit: sourceUnit ?? unit,
    });
  } else if (valueType === 'number' || valueType === 'integer') {
    transforms.push({ kind: 'number' });
    if (valueType === 'integer') transforms.push({ kind: 'integer' });
  }

  return {
    property,
    source_field: field,
    value_type: valueType,
    output_kind: 'NORMALIZED_FACT',
    ...(unit === null ? {} : { unit }),
    ...(transforms.length === 0 ? {} : { transforms }),
  };
}

function findNotationRule(config: VerticalConfig, reference: string): Yaml | null {
  const id = reference.startsWith('notation.') ? reference.slice('notation.'.length) : reference;
  const rules: Yaml[] = config.domainNormalization?.notation_rules ?? [];
  return rules.find((rule) => String(rule.id) === id) ?? null;
}

interface RelationshipContext {
  readonly entityType: Identifier;
  /** Declared alias path → the compiled alias plan that reads it. */
  readonly aliasFieldByPath: ReadonlyMap<string, AliasPlan>;
  readonly locateFor: (mapping: Yaml, name: string, path: string) => Identifier;
}

function compileRelationship(
  config: VerticalConfig,
  relationship: Yaml,
  path: string,
  context: RelationshipContext,
): RelationshipPlan {
  const predicate = asIdentifier(String(relationship.predicate), `${path}.predicate`);
  if (!config.relationshipPredicates.includes(predicate)) {
    throw new MappingCompilationError(
      `${path}.predicate`,
      `"${predicate}" is not a declared predicate of this vertical`,
    );
  }

  const endpoint = (side: 'subject' | 'object'): EndpointPlan => {
    const literal = relationship[`${side}_literal`];
    const from = relationship[`${side}_from`];
    const declaredType = relationship[`${side}_type`];
    const resolveWith = relationship[`${side}_resolve_with`];

    if (resolveWith === 'publisher_aliases') {
      return {
        kind: 'publisher',
        field:
          from === undefined
            ? null
            : context.locateFor({ path: String(from) }, `rel_${predicate}_${side}`, path),
        literal: literal === undefined ? null : String(literal),
      };
    }
    if (from === undefined) {
      throw new MappingCompilationError(
        `${path}.${side}_from`,
        'a non-publisher endpoint must name a source field',
      );
    }

    const targetType = asIdentifier(String(declaredType), `${path}.${side}_type`);
    // Reading the record's own strong identifier means "this record's entity".
    const ownAlias = context.aliasFieldByPath.get(String(from));
    if (targetType === context.entityType && ownAlias !== undefined && ownAlias.strong) {
      return { kind: 'self' };
    }

    const aliasType = primaryAliasType(config, targetType);
    if (aliasType === null) {
      throw new MappingCompilationError(
        `${path}.${side}_type`,
        `entity type "${targetType}" declares no strong alias to reference it by`,
      );
    }
    return {
      kind: 'alias',
      entityType: targetType,
      aliasType: asIdentifier(aliasType, `${path}.${side}_type`),
      field: context.locateFor({ path: String(from) }, `rel_${predicate}_${side}`, path),
    };
  };

  const validFromField =
    relationship.valid_from === undefined
      ? null
      : context.locateFor(
          { path: String(relationship.valid_from) },
          `rel_${predicate}_valid_from`,
          path,
        );

  const skipWhenNull = relationship.skip_when_null === undefined
    ? null
    : (String(relationship.skip_when_null) as 'subject' | 'object');

  return {
    predicate,
    subject: endpoint('subject'),
    object: endpoint('object'),
    validFromField,
    skipWhenNull,
  };
}
