/**
 * The `UA-002` direct-TLS operator: prove the hosted database is ready, then
 * catch it up to the reviewed release.
 *
 * This exists because the pieces were already correct individually and still
 * could not be run safely as a sequence. `migrate.ts` applies pending
 * migrations and refuses to replay ledgered ones; the exported manifest carries
 * the exact-baseline grant upgrade. What neither does is check, *before the
 * first mutation*, the preconditions the grant upgrade asserts at the end.
 *
 * That gap is not theoretical. On 2026-09-16 every `df_*` role on the hosted
 * project carried a role-global `search_path` setting and none carried the
 * per-current-database row the release requires — twelve violations that the
 * migration runner's per-transaction guards do not look at, but that the grant
 * packet raises on. Run in the obvious order, that state applies seven
 * migrations, writes seven ledger rows, and only then fails: half-done, which is
 * the single outcome the whole design exists to prevent.
 *
 * So preflight is the default and mutation is opt-in. The operator sees every
 * blocker at once, repairs them through the provider path, and runs again.
 *
 * The connection string is read only from the environment, is never an
 * argument, and is never printed — `migrationFailureMessage` narrows provider
 * errors on the secret-bearing path for the same reason.
 */
import { readFile } from 'node:fs/promises';
import {
  applyMigrations,
  assertRealPostgresSourceIdentity,
  createPostgresDriver,
  DATA_FOUNDRY_MIGRATION_ROLE,
  DATA_FOUNDRY_PRIVATE_SCHEMA,
  effectiveMigrationChecksum,
  LEDGER_MARKER,
  LEDGER_TABLE,
  ledgerMarker,
  loadMigrationsFromGit,
  migrationFailureMessage,
  realPostgresMigrationOptions,
  resolveDirectMigrationDatabaseUrl,
  scopeMigrationSql,
  type AppliedMigration,
  type Migration,
  type MigrationDriver,
} from './migrate.js';
import {
  buildGrantPrerequisiteProbeSql,
  buildRuntimeGrantPayloadForRelease,
  type SupabaseRuntimeGrantPayload,
} from './export-supabase-migration-packets.js';
import { RUNTIME_ROLES } from '../../packages/private-canary/src/runtime-role-policy.js';
import { isMain } from '../lib/cli-entry.js';

const PACKET_FORMAT = 'data-foundry-supabase-migration-plan/v1';
const RELEASE_SHA = /^[0-9a-f]{40}$/u;
const VERSION = /^\d{4}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;

/** One reason the run may not proceed. Never a secret, always actionable. */
export interface OperatorFinding {
  /** Stable machine-readable check name, e.g. `durable-settings`. */
  readonly check: string;
  /** Exactly what differs, in terms the operator can act on. */
  readonly detail: string;
}

export interface OperatorPacketMigration {
  readonly version: string;
  readonly filename: string;
  readonly checksum: string;
}

export interface OperatorPacket {
  readonly releaseSha: string;
  readonly schema: string;
  readonly migrationRole: string;
  readonly appliedMigrationCount: number;
  readonly pendingMigrationCount: number;
  readonly packets: readonly OperatorPacketMigration[];
  readonly postMigrationGrants: {
    readonly upgradeFrom0028Sql: string;
    readonly upgradeFrom0028Checksum: string;
    readonly verificationSql: string;
    readonly roles: readonly string[];
  };
}

export interface OperatorReport {
  readonly findings: readonly OperatorFinding[];
  readonly applied: readonly AppliedMigration[];
  readonly grantsApplied: boolean;
  readonly verified: boolean;
}

function fail(message: string): never {
  throw new Error(message);
}

/**
 * Accept only a manifest this runner understands, and only one describing the
 * private schema and the migration role. A manifest is an operator artifact
 * that travels between machines; treating it as trusted input because it is
 * local is how the wrong release gets applied to the right database.
 */
