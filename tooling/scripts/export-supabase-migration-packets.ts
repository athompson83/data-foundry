/**
 * Build deterministic, credential-free SQL packets for Supabase's
 * `apply_migration` connector operation.
 *
 * This module is deliberately offline. It accepts a previously queried app
 * ledger snapshot, compares it with the repository migrations, and emits JSON
 * to stdout. It never reads POSTGRES_URL and never calls a provider.
 */
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import {
  buildRuntimeRoleExpectedExternalAclValuesSql,
  buildRuntimeRoleExternalDirectAclSql,
  buildRuntimeRoleExpectedGrants,
  PRIVATE_FUNCTION_SIGNATURES as RUNTIME_PRIVATE_FUNCTION_SIGNATURES,
  RUNTIME_ROLES as RUNTIME_ROLE_NAMES,
  type RuntimeRoleExpectedGrant,
} from '@data-foundry/private-canary';
import { isMain } from '../lib/cli-entry.js';
import {
  DATA_FOUNDRY_PRIVATE_SCHEMA,
  EXPECTED_TABLES,
  LEDGER_MARKER,
  LEDGER_TABLE,
  effectiveMigrationChecksum,
  loadMigrationsFromGit,
  scopeMigrationSql,
  type Migration,
} from './migrate.js';

const FORMAT = 'data-foundry-supabase-migration-plan/v1';
const REQUIRED_MIGRATION_ROLE = 'df_migration';
const IDENTIFIER = /^[a-z][a-z0-9_]{0,62}$/;
const RELEASE_SHA = /^[0-9a-f]{40}$/;
const VERSION = /^\d{4}$/;
const MIGRATION_FILENAME = /^(\d{4})_[a-z0-9_]+\.sql$/;
const SHA256 = /^[0-9a-f]{64}$/;
const EXPECTED_REPOSITORY_MIGRATION_COUNT = 28;
const EXPECTED_TERMINAL_VERSION = '0028';
const HERE = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = resolve(HERE, '..', '..');
const execFileAsync = promisify(execFile);

/** Inputs whose committed bytes determine the exported migration packets. */
export const RELEVANT_SOURCE_PATHS = [
  'db/migrations',
  'tooling/scripts/migrate.ts',
  'tooling/scripts/export-supabase-migration-packets.ts',
  'packages/private-canary/src/index.ts',
  'packages/private-canary/src/runtime-role-policy.ts',
] as const;

export interface VerifiedSourceIdentity {
  readonly releaseSha: string;
  readonly headSha: string;
  readonly relevantInputsClean: true;
  readonly relevantPaths: typeof RELEVANT_SOURCE_PATHS;
}

export async function verifyGitSourceIdentity(
  releaseSha: string,
  repositoryRoot: string = REPOSITORY_ROOT,
): Promise<VerifiedSourceIdentity> {
  if (!RELEASE_SHA.test(releaseSha)) {
    throw new Error('releaseSha must be a lowercase 40-character Git SHA.');
  }
  const { stdout: headOutput } = await execFileAsync(
    'git',
    ['-C', repositoryRoot, 'rev-parse', '--verify', 'HEAD'],
    { encoding: 'utf8' },
  );
  const headSha = headOutput.trim();
  if (releaseSha !== headSha) {
    throw new Error(`The supplied release SHA ${releaseSha} does not equal Git HEAD ${headSha}.`);
  }
  const { stdout: statusOutput } = await execFileAsync(
    'git',
    [
      '-C',
      repositoryRoot,
      'status',
      '--porcelain=v1',
      '--untracked-files=all',
      '--',
      ...RELEVANT_SOURCE_PATHS,
    ],
    { encoding: 'utf8' },
  );
  const relevantChanges = statusOutput.trim();
  if (relevantChanges !== '') {
    throw new Error(
      `Relevant source inputs differ from Git HEAD; commit or restore them before export:\n${relevantChanges}`,
    );
  }
  return {
    releaseSha,
    headSha,
    relevantInputsClean: true,
    relevantPaths: RELEVANT_SOURCE_PATHS,
  };
}

export interface SupabaseAppliedMigration {
  readonly version: string;
  readonly filename: string;
  readonly checksum: string;
}

export interface SupabaseMigrationPacket {
  readonly version: string;
  readonly filename: string;
  readonly checksum: string;
  readonly expectedAppliedCount: number;
  readonly providerMigrationName: string;
  readonly transformedSql: string;
  readonly sql: string;
}

export interface SupabaseRuntimeGrantPayload {
  readonly providerMigrationName: string;
  readonly checksum: string;
  readonly applicationLedgerMutation: false;
  readonly roles: typeof RUNTIME_ROLE_NAMES;
  readonly functionGrantPolicy: 'explicit-all-private-functions-to-acquisition-invoker';
  readonly functionSignatures: typeof RUNTIME_PRIVATE_FUNCTION_SIGNATURES;
  readonly expectedGrants: readonly ExpectedRuntimeGrant[];
  readonly sql: string;
  readonly verificationSql: string;
  readonly postCredentialVerificationSql: string;
}

export interface SupabaseMigrationPlan {
  readonly format: typeof FORMAT;
  readonly releaseSha: string;
  readonly sourceIdentity: VerifiedSourceIdentity;
  readonly transactionContract: Readonly<{
    packetTransaction: 'provider-managed-required';
    providerMigrationLedgerAtomicity: 'unverified';
    liveUseAuthorized: false;
  }>;
  readonly schema: typeof DATA_FOUNDRY_PRIVATE_SCHEMA;
  readonly migrationRole: typeof REQUIRED_MIGRATION_ROLE;
  readonly ledger: Readonly<{
    schema: typeof DATA_FOUNDRY_PRIVATE_SCHEMA;
    table: typeof LEDGER_TABLE;
    marker: typeof LEDGER_MARKER;
  }>;
  readonly repositoryMigrationCount: number;
  readonly appliedMigrationCount: number;
  readonly pendingMigrationCount: number;
  readonly repositoryDigest: string;
  readonly bootstrapProviderMigrationName: string;
  readonly preflightSql: string;
  readonly bootstrapSql: string;
  readonly verificationSql: string;
  readonly packets: readonly SupabaseMigrationPacket[];
  readonly postMigrationGrants: SupabaseRuntimeGrantPayload;
}

export interface BuildSupabaseMigrationPlanOptions {
  readonly sourceIdentity: VerifiedSourceIdentity;
  readonly schema: string;
  readonly migrationRole: string;
  readonly migrations: readonly Migration[];
  readonly appliedMigrations: readonly SupabaseAppliedMigration[];
}

interface EffectiveMigration {
  readonly migration: Migration;
  readonly transformedSql: string;
  readonly checksum: string;
}

function sqlLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function quotedIdentifier(value: string): string {
  return `"${value}"`;
}

function qualified(schema: string, relation: string): string {
  return `${quotedIdentifier(schema)}.${quotedIdentifier(relation)}`;
}

function assertIdentifier(value: string, label: string): void {
  if (!IDENTIFIER.test(value)) {
    throw new Error(`${label} must be a safe lowercase PostgreSQL identifier.`);
  }
}

function validateTarget(schema: string, migrationRole: string): void {
  assertIdentifier(schema, 'Schema');
  if (schema !== DATA_FOUNDRY_PRIVATE_SCHEMA) {
    throw new Error(
      `The Supabase packet exporter only targets the private ${DATA_FOUNDRY_PRIVATE_SCHEMA} schema.`,
    );
  }
  assertIdentifier(migrationRole, 'Migration role');
  if (migrationRole !== REQUIRED_MIGRATION_ROLE) {
    throw new Error(`The migration role must be ${REQUIRED_MIGRATION_ROLE}.`);
  }
}

