/**
 * Prepare, verify, and remove the synthetic rows used by the route-less
 * Cloudflare private canary. The fixture contains identifiers only: it never
 * mints an API key, runtime password, source record, or public-facing value.
 */
import { createHash } from 'node:crypto';
import {
  DATA_FOUNDRY_PRIVATE_SCHEMA,
  createPostgresDriver,
  type SqlDriver,
  type SqlParam,
  type SqlTransactionExecutor,
} from '@data-foundry/canonical-store';
import {
  assertPrivateMigrationRoleBinding,
  assertRealPostgresSourceIdentity,
  resolveOperationalSchema,
  type MigrationDriver,
} from './migrate.js';
import { isMain } from '../lib/cli-entry.js';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export interface PrivateCanaryFixture {
  readonly runId: string;
  readonly issuedAt: string;
  readonly tenantId: string;
  readonly verticalId: string;
  readonly edgeApiKeyId: string;
  readonly mcpApiKeyId: string;
  readonly edgeEventId: string;
  readonly mcpEventId: string;
}

type FixtureMode = 'prepare' | 'verify' | 'cleanup';

export interface FixtureArgs {
  readonly mode: FixtureMode;
  readonly runId: string;
}

/**
 * The fixture needs the canonical driver's transaction support, while the
 * migration-role assertion intentionally uses the smaller migration surface.
 * Keep the bridge local so neither driver contract is weakened.
 */
function migrationDriverView(driver: SqlDriver): MigrationDriver {
  return {
    label: driver.label,
    exec: (sql) => driver.exec(sql),
    query: async <T,>(sql: string, params?: readonly unknown[]): Promise<T[]> =>
      (await driver.query(sql, params as readonly SqlParam[] | undefined)) as T[],
    close: () => driver.close(),
  };
}

function canonicalRunId(value: string): string {
  const runId = value.trim().toLowerCase();
  if (!UUID_V4.test(runId)) {
    throw new Error('Private canary fixture configuration is invalid.');
  }
  return runId;
}