export function parseOperatorPacket(raw: unknown): OperatorPacket {
  if (typeof raw !== 'object' || raw === null) fail('The migration packet must be a JSON object.');
  const packet = raw as Record<string, unknown>;
  if (packet['format'] !== PACKET_FORMAT) {
    fail(`The migration packet must declare format ${PACKET_FORMAT}.`);
  }
  const releaseSha = packet['releaseSha'];
  if (typeof releaseSha !== 'string' || !RELEASE_SHA.test(releaseSha)) {
    fail('The migration packet must carry a lowercase 40-character release SHA.');
  }
  if (packet['schema'] !== DATA_FOUNDRY_PRIVATE_SCHEMA) {
    fail(`This operator runs only against the ${DATA_FOUNDRY_PRIVATE_SCHEMA} schema.`);
  }
  if (packet['migrationRole'] !== DATA_FOUNDRY_MIGRATION_ROLE) {
    fail(`This operator runs only as ${DATA_FOUNDRY_MIGRATION_ROLE}.`);
  }
  const rawPackets = packet['packets'];
  if (!Array.isArray(rawPackets) || rawPackets.length === 0) {
    fail('The migration packet must list at least one pending migration.');
  }
  const packets = rawPackets.map((entry): OperatorPacketMigration => {
    const row = entry as Record<string, unknown>;
    const version = row['version'];
    const filename = row['filename'];
    const checksum = row['checksum'];
    if (typeof version !== 'string' || !VERSION.test(version)) {
      fail('Every pending packet needs a four-digit version.');
    }
    if (typeof filename !== 'string' || filename === '') {
      fail(`Pending packet ${version} needs a filename.`);
    }
    if (typeof checksum !== 'string' || !SHA256.test(checksum)) {
      fail(`Pending packet ${version} needs a sha256 checksum.`);
    }
    return { version, filename, checksum };
  });

  const grants = packet['postMigrationGrants'];
  if (typeof grants !== 'object' || grants === null) {
    fail('The migration packet must carry postMigrationGrants.');
  }
  const grantRow = grants as Record<string, unknown>;
  const upgradeSql = grantRow['upgradeFrom0028Sql'];
  const upgradeChecksum = grantRow['upgradeFrom0028Checksum'];
  const verificationSql = grantRow['verificationSql'];
  const roles = grantRow['roles'];
  if (typeof upgradeSql !== 'string' || upgradeSql === '') {
    fail('postMigrationGrants.upgradeFrom0028Sql is required for the hosted upgrade.');
  }
  if (typeof upgradeChecksum !== 'string' || !SHA256.test(upgradeChecksum)) {
    fail('postMigrationGrants.upgradeFrom0028Checksum is required.');
  }
  if (typeof verificationSql !== 'string' || verificationSql === '') {
    fail('postMigrationGrants.verificationSql is required.');
  }
  if (!Array.isArray(roles) || roles.some((role) => typeof role !== 'string')) {
    fail('postMigrationGrants.roles must be the expected role names.');
  }

  const applied = packet['appliedMigrationCount'];
  const pending = packet['pendingMigrationCount'];
  if (typeof applied !== 'number' || typeof pending !== 'number') {
    fail('The migration packet must carry applied and pending migration counts.');
  }
  if (pending !== packets.length) {
    fail('The migration packet disagrees with itself about how many migrations are pending.');
  }

  return {
    releaseSha,
    schema: DATA_FOUNDRY_PRIVATE_SCHEMA,
    migrationRole: DATA_FOUNDRY_MIGRATION_ROLE,
    appliedMigrationCount: applied,
    pendingMigrationCount: pending,
    packets,
    postMigrationGrants: {
      upgradeFrom0028Sql: upgradeSql,
      upgradeFrom0028Checksum: upgradeChecksum,
      verificationSql,
      roles: roles as readonly string[],
    },
  };
}

interface IdentityRow {
  readonly current_user_name: string;
  readonly session_user_name: string;
  readonly transaction_read_only: string;
  readonly in_recovery: boolean;
}

interface PrerequisiteRow {
  readonly probe: string;
  readonly detail: string;
}

interface RoleRow {
  readonly rolname: string;
  readonly rolcanlogin: boolean;
  readonly rolinherit: boolean;
  readonly rolsuper: boolean;
  readonly rolcreatedb: boolean;
  readonly rolcreaterole: boolean;
  readonly rolreplication: boolean;
  readonly rolbypassrls: boolean;
  readonly outgoing_memberships: number;
  readonly incoming_members: number;
}

interface LedgerRow {
  readonly version: string;
  readonly filename: string;
  readonly checksum: string;
}

const IDENTITY_SQL = `SELECT current_user::text AS current_user_name,
       session_user::text AS session_user_name,
       current_setting('transaction_read_only') AS transaction_read_only,
       pg_is_in_recovery() AS in_recovery`;