function validateSourceIdentity(sourceIdentity: VerifiedSourceIdentity): void {
  if (
    !RELEASE_SHA.test(sourceIdentity.releaseSha) ||
    !RELEASE_SHA.test(sourceIdentity.headSha)
  ) {
    throw new Error('Verified source identity must contain lowercase 40-character Git SHAs.');
  }
  if (sourceIdentity.releaseSha !== sourceIdentity.headSha) {
    throw new Error('Verified source identity release SHA does not equal Git HEAD.');
  }
  if (sourceIdentity.relevantInputsClean !== true) {
    throw new Error('Verified source identity must prove its relevant inputs are clean.');
  }
  if (
    sourceIdentity.relevantPaths.length !== RELEVANT_SOURCE_PATHS.length ||
    sourceIdentity.relevantPaths.some(
      (path, index) => path !== RELEVANT_SOURCE_PATHS[index],
    )
  ) {
    throw new Error('Verified source identity does not cover the exact exporter source paths.');
  }
}

function validateRepositoryMigrations(migrations: readonly Migration[]): void {
  for (let index = 0; index < EXPECTED_REPOSITORY_MIGRATION_COUNT; index += 1) {
    const expectedVersion = String(index + 1).padStart(4, '0');
    if (migrations[index]?.version !== expectedVersion) {
      throw new Error(
        `Expected ${EXPECTED_REPOSITORY_MIGRATION_COUNT} contiguous migrations 0001 through ${EXPECTED_TERMINAL_VERSION}; ` +
          `missing or displaced ${expectedVersion}.`,
      );
    }
  }
  if (migrations.length !== EXPECTED_REPOSITORY_MIGRATION_COUNT) {
    throw new Error(
      `Expected exactly ${EXPECTED_REPOSITORY_MIGRATION_COUNT} contiguous migrations 0001 through ${EXPECTED_TERMINAL_VERSION}; ` +
        `received ${migrations.length}.`,
    );
  }

  const seen = new Set<string>();
  let previous = '';
  for (const migration of migrations) {
    const filenameMatch = MIGRATION_FILENAME.exec(migration.filename);
    if (
      !VERSION.test(migration.version) ||
      filenameMatch === null ||
      filenameMatch[1] !== migration.version
    ) {
      throw new Error(`Unsafe or inconsistent migration identity: ${migration.filename}.`);
    }
    if (!SHA256.test(migration.checksum)) {
      throw new Error(`Migration ${migration.filename} has an invalid source checksum.`);
    }
    if (seen.has(migration.version)) {
      throw new Error(`Duplicate repository migration version ${migration.version}.`);
    }
    if (previous !== '' && migration.version <= previous) {
      throw new Error('Repository migrations must be supplied in strictly increasing version order.');
    }
    seen.add(migration.version);
    previous = migration.version;
  }
}

function effectiveMigrations(migrations: readonly Migration[]): EffectiveMigration[] {
  return migrations.map((migration) => {
    const transformedSql = scopeMigrationSql(migration.sql, DATA_FOUNDRY_PRIVATE_SCHEMA);
    return {
      migration,
      transformedSql,
      checksum: effectiveMigrationChecksum(
        migration,
        DATA_FOUNDRY_PRIVATE_SCHEMA,
        transformedSql,
      ),
    };
  });
}

function pendingMigrations(
  migrations: readonly EffectiveMigration[],
  appliedRows: readonly SupabaseAppliedMigration[],
): EffectiveMigration[] {
  const repositoryByVersion = new Map(
    migrations.map((migration) => [migration.migration.version, migration] as const),
  );
  const appliedByVersion = new Map<string, SupabaseAppliedMigration>();

  for (const row of appliedRows) {
    if (
      !VERSION.test(row.version) ||
      MIGRATION_FILENAME.exec(row.filename)?.[1] !== row.version ||
      !SHA256.test(row.checksum)
    ) {
      throw new Error(`Invalid application-ledger row for migration version ${row.version}.`);
    }
    if (appliedByVersion.has(row.version)) {
      throw new Error(`Duplicate application-ledger version ${row.version}.`);
    }
    const expected = repositoryByVersion.get(row.version);
    if (expected === undefined) {
      throw new Error(
        `Application-ledger version ${row.version} is not present in the repository migrations.`,
      );
    }
    if (row.filename !== expected.migration.filename) {
      throw new Error(
        `Application-ledger filename mismatch for version ${row.version}: expected ${expected.migration.filename}.`,
      );
    }
    if (row.checksum !== expected.checksum) {
      throw new Error(`Application-ledger checksum mismatch for ${row.filename}.`);
    }
    appliedByVersion.set(row.version, row);
  }

  let sawPending = false;
  const pending: EffectiveMigration[] = [];
  for (const migration of migrations) {
    const isApplied = appliedByVersion.has(migration.migration.version);
    if (!isApplied) {
      sawPending = true;
      pending.push(migration);
    } else if (sawPending) {
      throw new Error(
        `Application ledger is not a contiguous repository prefix: ${migration.migration.version} is applied after a gap.`,
      );
    }
  }
  return pending;
}

function expectedLedgerColumnsSql(): string {
  return `VALUES
    ('version'::text, 'text'::text, true, NULL::text),
    ('filename'::text, 'text'::text, true, NULL::text),
    ('checksum'::text, 'text'::text, true, NULL::text),
    ('applied_at'::text, 'timestamp with time zone'::text, true, 'now()'::text),
    ('execution_ms'::text, 'integer'::text, true, NULL::text)`;
}

function canonicalLedgerSchemaAssertion(schema: string): string {
  return `
  WITH expected(attname, data_type, is_not_null, default_expression) AS (
    ${expectedLedgerColumnsSql()}
  ), live AS (
    SELECT a.attname::text AS attname,
           format_type(a.atttypid, a.atttypmod)::text AS data_type,
           a.attnotnull AS is_not_null,
           pg_get_expr(d.adbin, d.adrelid)::text AS default_expression
      FROM pg_attribute a
      LEFT JOIN pg_attrdef d
        ON d.adrelid = a.attrelid AND d.adnum = a.attnum
     WHERE a.attrelid = ${sqlLiteral(`${schema}.${LEDGER_TABLE}`)}::regclass
       AND a.attnum > 0
       AND NOT a.attisdropped
  ), differences AS (
    SELECT COALESCE(expected.attname, live.attname) AS attname
      FROM expected
      FULL OUTER JOIN live USING (attname)
     WHERE expected.attname IS NULL
        OR live.attname IS NULL
        OR expected.data_type IS DISTINCT FROM live.data_type
        OR expected.is_not_null IS DISTINCT FROM live.is_not_null
        OR expected.default_expression IS DISTINCT FROM live.default_expression
  )
  SELECT count(*) INTO ledger_schema_drift_count FROM differences;
  IF ledger_schema_drift_count <> 0 THEN
    RAISE EXCEPTION 'Refusing a marked ledger that does not have the canonical ledger schema, types, NOT NULL attributes, and defaults.';
  END IF;
  SELECT count(*)
    INTO ledger_primary_key_count
    FROM pg_constraint c
   WHERE c.conrelid = ${sqlLiteral(`${schema}.${LEDGER_TABLE}`)}::regclass
     AND c.contype = 'p'
     AND (
       SELECT array_agg(a.attname::text ORDER BY key_column.ordinality)
         FROM unnest(c.conkey) WITH ORDINALITY AS key_column(attnum, ordinality)
         JOIN pg_attribute a
           ON a.attrelid = c.conrelid AND a.attnum = key_column.attnum
     ) = ARRAY['version']::text[];
  IF ledger_primary_key_count <> 1 THEN
    RAISE EXCEPTION 'The canonical ledger requires its exact primary key on version; refusing to stamp or repair it.';
  END IF;`;
}