function deterministicUuid(runId: string, label: string): string {
  const bytes = createHash('sha256').update(`data-foundry-private-canary:${runId}:${label}`).digest().subarray(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function fixtureSlug(fixture: PrivateCanaryFixture): string {
  return `private-canary-${fixture.runId.replaceAll('-', '').slice(0, 20)}`;
}

function syntheticHash(fixture: PrivateCanaryFixture, channel: 'edge' | 'mcp'): string {
  return createHash('sha256')
    .update(`data-foundry-private-canary-noncredential:${fixture.runId}:${channel}`)
    .digest('hex');
}

function relation(name: string): string {
  return `"${DATA_FOUNDRY_PRIVATE_SCHEMA}"."${name}"`;
}

export function createPrivateCanaryFixture(
  inputRunId: string,
  issuedAt = new Date().toISOString(),
): PrivateCanaryFixture {
  const runId = canonicalRunId(inputRunId);
  if (new Date(issuedAt).toISOString() !== issuedAt) {
    throw new Error('Private canary fixture configuration is invalid.');
  }
  return {
    runId,
    issuedAt,
    tenantId: deterministicUuid(runId, 'tenant'),
    verticalId: deterministicUuid(runId, 'vertical'),
    edgeApiKeyId: deterministicUuid(runId, 'edge-api-key'),
    mcpApiKeyId: deterministicUuid(runId, 'mcp-api-key'),
    edgeEventId: deterministicUuid(runId, 'edge-event'),
    mcpEventId: deterministicUuid(runId, 'mcp-event'),
  };
}

async function assertPreparedFixture(
  executor: SqlDriver | SqlTransactionExecutor,
  fixture: PrivateCanaryFixture,
): Promise<void> {
  const vertical = await executor.query<{ id: string }>(
    `SELECT id FROM ${relation('verticals')}
      WHERE id = $1 AND slug = $2 AND name = 'Private canary synthetic vertical' AND status = 'DRAFT'`,
    [fixture.verticalId, fixtureSlug(fixture)],
  );
  const tenant = await executor.query<{ id: string }>(
    `SELECT id FROM ${relation('api_tenants')}
      WHERE id = $1 AND slug = $2 AND name = 'Private canary synthetic tenant' AND status = 'ACTIVE'`,
    [fixture.tenantId, fixtureSlug(fixture)],
  );
  const keys = await executor.query<{ id: string }>(
    `SELECT id FROM ${relation('api_keys')}
      WHERE (id = $1 AND tenant_id = $2 AND vertical_id = $3
             AND label = 'Private canary direct meter' AND token_prefix = 'canaryedge'
             AND token_hash = $4 AND access_tier = 'API_FREE' AND billing_source = 'DIRECT')
         OR (id = $5 AND tenant_id = $2 AND vertical_id = $3
             AND label = 'Private canary MCP meter' AND token_prefix = 'canarymcp'
             AND token_hash = $6 AND access_tier = 'MCP' AND billing_source = 'NONE')`,
    [
      fixture.edgeApiKeyId,
      fixture.tenantId,
      fixture.verticalId,
      syntheticHash(fixture, 'edge'),
      fixture.mcpApiKeyId,
      syntheticHash(fixture, 'mcp'),
    ],
  );
  if (vertical.length !== 1 || tenant.length !== 1 || keys.length !== 2) {
    throw new Error('Private canary fixture verification failed.');
  }
}

/** Idempotently create only the synthetic rows needed to accept two meter events. */
export async function preparePrivateCanaryFixture(
  driver: SqlDriver,
  fixture: PrivateCanaryFixture,
): Promise<void> {
  await driver.transaction(async (tx) => {
    await tx.query(
      `INSERT INTO ${relation('verticals')}
         (id, slug, name, schema_version, status, default_refresh_policy)
       VALUES ($1, $2, 'Private canary synthetic vertical', '1.0.0', 'DRAFT', $3::jsonb)
       ON CONFLICT (id) DO NOTHING`,
      [
        fixture.verticalId,
        fixtureSlug(fixture),
        JSON.stringify({ cadence: 'MANUAL', max_staleness_hours: 24, priority: 1 }),
      ],
    );
    await tx.query(
      `INSERT INTO ${relation('api_tenants')} (id, slug, name, status)
       VALUES ($1, $2, 'Private canary synthetic tenant', 'ACTIVE')
       ON CONFLICT (id) DO NOTHING`,
      [fixture.tenantId, fixtureSlug(fixture)],
    );
    await tx.query(
      `INSERT INTO ${relation('api_keys')}
         (id, tenant_id, token_hash, token_prefix, label, vertical_id, access_tier, billing_source)
       VALUES ($1, $2, $3, 'canaryedge', 'Private canary direct meter', $4, 'API_FREE', 'DIRECT')
       ON CONFLICT (id) DO NOTHING`,
      [fixture.edgeApiKeyId, fixture.tenantId, syntheticHash(fixture, 'edge'), fixture.verticalId],
    );
    await tx.query(
      `INSERT INTO ${relation('api_keys')}
         (id, tenant_id, token_hash, token_prefix, label, vertical_id, access_tier, billing_source)
       VALUES ($1, $2, $3, 'canarymcp', 'Private canary MCP meter', $4, 'MCP', 'NONE')
       ON CONFLICT (id) DO NOTHING`,
      [fixture.mcpApiKeyId, fixture.tenantId, syntheticHash(fixture, 'mcp'), fixture.verticalId],
    );
    await assertPreparedFixture(tx, fixture);
  });
}

/** Prove each duplicated Queue event materialized only once, without reading its payload. */
export async function verifyPrivateCanaryFixture(
  driver: SqlDriver,
  fixture: PrivateCanaryFixture,
): Promise<Readonly<{ edgeEvent: 'PRESENT_ONCE'; mcpEvent: 'PRESENT_ONCE' }>> {
  await assertPreparedFixture(driver, fixture);
  const rows = await driver.query<{ id: string }>(
    `SELECT id FROM ${relation('api_usage_events')} WHERE id = $1 OR id = $2`,
    [fixture.edgeEventId, fixture.mcpEventId],
  );
  const ids = new Set(rows.map((row) => row.id));
  if (rows.length !== 2 || ids.size !== 2 || !ids.has(fixture.edgeEventId) || !ids.has(fixture.mcpEventId)) {
    throw new Error('Private canary fixture verification failed.');
  }
  return { edgeEvent: 'PRESENT_ONCE', mcpEvent: 'PRESENT_ONCE' };
}

/** Remove precisely the synthetic fixture in dependency order; repeated cleanup is harmless. */
export async function cleanupPrivateCanaryFixture(
  driver: SqlDriver,
  fixture: PrivateCanaryFixture,
): Promise<void> {
  await driver.transaction(async (tx) => {
    await tx.query(
      `DELETE FROM ${relation('api_usage_events')} WHERE id = $1 OR id = $2`,
      [fixture.edgeEventId, fixture.mcpEventId],
    );
    await tx.query(
      `DELETE FROM ${relation('api_keys')}
        WHERE (id = $1 AND tenant_id = $2 AND label = 'Private canary direct meter')
           OR (id = $3 AND tenant_id = $2 AND label = 'Private canary MCP meter')`,
      [fixture.edgeApiKeyId, fixture.tenantId, fixture.mcpApiKeyId],
    );
    await tx.query(
      `DELETE FROM ${relation('api_tenants')} WHERE id = $1 AND slug = $2`,
      [fixture.tenantId, fixtureSlug(fixture)],
    );
    await tx.query(
      `DELETE FROM ${relation('verticals')} WHERE id = $1 AND slug = $2`,
      [fixture.verticalId, fixtureSlug(fixture)],
    );
  });
}

export function parseFixtureArgs(argv: readonly string[]): FixtureArgs {
  const [mode, ...rest] = argv;
  if (mode !== 'prepare' && mode !== 'verify' && mode !== 'cleanup') {
    throw new Error('Private canary fixture configuration is invalid.');
  }
  let runId: string | undefined;
  for (let index = 0; index < rest.length; index += 1) {
    if (rest[index] === '--run-id') runId = rest[index + 1];
    else throw new Error('Private canary fixture configuration is invalid.');
    index += 1;
  }
  if (runId === undefined) throw new Error('Private canary fixture configuration is invalid.');
  return { mode, runId: canonicalRunId(runId) };
}

function envelope(fixture: PrivateCanaryFixture): Readonly<Record<string, string>> {
  return {
    kind: 'data-foundry.private-canary.v1',
    run_id: fixture.runId,
    issued_at: fixture.issuedAt,
    tenant_id: fixture.tenantId,
    vertical_id: fixture.verticalId,
    edge_api_key_id: fixture.edgeApiKeyId,
    mcp_api_key_id: fixture.mcpApiKeyId,
    edge_event_id: fixture.edgeEventId,
    mcp_event_id: fixture.mcpEventId,
  };
}

export async function run(
  argv: readonly string[] = process.argv.slice(2),
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<number> {
  const args = parseFixtureArgs(argv);
  const connectionString = env['DATA_FOUNDRY_MIGRATION_DATABASE_URL'];
  if (connectionString === undefined || connectionString.trim() === '') {
    throw new Error('Private canary fixture configuration is invalid.');
  }
  if (resolveOperationalSchema(env) !== DATA_FOUNDRY_PRIVATE_SCHEMA) {
    throw new Error('Private canary fixture configuration is invalid.');
  }
  await assertRealPostgresSourceIdentity(env, {
    additionalSourcePaths: ['tooling/scripts/private-canary-fixture.ts'],
  });
  const driver = await createPostgresDriver(connectionString, { schema: DATA_FOUNDRY_PRIVATE_SCHEMA });
  try {
    await assertPrivateMigrationRoleBinding(migrationDriverView(driver), {
      schema: DATA_FOUNDRY_PRIVATE_SCHEMA,
      requireSchemaOwner: true,
    });
    const fixture = createPrivateCanaryFixture(args.runId);
    if (args.mode === 'prepare') {
      await preparePrivateCanaryFixture(driver, fixture);
      process.stdout.write(`${JSON.stringify(envelope(fixture))}\n`);
    } else if (args.mode === 'verify') {
      await verifyPrivateCanaryFixture(driver, fixture);
      process.stdout.write('OK: private canary metering events are present exactly once.\n');
    } else {
      await cleanupPrivateCanaryFixture(driver, fixture);
      process.stdout.write('OK: private canary synthetic fixture removed.\n');
    }
    return 0;
  } finally {
    await driver.close();
  }
}

if (isMain(import.meta.url)) {
  run().then(
    (code) => { process.exitCode = code; },
    () => {
      process.stderr.write('Private canary fixture operation failed.\n');
      process.exitCode = 1;
    },
  );
}
