/**
 * END-TO-END SHAPE PROOF for `vehicles`.
 *
 * The synthetic shape fixtures go through the REAL pipeline — real migrations
 * on a WASM Postgres, the real vertical configuration, the real CSV extractor,
 * normalization, entity resolution, canonical store and fact selection — and
 * the canonical output is compared with `fixtures/golden/`.
 *
 * WHAT THIS DOES NOT PROVE. The fixtures are synthetic and their column names
 * UNVERIFIED (SOURCES.md), so this proves the configuration is coherent and the
 * platform can carry a second industry — not that the real EPA/NHTSA files map.
 *
 * HOW IT RUNS WITHOUT A RIGHTS DECISION. The committed sources are fail-closed
 * (UNDER_REVIEW / UNREVIEWED / unapproved) and the first test proves the
 * pipeline refuses them. The rest runs on a TEMPORARY COPY of the vertical in
 * which the two mapped sources are marked activated by `synthetic-test-fixture`,
 * with the same synthetic internal-processing grants the HVAC harness uses.
 * Nothing in the repository is changed, and no customer-surface grant exists.
 */
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createCanonicalStore, type CanonicalStore, type SqlDriver } from '../../../packages/canonical-store/src/index.js';
import { createQueryModel } from '../../../packages/query-model/src/index.js';
import { compileAliasNormalization } from '../../../packages/normalization/src/index.js';
import type { Identifier, IsoDateTime, VerticalId } from '../../../packages/canonical-schema/src/index.js';
import {
  InMemoryArtifactStore,
  Pipeline,
  buildFieldMetadata,
  loadVerticalConfig,
  type VerticalConfig,
  type VerticalRunResult,
} from '../../../services/ingest-worker/src/index.js';
import {
  REPO_ROOT,
  RUN_1_AT,
  RUN_2_AT,
  migratedDriver,
  seedSyntheticInternalRights,
  snapshotCanonical,
} from '../../../tests/support/harness.js';

const MAPPED_SOURCES = ['epa-fueleconomy-vehicles', 'nhtsa-recalls'] as const;
/**
 * Test-only authority ranks. The committed declarations leave `authority_rank`
 * at 0 (unassigned until activation); EPA's mixed-case spelling ranks above
 * NHTSA's upper-case one only so the display names are readable.
 */
const TEST_RANKS: Readonly<Record<string, number>> = {
  'epa-fueleconomy-vehicles': 85,
  'nhtsa-recalls': 80,
};
const PRIMARY_ALIAS: Readonly<Record<string, string>> = {
  vehicle_model_year: 'make_model_year',
  vehicle_configuration: 'epa_vehicle_id',
  recall_campaign: 'nhtsa_campaign_number',
};
const SOURCE_BY_DOMAIN: Readonly<Record<string, string>> = {
  'www.fueleconomy.gov': 'epa-fueleconomy-vehicles',
  'static.nhtsa.gov': 'nhtsa-recalls',
};

const goldenPath = (file: string): string => join(REPO_ROOT, 'verticals', 'vehicles', 'fixtures', 'golden', file);
const readGolden = async (file: string): Promise<any> => JSON.parse(await readFile(goldenPath(file), 'utf8'));

/** A copy of the vertical with the two mapped sources activated for this test only. */
async function activatedCopy(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'vehicles-shape-'));
  await cp(join(REPO_ROOT, 'verticals', 'vehicles'), join(root, 'vehicles'), { recursive: true });
  for (const key of MAPPED_SOURCES) {
    const path = join(root, 'vehicles', 'sources', `${key}.yaml`);
    const source = parseYaml(await readFile(path, 'utf8'));
    source.status = 'ACTIVE';
    source.rights_classification = 'GREEN';
    source.authority_rank = TEST_RANKS[key];
    Object.assign(source.rights_policy, {
      commercial_use_allowed: true,
      redistribution_allowed: true,
      derivative_normalization_allowed: true,
      reviewed_at: '2026-06-01T00:00:00Z',
      reviewed_by: 'synthetic-test-fixture',
      next_review_at: '2027-06-01',
    });
    Object.assign(source.acquisition_policy, {
      approved: true,
      approved_by: 'synthetic-test-fixture',
      approved_at: '2026-06-01T00:00:00Z',
    });
    await writeFile(path, stringifyYaml(source), 'utf8');
  }
  return root;
}