function ledgerOwnershipAssertion(schema: string): string {
  return `
  IF to_regclass(${sqlLiteral(`${schema}.${LEDGER_TABLE}`)}) IS NULL THEN
    RAISE EXCEPTION 'Data Foundry application ledger is absent; apply the bootstrap packet first.';
  END IF;
  SELECT obj_description(c.oid, 'pg_class')
    INTO ledger_marker
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = ${sqlLiteral(schema)}
     AND c.relname = ${sqlLiteral(LEDGER_TABLE)};
  IF ledger_marker IS DISTINCT FROM ${sqlLiteral(LEDGER_MARKER)} THEN
    RAISE EXCEPTION 'Refusing an unmarked or foreign data_foundry.schema_migrations table.';
  END IF;
${canonicalLedgerSchemaAssertion(schema)}`;
}

function buildPreflightSql(schema: string, migrationRole: string): string {
  return `WITH target AS (
  SELECT
    EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'extensions') AS extensions_schema_exists,
    EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ${sqlLiteral(migrationRole)}) AS migration_role_exists,
    CASE
      WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ${sqlLiteral(migrationRole)})
      THEN pg_has_role(current_user, ${sqlLiteral(migrationRole)}, 'MEMBER')
      ELSE false
    END AS connector_can_set_migration_role,
    EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = ${sqlLiteral(schema)}) AS target_schema_exists,
    (
      SELECT r.rolname
        FROM pg_namespace n
        JOIN pg_roles r ON r.oid = n.nspowner
       WHERE n.nspname = ${sqlLiteral(schema)}
    ) AS target_schema_owner,
    (
      SELECT obj_description(c.oid, 'pg_class')
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = ${sqlLiteral(schema)} AND c.relname = ${sqlLiteral(LEDGER_TABLE)}
    ) AS target_ledger_marker,
    (
      SELECT array_agg(a.attname::text ORDER BY a.attname)
        FROM pg_attribute a
       WHERE a.attrelid = to_regclass(${sqlLiteral(`${schema}.${LEDGER_TABLE}`)})
         AND a.attnum > 0
         AND NOT a.attisdropped
    ) AS target_ledger_columns,
    (
      SELECT obj_description(c.oid, 'pg_class')
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relname = ${sqlLiteral(LEDGER_TABLE)}
    ) AS public_ledger_marker
)
SELECT current_database() AS database_name,
       current_user AS connector_role,
       extensions_schema_exists,
       migration_role_exists,
       connector_can_set_migration_role,
       target_schema_exists,
       target_schema_owner,
       target_ledger_marker,
       target_ledger_columns,
       public_ledger_marker,
       (public_ledger_marker IS DISTINCT FROM ${sqlLiteral(LEDGER_MARKER)}) AS no_legacy_public_install
  FROM target;
`;
}

function buildBootstrapSql(schema: string, migrationRole: string): string {
  const ledger = qualified(schema, LEDGER_TABLE);
  return `-- Serialize every Data Foundry bootstrap that uses this exporter.
SELECT pg_advisory_xact_lock(168410838, 1935894387);

DO $data_foundry_bootstrap_preflight$
DECLARE
  existing_owner text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'extensions') THEN
    RAISE EXCEPTION 'The required extensions schema is absent.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ${sqlLiteral(migrationRole)}) THEN
    RAISE EXCEPTION 'The required Data Foundry migration role is absent.';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relname = ${sqlLiteral(LEDGER_TABLE)}
       AND obj_description(c.oid, 'pg_class') = ${sqlLiteral(LEDGER_MARKER)}
  ) THEN
    RAISE EXCEPTION 'A marked Data Foundry public-schema install exists; refusing private bootstrap.';
  END IF;
  SELECT r.rolname
    INTO existing_owner
    FROM pg_namespace n
    JOIN pg_roles r ON r.oid = n.nspowner
   WHERE n.nspname = ${sqlLiteral(schema)};
  IF existing_owner IS NOT NULL AND existing_owner <> ${sqlLiteral(migrationRole)} THEN
    RAISE EXCEPTION 'The data_foundry schema exists under a different owner.';
  END IF;
END
$data_foundry_bootstrap_preflight$;

CREATE SCHEMA IF NOT EXISTS ${quotedIdentifier(schema)} AUTHORIZATION ${quotedIdentifier(migrationRole)};
SET LOCAL ROLE ${quotedIdentifier(migrationRole)};
GRANT USAGE, CREATE ON SCHEMA ${quotedIdentifier(schema)} TO ${quotedIdentifier(migrationRole)};
SET LOCAL search_path TO ${quotedIdentifier(schema)}, pg_catalog, extensions;
DO $data_foundry_ledger_bootstrap$
DECLARE
  ledger_marker text;
  ledger_schema_drift_count integer;
  ledger_primary_key_count integer;
BEGIN
  IF to_regclass(${sqlLiteral(`${schema}.${LEDGER_TABLE}`)}) IS NULL THEN
    CREATE TABLE ${ledger} (
      version text PRIMARY KEY,
      filename text NOT NULL,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now(),
      execution_ms integer NOT NULL
    );
    COMMENT ON TABLE ${ledger} IS ${sqlLiteral(LEDGER_MARKER)};
  END IF;
${ledgerOwnershipAssertion(schema)}
END
$data_foundry_ledger_bootstrap$;
RESET search_path;
RESET ROLE;
`;
}

function buildPacketSql(
  schema: string,
  migrationRole: string,
  effective: EffectiveMigration,
  expectedAppliedPrefix: readonly EffectiveMigration[],
): string {
  const { migration, transformedSql, checksum } = effective;
  const ledger = qualified(schema, LEDGER_TABLE);
  const transformedWithNewline = transformedSql.endsWith('\n') ? transformedSql : `${transformedSql}\n`;
  const expectedRows =
    expectedAppliedPrefix.length === 0
      ? '  SELECT NULL::text AS version, NULL::text AS filename, NULL::text AS checksum WHERE false'
      : `  VALUES\n${expectedAppliedPrefix
          .map(
            ({ migration: expected, checksum: expectedChecksum }) =>
              `    (${sqlLiteral(expected.version)}, ${sqlLiteral(expected.filename)}, ${sqlLiteral(expectedChecksum)})`,
          )
          .join(',\n')}`;

  return `SET LOCAL ROLE ${quotedIdentifier(migrationRole)};
SET LOCAL search_path TO ${quotedIdentifier(schema)}, pg_catalog, extensions;
LOCK TABLE ${ledger} IN EXCLUSIVE MODE;
DO $data_foundry_packet$
DECLARE
  ledger_marker text;
  ledger_schema_drift_count integer;
  ledger_primary_key_count integer;
  ledger_row_count bigint;
  ledger_drift_count integer;
BEGIN${ledgerOwnershipAssertion(schema)}
  SELECT count(*) INTO ledger_row_count FROM ${ledger};
  IF ledger_row_count <> ${expectedAppliedPrefix.length} THEN
    RAISE EXCEPTION 'The entire application ledger row count does not equal this packet expected prefix length; refresh and export again.';
  END IF;
  WITH expected(version, filename, checksum) AS (
${expectedRows}
  ), differences AS (
    SELECT COALESCE(expected.version, live.version) AS version
      FROM expected
      FULL OUTER JOIN ${ledger} live USING (version)
     WHERE expected.version IS NULL
        OR live.version IS NULL
        OR expected.filename IS DISTINCT FROM live.filename
        OR expected.checksum IS DISTINCT FROM live.checksum
  )
  SELECT count(*) INTO ledger_drift_count FROM differences;
  IF ledger_drift_count <> 0 THEN
    RAISE EXCEPTION 'The entire application ledger does not equal this packet expected prefix; refresh and export again.';
  END IF;
END
$data_foundry_packet$;

${transformedWithNewline}
INSERT INTO ${ledger} (version, filename, checksum, execution_ms)
VALUES (${sqlLiteral(migration.version)}, ${sqlLiteral(migration.filename)}, ${sqlLiteral(checksum)}, 0);
RESET search_path;
RESET ROLE;
`;
}

