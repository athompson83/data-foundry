/**
 * The source-mapping compiler, on the real `hvac` configuration.
 *
 * These are the assertions that keep AGENTS.md rule 4 honest. Everything the
 * pipeline does to a specific source is derived here from
 * `normalizers/source-mappings.yaml` plus the shared normalizer layers; if any
 * of it were hard-coded, onboarding a fifth source would mean editing
 * TypeScript, and the "a vertical is configuration, not a fork" claim would be
 * false.
 */
import { describe, expect, it, beforeAll } from 'vitest';
import { parseExtractionSchema } from '@data-foundry/extraction';
import { parseNormalizationRuleSet } from '@data-foundry/normalization';
import { compileSourcePlans, type SourcePlan } from '../src/compile.js';
import { loadVerticalConfig, primaryAliasType, type VerticalConfig } from '../src/config.js';
import { AliasNormalizer, slugify, upcMod10 } from '../src/identifiers.js';
import { buildFactSelectionPolicy, buildFieldMetadata } from '../src/fact-policy.js';
import { buildFixtureManifest } from '../src/fixtures.js';
import { classifyError, IngestError, MappingCompilationError } from '../src/errors.js';

let config: VerticalConfig;
let plans: SourcePlan[];

const planFor = (key: string): SourcePlan => {
  const plan = plans.find((candidate) => candidate.sourceKey === key);
  if (plan === undefined) throw new Error(`no compiled plan for ${key}`);
  return plan;
};

beforeAll(async () => {
  config = await loadVerticalConfig('hvac');
  plans = compileSourcePlans(config);
});

describe('vertical configuration loading', () => {
  it('loads every declared source as a complete rights record (rule 1)', () => {
    expect(config.sources).toHaveLength(4);
    for (const source of config.sources) {
      expect(source.rights_policy.reviewed_by).not.toBeNull();
      expect(source.rights_policy.reviewed_at).not.toBeNull();
      expect(source.acquisition_policy.approved).toBe(true);
    }
  });

  it('reads the publisher alias table and the controlled vocabularies as data', () => {
    expect(config.publisherAliases.map((publisher) => publisher.key)).toEqual([
      'acme-climate-systems',
      'northwind-air-systems',
      'borealis-thermal-works',
    ]);
    expect(Object.keys(config.vocabularies).sort()).toEqual(['product_type', 'refrigerant']);
    // `unmapped_term_policy: quarantine` means an unknown term is a recorded
    // failure, never a value that quietly becomes canonical.
    expect(config.vocabularies['product_type']?.allow_unmapped).toBe(false);
  });

  it('derives the alias type an inbound reference names an entity by', () => {
    expect(primaryAliasType(config, 'equipment_model')).toBe('model_number');
    // `ahri_ref` applies to both types; a certification has nothing else, so it
    // must not be chosen for `equipment_model` or `certified_by` would join the
    // wrong side.
    expect(primaryAliasType(config, 'certification')).toBe('ahri_ref');
  });
});