const ROLE_SQL = `SELECT r.rolname::text AS rolname,
       r.rolcanlogin, r.rolinherit, r.rolsuper, r.rolcreatedb,
       r.rolcreaterole, r.rolreplication, r.rolbypassrls,
       (SELECT count(*) FROM pg_auth_members m WHERE m.member = r.oid)::int
         AS outgoing_memberships,
       (SELECT count(*) FROM pg_auth_members m WHERE m.roleid = r.oid)::int
         AS incoming_members
  FROM pg_catalog.pg_roles r
 WHERE r.rolname = ANY($1::text[])`;

/**
 * Every prerequisite the grant install asserts, asked before the first mutation.
 *
 * This is deliberately the exporter's own probe rather than a local paraphrase:
 * a preflight that checks something subtly different from what the install
 * raises on is worse than no preflight, because it buys false confidence.
 */
export function grantPrerequisiteProbeSql(
  schema: string = DATA_FOUNDRY_PRIVATE_SCHEMA,
  migrationRole: string = DATA_FOUNDRY_MIGRATION_ROLE,
): string {
  return buildGrantPrerequisiteProbeSql(schema, migrationRole);
}

function ledgerSql(schema: string): string {
  if (schema !== DATA_FOUNDRY_PRIVATE_SCHEMA) {
    fail(`The operator ledger read is scoped to ${DATA_FOUNDRY_PRIVATE_SCHEMA}.`);
  }
  return `SELECT version, filename, checksum FROM ${schema}.${LEDGER_TABLE} ORDER BY version`;
}

/**
 * Everything that must be true before the first mutation, read-only.
 *
 * Returns findings rather than throwing on the first one: an operator who has
 * to open a privileged provider session anyway should learn about all three
 * prerequisites in one pass, not discover them one run at a time.
 */
