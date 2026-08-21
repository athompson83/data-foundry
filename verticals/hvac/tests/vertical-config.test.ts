/**
 * Vertical CONFIGURATION tests for `hvac`.
 *
 * These validate configuration and data, not platform behaviour — platform logic
 * is tested in `packages/*\/test`.
 *
 * Self-contained by design: imports only `yaml`, `vitest` and Node built-ins.
 * Never a platform package that may not be built yet, and never the ingestion
 * pipeline. A vertical's configuration must be verifiable ON ITS OWN, before any
 * pipeline exists to consume it — that is what makes the config the contract
 * rather than a description of code someone already wrote.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const VERTICAL = join(HERE, '..');

const readYaml = (...segments: string[]): any =>
  parseYaml(readFileSync(join(VERTICAL, ...segments), 'utf8'));
const readJson = (...segments: string[]): any =>
  JSON.parse(readFileSync(join(VERTICAL, ...segments), 'utf8'));

const vertical = readYaml('vertical.yaml');
const relationships = readYaml('relationships.yaml');
const filters = readYaml('filters.yaml');
const seo = readYaml('seo.yaml');
const mcp = readYaml('mcp.yaml');

const entityDefs: Record<string, any> = Object.fromEntries(
  (vertical.entity_types as string[]).map((type) => [type, readYaml('entities', `${type}.yaml`)]),
);

const sourceFiles = readdirSync(join(VERTICAL, 'sources')).filter((f) => f.endsWith('.yaml'));
const sources = sourceFiles.map((f) => readYaml('sources', f));

/** Every property name declared by any entity type in this vertical. */
const declaredProperties = new Set(
  Object.values(entityDefs).flatMap((def: any) => def.properties.map((p: any) => p.name)),
);

describe('vertical.yaml', () => {
  it('declares the agreed shared vocabulary', () => {
    // Other build waves code against these exact strings. A rename here is a
    // breaking change, so it should break a test, loudly, here.
    expect(vertical.slug).toBe('hvac');
    expect(vertical.entity_types).toEqual(['manufacturer', 'equipment_model', 'certification']);
    expect(vertical.relationship_predicates).toEqual([
      'manufactures',
      'supersedes',
      'certified_by',
      'compatible_with',
    ]);
    expect(vertical.alias_types.map((a: any) => a.type)).toEqual([
      'model_number',
      'ahri_ref',
      'manufacturer_sku',
      'upc',
      'series_name',
    ]);
  });

  it('has an entities/ file for every declared entity type', () => {
    for (const type of vertical.entity_types) {
      expect(existsSync(join(VERTICAL, 'entities', `${type}.yaml`))).toBe(true);
      expect(entityDefs[type].entity_type).toBe(type);
    }
  });

  it('ships every document doc 11 requires', () => {
    for (const doc of [
      'README.md',
      'DATA_DICTIONARY.md',
      'SOURCES.md',
      'RIGHTS.md',
      'QUALITY.md',
      'CHANGELOG.md',
    ]) {
      expect(existsSync(join(VERTICAL, doc)), `${doc} is required by doc 11`).toBe(true);
    }
  });

  it('stays DRAFT while its sources are synthetic', () => {
    // No real source has been rights-reviewed. Promoting to ACTIVE would
    // claim a product we do not have the rights to sell.
    expect(vertical.status).toBe('DRAFT');
  });

  it('never merges entities across a supersession edge', () => {
    // Collapsing a model into its successor destroys the replacement lookup
    // that is this vertical's entire commercial thesis.
    expect(vertical.entity_resolution.never_merge_across).toContain('supersedes');
  });

  it('forbids an LLM from executing a merge (AGENTS.md rule 3)', () => {
    expect(vertical.entity_resolution.llm_adjudication.may_execute_merge).toBe(false);
  });
});