function buildVerificationSql(schema: string, migrations: readonly EffectiveMigration[]): string {
  const values = migrations
    .map(
      ({ migration, checksum }) =>
        `  (${sqlLiteral(migration.version)}, ${sqlLiteral(migration.filename)}, ${sqlLiteral(checksum)})`,
    )
    .join(',\n');
  const ledger = qualified(schema, LEDGER_TABLE);
  return `WITH expected_columns(attname, data_type, is_not_null, default_expression) AS (
  ${expectedLedgerColumnsSql()}
), live_columns AS (
  SELECT a.attname::text AS attname,
         format_type(a.atttypid, a.atttypmod)::text AS data_type,
         a.attnotnull AS is_not_null,
         pg_get_expr(d.adbin, d.adrelid)::text AS default_expression
    FROM pg_attribute a
    LEFT JOIN pg_attrdef d
      ON d.adrelid = a.attrelid AND d.adnum = a.attnum
   WHERE a.attrelid = ${sqlLiteral(`${schema}.${LEDGER_TABLE}`)}::regclass
     AND a.attnum > 0
     AND NOT a.attisdropped
), column_differences AS (
  SELECT COALESCE(expected_columns.attname, live_columns.attname) AS attname
    FROM expected_columns
    FULL OUTER JOIN live_columns USING (attname)
   WHERE expected_columns.attname IS NULL
      OR live_columns.attname IS NULL
      OR expected_columns.data_type IS DISTINCT FROM live_columns.data_type
      OR expected_columns.is_not_null IS DISTINCT FROM live_columns.is_not_null
      OR expected_columns.default_expression IS DISTINCT FROM live_columns.default_expression
), exact_primary_key AS (
  SELECT count(*)::int AS matching_count
    FROM pg_constraint c
   WHERE c.conrelid = ${sqlLiteral(`${schema}.${LEDGER_TABLE}`)}::regclass
     AND c.contype = 'p'
     AND (
       SELECT array_agg(a.attname::text ORDER BY key_column.ordinality)
         FROM unnest(c.conkey) WITH ORDINALITY AS key_column(attnum, ordinality)
         JOIN pg_attribute a
           ON a.attrelid = c.conrelid AND a.attnum = key_column.attnum
     ) = ARRAY['version']::text[]
)
SELECT obj_description(c.oid, 'pg_class') AS ledger_marker,
       obj_description(c.oid, 'pg_class') = ${sqlLiteral(LEDGER_MARKER)} AS marker_matches,
       NOT EXISTS (SELECT 1 FROM column_differences) AS canonical_columns_match,
       (SELECT matching_count = 1 FROM exact_primary_key) AS primary_key_on_version,
       (SELECT count(*) = ${migrations.length} FROM ${ledger}) AS row_count_matches,
       (SELECT count(*)::int FROM ${ledger}) AS live_row_count,
       ${migrations.length}::int AS expected_row_count
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = ${sqlLiteral(schema)} AND c.relname = ${sqlLiteral(LEDGER_TABLE)};

WITH expected(version, filename, checksum) AS (VALUES
${values}
), actual AS (
  SELECT version,
         filename,
         checksum,
         row_number() OVER (PARTITION BY version, filename, checksum ORDER BY applied_at) AS duplicate_ordinal
    FROM ${ledger}
)
SELECT 'missing'::text AS status, e.version, e.filename, e.checksum
  FROM expected e
  LEFT JOIN actual a
    ON a.version = e.version
   AND a.filename = e.filename
   AND a.checksum = e.checksum
   AND a.duplicate_ordinal = 1
 WHERE a.version IS NULL
UNION ALL
SELECT 'unexpected_or_mismatched'::text AS status, a.version, a.filename, a.checksum
  FROM actual a
  LEFT JOIN expected e USING (version, filename, checksum)
 WHERE e.version IS NULL OR a.duplicate_ordinal > 1
ORDER BY version, status;
`;
}

type ExpectedRuntimeGrant = RuntimeRoleExpectedGrant;

function runtimeRoleArraySql(): string {
  return `ARRAY[${RUNTIME_ROLE_NAMES.map(sqlLiteral).join(', ')}]::text[]`;
}

function expectedRelations(): Array<Readonly<{ name: string; kind: string }>> {
  return [
    ...EXPECTED_TABLES.map((name) => ({ name, kind: 'r' })),
    { name: LEDGER_TABLE, kind: 'r' },
    { name: 'current_entity_aliases', kind: 'v' },
    { name: 'current_rights_decisions', kind: 'v' },
    { name: 'current_rights_terms', kind: 'v' },
    { name: 'ingestion_job_transitions_id_seq', kind: 'S' },
  ].sort((left, right) => left.name.localeCompare(right.name));
}

function expectedRelationValuesSql(): string {
  return expectedRelations()
    .map(({ name, kind }) => `    (${sqlLiteral(name)}, ${sqlLiteral(kind)})`)
    .join(',\n');
}

function expectedFunctionValuesSql(): string {
  return RUNTIME_PRIVATE_FUNCTION_SIGNATURES.map((signature) => `    (${sqlLiteral(signature)})`).join(',\n');
}

function aclInventorySql(schema: string, rolePredicate: string): string {
  return `
    SELECT 'schema'::text AS scope, n.nspname::text AS object_name,
           ''::text AS column_name, grantee.rolname::text AS role_name,
           acl.privilege_type::text AS privilege, acl.is_grantable
      FROM pg_namespace n
      CROSS JOIN LATERAL aclexplode(n.nspacl) acl
      JOIN pg_roles grantee ON grantee.oid = acl.grantee
     WHERE n.nspname = ${sqlLiteral(schema)} AND ${rolePredicate}
    UNION ALL
    SELECT 'relation', c.relname::text, '', grantee.rolname::text, acl.privilege_type::text, acl.is_grantable
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      CROSS JOIN LATERAL aclexplode(c.relacl) acl
      JOIN pg_roles grantee ON grantee.oid = acl.grantee
     WHERE n.nspname = ${sqlLiteral(schema)}
       AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
       AND ${rolePredicate}
    UNION ALL
    SELECT 'column', c.relname::text, a.attname::text, grantee.rolname::text, acl.privilege_type::text, acl.is_grantable
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      CROSS JOIN LATERAL aclexplode(a.attacl) acl
      JOIN pg_roles grantee ON grantee.oid = acl.grantee
     WHERE n.nspname = ${sqlLiteral(schema)}
       AND a.attnum > 0 AND NOT a.attisdropped
       AND ${rolePredicate}
    UNION ALL
    SELECT 'function',
           (p.proname || '(' || oidvectortypes(p.proargtypes) || ')')::text,
           '', grantee.rolname::text, acl.privilege_type::text, acl.is_grantable
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      CROSS JOIN LATERAL aclexplode(p.proacl) acl
      JOIN pg_roles grantee ON grantee.oid = acl.grantee
     WHERE n.nspname = ${sqlLiteral(schema)} AND p.prokind IN ('f', 'p', 'a', 'w') AND ${rolePredicate}`;
}

function completePrivateDirectAclSql(schema: string): string {
  const grantee = `COALESCE(grantee.rolname, 'PUBLIC')::text`;
  const normalized = aclInventorySql(schema, 'TRUE')
    .replaceAll('grantee.rolname::text AS role_name', `${grantee} AS role_name`)
    .replaceAll('grantee.rolname::text', grantee)
    .replaceAll(
      'JOIN pg_roles grantee ON grantee.oid = acl.grantee',
      'LEFT JOIN pg_roles grantee ON grantee.oid = acl.grantee',
    )
    .replace(
      "AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')\n       AND TRUE",
      "AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')\n       AND acl.grantee <> c.relowner\n       AND TRUE",
    );
  return `${normalized}
    UNION ALL
    SELECT 'type', t.typname::text, '', ${grantee}, acl.privilege_type::text, acl.is_grantable
      FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
      CROSS JOIN LATERAL aclexplode(t.typacl) acl
      LEFT JOIN pg_roles grantee ON grantee.oid = acl.grantee
     WHERE n.nspname = ${sqlLiteral(schema)} AND acl.grantee <> t.typowner`;
}

