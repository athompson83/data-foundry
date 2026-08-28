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
import type {
  EntityId,
  IsoDateTime,
  Vertical,
} from '../../packages/canonical-schema/src/index.js';
import { toSourceInsert } from '../../packages/source-registry/src/index.js';
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
  await seedSyntheticInternalRights(driver, store, config);

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

/**
 * Test-only human-approved rights for the repository's fictional fixtures.
 * Production migrations deliberately create no permissions from legacy
 * classifications or booleans; this helper makes every ALLOW explicit in the
 * one harness that needs an end-to-end synthetic factory.
 */
export async function seedSyntheticInternalRights(
  driver: SqlDriver,
  store: CanonicalStore,
  config: VerticalConfig,
  options: {
    readonly omit?: Readonly<Record<string, readonly string[]>>;
    readonly fieldAllows?: Readonly<
      Record<string, Readonly<Record<string, readonly string[]>>>
    >;
  } = {},
): Promise<void> {
  const vertical = await store.upsertVertical({
    slug: config.slug,
    name: config.name,
    schema_version: config.schemaVersion,
    status: config.status as Vertical['status'],
    default_refresh_policy:
      config.defaultRefreshPolicy as Vertical['default_refresh_policy'],
  });
  const operations = ['ACQUIRE', 'STORE', 'CACHE', 'NORMALIZE', 'DERIVE'] as const;
  let sourceIndex = 0;
  for (const entry of config.sources) {
    sourceIndex += 1;
    const source = await store.upsertSource(toSourceInsert(entry, vertical.id));
    const publisherId = crypto.randomUUID();
    const termsEvidenceId = crypto.randomUUID();
    const reviewEvidenceId = crypto.randomUUID();
    const termsCellId = crypto.randomUUID();
    const termsVersionId = crypto.randomUUID();
    const termsHash = sourceIndex.toString(16).padStart(64, '0');
    const reviewHash = (sourceIndex + 100).toString(16).padStart(64, '0');
    const reviewedAt = '2026-06-01T00:00:00.000Z';
    const recheckAt = '2027-06-01T00:00:00.000Z';

    await driver.query(
      `INSERT INTO rights_publishers (id, publisher_key, legal_name, status)
       VALUES ($1, $2, $3, 'ACTIVE')`,
      [publisherId, `synthetic-${entry.key}`, `${entry.publisher} synthetic test fixture`],
    );
    await driver.query(
      `INSERT INTO rights_evidence_artifacts
         (id, kind, canonical_uri, storage_uri, content_sha256, mime_type,
          captured_at, created_by)
       VALUES ($1, 'TERMS', $3, $4, $5, 'text/plain', $7, 'synthetic-test-fixture'),
              ($2, 'REVIEW_MEMO', $6, $6, $8, 'text/plain', $7, 'synthetic-test-fixture')`,
      [
        termsEvidenceId,
        reviewEvidenceId,
        `fixture://terms/${entry.key}`,
        `fixture://terms/${entry.key}.txt`,
        termsHash,
        `fixture://review/${entry.key}`,
        reviewedAt,
        reviewHash,
      ],
    );
    await driver.query(
      `UPDATE sources
          SET rights_publisher_id = $1,
              rights_publisher_mapping_evidence_artifact_id = $3,
              rights_publisher_mapping_reviewer_type = 'HUMAN',
              rights_publisher_mapping_reviewed_by = 'synthetic-test-fixture',
              rights_publisher_mapping_reviewed_at = $4
        WHERE id = $2`,
      [publisherId, source.id, reviewEvidenceId, reviewedAt],
    );
    await driver.query(
      `INSERT INTO rights_terms_cells
         (id, source_id, acquisition_route, account_or_product_plan, jurisdiction, created_by)
       VALUES ($1, $2, $3, $4, $5, 'synthetic-test-fixture')`,
      [
        termsCellId,
        source.id,
        entry.acquisition_policy.method,
        entry.acquisition_policy.account_or_product_plan,
        entry.acquisition_policy.jurisdiction,
      ],
    );
    await driver.query(
      `INSERT INTO rights_terms_versions
         (id, terms_cell_id, evidence_artifact_id, content_sha256, version_label,
          effective_from, recheck_at, created_by)
       VALUES ($1, $2, $3, $4, 'synthetic-v1', $5, $6, 'synthetic-test-fixture')`,
      [termsVersionId, termsCellId, termsEvidenceId, termsHash, reviewedAt, recheckAt],
    );
    await driver.query(
      `SELECT activate_rights_terms($1, 'HUMAN', 'synthetic-test-fixture',
                                    'activate synthetic fixture terms', $2)`,
      [termsVersionId, reviewedAt],
    );

    const omitted = new Set(options.omit?.[entry.key] ?? []);
    await driver.exec('BEGIN');
    try {
      for (const operation of operations) {
        if (omitted.has(operation)) continue;
        const cellId = crypto.randomUUID();
        const decisionId = crypto.randomUUID();
        await driver.query(
          `INSERT INTO rights_cells
             (id, source_id, acquisition_route, account_or_product_plan, jurisdiction,
              operation, channel, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, 'INTERNAL_PROCESSING',
                   'synthetic-test-fixture')`,
          [
            cellId,
            source.id,
            entry.acquisition_policy.method,
            entry.acquisition_policy.account_or_product_plan,
            entry.acquisition_policy.jurisdiction,
            operation,
          ],
        );
        await driver.query(
          `INSERT INTO rights_decisions
             (id, cell_id, state, controlling_terms_version_id, evidence_artifact_id,
              clause_ref, review_status, reviewer_type, reviewed_by, reviewed_at,
              effective_from, recheck_at, rationale, created_by)
           VALUES ($1, $2, 'ALLOW', $3, $4, 'synthetic fixture only', 'APPROVED',
                   'HUMAN', 'synthetic-test-fixture', $5, $5, $6,
                   'explicit synthetic internal processing grant',
                   'synthetic-test-fixture')`,
          [decisionId, cellId, termsVersionId, reviewEvidenceId, reviewedAt, recheckAt],
        );
        await driver.query(
          `SELECT activate_rights_decision($1, 'HUMAN', 'synthetic-test-fixture',
                                           'activate synthetic fixture grant', $2)`,
          [decisionId, reviewedAt],
        );
      }
      for (const [operation, fields] of Object.entries(options.fieldAllows?.[entry.key] ?? {})) {
        for (const fieldKey of fields) {
          const cellId = crypto.randomUUID();
          const decisionId = crypto.randomUUID();
          await driver.query(
            `INSERT INTO rights_cells
               (id, source_id, acquisition_route, account_or_product_plan, jurisdiction,
                field_key, operation, channel, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, 'INTERNAL_PROCESSING',
                     'synthetic-test-fixture')`,
            [
              cellId,
              source.id,
              entry.acquisition_policy.method,
              entry.acquisition_policy.account_or_product_plan,
              entry.acquisition_policy.jurisdiction,
              fieldKey,
              operation,
            ],
          );
          await driver.query(
            `INSERT INTO rights_decisions
               (id, cell_id, state, controlling_terms_version_id, evidence_artifact_id,
                clause_ref, review_status, reviewer_type, reviewed_by, reviewed_at,
                effective_from, recheck_at, rationale, created_by)
             VALUES ($1, $2, 'ALLOW', $3, $4, 'synthetic fixture field scope', 'APPROVED',
                     'HUMAN', 'synthetic-test-fixture', $5, $5, $6,
                     'explicit synthetic field-level internal grant',
                     'synthetic-test-fixture')`,
            [decisionId, cellId, termsVersionId, reviewEvidenceId, reviewedAt, recheckAt],
          );
          await driver.query(
            `SELECT activate_rights_decision($1, 'HUMAN', 'synthetic-test-fixture',
                                             'activate synthetic field grant', $2)`,
            [decisionId, reviewedAt],
          );
        }
      }
      await driver.exec('COMMIT');
    } catch (error) {
      await driver.exec('ROLLBACK');
      throw error;
    }
  }
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