describe('entities/', () => {
  it('declares a unit for every unit-bearing property and none for the rest', () => {
    const unitBearing = new Set([
      'cooling_capacity_btu',
      'nominal_tonnage',
      'voltage',
      'sound_level_db',
      'weight_lb',
    ]);
    for (const def of Object.values(entityDefs)) {
      for (const property of (def as any).properties) {
        if (unitBearing.has(property.name)) {
          expect(property.unit, `${property.name} must carry a unit`).toBeTruthy();
        } else {
          expect(property.unit, `${property.name} must not carry a unit`).toBeNull();
        }
      }
    }
  });

  it('uses only platform FACT_VALUE_TYPES', () => {
    const valid = new Set([
      'string', 'number', 'integer', 'boolean', 'date',
      'datetime', 'enum', 'url', 'quantity', 'array', 'object',
    ]);
    for (const def of Object.values(entityDefs)) {
      for (const property of (def as any).properties) {
        expect(valid.has(property.value_type), `${property.name}: ${property.value_type}`).toBe(true);
      }
    }
  });

  it('marks exactly the six critical properties on equipment_model', () => {
    // These drive the indexability quality gate. Changing the set changes which
    // pages may be indexed, so it is a policy decision, not a tidy-up.
    const critical = entityDefs.equipment_model.properties
      .filter((p: any) => p.critical)
      .map((p: any) => p.name)
      .sort();
    expect(critical).toEqual([
      'cooling_capacity_btu',
      'nominal_tonnage',
      'product_type',
      'refrigerant',
      'seer2',
      'voltage',
    ]);
  });

  it('gives every quality rule an id and a severity', () => {
    for (const def of Object.values(entityDefs)) {
      for (const rule of (def as any).quality_rules ?? []) {
        expect(rule.id).toBeTruthy();
        expect(['error', 'warning']).toContain(rule.severity);
      }
    }
  });
});

describe('relationships.yaml', () => {
  it('defines exactly the predicates vertical.yaml declares', () => {
    expect(relationships.predicates.map((p: any) => p.predicate).sort()).toEqual(
      [...vertical.relationship_predicates].sort(),
    );
  });

  it('requires evidence on every predicate (doc 04)', () => {
    for (const predicate of relationships.predicates) {
      expect(predicate.evidence_required, `${predicate.predicate}`).toBe(true);
    }
  });

  it('references only declared entity types', () => {
    for (const predicate of relationships.predicates) {
      expect(vertical.entity_types).toContain(predicate.subject_type);
      expect(vertical.entity_types).toContain(predicate.object_type);
    }
  });

  it('forbids inferring supersession and compatibility', () => {
    // Both are purchasing/safety-relevant claims. Inferring either from
    // specification similarity fabricates advice a source never gave.
    const byName = Object.fromEntries(
      relationships.predicates.map((p: any) => [p.predicate, p]),
    );
    expect(byName.supersedes.inference_allowed).toBe(false);
    expect(byName.compatible_with.inference_allowed).toBe(false);
    expect(byName.compatible_with.transitive_closure_forbidden).toBe(true);
  });

  it('walks supersession transitively', () => {
    // A two-generation-old unit must resolve to the CURRENT model, not to
    // another discontinued one.
    const supersedes = relationships.predicates.find((p: any) => p.predicate === 'supersedes');
    expect(supersedes.transitive).toBe(true);
  });
});