export async function preflightUa002(
  driver: MigrationDriver,
  packet: OperatorPacket,
  migrations: readonly Migration[],
  releaseGrants: SupabaseRuntimeGrantPayload = buildRuntimeGrantPayloadForRelease(migrations),
): Promise<OperatorFinding[]> {
  const findings: OperatorFinding[] = [];
  const schema = packet.schema;

  // The manifest's grant SQL is executed as the schema owner, and its checksum
  // is stored beside the SQL it hashes — which proves nothing against an edit.
  // So the payload is rebuilt from the release and the manifest is checked
  // against it. `runUa002Operator` then executes the rebuilt one, not the file's.
  if (packet.postMigrationGrants.upgradeFrom0028Sql !== releaseGrants.upgradeFrom0028Sql) {
    findings.push({
      check: 'grant-payload',
      detail: 'upgradeFrom0028Sql does not match the payload derived from the release.',
    });
  }
  if (packet.postMigrationGrants.upgradeFrom0028Checksum !== releaseGrants.upgradeFrom0028Checksum) {
    findings.push({
      check: 'grant-payload',
      detail:
        `upgradeFrom0028Checksum is ${packet.postMigrationGrants.upgradeFrom0028Checksum.slice(0, 12)}; ` +
        `the release derives ${releaseGrants.upgradeFrom0028Checksum.slice(0, 12)}.`,
    });
  }
  if (packet.postMigrationGrants.verificationSql !== releaseGrants.verificationSql) {
    findings.push({
      check: 'grant-payload',
      detail:
        'verificationSql does not match the payload derived from the release. A substituted ' +
        'verifier would report success on an unverified database.',
    });
  }
  const expectedGrantRoles = [...releaseGrants.roles].sort();
  const declaredGrantRoles = [...packet.postMigrationGrants.roles].sort();
  if (expectedGrantRoles.join(',') !== declaredGrantRoles.join(',')) {
    findings.push({
      check: 'grant-payload',
      detail:
        `The manifest declares roles ${declaredGrantRoles.join(', ')}; ` +
        `the release expects ${expectedGrantRoles.join(', ')}.`,
    });
  }

  const [identity] = await driver.query<IdentityRow>(IDENTITY_SQL);
  if (identity === undefined) {
    findings.push({ check: 'identity', detail: 'The database returned no identity row.' });
  } else {
    // `SET ROLE` is not equivalent here: every private object is owned by the
    // migration role, and the runner asserts a direct login for exactly that
    // reason.
    if (
      identity.current_user_name !== packet.migrationRole ||
      identity.session_user_name !== packet.migrationRole
    ) {
      findings.push({
        check: 'identity',
        detail:
          `Connect directly as ${packet.migrationRole}; this session is ` +
          `current_user=${identity.current_user_name}, session_user=${identity.session_user_name}. ` +
          'SET ROLE and a broader operator credential are both rejected.',
      });
    }
    if (identity.transaction_read_only !== 'off') {
      findings.push({
        check: 'session-writable',
        detail: 'transaction_read_only is on; this session cannot write.',
      });
    }
    if (identity.in_recovery) {
      findings.push({
        check: 'session-writable',
        detail: 'The target is in recovery; it is a standby, not the primary.',
      });
    }
  }

  // Everything the grant upgrade would raise on — durable settings, migration
  // posture and session, default ACLs, external capability, runtime-role
  // external ACLs and forbidden PUBLIC/named grants. Checking only durable
  // settings here left every other invariant to fail *after* the migrations
  // committed, which is the half-done state this operator exists to prevent.
  const prerequisites = await driver.query<PrerequisiteRow>(
    grantPrerequisiteProbeSql(schema, packet.migrationRole),
  );
  for (const row of prerequisites) {
    findings.push({ check: 'grant-prerequisites', detail: `${row.probe}: ${row.detail}` });
  }

  const expectedRoles = [packet.migrationRole, ...RUNTIME_ROLES];
  const roles = await driver.query<RoleRow>(ROLE_SQL, [expectedRoles]);
  const byName = new Map(roles.map((role) => [role.rolname, role] as const));
  for (const name of expectedRoles) {
    const role = byName.get(name);
    if (role === undefined) {
      findings.push({
        check: 'roles',
        detail:
          `${name} does not exist. The migration role is NOCREATEROLE, so the provider path ` +
          'must create it before this run.',
      });
      continue;
    }
    if (role.rolsuper || role.rolcreatedb || role.rolcreaterole || role.rolreplication || role.rolbypassrls) {
      findings.push({ check: 'roles', detail: `${name} carries a privileged role attribute.` });
    }
    if (role.rolinherit) {
      findings.push({ check: 'roles', detail: `${name} must be NOINHERIT.` });
    }
    // Outgoing membership is prohibited for every role, the migration identity
    // included — inheriting someone else's privileges is exactly what NOINHERIT
    // and an empty membership set are there to prevent. Incoming members are a
    // different question: the migration role legitimately has them, which is how
    // a provider session assumes it.
    if (role.outgoing_memberships !== 0) {
      findings.push({
        check: 'roles',
        detail: `${name} is a member of another role; it must have no outgoing memberships.`,
      });
    }
    if (role.incoming_members !== 0 && name !== packet.migrationRole) {
      findings.push({ check: 'roles', detail: `${name} must have no incoming role members.` });
    }
    // Only the migration identity logs in during this run. A runtime role that
    // can already log in has a credential nobody recorded.
    if (name === packet.migrationRole ? !role.rolcanlogin : role.rolcanlogin) {
      findings.push({
        check: 'roles',
        detail:
          name === packet.migrationRole
            ? `${name} is NOLOGIN; activate the migration credential through the provider's secure path.`
            : `${name} is LOGIN before its credential step.`,
      });
    }
  }

  // A table called `schema_migrations` is not evidence that it is ours. The
  // marker is what the runner writes when it creates the ledger, and pointing
  // the migration credential at someone else's database is exactly the mistake
  // worth failing on.
  const marker = await ledgerMarker(driver, schema);
  if (marker !== LEDGER_MARKER) {
    findings.push({
      check: 'ledger',
      detail:
        `${schema}.${LEDGER_TABLE} carries marker ${marker ?? '<none>'}, not ${LEDGER_MARKER}. ` +
        'This is not the ledger this project created.',
    });
  }

  const ledger = await driver.query<LedgerRow>(ledgerSql(schema));
  const appliedVersions = new Set(ledger.map((row) => row.version));
  if (ledger.length !== packet.appliedMigrationCount) {
    findings.push({
      check: 'ledger',
      detail:
        `The ledger holds ${ledger.length} migration(s); the packet was derived against ` +
        `${packet.appliedMigrationCount}. Re-derive the packet against the live ledger.`,
    });
  }
  for (const pending of packet.packets) {
    if (appliedVersions.has(pending.version)) {
      findings.push({
        check: 'ledger',
        detail: `${pending.filename} is already applied; this packet would replay it.`,
      });
    }
  }

  // The packet lists what to apply, but `applyMigrations` applies everything the
  // ledger is missing. A packet that omits a release migration would therefore
  // apply it anyway — unlisted, unchecked against any declared checksum — and
  // then run a grant plan derived for a different schema state. The ledger and
  // the packet have to partition the release exactly, not merely agree on the
  // subset the packet happens to name.
  const packetVersions = new Set(packet.packets.map((entry) => entry.version));
  for (const migration of migrations) {
    if (!appliedVersions.has(migration.version) && !packetVersions.has(migration.version)) {
      findings.push({
        check: 'coverage',
        detail:
          `${migration.filename} is unapplied at release ${packet.releaseSha} but the packet does ` +
          'not list it. The run would apply it anyway. Re-derive the packet against this ledger.',
      });
    }
  }

  // The checksums the packet claims, recomputed from the Git objects rather
  // than trusted because the exporter and the operator can be different people
  // on different machines.
  const byVersion = new Map(migrations.map((migration) => [migration.version, migration] as const));
  for (const pending of packet.packets) {
    const migration = byVersion.get(pending.version);
    if (migration === undefined) {
      findings.push({
        check: 'checksums',
        detail: `${pending.filename} is not present at release ${packet.releaseSha}.`,
      });
      continue;
    }
    if (migration.filename !== pending.filename) {
      findings.push({
        check: 'checksums',
        detail: `${pending.version} is ${migration.filename} at the release, not ${pending.filename}.`,
      });
      continue;
    }
    const effective = effectiveMigrationChecksum(
      migration,
      schema,
      scopeMigrationSql(migration.sql, schema),
    );
    if (effective !== pending.checksum) {
      findings.push({
        check: 'checksums',
        detail:
          `${pending.filename} hashes to ${effective.slice(0, 12)} at the release but the packet ` +
          `claims ${pending.checksum.slice(0, 12)}.`,
      });
    }
  }
  for (const applied of ledger) {
    const migration = byVersion.get(applied.version);
    if (migration === undefined) {
      findings.push({
        check: 'checksums',
        detail: `Applied ${applied.filename} has no counterpart at release ${packet.releaseSha}.`,
      });
      continue;
    }
    const effective = effectiveMigrationChecksum(
      migration,
      schema,
      scopeMigrationSql(migration.sql, schema),
    );
    if (effective !== applied.checksum) {
      findings.push({
        check: 'checksums',
        detail:
          `Applied ${applied.filename} no longer matches the release. An applied migration ` +
          'changed, which two environments diverging looks like.',
      });
    }
  }

  return findings;
}