interface Run {
  readonly driver: SqlDriver;
  readonly store: CanonicalStore;
  readonly config: VerticalConfig;
  readonly verticalsDir: string;
  run(at: IsoDateTime): Promise<VerticalRunResult>;
}

async function factory(verticalsDir: string): Promise<Run> {
  const driver = await migratedDriver();
  const store = createCanonicalStore(driver);
  const config = await loadVerticalConfig('vehicles', { verticalsDir });
  await seedSyntheticInternalRights(driver, store, config);
  return {
    driver,
    store,
    config,
    verticalsDir,
    async run(at) {
      const pipeline = await Pipeline.create({
        driver,
        verticalSlug: 'vehicles',
        verticalsDir,
        artifactStore: new InMemoryArtifactStore(),
        now: at,
        runId: `vehicles-${at}`,
      });
      return pipeline.runVertical({ sources: MAPPED_SOURCES });
    },
  };
}

/** entity id -> golden ref (`vehicle_model_year:EXAMPLARMOTORSROADSTER2020`, `make:<slug>`). */
async function refs(driver: SqlDriver): Promise<Map<string, string>> {
  const rows = await driver.query<{ id: string; entity_type: string; canonical_slug: string }>(
    `SELECT id::text AS id, entity_type, canonical_slug FROM entities`,
  );
  const aliases = await driver.query<{ entity_id: string; alias_type: string; normalized_value: string }>(
    `SELECT entity_id::text AS entity_id, alias_type, normalized_value FROM entity_aliases`,
  );
  const out = new Map<string, string>();
  for (const row of rows) {
    const primary = PRIMARY_ALIAS[row.entity_type];
    if (primary === undefined) {
      out.set(row.id, `${row.entity_type}:${row.canonical_slug}`);
      continue;
    }
    const alias = aliases.find((candidate) => candidate.entity_id === row.id && candidate.alias_type === primary);
    out.set(row.id, `${row.entity_type}:${alias?.normalized_value ?? `?${row.canonical_slug}`}`);
  }
  return out;
}

const sorted = (values: Iterable<string>): string[] => [...values].sort();

describe('the committed declarations are refused', () => {
  it('runs nothing and publishes nothing from an UNDER_REVIEW / UNREVIEWED source', async () => {
    const run = await factory(join(REPO_ROOT, 'verticals'));
    try {
      const result = await run.run(RUN_1_AT);
      for (const source of result.sources) {
        expect(source.finalState, source.sourceKey).not.toBe('PUBLISHED');
        expect(source.error, source.sourceKey).not.toBeNull();
      }
      const [facts] = await run.driver.query<{ n: string }>(`SELECT count(*)::text AS n FROM facts`);
      const [entities] = await run.driver.query<{ n: string }>(`SELECT count(*)::text AS n FROM entities`);
      expect(Number(facts?.n)).toBe(0);
      expect(Number(entities?.n)).toBe(0);
    } finally {
      await run.driver.close();
    }
  }, 300_000);
});