describe('compiled extraction schemas', () => {
  it('compiles one valid schema per declared stream', () => {
    expect(plans.map((plan) => plan.sourceKey).sort()).toEqual([
      'acme-hvac-catalog',
      'acme-spec-sheets',
      'ahri-directory-export',
      'coolsupply-distributor',
    ]);
    for (const plan of plans) {
      for (const stream of plan.streams) {
        // The extraction package's own validator is the arbiter.
        expect(() => parseExtractionSchema(stream.schema)).not.toThrow();
        expect(() => parseNormalizationRuleSet(stream.ruleSet)).not.toThrow();
      }
    }
  });

  it('yields two streams from one CSV row: the certification and the certified model', () => {
    const plan = planFor('ahri-directory-export');
    expect(plan.streams.map((stream) => stream.stream)).toEqual([
      'certifications',
      'certified_models',
    ]);
    expect(plan.streams.map((stream) => stream.entityType)).toEqual([
      'certification',
      'equipment_model',
    ]);
    // Distinct source-native keys, so the two records cannot collide in
    // `(source_id, source_record_key)`.
    expect(plan.streams[0]?.schema.record_key.fields).toEqual(['alias_ahri_ref']);
    expect(plan.streams[1]?.schema.record_key.fields).toEqual(['alias_model_number']);
  });

  it('reads one field once when two properties come from the same string', () => {
    // `208/230-1-60` is voltage AND phase. Evidence for either has to point a
    // human at that one value, so both properties read the same field.
    const stream = planFor('acme-hvac-catalog').streams[0]!;
    const voltage = stream.ruleSet.properties.find((rule) => rule.property === 'voltage');
    const phase = stream.ruleSet.properties.find((rule) => rule.property === 'phase');
    expect(voltage?.source_field).toBe(phase?.source_field);
    expect(stream.schema.fields.filter((field) => field.locate.kind === 'json_pointer' &&
      field.locate.pointer === '/electrical')).toHaveLength(1);

    // The declared capture is pulled out by name, not by position.
    expect(voltage?.transforms?.[0]).toMatchObject({ kind: 'replace', replacement: '$<v_low>' });
    expect(phase?.transforms?.[0]).toMatchObject({ kind: 'replace', replacement: '$<phase>' });
  });

  it('compiles a column-aligned PDF label into an anchored line pattern', () => {
    const stream = planFor('acme-spec-sheets').streams[0]!;
    const sound = stream.schema.fields.find((field) => field.field === 'prop_sound_level_db');
    expect(sound?.locate).toEqual({
      kind: 'pdf_regex',
      pattern: '^Sound Level\\s+(.+)$',
      group: 1,
    });
  });

  it('derives a missing unit-twin property only where the source does not publish it', () => {
    // BTU/h published, tons derived.
    const catalog = planFor('acme-hvac-catalog').streams[0]!;
    const derivedTonnage = catalog.ruleSet.properties.find(
      (rule) => rule.property === 'nominal_tonnage',
    );
    expect(derivedTonnage?.source_field).toBe('prop_cooling_capacity_btu');
    expect(derivedTonnage).toMatchObject({
      output_kind: 'DERIVED_METRIC',
      derived_from_property: 'cooling_capacity_btu',
      transformation_ref: 'hvac.nominal_tonnage.from.cooling_capacity_btu.v1',
    });
    expect(derivedTonnage?.transforms?.[0]).toMatchObject({
      kind: 'quantity',
      target_unit: 'ton',
      default_unit: 'BTU/h',
    });

    // Tons published, BTU/h derived — the same rule in the other direction.
    const distributor = planFor('coolsupply-distributor').streams[0]!;
    const derivedCapacity = distributor.ruleSet.properties.find(
      (rule) => rule.property === 'cooling_capacity_btu',
    );
    expect(derivedCapacity?.source_field).toBe('prop_nominal_tonnage');
    expect(derivedCapacity).toMatchObject({
      output_kind: 'DERIVED_METRIC',
      derived_from_property: 'nominal_tonnage',
      transformation_ref: 'hvac.cooling_capacity_btu.from.nominal_tonnage.v1',
    });

    // Both published: nothing is derived, because derivation cannot add
    // information to a directly published pair.
    const specs = planFor('acme-spec-sheets').streams[0]!;
    const tonnageRules = specs.ruleSet.properties.filter(
      (rule) => rule.property === 'nominal_tonnage',
    );
    expect(tonnageRules).toHaveLength(1);
    expect(tonnageRules[0]?.source_field).toBe('prop_nominal_tonnage');

    // A certification has no tonnage property, so no rule is invented for it.
    const certifications = planFor('ahri-directory-export').streams[0]!;
    expect(
      certifications.ruleSet.properties.some((rule) => rule.property === 'nominal_tonnage'),
    ).toBe(false);
  });

  it('compiles the inverted supersession edge exactly as the mapping declares it', () => {
    const stream = planFor('acme-hvac-catalog').streams[0]!;
    const supersedes = stream.relationships.find((edge) => edge.predicate === 'supersedes');
    // The feed says "this model was replaced_by X"; the canonical edge runs
    // successor → predecessor. Getting this backwards answers every replacement
    // question with the discontinued unit.
    expect(supersedes?.subject).toMatchObject({
      kind: 'alias',
      entityType: 'equipment_model',
      aliasType: 'model_number',
    });
    expect(supersedes?.object).toEqual({ kind: 'self' });
    expect(supersedes?.skipWhenNull).toBe('subject');
  });

  it('routes a brand string through the publisher table and a certification through its ref', () => {
    const certified = planFor('ahri-directory-export').streams[1]!;
    const manufactures = certified.relationships.find((edge) => edge.predicate === 'manufactures');
    expect(manufactures?.subject.kind).toBe('publisher');
    expect(manufactures?.object).toEqual({ kind: 'self' });

    const certifiedBy = certified.relationships.find((edge) => edge.predicate === 'certified_by');
    expect(certifiedBy?.subject).toEqual({ kind: 'self' });
    expect(certifiedBy?.object).toMatchObject({
      kind: 'alias',
      entityType: 'certification',
      aliasType: 'ahri_ref',
    });
    expect(certifiedBy?.validFromField).not.toBeNull();
  });

  it('resolves the PDF publisher from a declared literal rather than inferring it', () => {
    const stream = planFor('acme-spec-sheets').streams[0]!;
    const manufactures = stream.relationships.find((edge) => edge.predicate === 'manufactures');
    expect(manufactures?.subject).toMatchObject({
      kind: 'publisher',
      literal: 'Acme Climate Systems',
    });
  });

  it('reports rather than hides a record key it cannot reach', () => {
    // `[data-item]` is an attribute of the record element itself, which no
    // field selector in the extraction contract can read.
    const stream = planFor('coolsupply-distributor').streams[0]!;
    expect(stream.diagnostics.join(' ')).toContain('[data-item]');
    expect(stream.schema.record_key.fields).toEqual(['alias_model_number']);
  });

  it('refuses a mapping that names a property the entity type does not declare', () => {
    const broken = {
      source_key: 'broken',
      format: 'json',
      records: [
        {
          stream: 'x',
          entity_type: 'equipment_model',
          record_path: '/items',
          source_record_key: '/id',
          aliases: [{ alias_type: 'model_number', path: '/id', strong: true }],
          properties: [{ property: 'colour', path: '/colour' }],
        },
      ],
    };
    expect(() => compileSourcePlans({ ...config, sourceMappings: { sources: [broken] } })).toThrow(
      MappingCompilationError,
    );
  });
});