describe('sources/', () => {
  it('declares four sources, all bound to this vertical', () => {
    expect(sources).toHaveLength(4);
    for (const source of sources) {
      expect(source.vertical_slug).toBe(vertical.slug);
    }
  });

  it('carries complete rights metadata on every source (AGENTS.md rule 1)', () => {
    for (const source of sources) {
      for (const field of [
        'publisher', 'domain', 'source_type', 'authority_rank', 'status',
        'refresh_cadence', 'rights_classification', 'attribution_requirement',
        'robots_policy', 'rights_policy', 'acquisition_policy', 'image_policy',
        'provenance_retention', 'license_split',
      ]) {
        expect(source[field], `${source.key}.${field}`).toBeDefined();
      }
      expect(typeof source.kill_switch_engaged).toBe('boolean');
    }
  });

  it('uses only RFC 2606 reserved domains, so no real site can be contacted', () => {
    // This is what makes "no real third-party site is crawled" a property of the
    // data rather than a promise about the code.
    for (const source of sources) {
      expect(source.domain, source.key).toMatch(/\.example\.(com|org|net)$/);
    }
  });

  it('satisfies the activation gate for every ACTIVE source', () => {
    const asOf = Date.now();
    for (const source of sources.filter((s) => s.status === 'ACTIVE')) {
      const where = source.key;
      expect(['GREEN', 'AMBER'], where).toContain(source.rights_classification);
      expect(source.rights_policy.reviewed_by, where).toBeTruthy();
      expect(source.rights_policy.reviewed_at, where).toBeTruthy();
      if (source.rights_policy.next_review_at !== null) {
        expect(
          Date.parse(`${source.rights_policy.next_review_at}T23:59:59Z`),
          `${where}: rights review has lapsed`,
        ).toBeGreaterThan(asOf);
      }
      expect(source.acquisition_policy.approved, where).toBe(true);
      expect(
        source.provenance_retention.retain_artifacts || source.provenance_retention.legal_hold,
        where,
      ).toBe(true);

      const attribution = source.attribution_requirement;
      if (attribution.required) {
        expect(attribution.text, `${where}: required attribution needs a credit line`).toBeTruthy();
      }
      const imageAttribution = source.image_policy.image_attribution;
      if (imageAttribution.required) {
        expect(imageAttribution.text, `${where}: required image attribution needs a credit line`).toBeTruthy();
      }
    }
  });

  it('never permits image caching without reuse rights (AGENTS.md rule 9)', () => {
    for (const source of sources) {
      if (source.image_policy.cache_to_r2_permitted) {
        expect(source.image_policy.images_reusable, source.key).toBe(true);
      }
    }
  });

  it('spans four formats and three independent publisher families', () => {
    // A factory that only handles one shape of source is not a factory.
    expect(new Set(sources.map((s) => s.acquisition_policy.method)).size).toBeGreaterThanOrEqual(3);
    expect(new Set(sources.map((s) => s.source_type)).size).toBe(3);
    // acme-hvac-catalog and acme-spec-sheets share a publisher: 4 sources,
    // 3 families. The independence minimum is met exactly, not exceeded.
    expect(new Set(sources.map((s) => s.publisher)).size).toBe(3);
  });
});

describe('filters.yaml', () => {
  it('references only declared properties', () => {
    for (const field of filters.fields) {
      if (field.field === 'manufacturer') continue; // an entity reference, not a property
      expect(declaredProperties.has(field.field), field.field).toBe(true);
    }
  });

  it('gives every indexable field an seo block with thresholds', () => {
    for (const field of filters.fields.filter((f: any) => f.indexable)) {
      expect(field.seo, field.field).toBeDefined();
      expect(field.seo.min_results, field.field).toBeGreaterThan(0);
    }
  });

  it('explains every non-indexable field (AGENTS.md rule 8)', () => {
    // "Not indexable" must be a decision with a reason, not an oversight.
    for (const field of filters.fields.filter((f: any) => !f.indexable)) {
      expect(field.seo?.reason, `${field.field} needs a reason`).toBeTruthy();
    }
  });

  it('whitelists only a handful of indexable combinations', () => {
    // 13 filterable fields permit thousands of combinations. Four are allowed.
    expect(filters.indexable_combinations.length).toBeLessThanOrEqual(5);
    for (const combination of filters.indexable_combinations) {
      expect(combination.rationale, combination.id).toBeTruthy();
      expect(combination.min_results, combination.id).toBeGreaterThanOrEqual(5);
      expect(combination.fields.length).toBeLessThanOrEqual(3);
    }
  });

  it('caps facet depth at three', () => {
    expect(
      filters.denied_combinations.some((c: any) => c.pattern === 'any_combination_of_four_or_more'),
    ).toBe(true);
  });
});

