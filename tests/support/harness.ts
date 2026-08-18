/**
 * Shared harness for the repo-level integration, e2e and contract suites.
 *
 * Nothing here is a mock. Every test that uses it runs the real migrations
 * against a real (WASM) Postgres, the real vertical configuration off disk, the
 * real extraction and normalization packages, and the real canonical store. The
 * only substitution is the acquisition *transport*: `FixtureAcquisitionProvider`
 * serves the committed fixtures instead of the network, and it implements the
 * same contract as the live adapters — rights gate, conditional requests,
 * content-addressed storage and all.
 *
 * That distinction is the whole point of the Phase 1 proof. A pipeline test
 * that stubbed the store would prove the test doubles agree with each other.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
// Workspace packages are imported by source path rather than by package name:
// the repo-root `tests/` directory is not itself a workspace package, so it has
// no `node_modules` to resolve `@data-foundry/*` through. The packages resolve
// their own dependencies normally from their own directories.
import {
  createCanonicalStore,
  createPgliteDriver,
  type CanonicalStore,
  type SqlDriver,
  type SqlParam,
} from '../../packages/canonical-store/src/index.js';
import { createQueryModel, type QueryModel } from '../../packages/query-model/src/index.js';
import type { ValidatorCache } from '../../packages/acquisition/src/index.js';
import type { EntityId, IsoDateTime } from '../../packages/canonical-schema/src/index.js';
import {
  InMemoryArtifactStore,
  Pipeline,
  buildFieldMetadata,
  loadVerticalConfig,
  type VerticalConfig,
  type VerticalRunResult,
} from '../../services/ingest-worker/src/index.js';
import { applyMigrations, loadMigrations, type MigrationDriver } from '../../tooling/scripts/migrate.js';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(HERE, '..', '..');
export const HVAC_DIR = join(REPO_ROOT, 'verticals', 'hvac');

/** The instant every run in these suites is anchored to. */
export const RUN_1_AT = '2026-07-15T09:00:00.000Z' as IsoDateTime;
/** A later cycle, so freshness can be observed changing while data does not. */
export const RUN_2_AT = '2026-08-01T09:00:00.000Z' as IsoDateTime;

export interface Factory {
  readonly driver: SqlDriver;
  readonly store: CanonicalStore;
  readonly artifacts: InMemoryArtifactStore;
  readonly config: VerticalConfig;
  /**
   * Run the vertical. Each call builds a fresh `Pipeline` — and therefore a
   * fresh conditional-request cache — so a re-run genuinely re-fetches and
   * re-writes rather than short-circuiting on a 304. Idempotency has to be
   * proved at the storage layer, not at the HTTP layer.
   */
  run(options?: RunOptions): Promise<VerticalRunResult>;
  queryModel(): QueryModel;
  close(): Promise<void>;
}

export interface RunOptions {
  readonly at?: IsoDateTime;
  readonly runId?: string;
  readonly sources?: readonly string[];
  readonly dryRun?: boolean;
  /** Source key → replacement body, for simulating an upstream change. */
  readonly fixtureOverrides?: Readonly<Record<string, string>>;
  /**
   * Share a validator cache across runs to exercise conditional requests. Omit
   * it — the default — for a cold refresh that genuinely re-fetches, which is
   * the harder case for idempotency.
   */
  readonly validatorCache?: ValidatorCache;
}

/** A migrated, empty database with the real `db/migrations` applied. */
export async function migratedDriver(): Promise<SqlDriver> {
  const driver = await createPgliteDriver({ trigram: true });
  const adapter: MigrationDriver = {
    label: driver.label,
    exec: (sql: string) => driver.exec(sql),
    query: async <T,>(sql: string, params?: readonly unknown[]): Promise<T[]> =>
      (await driver.query(sql, params as readonly SqlParam[] | undefined)) as T[],
    close: async () => undefined,
  };
  await applyMigrations(adapter, await loadMigrations(join(REPO_ROOT, 'db', 'migrations')));
  return driver;
}