describe('alias normalization follows the vertical, not a built-in default', () => {
  it('collapses every declared identifier the way layer 3 says to', async () => {
    const normalizer = new AliasNormalizer(config);
    // Separators are meaningless in a model number here, so they are stripped…
    expect(normalizer.normalize('model_number', '24acc6-36a003')).toBe('24ACC636A003');
    expect(normalizer.normalize('model_number', '24ACC6 36A003')).toBe('24ACC636A003');
    expect(normalizer.normalize('model_number', 'BTW-C2036')).toBe('BTWC2036');
    // …and structural in a SKU, whose prefix identifies the manufacturer, so
    // they are kept.
    expect(normalizer.normalize('manufacturer_sku', 'acs-24acc636a003')).toBe('ACS-24ACC636A003');
    expect(normalizer.normalize('ahri_ref', 'AHRI-20134501')).toBe('20134501');
    expect(normalizer.normalize('upc', '83456120010')).toBe('083456120010');
    // Marketing series keeps its spacing and case: it is a label, not a key.
    expect(normalizer.normalize('series_name', 'comfort  16')).toBe('Comfort 16');
    // Company names fall back to the platform default for name-like aliases.
    expect(normalizer.normalize('legal_name', 'Acme Climate Systems')).toBe('ACME CLIMATE SYSTEMS');
  });

  it('quarantines a value that fails the declared validation', () => {
    const normalizer = new AliasNormalizer(config);
    expect(normalizer.validate('model_number', 'AB')).toContain('minimum length');
    expect(normalizer.validate('model_number', '24ACC636A003')).toBeNull();
    // A mistyped barcode that reaches the alias index attaches one product's
    // identity to another, so the check digit is used rather than trusted.
    expect(normalizer.validate('upc', '083456120011')).toContain('check digit');
    expect(normalizer.validate('upc', '083456120010')).toBeNull();
  });

  it('computes UPC check digits and slugs deterministically', () => {
    expect(upcMod10('083456120010')).toBe(true);
    expect(upcMod10('083456120019')).toBe(false);
    expect(upcMod10('nope')).toBe(false);
    expect(slugify('Acme Climate Systems')).toBe('acme-climate-systems');
    expect(slugify('BTW-C2036')).toBe('btw-c2036');
  });
});