function baselinePrivateAclValuesSql(schema: string): string {
  return [
    `    ('schema', ${sqlLiteral(schema)}, '', 'df_migration', 'CREATE', false)`,
    `    ('schema', ${sqlLiteral(schema)}, '', 'df_migration', 'USAGE', false)`,
    ...RUNTIME_PRIVATE_FUNCTION_SIGNATURES.map(
      (signature) => `    ('function', ${sqlLiteral(signature)}, '', 'df_migration', 'EXECUTE', false)`,
    ),
  ].join(',\n');
}

function buildGrantStatements(schema: string): {
  readonly sql: string;
  readonly expected: readonly ExpectedRuntimeGrant[];
} {
  const expected = buildRuntimeRoleExpectedGrants(schema);
  const statements: string[] = [];
  const relationGroups = new Map<string, { readonly role: string; readonly relation: string; readonly privileges: string[] }>();
  const columnGroups = new Map<string, { readonly role: string; readonly relation: string; readonly privilege: string; readonly columns: string[] }>();

  for (const grant of expected) {
    if (grant.scope === 'schema') {
      statements.push(`GRANT ${grant.privilege} ON SCHEMA ${quotedIdentifier(schema)} TO ${quotedIdentifier(grant.role)};`);
      continue;
    }
    if (grant.scope === 'relation') {
      const key = `${grant.role}:${grant.objectName}`;
      const group = relationGroups.get(key) ?? { role: grant.role, relation: grant.objectName, privileges: [] };
      group.privileges.push(grant.privilege);
      relationGroups.set(key, group);
      continue;
    }
    if (grant.scope === 'column') {
      const key = `${grant.role}:${grant.objectName}:${grant.privilege}`;
      const group = columnGroups.get(key) ?? {
        role: grant.role,
        relation: grant.objectName,
        privilege: grant.privilege,
        columns: [],
      };
      group.columns.push(grant.columnName);
      columnGroups.set(key, group);
      continue;
    }
    statements.push(
      `GRANT ${grant.privilege} ON FUNCTION ${quotedIdentifier(schema)}.${grant.objectName} TO ${quotedIdentifier(grant.role)};`,
    );
  }
  for (const group of relationGroups.values()) {
    statements.push(
      `GRANT ${group.privileges.join(', ')} ON TABLE ${qualified(schema, group.relation)} TO ${quotedIdentifier(group.role)};`,
    );
  }
  for (const group of columnGroups.values()) {
    statements.push(
      `GRANT ${group.privilege} (${group.columns.map(quotedIdentifier).join(', ')}) ON TABLE ${qualified(schema, group.relation)} TO ${quotedIdentifier(group.role)};`,
    );
  }
  return { sql: statements.join('\n'), expected };
}

function expectedGrantValuesSql(expected: readonly ExpectedRuntimeGrant[]): string {
  return expected
    .map(
      (grant) =>
        `    (${sqlLiteral(grant.scope)}, ${sqlLiteral(grant.objectName)}, ${sqlLiteral(grant.columnName)}, ` +
        `${sqlLiteral(grant.role)}, ${sqlLiteral(grant.privilege)}, ${grant.isGrantable})`,
    )
    .join(',\n');
}

function publicPrivateAclRowsSql(schema: string): string {
  return `SELECT acl.privilege_type::text AS privilege
      FROM pg_namespace n
      CROSS JOIN LATERAL aclexplode(n.nspacl) acl
     WHERE n.nspname = ${sqlLiteral(schema)} AND acl.grantee = 0
    UNION ALL
    SELECT acl.privilege_type::text
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      CROSS JOIN LATERAL aclexplode(c.relacl) acl
     WHERE n.nspname = ${sqlLiteral(schema)}
       AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f') AND acl.grantee = 0
    UNION ALL
    SELECT acl.privilege_type::text
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      CROSS JOIN LATERAL aclexplode(a.attacl) acl
     WHERE n.nspname = ${sqlLiteral(schema)}
       AND a.attnum > 0 AND NOT a.attisdropped AND acl.grantee = 0
    UNION ALL
    SELECT acl.privilege_type::text
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      CROSS JOIN LATERAL aclexplode(p.proacl) acl
     WHERE n.nspname = ${sqlLiteral(schema)} AND p.prokind IN ('f', 'p', 'a', 'w') AND acl.grantee = 0
    UNION ALL
    SELECT 'EXECUTE'::text
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = ${sqlLiteral(schema)} AND p.proacl IS NULL`;
}