/**
 * Apply the grant upgrade in one transaction, and prove the rollback when it
 * fails rather than assuming PostgreSQL did it. "Verify rollback before
 * retrying" is a safety condition, not a formality: a session left in a failed
 * transaction silently swallows every later statement.
 */
export async function applyGrantUpgrade(driver: MigrationDriver, sql: string): Promise<void> {
  await driver.exec('BEGIN');
  try {
    await driver.exec(sql);
    await driver.exec('COMMIT');
  } catch (error) {
    await driver.exec('ROLLBACK').catch(() => undefined);
    let rolledBack = false;
    try {
      await driver.query('SELECT 1');
      rolledBack = true;
    } catch {
      rolledBack = false;
    }
    throw new Error(
      `The runtime-grant upgrade failed and the transaction was ${
        rolledBack ? 'rolled back cleanly' : 'NOT confirmed rolled back — inspect the session before retrying'
      }: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

export interface RunOperatorOptions {
  /** Mutation is opt-in. Without it this is a read-only readiness report. */
  readonly apply?: boolean | undefined;
  readonly log?: ((line: string) => void) | undefined;
  /**
   * Seam for tests, matching how `loadMigrationsFromGit` takes `runGit` and the
   * runtime-role check takes `connect`. Production always uses the real runner.
   */
  readonly applyMigrationsImpl?: typeof applyMigrations | undefined;
  /**
   * Same seam. Production leaves this unset so the payload is always rebuilt
   * from the release; tests supply a small one rather than the real 33-migration
   * set the release builder insists on.
   */
  readonly releaseGrants?: SupabaseRuntimeGrantPayload | undefined;
}

export async function runUa002Operator(
  driver: MigrationDriver,
  packet: OperatorPacket,
  migrations: readonly Migration[],
  options: Readonly<RunOperatorOptions> = {},
): Promise<OperatorReport> {
  const log = options.log ?? (() => undefined);
  // Derived once, checked against the manifest in preflight, and executed below.
  // The manifest is a declaration to verify, never the thing that runs.
  const releaseGrants =
    options.releaseGrants ??
    buildRuntimeGrantPayloadForRelease(migrations, packet.schema, packet.migrationRole);
  const findings = await preflightUa002(driver, packet, migrations, releaseGrants);
  if (findings.length > 0) {
    for (const finding of findings) log(`  BLOCK ${finding.check}: ${finding.detail}`);
    return { findings, applied: [], grantsApplied: false, verified: false };
  }
  log(`  OK    preflight: ${packet.pendingMigrationCount} pending migration(s) ready`);
  if (options.apply !== true) {
    return { findings, applied: [], grantsApplied: false, verified: false };
  }

  const runMigrations = options.applyMigrationsImpl ?? applyMigrations;
  const applied = await runMigrations(driver, migrations, realPostgresMigrationOptions(packet.schema));
  for (const result of applied) {
    log(`  ${result.skipped ? 'skip ' : 'apply'} ${result.filename}`);
  }

  await applyGrantUpgrade(driver, releaseGrants.upgradeFrom0028Sql);
  log(`  apply runtime-grant upgrade (${releaseGrants.roles.length} roles, derived from the release)`);

  await driver.exec(releaseGrants.verificationSql);
  log('  OK    postcondition verification');

  return { findings, applied, grantsApplied: true, verified: true };
}

export async function readOperatorPacket(path: string): Promise<OperatorPacket> {
  return parseOperatorPacket(JSON.parse(await readFile(path, 'utf8')) as unknown);
}

function packetPathFrom(argv: readonly string[]): string {
  const inline = argv.find((argument) => argument.startsWith('--packet='));
  if (inline !== undefined) return inline.slice('--packet='.length);
  const index = argv.indexOf('--packet');
  const candidate = index === -1 ? undefined : argv[index + 1];
  if (candidate === undefined || candidate.startsWith('--')) {
    fail('Usage: ua002:operator -- --packet <manifest.json> [--apply]');
  }
  return candidate;
}

async function main(argv: readonly string[]): Promise<number> {
  const packet = await readOperatorPacket(packetPathFrom(argv));
  const apply = argv.includes('--apply');

  // The grant payload is rebuilt from this checkout's code rather than read from
  // the manifest, so the checkout has to *be* the release it claims: exact HEAD,
  // clean worktree, untracked files included. Regenerating from some other
  // revision would be a verification that verifies nothing.
  const declaredSha = process.env['DATA_FOUNDRY_RELEASE_SHA']?.trim();
  if (declaredSha !== packet.releaseSha) {
    fail(
      `Check out release ${packet.releaseSha} and set DATA_FOUNDRY_RELEASE_SHA to it; ` +
        `the environment ${declaredSha === undefined || declaredSha === '' ? 'does not set it' : `declares ${declaredSha}`}.`,
    );
  }
  await assertRealPostgresSourceIdentity();

  const connectionString = resolveDirectMigrationDatabaseUrl();
  if (connectionString === undefined) {
    fail('DATA_FOUNDRY_MIGRATION_DATABASE_URL is required; this runner never takes a credential as an argument.');
  }
  const migrations = await loadMigrationsFromGit(packet.releaseSha);
  const driver = await createPostgresDriver(connectionString, packet.schema);
  try {
    process.stdout.write(
      `UA-002 operator against ${driver.label} at release ${packet.releaseSha} ` +
        `(${apply ? 'APPLY' : 'preflight only'})\n`,
    );
    const report = await runUa002Operator(driver, packet, migrations, {
      apply,
      log: (line) => process.stdout.write(`${line}\n`),
    });
    if (report.findings.length > 0) {
      process.stderr.write(
        `\n${report.findings.length} blocker(s). Nothing was mutated. ` +
          'Repair these through the provider path, then run again.\n',
      );
      return 2;
    }
    if (!apply) {
      process.stdout.write('\nPreflight passed. Re-run with --apply to catch the database up.\n');
      return 0;
    }
    process.stdout.write('\nHosted database is at the reviewed release and verified.\n');
    return 0;
  } finally {
    await driver.close();
  }
}

if (isMain(import.meta.url)) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      process.stderr.write(`${migrationFailureMessage(error)}\n`);
      process.exitCode = 1;
    });
}
