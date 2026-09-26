/**
 * Vertical CONFIGURATION tests for `vehicles`.
 *
 * Self-contained like HVAC's: `yaml`, `vitest` and Node built-ins only. The
 * platform proof (real pipeline, real database) is `shape-ingest.test.ts`.
 *
 * Three things this file holds that are specific to where this vertical is:
 *   1. every source is FAIL-CLOSED — no rights determination has been captured;
 *   2. every fixture is a SYNTHETIC SHAPE FIXTURE and says so;
 *   3. every source column the mappings read is listed in SOURCES.md as
 *      UNVERIFIED, so none can reach activation unchecked.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const VERTICAL = join(HERE, '..');
const HVAC = join(VERTICAL, '..', 'hvac');

const read = (...segments: string[]): string => readFileSync(join(VERTICAL, ...segments), 'utf8');
const readYaml = (...segments: string[]): any => parseYaml(read(...segments));
const readJson = (...segments: string[]): any => JSON.parse(read(...segments));

const vertical = readYaml('vertical.yaml');
const relationships = readYaml('relationships.yaml');
const filters = readYaml('filters.yaml');
const seo = readYaml('seo.yaml');
const mcp = readYaml('mcp.yaml');
const product = readYaml('product.yaml');
const acquisition = readYaml('acquisition.yaml');
const mappings = readYaml('normalizers', 'source-mappings.yaml');
const domain = readYaml('normalizers', '03-domain-normalization.yaml');

const entityDefs: Record<string, any> = Object.fromEntries(
  (vertical.entity_types as string[]).map((type) => [type, readYaml('entities', `${type}.yaml`)]),
);
const sources = readdirSync(join(VERTICAL, 'sources'))
  .filter((file) => file.endsWith('.yaml'))
  .map((file) => readYaml('sources', file));

const BANNER = 'SYNTHETIC SHAPE FIXTURE — replace with captured artifacts before activation';

describe('vertical.yaml', () => {
  it('declares the agreed vocabulary', () => {
    expect(vertical.slug).toBe('vehicles');
    expect(vertical.entity_types).toEqual([
      'make',
      'vehicle_model_year',
      'vehicle_configuration',
      'recall_campaign',
    ]);
    expect(vertical.relationship_predicates).toEqual(['makes', 'configuration_of', 'recall_affects']);
    expect(vertical.alias_types.map((alias: any) => alias.type)).toEqual([
      'make_model_year',
      'epa_vehicle_id',
      'nhtsa_campaign_number',
    ]);
  });

  it('stays DRAFT while no source is determined or activated', () => {
    expect(vertical.status).toBe('DRAFT');
  });

  it('ships every document doc 11 requires and an entity file per type', () => {
    for (const doc of ['README.md', 'DATA_DICTIONARY.md', 'SOURCES.md', 'RIGHTS.md', 'QUALITY.md', 'CHANGELOG.md']) {
      expect(existsSync(join(VERTICAL, doc)), doc).toBe(true);
    }
    for (const type of vertical.entity_types) expect(entityDefs[type].entity_type).toBe(type);
  });

  it('forbids an LLM from executing a merge and never merges across an edge', () => {
    expect(vertical.entity_resolution.llm_adjudication.may_execute_merge).toBe(false);
    expect(vertical.entity_resolution.never_merge_across).toEqual(['recall_affects', 'configuration_of']);
  });

  it('declares only narrow, exact blocking keys (no n-squared same-make or year-prefix blocks)', () => {
    const keys = vertical.entity_resolution.blocking_keys;
    expect(keys.map((key: any) => key.key)).toEqual(['model_name_and_year', 'epa_vehicle_id', 'nhtsa_campaign_number']);
    for (const key of keys) {
      expect(key.kind).not.toBe('related_entity');
      expect(key.prefix_length).toBeUndefined();
    }
  });
});

describe('sources are fail-closed until an ADR-0013 determination is captured', () => {
  it('declares exactly the three federal sources', () => {
    expect(sources.map((source) => source.key).sort()).toEqual([
      'epa-fueleconomy-vehicles',
      'nhtsa-recalls',
      'nhtsa-vpic',
    ]);
  });

  it.each(sources.map((source) => [source.key, source]))('%s is UNDER_REVIEW, UNREVIEWED and unapproved', (_key, source: any) => {
    expect(source.vertical_slug).toBe('vehicles');
    expect(source.status).toBe('UNDER_REVIEW');
    expect(source.rights_classification).toBe('UNREVIEWED');
    expect(source.authority_rank).toBe(0);
    expect(source.acquisition_policy.approved).toBe(false);
    expect(source.acquisition_policy.approved_by).toBeNull();
    expect(source.rights_policy.commercial_use_allowed).toBe(false);
    expect(source.rights_policy.redistribution_allowed).toBe(false);
    expect(source.rights_policy.derivative_normalization_allowed).toBe(false);
    expect(source.rights_policy.reviewed_by).toBeNull();
    expect(source.rights_policy.reviewed_at).toBeNull();
    expect(source.kill_switch_engaged).toBe(false);
    expect(source.notes).toContain('PUBLIC_DOMAIN_US_GOVERNMENT_WORK');
  });

  it('schedules no acquisition target', () => {
    expect(acquisition.targets).toEqual([]);
  });

  it('maps only the two sources that have fixtures; vPIC is declared, not mapped', () => {
    expect(mappings.sources.map((source: any) => source.source_key)).toEqual([
      'epa-fueleconomy-vehicles',
      'nhtsa-recalls',
    ]);
  });
});

describe('synthetic shape fixtures', () => {
  const fixtures = readdirSync(join(VERTICAL, 'fixtures')).filter((file) => /\.(csv|json)$/.test(file));

  it('marks every fixture and golden file with the synthetic banner', () => {
    expect(fixtures.sort()).toEqual(['epa-vehicles.csv', 'nhtsa-flat-rcl.csv']);
    for (const file of fixtures) expect(read('fixtures', file).split('\n')[0], file).toContain(BANNER);
    for (const file of ['entities.json', 'facts.json', 'relationships.json']) {
      expect(readJson('fixtures', 'golden', file)._banner, file).toContain(BANNER);
    }
    expect(read('fixtures', 'README.md')).toContain(BANNER);
    expect(read('fixtures', 'golden', 'README.md')).toContain(BANNER);
  });

  it('uses only fictional makes that the publisher table declares', () => {
    const declared = Object.values(domain.publisher_aliases).flatMap((entry: any) =>
      [entry.canonical_name, ...entry.aliases].map((name: string) => name.toLowerCase()),
    );
    expect(declared).not.toEqual(expect.arrayContaining(['honda', 'toyota', 'ford']));
    const epaMakes = new Set(epaRows().map((row) => row['make']!.toLowerCase()));
    const nhtsaMakes = new Set(nhtsaVehicleRows().map((row) => row['MAKETXT']!.toLowerCase()));
    for (const make of [...epaMakes, ...nhtsaMakes]) expect(declared).toContain(make);
  });
});

/** Every source column the mappings read, by source. */
function mappedColumns(): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  const add = (sourceKey: string, value: unknown): void => {
    const set = out.get(sourceKey) ?? new Set<string>();
    for (const column of Array.isArray(value) ? value : value === undefined ? [] : [value]) set.add(String(column));
    out.set(sourceKey, set);
  };
  for (const source of mappings.sources) {
    for (const record of source.records) {
      add(source.source_key, record.source_record_key);
      add(source.source_key, record.where?.column);
      for (const mapping of [...(record.aliases ?? []), ...(record.properties ?? [])]) {
        add(source.source_key, mapping.path ?? mapping.paths);
      }
      for (const relationship of record.relationships ?? []) {
        add(source.source_key, relationship.subject_from);
        add(source.source_key, relationship.object_from);
      }
    }
  }
  return out;
}