export async function createFactory(verticalSlug = 'hvac'): Promise<Factory> {
  const driver = await migratedDriver();
  const store = createCanonicalStore(driver);
  const artifacts = new InMemoryArtifactStore();
  const config = await loadVerticalConfig(verticalSlug, {
    verticalsDir: join(REPO_ROOT, 'verticals'),
  });

  return {
    driver,
    store,
    artifacts,
    config,
    async run(options: RunOptions = {}) {
      const pipeline = await Pipeline.create({
        driver,
        verticalSlug,
        verticalsDir: join(REPO_ROOT, 'verticals'),
        artifactStore: artifacts,
        now: options.at ?? RUN_1_AT,
        runId: options.runId ?? `run-${options.at ?? RUN_1_AT}`,
        ...(options.dryRun === undefined ? {} : { dryRun: options.dryRun }),
        ...(options.fixtureOverrides === undefined
          ? {}
          : { fixtureOverrides: options.fixtureOverrides }),
        ...(options.validatorCache === undefined
          ? {}
          : { validatorCache: options.validatorCache }),
      });
      return pipeline.runVertical(options.sources === undefined ? {} : { sources: options.sources });
    },
    queryModel() {
      return createQueryModel(store, { fields: buildFieldMetadata(config) });
    },
    close: () => driver.close(),
  };
}

/* ------------------------------------------------------------------ *
 * Golden records
 * ------------------------------------------------------------------ */

/** Golden files are hand-authored JSON; each reader below narrows what it uses. */
const readGolden = (file: string): any =>
  JSON.parse(readFileSync(join(HVAC_DIR, 'fixtures', 'golden', file), 'utf8'));

export const goldenEntities = (): any => readGolden('entities.json');
export const goldenFacts = (): any => readGolden('facts.json');
export const goldenRelationships = (): any => readGolden('relationships.json');

export const readFixture = (file: string): string =>
  readFileSync(join(HVAC_DIR, 'fixtures', file), 'utf8');

/**
 * `entity id → golden ref`.
 *
 * The golden files address entities by a stable test handle
 * (`equipment_model:24ACC636A003`) rather than by database id, and the handle
 * uses the *normalized* identifier — which is the assertion, not a convenience:
 * `BTW-C2036` and `btw-c2036` both have to arrive at `BTWC2036`.
 */
export async function entityRefs(driver: SqlDriver): Promise<Map<string, string>> {
  const rows = await driver.query(
    `SELECT e.id, e.entity_type, e.canonical_slug,
            (SELECT a.normalized_value
               FROM entity_aliases a
              WHERE a.entity_id = e.id
                AND a.alias_type = CASE WHEN e.entity_type = 'certification'
                                        THEN 'ahri_ref' ELSE 'model_number' END
              LIMIT 1) AS identifier
       FROM entities e
      ORDER BY e.id`,
  );
  const refs = new Map<string, string>();
  for (const row of rows) {
    const type = String(row['entity_type']);
    const id = String(row['id']);
    if (type === 'manufacturer') {
      refs.set(id, `manufacturer:${String(row['canonical_slug'])}`);
      continue;
    }
    const identifier =
      row['identifier'] === null ? String(row['canonical_slug']) : String(row['identifier']);
    refs.set(id, `${type}:${identifier}`);
  }
  return refs;
}

export async function entityIdByRef(driver: SqlDriver, ref: string): Promise<EntityId> {
  const refs = await entityRefs(driver);
  for (const [id, candidate] of refs) {
    if (candidate === ref) return id as EntityId;
  }
  throw new Error(`no entity resolved to golden ref "${ref}"`);
}

/* ------------------------------------------------------------------ *
 * Row-level snapshots
 * ------------------------------------------------------------------ */

export interface CanonicalSnapshot {
  readonly entities: number;
  readonly aliases: number;
  readonly facts: number;
  readonly factEvidence: number;
  readonly relationships: number;
  readonly relationshipEvidence: number;
  readonly artifacts: number;
  readonly sourceRecords: number;
  readonly resolutionCandidates: number;
  readonly resolutionJudgments: number;
  /** Fact identities, so "same count" cannot hide "different rows". */
  readonly factIds: readonly string[];
  readonly evidenceIds: readonly string[];
  readonly entityIds: readonly string[];
}