describe('seo.yaml', () => {
  it('gives every page class a quality gate', () => {
    const gates = new Set(Object.keys(seo.quality_gates));
    for (const pageClass of seo.page_classes) {
      expect(pageClass.quality_gate, pageClass.id).toBeTruthy();
      expect(gates.has(pageClass.quality_gate), `${pageClass.id} -> ${pageClass.quality_gate}`).toBe(true);
    }
  });

  it('demands real fact coverage before an entity page may be indexed', () => {
    // The anti-thin-page numbers rule 8 requires.
    const gate = seo.quality_gates.entity_detail;
    expect(gate.min_critical_fact_coverage).toBeGreaterThanOrEqual(0.75);
    expect(gate.min_total_facts).toBeGreaterThanOrEqual(6);
    // AGENTS.md rule 2: no published fact without evidence.
    expect(gate.min_evidence_coverage).toBe(1.0);
    expect(gate.require_all_sources_publishable).toBe(true);
  });

  it('serves failed pages as noindex,follow rather than hiding them', () => {
    expect(seo.on_gate_failure.robots).toBe('noindex,follow');
    expect(seo.on_gate_failure.in_sitemap).toBe(false);
    // Indexability is a search-engine decision, not a data-availability one.
    expect(seo.on_gate_failure.in_api).toBe(true);
  });

  it('keeps non-indexable pages out of sitemaps', () => {
    expect(seo.sitemaps.include_only_indexable).toBe(true);
  });

  it('maps every agent intent to a declared MCP tool', () => {
    const toolNames = new Set(mcp.tools.map((t: any) => t.name));
    for (const [intent, config] of Object.entries<any>(seo.agent_intents)) {
      expect(toolNames.has(config.tool), `${intent} -> ${config.tool}`).toBe(true);
      expect(config.examples.length, intent).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('mcp.yaml', () => {
  it('exposes a small, intent-shaped tool set (doc 10)', () => {
    expect(mcp.tools.length).toBeGreaterThanOrEqual(4);
    expect(mcp.tools.length).toBeLessThanOrEqual(6);
  });

  it('names no tool as a CRUD wrapper', () => {
    // "get_entity", "list_facts", "search" are database methods in costume.
    const crud = /^(get|list|create|update|delete|read)_(entity|entities|fact|facts|record|records|row|rows)$/;
    for (const tool of mcp.tools) {
      expect(crud.test(tool.name), `${tool.name} is a CRUD wrapper`).toBe(false);
      expect(tool.name).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });

  it('writes descriptions that communicate all five doc 07 requirements', () => {
    for (const tool of mcp.tools) {
      // Intent, identifiers, output meaning, citation behaviour, limitations.
      expect(tool.description.length, `${tool.name} description is too thin`).toBeGreaterThan(300);
      expect(tool.limitations, `${tool.name} must state its limitations`).toBeTruthy();
      expect(tool.evidence, `${tool.name}`).toBe('required');
      expect(tool.errors.length, `${tool.name} must declare its errors`).toBeGreaterThan(0);
      expect(tool.intent, `${tool.name}`).toBeTruthy();
    }
  });

  it('references only declared properties in tool schemas', () => {
    const evidenceTool = mcp.tools.find((t: any) => t.name === 'get_spec_evidence');
    const propertyInput = evidenceTool.inputs.find((i: any) => i.name === 'property');
    for (const property of propertyInput.enum) {
      expect(declaredProperties.has(property), property).toBe(true);
    }
  });

  it('never returns a fact without evidence or an unpublishable source', () => {
    // AGENTS.md rules 1 and 2, enforced at the interface.
    expect(mcp.response_contract.suppress_facts_without_evidence).toBe(true);
    expect(mcp.response_contract.exclude_unpublishable_sources).toBe(true);
    expect(mcp.response_contract.include_evidence_refs).toBe(true);
  });

  it('declares negative cases the server should decline', () => {
    expect(mcp.evals.negative_cases.length).toBeGreaterThanOrEqual(3);
    for (const negativeCase of mcp.evals.negative_cases) {
      expect(negativeCase.reason).toBeTruthy();
    }
  });
});

describe('normalizers/', () => {
  it('contains no TypeScript — a vertical is config, not code (rule 4)', () => {
    const files = readdirSync(join(VERTICAL, 'normalizers'));
    expect(files.filter((f) => f.endsWith('.ts') || f.endsWith('.js'))).toEqual([]);
  });

  it('parses every rule file', () => {
    for (const file of readdirSync(join(VERTICAL, 'normalizers')).filter((f) => f.endsWith('.yaml'))) {
      expect(() => readYaml('normalizers', file), file).not.toThrow();
    }
  });

  it('converts capacity exactly, in both directions', () => {
    const typed = readYaml('normalizers', '02-typed-values.yaml');
    const toBtu = typed.unit_conversions.find((c: any) => c.canonical_unit === 'BTU/h');
    const fromTon = toBtu.convert_from.find((c: any) => c.unit === 'ton');
    // 12000 BTU/h = 1 ton, exact by definition. An inexact factor makes the
    // capacity/tonnage consistency check fail on correct data.
    expect(fromTon.factor).toBe(12000);
    expect(fromTon.exact).toBe(true);

    const derived = typed.derived_properties;
    expect(derived.map((d: any) => d.property).sort()).toEqual([
      'cooling_capacity_btu',
      'nominal_tonnage',
    ]);
    // A derived value must never displace a directly published one.
    for (const rule of derived) {
      expect(rule.only_if_absent, rule.property).toBe(true);
    }
  });

  it('maps every declared source and only declared sources', () => {
    const mappings = readYaml('normalizers', 'source-mappings.yaml');
    expect(mappings.sources.map((s: any) => s.source_key).sort()).toEqual(
      sources.map((s) => s.key).sort(),
    );
  });

  it('gives a reason for every excluded field', () => {
    // An explicit exclusion list stops the same "should we take this?" debate
    // recurring every time someone reads the fixture.
    const mappings = readYaml('normalizers', 'source-mappings.yaml');
    for (const source of mappings.sources) {
      const excluded = [
        ...(source.excluded_fields ?? []),
        ...(source.records ?? []).flatMap((r: any) => r.excluded_fields ?? []),
      ];
      for (const field of excluded) {
        expect(field.reason, `${source.source_key}: ${field.path}`).toBeTruthy();
      }
    }
  });

  it('orders fact selection by doc 04 criteria, with authority first among sources', () => {
    const selection = readYaml('normalizers', 'fact-selection.yaml');
    // ADR-0002: the auditable editorial override is criterion 0, ahead of every
    // source-derived criterion. Authority leads the source-derived ones.
    expect(selection.strategy[0]).toBe('editorial_override');
    expect(selection.strategy[1]).toBe('authoritative_source');
    // ...and it is only allowed there because it must be attributable.
    expect(selection.editorial_override.requires_reason).toBe(true);
    expect(selection.editorial_override.requires_reviewer).toBe(true);
    // Corroboration must not be able to outvote an authoritative source.
    expect(selection.strategy.indexOf('corroboration')).toBeGreaterThan(1);
    expect(selection.corroboration.affects_selection).toBe(false);
    // AGENTS.md rules 2 and 10: losing claims are retained, never deleted.
    expect(selection.conflict_policy.retain_losing_claims).toBe(true);
    expect(selection.conflict_policy.record_selection_reason).toBe(true);
  });

  it('prefers the certifying body for every certified performance rating', () => {
    const selection = readYaml('normalizers', 'fact-selection.yaml');
    for (const property of ['seer2', 'eer2', 'hspf2']) {
      expect(
        selection.authoritative_by_property[property].prefer_source_types,
        property,
      ).toContain('CERTIFICATION_BODY');
      expect(selection.authoritative_by_property[property].rationale, property).toBeTruthy();
    }
  });
});

describe('fixtures/', () => {
  it('ships one artifact per source, in its native format', () => {
    for (const file of [
      'acme-catalog.json',
      'coolsupply-listing.html',
      'ahri-export.csv',
      'acme-spec.pdf',
      'generate-acme-spec-pdf.ts',
    ]) {
      expect(existsSync(join(VERTICAL, 'fixtures', file)), file).toBe(true);
    }
  });

  it('commits a real PDF, not a placeholder', () => {
    const pdf = readFileSync(join(VERTICAL, 'fixtures', 'acme-spec.pdf'));
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(1000);
  });

  it('parses the JSON feed and covers six models', () => {
    const catalog = readJson('fixtures', 'acme-catalog.json');
    expect(catalog.products).toHaveLength(6);
    for (const product of catalog.products) {
      expect(product.model).toMatch(/^[A-Z0-9]+$/);
      expect(product.cooling_capacity_btuh).toBeGreaterThan(0);
    }
  });

  it('parses the CSV export and covers eleven certified models', () => {
    const csv = readFileSync(join(VERTICAL, 'fixtures', 'ahri-export.csv'), 'utf8');
    const lines = csv.split(/\r?\n/).filter((l) => l.trim() !== '' && !l.startsWith('#'));
    expect(lines.length - 1).toBe(11); // minus the header row
    expect(lines[0]).toContain('AHRI Certified Reference Number');
  });

  it('renders distributor specs client-side, forcing the browser path', () => {
    const html = readFileSync(join(VERTICAL, 'fixtures', 'coolsupply-listing.html'), 'utf8');
    expect((html.match(/class="product-card"/g) ?? [])).toHaveLength(5);
    expect(html).toContain('<script>');
    const distributor = sources.find((s) => s.key === 'coolsupply-distributor');
    expect(distributor.acquisition_policy.method).toBe('BROWSER_RUN');
  });
});