describe('SOURCES.md lists every column the mappings read as UNVERIFIED', () => {
  const sourcesDoc = read('SOURCES.md');
  const section = sourcesDoc.slice(sourcesDoc.indexOf('## Unverified source assumptions'));

  it('has the unverified-assumptions section', () => {
    expect(sourcesDoc).toContain('## Unverified source assumptions');
  });

  for (const [sourceKey, columns] of mappedColumns()) {
    it(`${sourceKey}: every mapped column is named`, () => {
      for (const column of columns) expect(section, column).toContain(`\`${column}\``);
    });
  }

  it('also names the declared NHTSA column order', () => {
    const nhtsa = mappings.sources.find((source: any) => source.source_key === 'nhtsa-recalls');
    for (const column of nhtsa.parsing.columns) expect(section, column).toContain(`\`${column}\``);
  });
});

describe('NHTSA recall-type row filter', () => {
  const nhtsa = mappings.sources.find((source: any) => source.source_key === 'nhtsa-recalls');

  it('keeps only vehicle (RCLTYPECD V) rows on every NHTSA stream', () => {
    for (const record of nhtsa.records) {
      expect(record.where, record.stream).toEqual({ column: 'RCLTYPECD', in: ['V'] });
    }
  });

  it('exercises the filter with at least one non-vehicle fixture row that no golden contains', () => {
    const excluded = nhtsaRows().filter((row) => row['RCLTYPECD'] !== 'V');
    expect(excluded.map((row) => row['RCLTYPECD']).sort()).toEqual(['E', 'T']);
    // The equipment row names a declared make, so without the filter it would
    // create a model year and a campaign.
    const declared = Object.values(domain.publisher_aliases).flatMap((entry: any) =>
      [entry.canonical_name, ...entry.aliases].map((name: string) => name.toLowerCase()),
    );
    expect(excluded.some((row) => declared.includes(row['MAKETXT']!.toLowerCase()))).toBe(true);
    const golden = JSON.stringify([
      readJson('fixtures', 'golden', 'entities.json'),
      readJson('fixtures', 'golden', 'facts.json'),
      readJson('fixtures', 'golden', 'relationships.json'),
    ]).toUpperCase();
    for (const row of excluded) {
      expect(golden, row['CAMPNO']).not.toContain(row['CAMPNO']!);
      expect(golden, row['MODELTXT']).not.toContain(row['MODELTXT']!.replace(/[-_. /\\]/g, ''));
    }
  });

  it('records the recall-type codes as unverified in SOURCES.md', () => {
    const sourcesDoc = read('SOURCES.md');
    expect(sourcesDoc).toMatch(/RCLTYPECD[^\n]*UNVERIFIED|UNVERIFIED[^\n]*RCLTYPECD/);
  });
});