function buildRuntimeGrantVerificationSql(
  schema: string,
  expected: readonly ExpectedRuntimeGrant[],
  migrations: readonly EffectiveMigration[],
  loginState: 'NOLOGIN' | 'LOGIN' = 'NOLOGIN',
): string {
  const targetPredicate = `grantee.rolname = ANY(${runtimeRoleArraySql()})`;
  const loginPredicate = loginState === 'LOGIN' ? 'r.rolcanlogin' : 'NOT r.rolcanlogin';
  const loginAlias = loginState === 'LOGIN' ? 'runtime_roles_are_login_nonprivileged' : 'runtime_roles_are_nologin_nonprivileged';
  const loginFailure = loginState === 'LOGIN'
    ? 'Runtime grant verification failed: runtime roles are not direct LOGIN roles.'
    : 'Runtime grant verification failed: runtime roles are not staged NOLOGIN roles.';
  const ledger = qualified(schema, LEDGER_TABLE);
  const expectedLedgerRows = migrations
    .map(({ migration, checksum }) => `    (${sqlLiteral(migration.version)}, ${sqlLiteral(migration.filename)}, ${sqlLiteral(checksum)})`)
    .join(',\n');
  const completeExpectedAcl = `${baselinePrivateAclValuesSql(schema)},\n${expectedGrantValuesSql(expected)}`;
  const expectedFunctionSearchPath = sqlLiteral(`search_path=${schema}, pg_catalog, extensions`);
  return `${buildVerificationSql(schema, migrations)}

WITH expected(scope, object_name, column_name, role_name, privilege, is_grantable) AS (VALUES
${expectedGrantValuesSql(expected)}
), live AS (
${aclInventorySql(schema, targetPredicate)}
), missing AS (
  SELECT expected.* FROM expected LEFT JOIN live USING (scope, object_name, column_name, role_name, privilege, is_grantable)
   WHERE live.scope IS NULL
), unexpected AS (
  SELECT live.* FROM live LEFT JOIN expected USING (scope, object_name, column_name, role_name, privilege, is_grantable)
   WHERE expected.scope IS NULL
)
SELECT (SELECT count(*)::int FROM missing) AS missing_private_privilege_count,
       (SELECT count(*)::int FROM unexpected) AS unexpected_private_privilege_count;

WITH expected_relations(relname, relkind) AS (VALUES
${expectedRelationValuesSql()}
), live_relations AS (
  SELECT c.relname::text, c.relkind::text, pg_get_userbyid(c.relowner)::text AS owner_name
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = ${sqlLiteral(schema)} AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
), relation_differences AS (
  SELECT COALESCE(expected_relations.relname, live_relations.relname) AS name
    FROM expected_relations FULL OUTER JOIN live_relations USING (relname, relkind)
   WHERE expected_relations.relname IS NULL OR live_relations.relname IS NULL
      OR live_relations.owner_name IS DISTINCT FROM 'df_migration'
), expected_functions(signature) AS (VALUES
${expectedFunctionValuesSql()}
), live_functions AS (
  SELECT (p.proname || '(' || oidvectortypes(p.proargtypes) || ')')::text AS signature,
         pg_get_userbyid(p.proowner)::text AS owner_name,
         p.prosecdef,
         p.proconfig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = ${sqlLiteral(schema)} AND p.prokind IN ('f', 'p', 'a', 'w')
), function_differences AS (
  SELECT COALESCE(expected_functions.signature, live_functions.signature) AS name
    FROM expected_functions FULL OUTER JOIN live_functions USING (signature)
   WHERE expected_functions.signature IS NULL OR live_functions.signature IS NULL
      OR live_functions.owner_name IS DISTINCT FROM 'df_migration'
      OR live_functions.proconfig IS DISTINCT FROM ARRAY[${expectedFunctionSearchPath}]::text[]
)
SELECT (SELECT count(*)::int FROM relation_differences) AS relation_inventory_difference_count,
       (SELECT count(*)::int FROM function_differences) AS function_inventory_difference_count,
       (SELECT count(*)::int FROM live_functions WHERE prosecdef) AS security_definer_count,
       (SELECT count(*)::int FROM live_functions
         WHERE proconfig IS DISTINCT FROM ARRAY[${expectedFunctionSearchPath}]::text[]
       ) AS function_search_path_difference_count,
       (SELECT count(*)::int FROM (${publicPrivateAclRowsSql(schema)}) public_acl) AS forbidden_public_private_acl_count,
       NOT has_schema_privilege('public', 'public', 'CREATE') AS public_schema_create_is_false,
       (
         SELECT count(*) = ${RUNTIME_ROLE_NAMES.length}
           FROM pg_roles r
          WHERE r.rolname = ANY(${runtimeRoleArraySql()})
            AND ${loginPredicate} AND NOT r.rolsuper AND NOT r.rolcreatedb
            AND NOT r.rolcreaterole AND NOT r.rolreplication AND NOT r.rolbypassrls
       ) AS ${loginAlias};

-- Compare this value with the operator-approved pre-deployment fingerprint.
SELECT n.nspacl::text AS public_fingerprint_input
  FROM pg_namespace n WHERE n.nspname = 'public';

DO $data_foundry_runtime_grant_verification$
DECLARE
  ledger_marker text;
  ledger_schema_drift_count integer;
  ledger_primary_key_count integer;
  drift_count integer;
BEGIN${ledgerOwnershipAssertion(schema)}
  WITH expected(version, filename, checksum) AS (VALUES
${expectedLedgerRows}
  ), live AS (SELECT version, filename, checksum FROM ${ledger}), differences AS (
    SELECT expected.version FROM expected FULL OUTER JOIN live USING (version)
     WHERE expected.version IS NULL OR live.version IS NULL
        OR expected.filename IS DISTINCT FROM live.filename
        OR expected.checksum IS DISTINCT FROM live.checksum
  )
  SELECT count(*) + ABS((SELECT count(*) FROM ${ledger}) - ${migrations.length})
    INTO drift_count FROM differences;
  IF drift_count <> 0 THEN RAISE EXCEPTION 'Runtime grant verification failed: application ledger drift.'; END IF;

  WITH expected(relname, relkind) AS (VALUES
${expectedRelationValuesSql()}
  ), live AS (
    SELECT c.relname::text, c.relkind::text, pg_get_userbyid(c.relowner)::text AS owner_name
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = ${sqlLiteral(schema)} AND c.relkind IN ('r','p','v','m','S','f')
  ), differences AS (
    SELECT expected.relname FROM expected FULL OUTER JOIN live USING (relname, relkind)
     WHERE expected.relname IS NULL OR live.relname IS NULL OR live.owner_name IS DISTINCT FROM 'df_migration'
  ) SELECT count(*) INTO drift_count FROM differences;
  IF drift_count <> 0 THEN RAISE EXCEPTION 'Runtime grant verification failed: relation inventory drift.'; END IF;

  WITH expected(signature) AS (VALUES
${expectedFunctionValuesSql()}
  ), live AS (
    SELECT (p.proname || '(' || oidvectortypes(p.proargtypes) || ')')::text AS signature,
           pg_get_userbyid(p.proowner)::text AS owner_name, p.prosecdef, p.proconfig
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = ${sqlLiteral(schema)} AND p.prokind IN ('f','p','a','w')
  ), differences AS (
    SELECT expected.signature FROM expected FULL OUTER JOIN live USING (signature)
     WHERE expected.signature IS NULL OR live.signature IS NULL
        OR live.owner_name IS DISTINCT FROM 'df_migration'
        OR live.proconfig IS DISTINCT FROM ARRAY[${expectedFunctionSearchPath}]::text[]
  ) SELECT count(*) + (SELECT count(*) FROM live WHERE prosecdef) INTO drift_count FROM differences;
  IF drift_count <> 0 THEN RAISE EXCEPTION 'Runtime grant verification failed: routine inventory, SECURITY DEFINER, or function search path drift.'; END IF;

  WITH expected(scope, object_name, column_name, role_name, privilege, is_grantable) AS (VALUES
${completeExpectedAcl}
  ), live AS (
${completePrivateDirectAclSql(schema)}
  ), differences AS (
    SELECT expected.scope FROM expected FULL OUTER JOIN live
      USING (scope, object_name, column_name, role_name, privilege, is_grantable)
     WHERE expected.scope IS NULL OR live.scope IS NULL
  ) SELECT count(*) INTO drift_count FROM differences;
  IF drift_count <> 0 THEN RAISE EXCEPTION 'Runtime grant verification failed: complete private direct ACL drift.'; END IF;

  WITH expected(scope, object_name, column_name, role_name, privilege, is_grantable) AS (VALUES
${buildRuntimeRoleExpectedExternalAclValuesSql()}
  ), live AS (
${buildRuntimeRoleExternalDirectAclSql(schema, targetPredicate)}
  ), differences AS (
    SELECT expected.scope FROM expected FULL OUTER JOIN live
      USING (scope, object_name, column_name, role_name, privilege, is_grantable)
     WHERE expected.scope IS NULL OR live.scope IS NULL
  ) SELECT count(*) INTO drift_count FROM differences;
  IF drift_count <> 0 THEN RAISE EXCEPTION 'Runtime grant verification failed: external direct ACL drift.'; END IF;

  IF has_schema_privilege('public', 'public', 'CREATE') OR
     (SELECT count(*) FROM pg_roles r WHERE r.rolname = ANY(${runtimeRoleArraySql()})
       AND ${loginPredicate} AND NOT r.rolsuper AND NOT r.rolcreatedb AND NOT r.rolcreaterole
       AND NOT r.rolreplication AND NOT r.rolbypassrls) <> ${RUNTIME_ROLE_NAMES.length} OR
     EXISTS (SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.member
              WHERE r.rolname = ANY(${runtimeRoleArraySql()})) OR
     EXISTS (SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.roleid
              WHERE r.rolname = ANY(${runtimeRoleArraySql()})) THEN
    RAISE EXCEPTION ${sqlLiteral(loginFailure)};
  END IF;
END
$data_foundry_runtime_grant_verification$;
`;
}