describe('fact selection policy derived from the vertical', () => {
  it('expands "prefer this source type" into the sources that have it', () => {
    const policy = buildFactSelectionPolicy(config, { at: '2026-07-15T09:00:00.000Z' as never });
    // The certification body is the authority for certified performance…
    expect(policy.authoritativeSourcesByProperty?.['seer2']).toEqual([
      'ratings-directory.example.org',
    ]);
    // …and the manufacturer for what it builds. Two different answers from one
    // declaration, which is why authority is per property, not per source.
    expect(policy.authoritativeSourcesByProperty?.['sound_level_db']).toEqual([
      'catalog.acme-climate.example.com',
      'docs.acme-climate.example.com',
    ]);
    expect(policy.requirePublishableRights).toBe(true);
  });

  it('carries per-field reliability overrides keyed by the source domain', () => {
    const policy = buildFactSelectionPolicy(config, { at: '2026-07-15T09:00:00.000Z' as never });
    expect(policy.fieldReliability?.['sound_level_db']?.['www.coolsupply.example.com']).toBe(0.3);
    expect(policy.fieldReliability?.['upc']?.['www.coolsupply.example.com']).toBe(0.95);
  });

  it('turns declared range and enum quality rules into deterministic checks', () => {
    const policy = buildFactSelectionPolicy(config, { at: '2026-07-15T09:00:00.000Z' as never });
    const ids = (policy.consistencyChecks ?? []).map((check) => check.id);
    expect(ids).toContain('numeric_range:seer2');
    expect(ids).toContain('numeric_range:cooling_capacity_btu');
    expect(ids).toContain('enum_membership:refrigerant');
  });

  it('derives query-layer field metadata from filters.yaml', () => {
    const fields = buildFieldMetadata(config);
    const productType = fields.find((field) => field.field === 'product_type');
    expect(productType?.filter?.type).toBe('multi_select');
    expect(productType?.search_boost).toBeGreaterThan(0);
    expect(fields.length).toBe((config.filters.fields as unknown[]).length);
  });
});

describe('fixture binding', () => {
  it('binds each source to the fixture its own registry entry names', async () => {
    const { bindings } = await buildFixtureManifest(config);
    const byKey = Object.fromEntries(bindings.map((binding) => [binding.sourceKey, binding]));
    expect(byKey['acme-hvac-catalog']?.file).toBe('acme-catalog.json');
    expect(byKey['coolsupply-distributor']?.file).toBe('coolsupply-listing.html');
    expect(byKey['ahri-directory-export']?.file).toBe('ahri-export.csv');
    // Named nowhere in its entry, but the only PDF in the fixture set.
    expect(byKey['acme-spec-sheets']?.file).toBe('acme-spec.pdf');
  });

  it('serves each fixture at a path the source itself declares crawlable', async () => {
    const { bindings } = await buildFixtureManifest(config);
    for (const binding of bindings) {
      const entry = config.sources.find((source) => source.key === binding.sourceKey);
      const url = new URL(binding.entry.url);
      expect(url.hostname).toBe(entry?.domain);
      // A fixture only reachable at a disallowed path would be testing a
      // request we are not permitted to make.
      expect(
        entry?.robots_policy.allowed_paths.some((path) => url.pathname.startsWith(path)),
      ).toBe(true);
      expect(binding.entry.headers?.['etag']).toMatch(/^"[0-9a-f]{32}"$/);
    }
  });

  it('serves an override in place of the file on disk', async () => {
    const { bindings } = await buildFixtureManifest(config, {
      overrides: { 'acme-hvac-catalog': '{"products":[]}' },
    });
    const binding = bindings.find((entry) => entry.sourceKey === 'acme-hvac-catalog');
    expect(binding?.entry.body).toBe('{"products":[]}');
    expect(binding?.entry.file).toBeUndefined();
  });
});

describe('error classification decides what the retry budget is spent on', () => {
  it('never retries a rights refusal', () => {
    const error = Object.assign(new Error('nope'), { name: 'RightsViolationError' });
    expect(classifyError(error).retryable).toBe(false);
  });

  it('never retries a configuration mistake', () => {
    expect(classifyError(new IngestError('X', 'bad config', 'CONFIGURATION')).retryable).toBe(false);
  });

  it('retries a transient failure', () => {
    expect(classifyError(new IngestError('X', 'upstream hiccup', 'TRANSIENT')).retryable).toBe(true);
  });

  it('treats an unclassified failure as worth one more bounded attempt', () => {
    expect(classifyError('something odd').retryable).toBe(true);
    expect(classifyError('something odd').code).toBe('UNKNOWN');
  });
});