describe('identifier rules (ADR-0003 gate)', () => {
  const hvacRule = parseYaml(readFileSync(join(HVAC, 'normalizers', '03-domain-normalization.yaml'), 'utf8'))
    .identifier_rules.find((rule: any) => rule.alias_type === 'model_number');

  it('uses exactly HVAC’s case-fold-and-strip-separators operation chain for every alias', () => {
    // The ADR-0003 onboarding gate: a vertical whose identifier equivalence
    // differs from the already-proved one must prove its own read/write parity
    // first. This vertical adds no new kind of equivalence.
    for (const rule of domain.identifier_rules) expect(rule.ops, rule.alias_type).toEqual(hvacRule.ops);
  });

  const normalize = (raw: string): string => raw.toUpperCase().replace(/[-_. /\\]/g, '');

  it('proves the declared equivalences and non-equivalences on fixture spellings', () => {
    expect(normalize('Placeholder Motor Works PM-3 2022')).toBe(normalize('PLACEHOLDER MOTOR WORKS PM3 2022'));
    expect(normalize('Examplar Motors Roadster 2020')).toBe(normalize('EXAMPLAR MOTORS ROADSTER 2020'));
    expect(normalize('20v-901-000')).toBe('20V901000');
    expect(normalize('Placeholder Motor Works PM-30 2022')).not.toBe(normalize('Placeholder Motor Works PM-300 2022'));
    expect(normalize('Placeholder Motor Works PM-3 2021')).not.toBe(normalize('Placeholder Motor Works PM-3 2022'));
  });

  it('validates the documented campaign-number shape', () => {
    const rule = domain.identifier_rules.find((candidate: any) => candidate.alias_type === 'nhtsa_campaign_number');
    const pattern = new RegExp(rule.validate.pattern);
    expect(pattern.test('20V314000')).toBe(true);
    expect(pattern.test('20X314000')).toBe(false);
    expect(pattern.test('20V31400')).toBe(false);
  });
});

describe('golden records are consistent with the fixtures and the declared rules', () => {
  const entities = readJson('fixtures', 'golden', 'entities.json');
  const facts = readJson('fixtures', 'golden', 'facts.json');
  const golden = readJson('fixtures', 'golden', 'relationships.json');
  const normalize = (raw: string): string => raw.toUpperCase().replace(/[-_. /\\]/g, '');

  it('has the documented population', () => {
    expect(entities.counts).toEqual({ make: 3, vehicle_model_year: 10, vehicle_configuration: 12, recall_campaign: 5, total: 30 });
    expect(entities.entities).toHaveLength(30);
    expect(golden.counts).toEqual({ configuration_of: 12, makes: 10, recall_affects: 7 });
    expect(facts.count).toBe(facts.facts.length);
  });

  it('derives every model-year key from a fixture row of either agency', () => {
    const fromEpa = epaRows().map((row) => normalize(`${row['make']} ${row['baseModel']} ${row['year']}`));
    const fromNhtsa = nhtsaVehicleRows().map((row) => normalize(`${row['MAKETXT']} ${row['MODELTXT']} ${row['YEARTXT']}`));
    const expected = new Set([...fromEpa, ...fromNhtsa]);
    const actual = new Set(
      entities.entities
        .filter((entity: any) => entity.entity_type === 'vehicle_model_year')
        .map((entity: any) => entity.ref.split(':')[1]),
    );
    expect([...actual].sort()).toEqual([...expected].sort());
  });

  it('references only golden entities from every fact and edge', () => {
    const refs = new Set(entities.entities.map((entity: any) => entity.ref));
    for (const fact of facts.facts) expect(refs.has(fact.entity), fact.entity).toBe(true);
    for (const edge of golden.relationships) {
      expect(refs.has(edge.subject), edge.subject).toBe(true);
      expect(refs.has(edge.object), edge.object).toBe(true);
      expect(vertical.relationship_predicates).toContain(edge.predicate);
    }
  });

  it('names a declared property and a mapped source on every fact', () => {
    for (const fact of facts.facts) {
      const type = fact.entity.split(':')[0];
      const declared = entityDefs[type].properties.map((property: any) => property.name);
      expect(declared, `${fact.entity}.${fact.property}`).toContain(fact.property);
      expect(fact.sources.length).toBeGreaterThan(0);
    }
  });
});