function buildPostMigrationGrantPayload(
  schema: string,
  migrationRole: string,
  migrations: readonly EffectiveMigration[],
): SupabaseRuntimeGrantPayload {
  const ledger = qualified(schema, LEDGER_TABLE);
  const expectedRows = migrations
    .map(
      ({ migration, checksum }) =>
        `    (${sqlLiteral(migration.version)}, ${sqlLiteral(migration.filename)}, ${sqlLiteral(checksum)})`,
    )
    .join(',\n');
  const grants = buildGrantStatements(schema);
  const targetPredicate = `grantee.rolname = ANY(${runtimeRoleArraySql()})`;
  const forbiddenNamedPredicate =
    "grantee.rolname = ANY(ARRAY['anon', 'authenticated', 'service_role']::text[])";
  const expectedFunctionSearchPath = sqlLiteral(`search_path=${schema}, pg_catalog, extensions`);

  const sql = `SET LOCAL ROLE ${quotedIdentifier(migrationRole)};
SET LOCAL search_path TO ${quotedIdentifier(schema)}, pg_catalog, extensions;
LOCK TABLE ${ledger} IN EXCLUSIVE MODE;
DO $data_foundry_runtime_grants$
DECLARE
  ledger_marker text;
  ledger_schema_drift_count integer;
  ledger_primary_key_count integer;
  prerequisite_drift_count integer;
  existing_privilege_count integer;
BEGIN${ledgerOwnershipAssertion(schema)}
  WITH expected(version, filename, checksum) AS (VALUES
${expectedRows}
  ), live AS (
    SELECT version, filename, checksum FROM ${ledger}
  ), differences AS (
    SELECT COALESCE(expected.version, live.version) AS version
      FROM expected FULL OUTER JOIN live USING (version)
     WHERE expected.version IS NULL OR live.version IS NULL
        OR expected.filename IS DISTINCT FROM live.filename
        OR expected.checksum IS DISTINCT FROM live.checksum
  )
  SELECT count(*) + ABS((SELECT count(*) FROM ${ledger}) - ${migrations.length})
    INTO prerequisite_drift_count FROM differences;
  IF prerequisite_drift_count <> 0 THEN
    RAISE EXCEPTION 'Runtime grants require the canonical full application ledger 0001 through 0028.';
  END IF;

  IF (SELECT pg_get_userbyid(n.nspowner) FROM pg_namespace n WHERE n.nspname = ${sqlLiteral(schema)})
       IS DISTINCT FROM ${sqlLiteral(migrationRole)} THEN
    RAISE EXCEPTION 'Runtime grants require data_foundry schema ownership by df_migration.';
  END IF;
  WITH expected(relname, relkind) AS (VALUES
${expectedRelationValuesSql()}
  ), live AS (
    SELECT c.relname::text, c.relkind::text, pg_get_userbyid(c.relowner)::text AS owner_name
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = ${sqlLiteral(schema)} AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
  ), differences AS (
    SELECT COALESCE(expected.relname, live.relname) AS name
      FROM expected FULL OUTER JOIN live USING (relname, relkind)
     WHERE expected.relname IS NULL OR live.relname IS NULL
        OR live.owner_name IS DISTINCT FROM ${sqlLiteral(migrationRole)}
  )
  SELECT count(*) INTO prerequisite_drift_count FROM differences;
  IF prerequisite_drift_count <> 0 THEN
    RAISE EXCEPTION 'Runtime grants require the exact canonical object inventory owned by df_migration.';
  END IF;

  WITH expected(signature) AS (VALUES
${expectedFunctionValuesSql()}
  ), live AS (
    SELECT (p.proname || '(' || oidvectortypes(p.proargtypes) || ')')::text AS signature,
           pg_get_userbyid(p.proowner)::text AS owner_name,
           p.proconfig
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = ${sqlLiteral(schema)} AND p.prokind IN ('f', 'p', 'a', 'w')
  ), differences AS (
    SELECT COALESCE(expected.signature, live.signature) AS name
      FROM expected FULL OUTER JOIN live USING (signature)
     WHERE expected.signature IS NULL OR live.signature IS NULL
        OR live.owner_name IS DISTINCT FROM ${sqlLiteral(migrationRole)}
        OR live.proconfig IS DISTINCT FROM ARRAY[${expectedFunctionSearchPath}]::text[]
  )
  SELECT count(*) INTO prerequisite_drift_count FROM differences;
  IF prerequisite_drift_count <> 0 THEN
    RAISE EXCEPTION 'Runtime grants require the exact private function inventory, ownership, and function search path.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = ${sqlLiteral(schema)} AND p.prosecdef
  ) THEN
    RAISE EXCEPTION 'Runtime grants refuse every private SECURITY DEFINER function.';
  END IF;

  SELECT count(*) INTO prerequisite_drift_count
    FROM pg_roles r
   WHERE r.rolname = ANY(${runtimeRoleArraySql()})
     AND (r.rolcanlogin OR r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication OR r.rolbypassrls);
  IF prerequisite_drift_count <> 0 OR
     (SELECT count(*) FROM pg_roles r WHERE r.rolname = ANY(${runtimeRoleArraySql()})) <> ${RUNTIME_ROLE_NAMES.length} OR
     EXISTS (
       SELECT 1 FROM pg_auth_members membership
       JOIN pg_roles member_role ON member_role.oid = membership.member
       WHERE member_role.rolname = ANY(${runtimeRoleArraySql()})
     ) OR EXISTS (
       SELECT 1 FROM pg_auth_members membership
       JOIN pg_roles granted_role ON granted_role.oid = membership.roleid
       WHERE granted_role.rolname = ANY(${runtimeRoleArraySql()})
     ) THEN
    RAISE EXCEPTION 'Runtime roles must all exist as NOLOGIN, nonprivileged, non-member roles.';
  END IF;
  IF has_schema_privilege('public', 'public', 'CREATE') THEN
    RAISE EXCEPTION 'PUBLIC CREATE on the shared public schema must already be false.';
  END IF;
  SELECT count(*) INTO prerequisite_drift_count FROM (
${publicPrivateAclRowsSql(schema)}
  ) forbidden_public_acl;
  IF prerequisite_drift_count <> 0 THEN
    RAISE EXCEPTION 'Private schema ACL is invalid because PUBLIC has privileges.';
  END IF;
  SELECT count(*) INTO prerequisite_drift_count FROM (
${aclInventorySql(schema, forbiddenNamedPredicate)}
  ) forbidden_named_acl;
  IF prerequisite_drift_count <> 0 THEN
    RAISE EXCEPTION 'Private schema ACL is invalid for anon, authenticated, or service_role.';
  END IF;
  SELECT count(*) INTO existing_privilege_count FROM (
${aclInventorySql(schema, targetPredicate)}
  ) existing_target_acl;
  IF existing_privilege_count <> 0 THEN
    RAISE EXCEPTION 'Target runtime roles have unexpected existing private privileges; refusing to normalize them.';
  END IF;
  WITH expected(scope, object_name, column_name, role_name, privilege, is_grantable) AS (VALUES
${baselinePrivateAclValuesSql(schema)}
  ), live AS (
${completePrivateDirectAclSql(schema)}
  ), differences AS (
    SELECT expected.scope FROM expected FULL OUTER JOIN live
      USING (scope, object_name, column_name, role_name, privilege, is_grantable)
     WHERE expected.scope IS NULL OR live.scope IS NULL
  )
  SELECT count(*) INTO prerequisite_drift_count FROM differences;
  IF prerequisite_drift_count <> 0 THEN
    RAISE EXCEPTION 'Private schema complete direct ACL baseline is not canonical.';
  END IF;
  WITH expected(scope, object_name, column_name, role_name, privilege, is_grantable) AS (VALUES
${buildRuntimeRoleExpectedExternalAclValuesSql()}
  ), live AS (
${buildRuntimeRoleExternalDirectAclSql(schema, targetPredicate)}
  ), differences AS (
    SELECT expected.scope FROM expected FULL OUTER JOIN live
      USING (scope, object_name, column_name, role_name, privilege, is_grantable)
     WHERE expected.scope IS NULL OR live.scope IS NULL
  )
  SELECT count(*) INTO prerequisite_drift_count FROM differences;
  IF prerequisite_drift_count <> 0 THEN
    RAISE EXCEPTION 'Runtime roles have an unexpected direct object privilege outside data_foundry; only extensions schema USAGE and current-database CONNECT are allowed.';
  END IF;
END
$data_foundry_runtime_grants$;

${grants.sql}
RESET search_path;
RESET ROLE;
`;
  const checksum = createHash('sha256').update(sql, 'utf8').digest('hex');
  return {
    providerMigrationName: `data_foundry_runtime_grants_${checksum.slice(0, 12)}`,
    checksum,
    applicationLedgerMutation: false,
    roles: RUNTIME_ROLE_NAMES,
    functionGrantPolicy: 'explicit-all-private-functions-to-acquisition-invoker',
    functionSignatures: RUNTIME_PRIVATE_FUNCTION_SIGNATURES,
    expectedGrants: grants.expected,
    sql,
    verificationSql: buildRuntimeGrantVerificationSql(schema, grants.expected, migrations),
    postCredentialVerificationSql: buildRuntimeGrantVerificationSql(
      schema,
      grants.expected,
      migrations,
      'LOGIN',
    ),
  };
}