export async function snapshotCanonical(driver: SqlDriver): Promise<CanonicalSnapshot> {
  const count = async (table: string): Promise<number> =>
    Number((await driver.query<{ n: string }>(`SELECT count(*)::text AS n FROM ${table}`))[0]?.n ?? 0);
  const ids = async (table: string): Promise<string[]> =>
    (await driver.query<{ id: string }>(`SELECT id::text AS id FROM ${table} ORDER BY id`)).map(
      (row) => row.id,
    );

  return {
    entities: await count('entities'),
    aliases: await count('entity_aliases'),
    facts: await count('facts'),
    factEvidence: await count('fact_evidence'),
    relationships: await count('relationships'),
    relationshipEvidence: await count('relationship_evidence'),
    artifacts: await count('source_artifacts'),
    sourceRecords: await count('source_records'),
    resolutionCandidates: await count('resolution_candidates'),
    resolutionJudgments: await count('resolution_judgments'),
    factIds: await ids('facts'),
    evidenceIds: await ids('fact_evidence'),
    entityIds: await ids('entities'),
  };
}

/** Every stored claim, keyed the way the golden facts file addresses them. */
export async function factKeys(driver: SqlDriver): Promise<Set<string>> {
  const refs = await entityRefs(driver);
  const rows = await driver.query(
    `SELECT entity_id, property, normalized_value, unit FROM facts`,
  );
  return new Set(
    rows.map(
      (row) =>
        `${refs.get(String(row['entity_id'])) ?? '?'}|${String(row['property'])}` +
        `|${JSON.stringify(row['normalized_value'])}|${row['unit'] === null ? '-' : String(row['unit'])}`,
    ),
  );
}

export const goldenFactKeys = (): Set<string> =>
  new Set(
    goldenFacts().facts.map(
      (fact: any) =>
        `${fact.entity}|${fact.property}|${JSON.stringify(fact.normalized_value)}` +
        `|${fact.unit === null || fact.unit === undefined ? '-' : String(fact.unit)}`,
    ),
  );

export async function aliasKeys(driver: SqlDriver): Promise<Set<string>> {
  const refs = await entityRefs(driver);
  const rows = await driver.query(
    `SELECT entity_id, alias_type, normalized_value FROM entity_aliases`,
  );
  return new Set(
    rows.map(
      (row) =>
        `${refs.get(String(row['entity_id'])) ?? '?'}|${String(row['alias_type'])}` +
        `|${String(row['normalized_value'])}`,
    ),
  );
}

export const goldenAliasKeys = (): Set<string> => {
  const keys = new Set<string>();
  for (const entity of goldenEntities().entities) {
    for (const alias of entity.aliases ?? []) {
      keys.add(`${entity.ref}|${alias.alias_type}|${alias.normalized_value}`);
    }
  }
  return keys;
};

export async function relationshipKeys(driver: SqlDriver): Promise<Set<string>> {
  const refs = await entityRefs(driver);
  const rows = await driver.query(
    `SELECT subject_entity_id, predicate, object_entity_id FROM relationships
      WHERE status <> 'RETRACTED' AND valid_to IS NULL`,
  );
  return new Set(
    rows.map(
      (row) =>
        `${refs.get(String(row['subject_entity_id'])) ?? '?'}|${String(row['predicate'])}` +
        `|${refs.get(String(row['object_entity_id'])) ?? '?'}`,
    ),
  );
}

export const goldenRelationshipKeys = (): Set<string> =>
  new Set(
    goldenRelationships().relationships.map(
      (edge: any) => `${edge.subject}|${edge.predicate}|${edge.object}`,
    ),
  );

/** Sorted difference, so a failure message names the rows rather than a count. */
export const difference = (left: ReadonlySet<string>, right: ReadonlySet<string>): string[] =>
  [...left].filter((value) => !right.has(value)).sort();