describe('relationships.yaml, filters.yaml, seo.yaml, mcp.yaml, product.yaml', () => {
  it('defines exactly the declared predicates, all evidenced and never inferred', () => {
    expect(relationships.predicates.map((p: any) => p.predicate).sort()).toEqual(
      [...vertical.relationship_predicates].sort(),
    );
    for (const predicate of relationships.predicates) {
      expect(predicate.evidence_required).toBe(true);
      expect(predicate.inference_allowed).toBe(false);
      expect(vertical.entity_types).toContain(predicate.subject_type);
      expect(vertical.entity_types).toContain(predicate.object_type);
    }
  });

  it('filters only on declared properties', () => {
    const declared = new Set(Object.values(entityDefs).flatMap((def: any) => def.properties.map((p: any) => p.name)));
    for (const field of filters.fields) expect(declared.has(field.field), field.field).toBe(true);
  });

  it('gives every indexable page class a quality gate and never indexes a configuration page', () => {
    for (const page of seo.page_classes) {
      expect(seo.quality_gates[page.quality_gate], page.id).toBeDefined();
    }
    const configuration = seo.page_classes.find((page: any) => page.id === 'vehicle_configuration_detail');
    expect(configuration.indexable).toBe(false);
    expect(configuration.sitemap).toBeNull();
    expect(seo.url_prefix).toBe('/vehicles');
  });

  it('selects exactly the six generic MCP tools, identical to HVAC', () => {
    const hvac = parseYaml(readFileSync(join(HVAC, 'mcp.yaml'), 'utf8'));
    expect(mcp.tools).toEqual(hvac.tools);
    expect(mcp.server).toEqual({ ...hvac.server, name: 'data-foundry-vehicles' });
  });

  it('publishes the conversion-first plan ladder on a prelaunch offer', () => {
    expect(product.title).toBe('US Vehicle Recalls & Fuel Economy API');
    expect(product.lookup_entity_type).toBe('vehicle_model_year');
    expect(product.availability).toBe('prelaunch');
    expect(product.listing_url).toBeNull();
    expect(product.plans).toEqual([
      { name: 'Evaluate', monthly_usd: 0, included_requests: 100 },
      { name: 'Starter', monthly_usd: 9, included_requests: 1000 },
      { name: 'Developer', monthly_usd: 49, included_requests: 5000 },
      { name: 'Growth', monthly_usd: 149, included_requests: 25000 },
      { name: 'Scale', monthly_usd: 299, included_requests: 75000 },
    ]);
    // The headline is VIN -> recalls, and the offer must say VIN decode is not
    // available yet.
    expect(product.summary).toMatch(/VIN/);
    expect(product.summary).toMatch(/not yet captured/);
    expect(product.coverage).toMatch(/VIN decoding is not available/);
  });
});

/* ------------------------------------------------------------------ *
 * Tiny readers for the two fixture formats (banner lines start with `#`).
 * ------------------------------------------------------------------ */

function dataLines(file: string): string[] {
  return read('fixtures', file).split('\n').filter((line) => line !== '' && !line.startsWith('#'));
}

function epaRows(): Record<string, string>[] {
  const [header, ...rows] = dataLines('epa-vehicles.csv');
  const columns = header!.split(',');
  return rows.map((row) => Object.fromEntries(row.split(',').map((value, index) => [columns[index]!, value])));
}

/** The rows the mapping's `where` filter admits (vehicle recalls). */
function nhtsaVehicleRows(): Record<string, string>[] {
  return nhtsaRows().filter((row) => row['RCLTYPECD'] === 'V');
}

function nhtsaRows(): Record<string, string>[] {
  const nhtsa = mappings.sources.find((source: any) => source.source_key === 'nhtsa-recalls');
  const columns: string[] = nhtsa.parsing.columns;
  return dataLines('nhtsa-flat-rcl.csv').map((row) => {
    const values = row.split('\t');
    expect(values).toHaveLength(columns.length);
    return Object.fromEntries(values.map((value, index) => [columns[index]!, value]));
  });
}