function repositoryDigest(migrations: readonly EffectiveMigration[]): string {
  const hash = createHash('sha256');
  for (const { migration, checksum } of migrations) {
    hash.update(`${migration.version}\u0000${migration.filename}\u0000${checksum}\u0000`, 'utf8');
  }
  return hash.digest('hex');
}

export function buildSupabaseMigrationPlan(
  options: Readonly<BuildSupabaseMigrationPlanOptions>,
): SupabaseMigrationPlan {
  validateSourceIdentity(options.sourceIdentity);
  validateTarget(options.schema, options.migrationRole);
  validateRepositoryMigrations(options.migrations);
  const effective = effectiveMigrations(options.migrations);
  const pending = pendingMigrations(effective, options.appliedMigrations);
  const bootstrapSql = buildBootstrapSql(options.schema, options.migrationRole);
  const postMigrationGrants = buildPostMigrationGrantPayload(
    options.schema,
    options.migrationRole,
    effective,
  );
  const digest = repositoryDigest(effective);
  const packets = pending.map(({ migration, transformedSql, checksum }) => {
    const migrationIndex = effective.findIndex(
      ({ migration: repositoryMigration }) => repositoryMigration.version === migration.version,
    );
    const expectedAppliedPrefix = effective.slice(0, migrationIndex);
    return {
      version: migration.version,
      filename: migration.filename,
      checksum,
      expectedAppliedCount: expectedAppliedPrefix.length,
      providerMigrationName: `data_foundry_${migration.version}_${checksum.slice(0, 12)}`,
      transformedSql,
      sql: buildPacketSql(
        options.schema,
        options.migrationRole,
        { migration, transformedSql, checksum },
        expectedAppliedPrefix,
      ),
    };
  });

  return {
    format: FORMAT,
    releaseSha: options.sourceIdentity.releaseSha,
    sourceIdentity: options.sourceIdentity,
    transactionContract: {
      packetTransaction: 'provider-managed-required',
      providerMigrationLedgerAtomicity: 'unverified',
      liveUseAuthorized: false,
    },
    schema: DATA_FOUNDRY_PRIVATE_SCHEMA,
    migrationRole: REQUIRED_MIGRATION_ROLE,
    ledger: {
      schema: DATA_FOUNDRY_PRIVATE_SCHEMA,
      table: LEDGER_TABLE,
      marker: LEDGER_MARKER,
    },
    repositoryMigrationCount: effective.length,
    appliedMigrationCount: options.appliedMigrations.length,
    pendingMigrationCount: packets.length,
    repositoryDigest: digest,
    bootstrapProviderMigrationName: `data_foundry_bootstrap_${createHash('sha256').update(bootstrapSql).digest('hex').slice(0, 12)}`,
    preflightSql: buildPreflightSql(options.schema, options.migrationRole),
    bootstrapSql,
    verificationSql: buildVerificationSql(options.schema, effective),
    packets,
    postMigrationGrants,
  };
}

export function renderSupabaseMigrationManifest(plan: SupabaseMigrationPlan): string {
  return `${JSON.stringify(plan, null, 2)}\n`;
}

function parseAppliedLedger(value: unknown): SupabaseAppliedMigration[] {
  if (!Array.isArray(value)) {
    throw new Error('The applied-ledger JSON must be an array of version, filename, checksum rows.');
  }
  return value.map((row, index) => {
    if (typeof row !== 'object' || row === null || Array.isArray(row)) {
      throw new Error(`Applied-ledger row ${index + 1} must be an object.`);
    }
    const record = row as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    if (keys.join(',') !== 'checksum,filename,version') {
      throw new Error(
        `Applied-ledger row ${index + 1} must contain only checksum, filename, and version.`,
      );
    }
    if (
      typeof record['version'] !== 'string' ||
      typeof record['filename'] !== 'string' ||
      typeof record['checksum'] !== 'string'
    ) {
      throw new Error(`Applied-ledger row ${index + 1} values must be strings.`);
    }
    return {
      version: record['version'],
      filename: record['filename'],
      checksum: record['checksum'],
    };
  });
}

export function parseSupabaseMigrationCliArguments(argv: readonly string[]): {
  releaseSha: string;
  appliedLedgerPath: string | undefined;
} {
  let releaseSha: string | undefined;
  let appliedLedgerPath: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (index === 0 && argument === '--') {
      continue;
    }
    if (argument === '--release-sha') {
      releaseSha = argv[index + 1];
      index += 1;
    } else if (argument === '--applied-ledger') {
      appliedLedgerPath = argv[index + 1];
      index += 1;
    } else {
      throw new Error(`Unknown or incomplete argument: ${argument ?? '(missing)'}.`);
    }
  }
  if (releaseSha === undefined) {
    throw new Error('Usage: migrate:supabase:export -- --release-sha <40-char-sha> [--applied-ledger <json-file>]');
  }
  return { releaseSha, appliedLedgerPath };
}

export interface BuildSupabaseMigrationPlanFromGitOptions {
  readonly releaseSha: string;
  readonly repositoryRoot?: string | undefined;
  readonly appliedMigrations: readonly SupabaseAppliedMigration[];
}

export interface SupabaseMigrationGitDependencies {
  readonly verifySourceIdentity?: typeof verifyGitSourceIdentity;
  readonly loadGitMigrations?: typeof loadMigrationsFromGit;
}

/**
 * Bind both identity verification and migration bytes to one immutable Git
 * object. Dependency injection keeps the check/load boundary directly
 * regression-testable without weakening the CLI's offline contract.
 */
export async function buildSupabaseMigrationPlanFromGit(
  options: Readonly<BuildSupabaseMigrationPlanFromGitOptions>,
  dependencies: Readonly<SupabaseMigrationGitDependencies> = {},
): Promise<SupabaseMigrationPlan> {
  const repositoryRoot = options.repositoryRoot ?? REPOSITORY_ROOT;
  const verifySourceIdentity = dependencies.verifySourceIdentity ?? verifyGitSourceIdentity;
  const loadGitMigrations = dependencies.loadGitMigrations ?? loadMigrationsFromGit;
  const sourceIdentity = await verifySourceIdentity(options.releaseSha, repositoryRoot);
  const migrations = await loadGitMigrations(options.releaseSha, { repositoryRoot });
  return buildSupabaseMigrationPlan({
    sourceIdentity,
    schema: DATA_FOUNDRY_PRIVATE_SCHEMA,
    migrationRole: REQUIRED_MIGRATION_ROLE,
    migrations,
    appliedMigrations: options.appliedMigrations,
  });
}

async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  const { releaseSha, appliedLedgerPath } = parseSupabaseMigrationCliArguments(argv);
  const appliedMigrations =
    appliedLedgerPath === undefined
      ? []
      : parseAppliedLedger(JSON.parse(await readFile(resolve(appliedLedgerPath), 'utf8')));
  const plan = await buildSupabaseMigrationPlanFromGit({
    releaseSha,
    appliedMigrations,
  });
  process.stdout.write(renderSupabaseMigrationManifest(plan));
}

if (isMain(import.meta.url)) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Supabase migration packet export failed: ${message}\n`);
    process.exitCode = 1;
  });
}