describe('synthetic shape fixtures through the real pipeline (test-only activation)', () => {
  let run: Run;
  let first: VerticalRunResult;

  beforeAll(async () => {
    run = await factory(await activatedCopy());
    first = await run.run(RUN_1_AT);
  }, 300_000);

  afterAll(async () => {
    await run?.driver.close();
    if (run !== undefined) await rm(run.verticalsDir, { recursive: true, force: true });
  });

  it('publishes both mapped sources without diagnostics or blocking candidates', () => {
    for (const source of first.sources) {
      expect(source.error, source.sourceKey).toBeNull();
      expect(source.finalState).toBe('PUBLISHED');
    }
    expect(first.diagnostics).toEqual([]);
    expect(first.blocking).toEqual({ proposed: 0, rejected: 0 });
  });

  it('resolves exactly the golden entities, names, slugs and alias join keys', async () => {
    const golden = await readGolden('entities.json');
    const byId = await refs(run.driver);
    const rows = await run.driver.query<{ id: string; canonical_name: string; canonical_slug: string; entity_type: string }>(
      `SELECT id::text AS id, canonical_name, canonical_slug, entity_type FROM entities`,
    );
    const actual = new Map(rows.map((row) => [byId.get(row.id)!, row] as const));
    expect(sorted(actual.keys())).toEqual(sorted(golden.entities.map((entity: any) => entity.ref)));
    for (const entity of golden.entities) {
      const row = actual.get(entity.ref)!;
      expect(row.entity_type, entity.ref).toBe(entity.entity_type);
      expect(row.canonical_name, entity.ref).toBe(entity.canonical_name);
      expect(row.canonical_slug, entity.ref).toBe(entity.canonical_slug);
    }

    const aliasRows = await run.driver.query<{ entity_id: string; alias_type: string; normalized_value: string }>(
      `SELECT entity_id::text AS entity_id, alias_type, normalized_value FROM entity_aliases`,
    );
    expect(sorted(aliasRows.map((alias) => `${byId.get(alias.entity_id)}|${alias.alias_type}|${alias.normalized_value}`))).toEqual(
      sorted(golden.entities.flatMap((entity: any) =>
        entity.aliases.map((alias: any) => `${entity.ref}|${alias.alias_type}|${alias.normalized_value}`))),
    );
  });

  it('joins EPA and NHTSA spellings of one model year into one entity', async () => {
    // `PM-3` (EPA baseModel) and `PM3` (NHTSA MODELTXT) are one key; the model
    // year carries evidence from both agencies.
    const [row] = await run.driver.query<{ n: string }>(
      `SELECT count(DISTINCT s.domain)::text AS n
         FROM entities e
         JOIN entity_aliases a ON a.entity_id = e.id AND a.alias_type = 'make_model_year'
         JOIN facts f ON f.entity_id = e.id
         JOIN fact_evidence fe ON fe.fact_id = f.id
         JOIN source_records sr ON sr.id = fe.source_record_id
         JOIN sources s ON s.id = sr.source_id
        WHERE a.normalized_value = 'PLACEHOLDERMOTORWORKSPM32022'`,
    );
    expect(Number(row?.n)).toBe(2);
  });

  it('stores exactly the golden facts, each backed by evidence from the named sources', async () => {
    const golden = await readGolden('facts.json');
    const byId = await refs(run.driver);
    const rows = await run.driver.query<{ entity_id: string; property: string; normalized_value: unknown; domain: string }>(
      `SELECT f.entity_id::text AS entity_id, f.property, f.normalized_value, s.domain
         FROM facts f
         JOIN fact_evidence fe ON fe.fact_id = f.id
         JOIN source_records sr ON sr.id = fe.source_record_id
         JOIN sources s ON s.id = sr.source_id`,
    );
    const actual = new Map<string, Set<string>>();
    for (const row of rows) {
      const key = `${byId.get(row.entity_id)}|${row.property}|${JSON.stringify(row.normalized_value)}`;
      const set = actual.get(key) ?? new Set<string>();
      set.add(SOURCE_BY_DOMAIN[row.domain] ?? row.domain);
      actual.set(key, set);
    }
    const expected = new Map<string, string[]>(
      golden.facts.map((fact: any) => [`${fact.entity}|${fact.property}|${JSON.stringify(fact.normalized_value)}`, fact.sources]),
    );
    expect(sorted(actual.keys())).toEqual(sorted(expected.keys()));
    for (const [key, sources] of expected) expect(sorted(actual.get(key) ?? []), key).toEqual(sources);

    const [count] = await run.driver.query<{ n: string }>(`SELECT count(*)::text AS n FROM facts`);
    expect(Number(count?.n)).toBe(golden.count);
  });

  it('gives every fact a table-cell locator into its artifact (AGENTS.md rule 2)', async () => {
    const [missing] = await run.driver.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM facts f
        WHERE NOT EXISTS (SELECT 1 FROM fact_evidence fe WHERE fe.fact_id = f.id)`,
    );
    expect(Number(missing?.n)).toBe(0);
    const locators = await run.driver.query<{ locator_type: string; locator_value: string }>(
      `SELECT DISTINCT locator_type, locator_value FROM fact_evidence`,
    );
    for (const locator of locators) {
      expect(locator.locator_type).toBe('TABLE_CELL');
      expect(locator.locator_value).toMatch(/^row=\d+;column=/);
    }
    // The composite model-year key cites all three cells it was built from.
    const claims = await run.driver.query<{ locator_value: string }>(
      `SELECT c.locator_value FROM entity_alias_claims c
         JOIN entity_aliases a ON a.id = c.entity_alias_id
        WHERE a.alias_type = 'make_model_year'`,
    );
    expect(claims.length).toBeGreaterThan(0);
    for (const claim of claims) {
      expect(claim.locator_value).toMatch(/^row=\d+;columns=(make,baseModel,year|MAKETXT,MODELTXT,YEARTXT);indexes=\d+,\d+,\d+$/);
    }
  });

  it('draws exactly the golden relationships, each with evidence', async () => {
    const golden = await readGolden('relationships.json');
    const byId = await refs(run.driver);
    const rows = await run.driver.query<{ s: string; predicate: string; o: string; evidence: string }>(
      `SELECT r.subject_entity_id::text AS s, r.predicate, r.object_entity_id::text AS o,
              (SELECT count(*)::text FROM relationship_evidence e WHERE e.relationship_id = r.id) AS evidence
         FROM relationships r
        WHERE r.status <> 'RETRACTED' AND r.valid_to IS NULL`,
    );
    expect(sorted(rows.map((row) => `${byId.get(row.s)}|${row.predicate}|${byId.get(row.o)}`))).toEqual(
      sorted(golden.relationships.map((edge: any) => `${edge.subject}|${edge.predicate}|${edge.object}`)),
    );
    for (const row of rows) expect(Number(row.evidence)).toBeGreaterThan(0);
  });

  it('answers the product question: which recalls affect a model year, with its configurations', async () => {
    const [modelYear] = await run.driver.query<{ id: string }>(
      `SELECT e.id::text AS id FROM entities e WHERE e.canonical_slug = 'fixture-automotive-mule-2021'`,
    );
    const edges = await run.driver.query<{ predicate: string; other: string }>(
      `SELECT r.predicate, o.canonical_slug AS other
         FROM relationships r JOIN entities o ON o.id = r.subject_entity_id
        WHERE r.object_entity_id = $1 AND r.valid_to IS NULL
        ORDER BY r.predicate, o.canonical_slug`,
      [modelYear!.id],
    );
    expect(edges.map((edge) => `${edge.predicate}:${edge.other}`)).toEqual([
      'configuration_of:epa-900007',
      'makes:fixture-automotive',
      'recall_affects:nhtsa-21v903000',
    ]);
  });

  it('reads identifiers through the compiled read-side specification (ADR-0003)', async () => {
    const vertical = await run.store.getVerticalBySlug('vehicles');
    const model = createQueryModel(run.store, {
      fields: buildFieldMetadata(run.config),
      identifier_normalization: compileAliasNormalization(run.config),
    });
    const lookup = async (value: string, aliasType: string): Promise<string[]> =>
      (await model.lookupIdentifier({
        vertical_id: vertical!.id as VerticalId,
        value,
        alias_type: aliasType as Identifier,
      })).entities.map((view) => view.entity.canonical_slug);

    // Equivalent spellings reach the one entity...
    for (const spelling of ['Placeholder Motor Works PM-3 2022', 'placeholder motor works pm3 2022', 'PLACEHOLDER_MOTOR_WORKS PM.3 2022']) {
      expect(await lookup(spelling, 'make_model_year'), spelling).toEqual(['placeholder-motor-works-pm-3-2022']);
    }
    expect(await lookup('20v-901-000', 'nhtsa_campaign_number')).toEqual(['nhtsa-20v901000']);
    expect(await lookup('900 004', 'epa_vehicle_id')).toEqual(['epa-900004']);
    // ...and distinct codes stay distinct.
    expect(await lookup('Placeholder Motor Works PM-30 2022', 'make_model_year')).toEqual(['placeholder-motor-works-pm-30-2022']);
    expect(await lookup('Placeholder Motor Works PM-3 2023', 'make_model_year')).toEqual([]);
    expect(await lookup('20V901000', 'make_model_year')).toEqual([]);
  });

  it('is an idempotent no-op on an unchanged re-run', async () => {
    const before = await snapshotCanonical(run.driver);
    const second = await run.run(RUN_2_AT);
    for (const source of second.sources) expect(source.error, source.sourceKey).toBeNull();
    const after = await snapshotCanonical(run.driver);
    expect(after.entityIds).toEqual(before.entityIds);
    expect(after.factIds).toEqual(before.factIds);
    expect(after.relationships).toBe(before.relationships);
    expect(after.aliases).toBe(before.aliases);
  }, 300_000);
});
