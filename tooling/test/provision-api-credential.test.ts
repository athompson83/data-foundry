import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createPgliteDriver,
  type SqlDriver,
  type SqlTransactionExecutor,
} from '@data-foundry/canonical-store';
import type { MintedApiKey } from '@data-foundry/api-keys';
import { loadMigrations } from '../scripts/migrate.js';
import {
  CredentialProvisioningError,
  buildWranglerEnvironment,
  cleanupFailedWranglerSnapshot,
  createNodeCredentialFileSystem,
  isSafeEdgeWranglerConfig,
  nodeCredentialProcessRunner,
  parseCredentialProvisioningArgs,
  provisionApiCredential,
  resolveWranglerCommand,
  runCredentialProvisioningCli,
  type CredentialFileSystem,
  type CredentialProcessRunner,
} from '../scripts/provision-api-credential.js';

const POSTGRES_URL = 'postgres://credential-admin:do-not-print@db.internal/data_foundry';
const SECRET = `df_live_${'A'.repeat(43)}`;
const HASH = 'cfcca9bfd9b75b526ad4e754dc6ae478464c8a9dcad3d2d0f639644c9a38d2fa';
const PREFIX = SECRET.slice(0, 16);
const NOW = new Date('2026-08-30T12:00:00.000Z');
const WRANGLER_COMMAND = {
  executable: 'C:\\Program Files\\nodejs\\node.exe',
  argsPrefix: ['C:\\repo\\node_modules\\wrangler\\bin\\wrangler.js'],
} as const;
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SECURE_ROOT = resolve(REPO_ROOT, '..', 'data-foundry-secure-tests');
const DIRECT_OUTPUT = resolve(SECURE_ROOT, 'acme-direct.json');
const MCP_OUTPUT = resolve(SECURE_ROOT, 'mcp-client.json');
const EDGE_CONFIG = resolve(REPO_ROOT, 'apps', 'edge', 'wrangler.production.toml');
const EMPTY_WRANGLER_ENV = resolve(REPO_ROOT, 'tooling', 'wrangler-empty.env');
const CLOUDFLARE_ACCOUNT_ID = '1234567890abcdef1234567890abcdef';
const SAFE_EDGE_MANIFEST = `
name = "data-foundry-edge"
main = "src/index.ts"
account_id = "${CLOUDFLARE_ACCOUNT_ID}"
routes = ["api.datafoundry.io/*", "marketplace.datafoundry.io/*"]
workers_dev = false
preview_urls = false
[observability.logs]
invocation_logs = false
[vars]
DEPLOYMENT_ENVIRONMENT = "production"
API_KEY_ENVIRONMENT = "live"
VERTICAL_SLUG = "hvac"
RAPIDAPI_HOSTNAME = "marketplace.datafoundry.io"
[[hyperdrive]]
binding = "HYPERDRIVE"
id = "abcdef1234567890abcdef1234567890"
# postgres://placeholder-in-a-comment-is-not-active-configuration
`;

const DIRECT_ARGS = [
  '--environment',
  'live',
  '--tenant-slug',
  'acme-direct',
  '--tenant-name',
  'Acme Direct',
  '--vertical',
  'hvac',
  '--credential-label',
  'production direct API',
  '--access-tier',
  'API_PAID',
  '--billing-source',
  'DIRECT',
  '--output',
  DIRECT_OUTPUT,
] as const;

function rapidApiArgs(overrides: { readonly environment?: string; readonly vertical?: string } = {}) {
  return [
    '--environment', overrides.environment ?? 'live',
    '--tenant-slug', 'rapidapi-marketplace',
    '--tenant-name', 'RapidAPI Marketplace',
    '--vertical', overrides.vertical ?? 'hvac',
    '--credential-label', 'production RapidAPI adapter',
    '--access-tier', 'RAPIDAPI',
    '--billing-source', 'RAPIDAPI',
    '--wrangler-secret', 'RAPIDAPI_API_KEY',
    '--wrangler-config', 'apps/edge/wrangler.production.toml',
    '--cloudflare-account-id', CLOUDFLARE_ACCOUNT_ID,
  ] as const;
}

function minted(overrides: Partial<MintedApiKey> = {}): MintedApiKey {
  return {
    secret: SECRET,
    tokenHash: HASH,
    tokenPrefix: PREFIX,
    environment: 'live',
    ...overrides,
  };
}

class FakeFileSystem implements CredentialFileSystem {
  readonly regularFiles = new Set<string>();
  readonly written = new Map<string, { readonly contents: string; readonly mode: number }>();
  readonly validationCalls: Array<{
    readonly kind: 'new' | 'wrangler';
    readonly path: string;
    readonly environment?: string;
    readonly verticalSlug?: string;
  }> = [];
  wranglerScope = { environment: 'live', verticalSlug: 'hvac' } as const;
  wranglerAccountId = CLOUDFLARE_ACCOUNT_ID;
  readonly createdSnapshots: string[] = [];
  readonly removedSnapshots: string[] = [];
  failRemoval = false;

  async assertNewOutputPath(path: string): Promise<void> {
    this.validationCalls.push({ kind: 'new', path });
    if (this.written.has(path) || this.regularFiles.has(path)) {
      throw new CredentialProvisioningError('output path already exists; refusing to overwrite it');
    }
  }

  async assertWranglerConfig(
    path: string,
    scope: { readonly environment: string; readonly verticalSlug: string },
  ): Promise<void> {
    this.validationCalls.push({ kind: 'wrangler', path, ...scope });
    if (!this.regularFiles.has(path)) {
      throw new CredentialProvisioningError('the selected Wrangler config is not a regular file');
    }
    if (
      scope.environment !== this.wranglerScope.environment ||
      scope.verticalSlug !== this.wranglerScope.verticalSlug
    ) {
      throw new CredentialProvisioningError('the selected Wrangler config has the wrong credential scope');
    }
  }

  async createValidatedWranglerConfigSnapshot(
    path: string,
    scope: { readonly environment: string; readonly verticalSlug: string },
    expectedAccountId: string,
  ): Promise<string> {
    await this.assertWranglerConfig(path, scope);
    if (expectedAccountId !== this.wranglerAccountId) {
      throw new CredentialProvisioningError(
        'the explicit Cloudflare account does not match the manifest account',
      );
    }
    const snapshotPath = join(
      dirname(path),
      `.wrangler-credential-snapshot-${this.createdSnapshots.length + 1}.toml`,
    );
    this.createdSnapshots.push(snapshotPath);
    return snapshotPath;
  }

  async removeWranglerConfigSnapshot(path: string): Promise<void> {
    this.removedSnapshots.push(path);
  }

  async writeNewRestrictedFile(path: string, contents: string, mode: number): Promise<void> {
    if (this.written.has(path) || this.regularFiles.has(path)) {
      throw new CredentialProvisioningError('output path already exists; refusing to overwrite it');
    }
    this.written.set(path, { contents, mode });
  }

  async removeNewFile(path: string): Promise<void> {
    if (this.failRemoval) throw new Error('injected removal failure');
    this.written.delete(path);
  }
}

class FakeRunner implements CredentialProcessRunner {
  readonly calls: Array<{
    readonly executable: string;
    readonly args: readonly string[];
    readonly stdin: string;
    readonly env: Readonly<Record<string, string>>;
  }> = [];
  preflightExitCode = 0;
  preflightStdout = '[{"id":"synthetic-existing-deployment"}]';
  secretExitCode = 0;
  throwOnPreflight = false;
  onRun: ((args: readonly string[]) => void) | null = null;

  async run(
    executable: string,
    args: readonly string[],
    stdin: string,
    env: Readonly<Record<string, string>>,
  ): Promise<{ readonly exitCode: number; readonly stdout: string }> {
    this.onRun?.(args);
    this.calls.push({ executable, args, stdin, env });
    const isPreflight = args.includes('deployments');
    if (isPreflight && this.throwOnPreflight) throw new Error('injected process failure');
    return isPreflight
      ? { exitCode: this.preflightExitCode, stdout: this.preflightStdout }
      : { exitCode: this.secretExitCode, stdout: '' };
  }
}

const openDrivers = new Set<SqlDriver>();

async function migratedDriver(): Promise<SqlDriver> {
  const driver = await createPgliteDriver({ trigram: false });
  openDrivers.add(driver);
  for (const migration of await loadMigrations()) await driver.exec(migration.sql);
  await driver.query(
    `INSERT INTO verticals (slug, name, schema_version, status, default_refresh_policy)
     VALUES ('hvac', 'HVAC', '1.0.0', 'DRAFT', $1::jsonb)`,
    [JSON.stringify({ cadence: 'MANUAL', max_staleness_hours: 24, priority: 1 })],
  );
  return driver;
}

afterEach(async () => {
  await Promise.all([...openDrivers].map((driver) => driver.close()));
  openDrivers.clear();
});

describe('credential provisioning argument contract', () => {
  it('accepts only the three deployable access/billing pairs and their secure delivery modes', () => {
    const direct = parseCredentialProvisioningArgs(DIRECT_ARGS);
    expect(direct).toMatchObject({
      environment: 'live',
      accessTier: 'API_PAID',
      billingSource: 'DIRECT',
      delivery: { kind: 'FILE', path: DIRECT_OUTPUT },
      dryRun: false,
    });

    const rapidApi = parseCredentialProvisioningArgs([
      ...DIRECT_ARGS.slice(0, -6),
      '--access-tier',
      'RAPIDAPI',
      '--billing-source',
      'RAPIDAPI',
      '--wrangler-secret',
      'RAPIDAPI_API_KEY',
      '--wrangler-config',
      'apps/edge/wrangler.production.toml',
      '--cloudflare-account-id',
      CLOUDFLARE_ACCOUNT_ID,
    ]);
    expect(rapidApi.delivery).toEqual({
      kind: 'WRANGLER',
      secretName: 'RAPIDAPI_API_KEY',
      configPath: EDGE_CONFIG,
    });
    expect(
      (rapidApi as unknown as Record<string, unknown>)['cloudflareAccountId'],
    ).toBe(CLOUDFLARE_ACCOUNT_ID);

    const mcp = parseCredentialProvisioningArgs([
      ...DIRECT_ARGS.slice(0, -6),
      '--access-tier',
      'MCP',
      '--billing-source',
      'NONE',
      '--output',
      MCP_OUTPUT,
    ]);
    expect(mcp).toMatchObject({
      accessTier: 'MCP',
      billingSource: 'NONE',
      delivery: { kind: 'FILE' },
    });
  });

  it('requires one explicit canonical Cloudflare account id for Wrangler delivery', () => {
    expect(() => parseCredentialProvisioningArgs(rapidApiArgs().slice(0, -2))).toThrow(
      /cloudflare-account-id/i,
    );
    for (const accountId of [
      '00000000000000000000000000000000',
      '1234567890ABCDEF1234567890ABCDEF',
      '1234567890abcdef1234567890abcde',
      '1234567890abcdef1234567890abcdeg',
    ]) {
      expect(() =>
        parseCredentialProvisioningArgs([
          ...rapidApiArgs().slice(0, -1),
          accountId,
        ]),
      ).toThrow(/cloudflare-account-id/i);
    }
  });

  it('refuses a Cloudflare account id outside Wrangler delivery', () => {
    expect(() =>
      parseCredentialProvisioningArgs([
        ...DIRECT_ARGS,
        '--cloudflare-account-id',
        CLOUDFLARE_ACCOUNT_ID,
      ]),
    ).toThrow(/cloudflare-account-id|delivery/i);
  });

  it.each([
    ['unknown environment', [...DIRECT_ARGS.slice(0, 1), 'production', ...DIRECT_ARGS.slice(2)]],
    ['unknown vertical', [...DIRECT_ARGS.slice(0, 7), 'HVAC', ...DIRECT_ARGS.slice(8)]],
    [
      'crossed direct marketplace pair',
      [...DIRECT_ARGS.slice(0, -5), 'RAPIDAPI', ...DIRECT_ARGS.slice(-4)],
    ],
    [
      'unknown tier',
      [...DIRECT_ARGS.slice(0, -6), '--access-tier', 'ENTERPRISE', '--billing-source', 'DIRECT', '--output', resolve(SECURE_ROOT, 'key.json')],
    ],
    ['plaintext key option', [...DIRECT_ARGS, '--api-key', SECRET]],
    ['database URL option', [...DIRECT_ARGS, '--database-url', POSTGRES_URL]],
  ])('refuses %s before opening a database', (_name, args) => {
    expect(() => parseCredentialProvisioningArgs(args)).toThrow(CredentialProvisioningError);
  });

  it('requires an explicit output path or exact Wrangler target and refuses crossed delivery', () => {
    expect(() => parseCredentialProvisioningArgs(DIRECT_ARGS.slice(0, -2))).toThrow(
      /output/i,
    );
    expect(() =>
      parseCredentialProvisioningArgs([
        ...DIRECT_ARGS.slice(0, -2),
        '--wrangler-secret',
        'RAPIDAPI_API_KEY',
        '--wrangler-config',
        'apps/edge/wrangler.production.toml',
        '--cloudflare-account-id',
        CLOUDFLARE_ACCOUNT_ID,
      ]),
    ).toThrow(/delivery/i);
  });

  it('keeps plaintext file targets absolute and outside the git worktree', () => {
    expect(() =>
      parseCredentialProvisioningArgs([
        ...DIRECT_ARGS.slice(0, -1),
        'relative-key.json',
      ]),
    ).toThrow(/absolute/i);
    expect(() =>
      parseCredentialProvisioningArgs([
        ...DIRECT_ARGS.slice(0, -1),
        resolve(REPO_ROOT, 'private-key.json'),
      ]),
    ).toThrow(/worktree/i);
  });

  it('permits Wrangler delivery only to the edge production manifest', () => {
    expect(() =>
      parseCredentialProvisioningArgs([
        ...DIRECT_ARGS.slice(0, -6),
        '--access-tier', 'RAPIDAPI',
        '--billing-source', 'RAPIDAPI',
        '--wrangler-secret', 'RAPIDAPI_API_KEY',
        '--wrangler-config', 'apps/mcp-worker/wrangler.production.toml',
        '--cloudflare-account-id', CLOUDFLARE_ACCOUNT_ID,
      ]),
    ).toThrow(/edge/i);
  });
});

describe('transactional credential provisioning', () => {
  it('creates the active tenant and one-vertical direct key atomically, then replays as a no-op', async () => {
    const driver = await migratedDriver();
    const fileSystem = new FakeFileSystem();
    const runner = new FakeRunner();
    const mint = vi.fn(async () => minted());
    const options = parseCredentialProvisioningArgs(DIRECT_ARGS);

    const created = await provisionApiCredential(driver, options, {
      mintApiKey: mint,
      fileSystem,
      runner,
      wranglerCommand: WRANGLER_COMMAND,
      now: () => NOW,
    });

    expect(created).toMatchObject({
      credentialAction: 'CREATED',
      tenantAction: 'CREATED',
      environment: 'live',
      accessTier: 'API_PAID',
      billingSource: 'DIRECT',
      prefix: PREFIX,
      fingerprint: `sha256:${HASH.slice(0, 16)}`,
      delivery: { kind: 'FILE', path: DIRECT_OUTPUT },
    });
    expect(created).not.toHaveProperty('secret');
    expect(fileSystem.written.get(DIRECT_OUTPUT)?.mode).toBe(0o600);
    expect(JSON.parse(fileSystem.written.get(DIRECT_OUTPUT)!.contents)).toMatchObject({
      credential: SECRET,
      credentialId: created.credentialId,
      prefix: PREFIX,
      fingerprint: `sha256:${HASH.slice(0, 16)}`,
    });

    expect(
      await driver.query(
        `SELECT t.slug, t.name, t.status, v.slug AS vertical_slug,
                k.token_hash, k.token_prefix, k.label, k.access_tier, k.billing_source
           FROM api_keys k
           JOIN api_tenants t ON t.id = k.tenant_id
           JOIN verticals v ON v.id = k.vertical_id`,
      ),
    ).toEqual([
      {
        slug: 'acme-direct',
        name: 'Acme Direct',
        status: 'ACTIVE',
        vertical_slug: 'hvac',
        token_hash: HASH,
        token_prefix: PREFIX,
        label: 'production direct API',
        access_tier: 'API_PAID',
        billing_source: 'DIRECT',
      },
    ]);

    const replay = await provisionApiCredential(driver, options, {
      mintApiKey: mint,
      fileSystem,
      runner,
      wranglerCommand: WRANGLER_COMMAND,
      now: () => NOW,
    });
    expect(replay).toMatchObject({
      credentialAction: 'UNCHANGED',
      tenantAction: 'UNCHANGED',
      credentialId: created.credentialId,
    });
    expect(mint).toHaveBeenCalledTimes(1);
    expect(fileSystem.written).toHaveLength(1);
    expect(await driver.query(`SELECT count(*)::int AS count FROM api_keys`)).toEqual([{ count: 1 }]);
  });

  it('locks tenant identity before credential identity to serialize concurrent first issuance', async () => {
    const driver = await migratedDriver();
    const queries: Array<{ readonly sql: string; readonly params: readonly unknown[] }> = [];
    const observedDriver: SqlDriver = {
      label: driver.label,
      dialect: driver.dialect,
      exec: (sql) => driver.exec(sql),
      query: (sql, params) =>
        params === undefined ? driver.query(sql) : driver.query(sql, params),
      transaction: async <T>(fn: (tx: SqlTransactionExecutor) => Promise<T>): Promise<T> =>
        driver.transaction(async (tx) => {
          const observed = {
            query: async <R extends Record<string, unknown>>(
              sql: string,
              params?: readonly (string | number | boolean | null)[],
            ): Promise<R[]> => {
              queries.push({ sql, params: params ?? [] });
              return params === undefined ? tx.query<R>(sql) : tx.query<R>(sql, params);
            },
          } as unknown as SqlTransactionExecutor;
          return fn(observed);
        }),
      close: async () => undefined,
    };

    await provisionApiCredential(observedDriver, parseCredentialProvisioningArgs(DIRECT_ARGS), {
      mintApiKey: async () => minted(),
      fileSystem: new FakeFileSystem(),
      runner: new FakeRunner(),
      wranglerCommand: WRANGLER_COMMAND,
      now: () => NOW,
    });

    const lockQueries = queries.filter(({ sql }) => sql.includes('pg_advisory_xact_lock'));
    expect(lockQueries).toHaveLength(2);
    expect(lockQueries[0]?.params).toEqual(['data-foundry:tenant:acme-direct']);
    expect(lockQueries[1]?.params).toEqual([
      'data-foundry:credential:acme-direct:hvac:production direct API',
    ]);
  });

  it('rolls back the tenant and key when one-time file delivery fails', async () => {
    const driver = await migratedDriver();
    const fileSystem = new FakeFileSystem();
    fileSystem.regularFiles.add(DIRECT_OUTPUT);

    await expect(
      provisionApiCredential(driver, parseCredentialProvisioningArgs(DIRECT_ARGS), {
        mintApiKey: async () => minted(),
        fileSystem,
        runner: new FakeRunner(),
        wranglerCommand: WRANGLER_COMMAND,
        now: () => NOW,
      }),
    ).rejects.toThrow(/overwrite/i);

    expect(await driver.query(`SELECT count(*)::int AS count FROM api_tenants`)).toEqual([
      { count: 0 },
    ]);
    expect(await driver.query(`SELECT count(*)::int AS count FROM api_keys`)).toEqual([{ count: 0 }]);
  });

  it('raises a secret-safe critical error when rollback cannot remove a delivered plaintext file', async () => {
    const driver = await migratedDriver();
    const commitFailDriver: SqlDriver = {
      label: driver.label,
      dialect: driver.dialect,
      exec: (sql) => driver.exec(sql),
      query: (sql, params) =>
        params === undefined ? driver.query(sql) : driver.query(sql, params),
      transaction: async <T>(fn: (tx: SqlTransactionExecutor) => Promise<T>): Promise<T> =>
        driver.transaction(async (tx) => {
          await fn(tx);
          throw new Error('injected commit failure');
        }),
      close: async () => undefined,
    };
    const fileSystem = new FakeFileSystem();
    fileSystem.failRemoval = true;

    const caught = await provisionApiCredential(
      commitFailDriver,
      parseCredentialProvisioningArgs(DIRECT_ARGS),
      {
        mintApiKey: async () => minted(),
        fileSystem,
        runner: new FakeRunner(),
        wranglerCommand: WRANGLER_COMMAND,
        now: () => NOW,
      },
    ).then(
      () => null,
      (error: unknown) => error,
    );
    expect(caught).toBeInstanceOf(CredentialProvisioningError);
    expect((caught as Error).message).toMatch(/^CRITICAL:/);
    expect((caught as Error).message).toContain('securely remove the selected output path');
    expect((caught as Error).message).not.toContain(SECRET);
    expect(fileSystem.written.has(DIRECT_OUTPUT)).toBe(true);
    expect(await driver.query(`SELECT count(*)::int AS count FROM api_keys`)).toEqual([{ count: 0 }]);
  });

  it('classifies one explicitly identified quarantined legacy key once without minting or delivery', async () => {
    const driver = await migratedDriver();
    const verticalId = (await driver.query<{ id: string }>(
      `SELECT id FROM verticals WHERE slug = 'hvac'`,
    ))[0]?.id;
    const tenantId = (await driver.query<{ id: string }>(
      `INSERT INTO api_tenants (slug, name) VALUES ('legacy', 'Legacy') RETURNING id`,
    ))[0]?.id;
    if (verticalId === undefined || tenantId === undefined) throw new Error('fixture insert failed');
    await driver.exec(`ALTER TABLE api_keys DISABLE TRIGGER api_keys_access_classification_guard`);
    const keyId = (await driver.query<{ id: string }>(
      `INSERT INTO api_keys
         (tenant_id, vertical_id, token_hash, token_prefix, label, access_tier, billing_source)
       VALUES ($1, $2, $3, $4, 'legacy key', NULL, NULL)
      RETURNING id`,
      [tenantId, verticalId, 'b'.repeat(64), `df_live_${'B'.repeat(8)}`],
    ))[0]?.id;
    if (keyId === undefined) throw new Error('fixture key insert failed');
    await driver.exec(`ALTER TABLE api_keys ENABLE TRIGGER api_keys_access_classification_guard`);

    const args = [
      '--environment', 'live',
      '--tenant-slug', 'legacy',
      '--tenant-name', 'Legacy',
      '--vertical', 'hvac',
      '--credential-label', 'legacy key',
      '--access-tier', 'MCP',
      '--billing-source', 'NONE',
      '--classify-existing', keyId,
    ];
    const mint = vi.fn(async () => minted());
    const first = await provisionApiCredential(driver, parseCredentialProvisioningArgs(args), {
      mintApiKey: mint,
      fileSystem: new FakeFileSystem(),
      runner: new FakeRunner(),
      wranglerCommand: WRANGLER_COMMAND,
      now: () => NOW,
    });
    expect(first).toMatchObject({ credentialAction: 'CLASSIFIED', credentialId: keyId });
    expect(mint).not.toHaveBeenCalled();
    expect(
      await driver.query(`SELECT access_tier, billing_source FROM api_keys WHERE id = $1`, [keyId]),
    ).toEqual([{ access_tier: 'MCP', billing_source: 'NONE' }]);

    const replay = await provisionApiCredential(driver, parseCredentialProvisioningArgs(args), {
      mintApiKey: mint,
      fileSystem: new FakeFileSystem(),
      runner: new FakeRunner(),
      wranglerCommand: WRANGLER_COMMAND,
      now: () => NOW,
    });
    expect(replay.credentialAction).toBe('UNCHANGED');
  });

  it('refuses ambiguous, inactive, revoked, expired, wrong-environment, and mismatched existing state', async () => {
    const driver = await migratedDriver();
    const options = parseCredentialProvisioningArgs(DIRECT_ARGS);
    const dependencies = {
      mintApiKey: async () => minted(),
      fileSystem: new FakeFileSystem(),
      runner: new FakeRunner(),
      wranglerCommand: WRANGLER_COMMAND,
      now: () => NOW,
    } as const;
    const created = await provisionApiCredential(driver, options, dependencies);
    if (created.credentialId === undefined) throw new Error('fixture credential insert failed');

    await driver.query(`UPDATE api_tenants SET status = 'SUSPENDED' WHERE slug = 'acme-direct'`);
    await expect(provisionApiCredential(driver, options, dependencies)).rejects.toThrow(/ACTIVE/i);
    await driver.query(`UPDATE api_tenants SET status = 'ACTIVE' WHERE slug = 'acme-direct'`);
    await driver.query(`UPDATE api_keys SET revoked_at = now() WHERE id = $1`, [created.credentialId]);
    await expect(provisionApiCredential(driver, options, dependencies)).rejects.toThrow(/revoked/i);
    await driver.query(`UPDATE api_keys SET revoked_at = NULL, expires_at = $2 WHERE id = $1`, [
      created.credentialId,
      '2026-08-30T11:59:59.000Z',
    ]);
    await expect(provisionApiCredential(driver, options, dependencies)).rejects.toThrow(/expired/i);
    await driver.query(`UPDATE api_keys SET expires_at = NULL WHERE id = $1`, [created.credentialId]);

    const testEnvironment = parseCredentialProvisioningArgs([
      ...DIRECT_ARGS.slice(0, 1),
      'test',
      ...DIRECT_ARGS.slice(2),
    ]);
    await expect(provisionApiCredential(driver, testEnvironment, dependencies)).rejects.toThrow(
      /environment/i,
    );

    const mcpProfile = parseCredentialProvisioningArgs([
      ...DIRECT_ARGS.slice(0, -6),
      '--access-tier', 'MCP',
      '--billing-source', 'NONE',
      '--output', resolve(SECURE_ROOT, 'mcp.json'),
    ]);
    await expect(provisionApiCredential(driver, mcpProfile, dependencies)).rejects.toThrow(
      /immutable/i,
    );

    await driver.query(
      `INSERT INTO api_keys
         (tenant_id, vertical_id, token_hash, token_prefix, label, access_tier, billing_source)
       SELECT tenant_id, vertical_id, $2, 'df_live_CCCCCCCC', label, access_tier, billing_source
         FROM api_keys
        WHERE id = $1`,
      [created.credentialId, 'c'.repeat(64)],
    );
    await expect(provisionApiCredential(driver, options, dependencies)).rejects.toThrow(/ambiguous/i);
  });

  it('validates dry-run state without minting, writing, running Wrangler, or mutating the database', async () => {
    const driver = await migratedDriver();
    const fileSystem = new FakeFileSystem();
    const runner = new FakeRunner();
    const mint = vi.fn(async () => minted());
    const options = parseCredentialProvisioningArgs([...DIRECT_ARGS, '--dry-run']);

    const result = await provisionApiCredential(driver, options, {
      mintApiKey: mint,
      fileSystem,
      runner,
      wranglerCommand: WRANGLER_COMMAND,
      now: () => NOW,
    });

    expect(result).toMatchObject({ credentialAction: 'WOULD_CREATE', dryRun: true });
    expect(JSON.stringify(result)).not.toContain(SECRET);
    expect(mint).not.toHaveBeenCalled();
    expect(fileSystem.written.size).toBe(0);
    expect(runner.calls).toEqual([]);
    expect(await driver.query(`SELECT count(*)::int AS count FROM api_tenants`)).toEqual([
      { count: 0 },
    ]);
  });

  it('refuses a well-formed but unknown vertical before minting or delivery', async () => {
    const driver = await migratedDriver();
    const mint = vi.fn(async () => minted());
    const fileSystem = new FakeFileSystem();
    const options = parseCredentialProvisioningArgs([
      ...DIRECT_ARGS.slice(0, 7),
      'plumbing',
      ...DIRECT_ARGS.slice(8),
    ]);
    await expect(
      provisionApiCredential(driver, options, {
        mintApiKey: mint,
        fileSystem,
        runner: new FakeRunner(),
        wranglerCommand: WRANGLER_COMMAND,
        now: () => NOW,
      }),
    ).rejects.toThrow(/does not exist/i);
    expect(mint).not.toHaveBeenCalled();
    expect(fileSystem.written.size).toBe(0);
  });
});

describe('secret delivery boundaries', () => {
  it('pipes the RapidAPI key only through Wrangler stdin with argv-safe exact arguments', async () => {
    const driver = await migratedDriver();
    const events: string[] = [];
    const observedDriver: SqlDriver = {
      label: driver.label,
      dialect: driver.dialect,
      exec: (sql) => driver.exec(sql),
      query: (sql, params) =>
        params === undefined ? driver.query(sql) : driver.query(sql, params),
      transaction: async <T>(fn: (tx: SqlTransactionExecutor) => Promise<T>): Promise<T> => {
        events.push('transaction');
        return driver.transaction(fn);
      },
      close: async () => undefined,
    };
    const fileSystem = new FakeFileSystem();
    const runner = new FakeRunner();
    runner.onRun = (args) => events.push(args.includes('deployments') ? 'preflight' : 'secret');
    fileSystem.regularFiles.add(EDGE_CONFIG);
    const options = parseCredentialProvisioningArgs([
      ...DIRECT_ARGS.slice(0, -6),
      '--access-tier', 'RAPIDAPI',
      '--billing-source', 'RAPIDAPI',
      '--wrangler-secret', 'RAPIDAPI_API_KEY',
      '--wrangler-config', 'apps/edge/wrangler.production.toml',
      '--cloudflare-account-id', CLOUDFLARE_ACCOUNT_ID,
    ]);

    const result = await provisionApiCredential(observedDriver, options, {
      mintApiKey: async () => minted(),
      fileSystem,
      runner,
      wranglerCommand: WRANGLER_COMMAND,
      env: {
        POSTGRES_URL,
        NODE_OPTIONS: '--require=C:\\untrusted-hook.cjs',
        NODE_PATH: 'C:\\untrusted-node-path',
        RAPIDAPI_PROXY_SECRET: 'must-not-cross-child-boundary',
        CLOUDFLARE_API_TOKEN: 'synthetic-cloudflare-token',
        CLOUDFLARE_ACCOUNT_ID: 'fedcba0987654321fedcba0987654321',
      },
      now: () => NOW,
    });

    expect(result.delivery).toEqual({
      kind: 'WRANGLER',
      secretName: 'RAPIDAPI_API_KEY',
      configPath: EDGE_CONFIG,
    });
    const snapshotPath = fileSystem.createdSnapshots[0]!;
    expect(dirname(snapshotPath)).toBe(dirname(EDGE_CONFIG));
    expect(runner.calls).toEqual([
      {
        executable: WRANGLER_COMMAND.executable,
        args: [
          ...WRANGLER_COMMAND.argsPrefix,
          'deployments', 'list', '--json',
          '--config', snapshotPath,
          '--env-file', EMPTY_WRANGLER_ENV,
        ],
        stdin: '',
        env: {
          CLOUDFLARE_API_TOKEN: 'synthetic-cloudflare-token',
          CLOUDFLARE_ACCOUNT_ID,
        },
      },
      {
        executable: WRANGLER_COMMAND.executable,
        args: [
          ...WRANGLER_COMMAND.argsPrefix,
          'secret', 'put', 'RAPIDAPI_API_KEY',
          '--config', snapshotPath,
          '--env-file', EMPTY_WRANGLER_ENV,
        ],
        stdin: `${SECRET}\n`,
        env: {
          CLOUDFLARE_API_TOKEN: 'synthetic-cloudflare-token',
          CLOUDFLARE_ACCOUNT_ID,
        },
      },
    ]);
    expect(fileSystem.removedSnapshots).toEqual([snapshotPath]);
    expect(events).toEqual(['preflight', 'transaction', 'secret']);
    expect(runner.calls[0]!.args).not.toContain(SECRET);
    expect(runner.calls[0]!.stdin).toBe('');
    expect(runner.calls[1]!.args).not.toContain(SECRET);
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });

  it('refuses an explicit Cloudflare account that differs from the validated manifest before minting', async () => {
    const driver = await migratedDriver();
    const fileSystem = new FakeFileSystem();
    const runner = new FakeRunner();
    const mint = vi.fn(async () => minted());
    fileSystem.regularFiles.add(EDGE_CONFIG);
    const args = [
      ...rapidApiArgs().slice(0, -1),
      'fedcba0987654321fedcba0987654321',
    ];

    await expect(
      provisionApiCredential(driver, parseCredentialProvisioningArgs(args), {
        mintApiKey: mint,
        fileSystem,
        runner,
        wranglerCommand: WRANGLER_COMMAND,
        now: () => NOW,
      }),
    ).rejects.toThrow(/account.*manifest/i);
    expect(mint).not.toHaveBeenCalled();
    expect(runner.calls).toEqual([]);
    expect(fileSystem.createdSnapshots).toEqual([]);
  });

  it('does not call Wrangler when the database transaction cannot commit', async () => {
    const driver = await migratedDriver();
    const commitFailDriver: SqlDriver = {
      label: driver.label,
      dialect: driver.dialect,
      exec: (sql) => driver.exec(sql),
      query: (sql, params) =>
        params === undefined ? driver.query(sql) : driver.query(sql, params),
      transaction: async <T>(fn: (tx: SqlTransactionExecutor) => Promise<T>): Promise<T> =>
        driver.transaction(async (tx) => {
          await fn(tx);
          throw new Error('injected commit failure');
        }),
      close: async () => undefined,
    };
    const fileSystem = new FakeFileSystem();
    const runner = new FakeRunner();
    fileSystem.regularFiles.add(EDGE_CONFIG);
    const options = parseCredentialProvisioningArgs([
      ...DIRECT_ARGS.slice(0, -6),
      '--access-tier', 'RAPIDAPI',
      '--billing-source', 'RAPIDAPI',
      '--wrangler-secret', 'RAPIDAPI_API_KEY',
      '--wrangler-config', 'apps/edge/wrangler.production.toml',
      '--cloudflare-account-id', CLOUDFLARE_ACCOUNT_ID,
    ]);

    await expect(
      provisionApiCredential(commitFailDriver, options, {
        mintApiKey: async () => minted(),
        fileSystem,
        runner,
        wranglerCommand: WRANGLER_COMMAND,
        now: () => NOW,
      }),
    ).rejects.toThrow(/commit failure/);
    const snapshotPath = fileSystem.createdSnapshots[0]!;
    expect(runner.calls).toEqual([
      expect.objectContaining({
        args: expect.arrayContaining(['deployments', 'list', '--config', snapshotPath]),
        stdin: '',
      }),
    ]);
    expect(fileSystem.removedSnapshots).toEqual([snapshotPath]);
    expect(await driver.query(`SELECT count(*)::int AS count FROM api_keys`)).toEqual([{ count: 0 }]);
  });

  it('revokes the committed key when Wrangler does not confirm delivery', async () => {
    const driver = await migratedDriver();
    const fileSystem = new FakeFileSystem();
    const runner = new FakeRunner();
    runner.secretExitCode = 1;
    fileSystem.regularFiles.add(EDGE_CONFIG);
    const options = parseCredentialProvisioningArgs([
      ...DIRECT_ARGS.slice(0, -6),
      '--access-tier', 'RAPIDAPI',
      '--billing-source', 'RAPIDAPI',
      '--wrangler-secret', 'RAPIDAPI_API_KEY',
      '--wrangler-config', 'apps/edge/wrangler.production.toml',
      '--cloudflare-account-id', CLOUDFLARE_ACCOUNT_ID,
    ]);

    await expect(
      provisionApiCredential(driver, options, {
        mintApiKey: async () => minted(),
        fileSystem,
        runner,
        wranglerCommand: WRANGLER_COMMAND,
        now: () => NOW,
      }),
    ).rejects.toThrow(/Wrangler/i);
    expect(await driver.query(`SELECT count(*)::int AS count FROM api_tenants`)).toEqual([
      { count: 1 },
    ]);
    expect(
      await driver.query<{ revoked: boolean }>(
        `SELECT revoked_at IS NOT NULL AS revoked FROM api_keys`,
      ),
    ).toEqual([{ revoked: true }]);
    expect(runner.calls.map((call) => call.args.includes('deployments'))).toEqual([true, false]);
    expect(fileSystem.removedSnapshots).toEqual(fileSystem.createdSnapshots);
  });
});

describe('host delivery safeguards', () => {
  it('fails closed on Windows file delivery instead of treating chmod as an owner-only ACL', async () => {
    const fileSystem = createNodeCredentialFileSystem({
      platform: 'win32',
      workspaceRoot: REPO_ROOT,
    });
    await expect(fileSystem.assertNewOutputPath(DIRECT_OUTPUT)).rejects.toThrow(/POSIX|WSL/i);
  });

  it('binds the fail-closed production edge manifest to the requested credential scope', () => {
    const safe = SAFE_EDGE_MANIFEST;
    const hvacLive = { environment: 'live', verticalSlug: 'hvac' } as const;
    expect(isSafeEdgeWranglerConfig(safe, hvacLive)).toBe(true);
    expect(isSafeEdgeWranglerConfig(safe, hvacLive, CLOUDFLARE_ACCOUNT_ID)).toBe(true);
    expect(
      isSafeEdgeWranglerConfig(
        safe,
        hvacLive,
        'fedcba0987654321fedcba0987654321',
      ),
    ).toBe(false);
    expect(isSafeEdgeWranglerConfig(safe, { environment: 'test', verticalSlug: 'hvac' })).toBe(false);
    expect(isSafeEdgeWranglerConfig(safe, { environment: 'live', verticalSlug: 'plumbing' })).toBe(false);
    expect(
      isSafeEdgeWranglerConfig(
        safe.replace('RAPIDAPI_HOSTNAME = "marketplace.datafoundry.io"\n', ''),
        hvacLive,
      ),
    ).toBe(false);
    expect(
      isSafeEdgeWranglerConfig(
        safe.replace('VERTICAL_SLUG = "hvac"', 'VERTICAL_SLUG = "plumbing"'),
        hvacLive,
      ),
    ).toBe(false);
    expect(
      isSafeEdgeWranglerConfig(safe.replace('preview_urls = false', 'preview_urls = true'), hvacLive),
    ).toBe(false);
    expect(
      isSafeEdgeWranglerConfig(
        safe.replace('1234567890abcdef1234567890abcdef', '00000000000000000000000000000000'),
        hvacLive,
      ),
    ).toBe(false);
    expect(
      isSafeEdgeWranglerConfig(
        safe.replace('1234567890abcdef1234567890abcdef', '1234567890ABCDEF1234567890ABCDEF'),
        hvacLive,
      ),
    ).toBe(false);
    expect(
      isSafeEdgeWranglerConfig(
        safe.replace('RAPIDAPI_HOSTNAME = "marketplace.datafoundry.io"', 'RAPIDAPI_HOSTNAME = "unrouted.datafoundry.io"'),
        hvacLive,
      ),
    ).toBe(false);
    expect(
      isSafeEdgeWranglerConfig(
        safe.replace(
          'routes = ["api.datafoundry.io/*", "marketplace.datafoundry.io/*"]',
          'route = "marketplace.datafoundry.io/*"',
        ),
        hvacLive,
      ),
    ).toBe(false);
    for (const route of [
      'API.datafoundry.io/*',
      'api.datafoundry.io./*',
      'https://api.datafoundry.io/*',
      'user@api.datafoundry.io/*',
      'api.datafoundry.io:443/*',
      'api.datafoundry.io/path/*',
      'api.datafoundry.io/*?preview=1',
      'api_datafoundry.io/*',
      'catalog.invalid./*',
      'data-foundry-edge.workers.dev/*',
      'data-foundry-edge.pages.dev/*',
      'data-foundry-edge.trycloudflare.com/*',
      'api.123/*',
      '1.2.3.4.5/*',
    ]) {
      expect(
        isSafeEdgeWranglerConfig(safe.replace('api.datafoundry.io/*', route), hvacLive),
      ).toBe(false);
    }
    for (const hostname of [
      'marketplace.invalid',
      'marketplace.invalid.',
      'marketplace.example',
      'marketplace.test.',
      'marketplace.example.com',
      'marketplace.local',
      'marketplace.onion',
      'marketplace.home.arpa',
      '8.8.8.8',
      'marketplace_datafoundry.io',
      'data-foundry-edge.workers.dev',
      'data-foundry-edge.workers.dev.',
      'data-foundry-edge.pages.dev',
      'data-foundry-edge.trycloudflare.com',
    ]) {
      expect(
        isSafeEdgeWranglerConfig(
          safe.replace('marketplace.datafoundry.io"\n[[hyperdrive]]', `${hostname}"\n[[hyperdrive]]`),
          hvacLive,
        ),
      ).toBe(false);
    }
    for (const hostname of [
      'API.datafoundry.io',
      'api.datafoundry.io.',
      ' api.datafoundry.io',
      'api.datafoundry.io ',
    ]) {
      expect(
        isSafeEdgeWranglerConfig(
          safe.replace(
            'RAPIDAPI_HOSTNAME = "marketplace.datafoundry.io"',
            `RAPIDAPI_HOSTNAME = "${hostname}"`,
          ),
          hvacLive,
        ),
      ).toBe(false);
    }
    expect(
      isSafeEdgeWranglerConfig(
        `${safe}\n[[hyperdrive]]\nbinding = "UNUSED_HYPERDRIVE"\nid = "not-a-cloudflare-id"\n`,
        hvacLive,
      ),
    ).toBe(false);
    expect(isSafeEdgeWranglerConfig(`${safe}\nPOSTGRES_URL = "postgres://secret"`, hvacLive)).toBe(false);
    expect(isSafeEdgeWranglerConfig(`${safe}\nRAPIDAPI_API_KEY = "${SECRET}"`, hvacLive)).toBe(false);
  });

  it('snapshots the exact validated manifest bytes beside the canonical config and removes them', async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), 'data-foundry-wrangler-snapshot-'));
    const productionConfig = join(temporaryRoot, 'edge', 'wrangler.production.toml');
    const originalBytes = `# exact validated bytes must survive\r\n${SAFE_EDGE_MANIFEST}`;
    await mkdir(dirname(productionConfig), { recursive: true });
    await writeFile(productionConfig, originalBytes, { encoding: 'utf8', flag: 'wx' });
    try {
      const fileSystem = createNodeCredentialFileSystem({
        platform: process.platform,
        workspaceRoot: REPO_ROOT,
        edgeProductionConfigPath: productionConfig,
      });
      const snapshotPath = await fileSystem.createValidatedWranglerConfigSnapshot(
        productionConfig,
        { environment: 'live', verticalSlug: 'hvac' },
        CLOUDFLARE_ACCOUNT_ID,
      );

      expect(dirname(snapshotPath)).toBe(dirname(productionConfig));
      expect(basename(snapshotPath)).toMatch(/^\.wrangler-credential-snapshot-[0-9a-f-]+\.toml$/);
      expect(await readFile(snapshotPath, 'utf8')).toBe(originalBytes);
      await writeFile(productionConfig, '# changed after validation\n', 'utf8');
      expect(await readFile(snapshotPath, 'utf8')).toBe(originalBytes);

      await fileSystem.removeWranglerConfigSnapshot(snapshotPath);
      await expect(readFile(snapshotPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });

  it('does not remove or alter another attempt snapshot when exclusive creation reports EEXIST', async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), 'data-foundry-wrangler-eexist-'));
    const productionConfig = join(temporaryRoot, 'edge', 'wrangler.production.toml');
    const fixedSnapshotId = '11111111-1111-4111-8111-111111111111';
    const occupiedSnapshot = join(
      dirname(productionConfig),
      `.wrangler-credential-snapshot-${fixedSnapshotId}.toml`,
    );
    const existingBytes = 'another-attempt-owned-snapshot';
    await mkdir(dirname(productionConfig), { recursive: true });
    await writeFile(productionConfig, SAFE_EDGE_MANIFEST, { encoding: 'utf8', flag: 'wx' });
    await writeFile(occupiedSnapshot, existingBytes, { encoding: 'utf8', flag: 'wx' });
    try {
      const fileSystem = createNodeCredentialFileSystem({
        platform: process.platform,
        workspaceRoot: REPO_ROOT,
        edgeProductionConfigPath: productionConfig,
        snapshotId: () => fixedSnapshotId,
      });

      await expect(
        fileSystem.createValidatedWranglerConfigSnapshot(
          productionConfig,
          { environment: 'live', verticalSlug: 'hvac' },
          CLOUDFLARE_ACCOUNT_ID,
        ),
      ).rejects.toThrow(/manifest/i);
      expect(await readFile(occupiedSnapshot, 'utf8')).toBe(existingBytes);
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });

  it('fails closed when cleanup of a partially created Wrangler snapshot cannot be proved', async () => {
    const closeSnapshot = vi.fn(async () => undefined);
    const removeSnapshot = vi.fn(async () => undefined);
    await expect(
      cleanupFailedWranglerSnapshot('synthetic-snapshot.toml', closeSnapshot, removeSnapshot),
    ).resolves.toBeUndefined();
    expect(closeSnapshot).toHaveBeenCalledOnce();
    expect(removeSnapshot).toHaveBeenCalledWith('synthetic-snapshot.toml');

    await expect(
      cleanupFailedWranglerSnapshot(
        'already-absent-snapshot.toml',
        null,
        vi.fn(async () => {
          throw Object.assign(new Error('synthetic missing snapshot'), { code: 'ENOENT' });
        }),
      ),
    ).resolves.toBeUndefined();

    const unlinkDetail = 'injected unlink cleanup detail must not escape';
    const failure = await cleanupFailedWranglerSnapshot(
      'unremovable-snapshot.toml',
      null,
      vi.fn(async () => {
        throw Object.assign(new Error(unlinkDetail), { code: 'EACCES' });
      }),
    ).then(
      () => null,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(CredentialProvisioningError);
    expect((failure as Error).message).toMatch(/^CRITICAL:.*snapshot.*cleanup/i);
    expect((failure as Error).message).not.toContain(unlinkDetail);

    const closeDetail = 'injected close cleanup detail must not escape';
    const removeAfterCloseFailure = vi.fn(async () => undefined);
    const closeFailure = await cleanupFailedWranglerSnapshot(
      'close-uncertain-snapshot.toml',
      vi.fn(async () => {
        throw new Error(closeDetail);
      }),
      removeAfterCloseFailure,
    ).then(
      () => null,
      (error: unknown) => error,
    );
    expect(removeAfterCloseFailure).toHaveBeenCalledWith('close-uncertain-snapshot.toml');
    expect(closeFailure).toBeInstanceOf(CredentialProvisioningError);
    expect((closeFailure as Error).message).toMatch(/^CRITICAL:.*snapshot.*cleanup/i);
    expect((closeFailure as Error).message).not.toContain(closeDetail);
  });

  it.each([
    ['placeholder text', 'configured-hyperdrive-id'],
    ['31 hexadecimal characters', 'a'.repeat(31)],
    ['zero identifier', '0'.repeat(32)],
    ['uppercase identifier', 'ABCDEF1234567890ABCDEF1234567890'],
    ['non-hexadecimal identifier', `${'a'.repeat(31)}g`],
  ])('rejects a %s as a Hyperdrive binding id', (_name, hyperdriveId) => {
    const manifest = SAFE_EDGE_MANIFEST.replace(
      'id = "abcdef1234567890abcdef1234567890"',
      `id = "${hyperdriveId}"`,
    );
    expect(
      isSafeEdgeWranglerConfig(SAFE_EDGE_MANIFEST, {
        environment: 'live',
        verticalSlug: 'hvac',
      }),
    ).toBe(true);
    expect(
      isSafeEdgeWranglerConfig(manifest, { environment: 'live', verticalSlug: 'hvac' }),
    ).toBe(false);
  });

  it('uses the repository-pinned Wrangler JavaScript entrypoint through Node', async () => {
    const expectedCli = resolve(REPO_ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
    const probed: string[] = [];
    const command = await resolveWranglerCommand(
      'C:\\Program Files\\nodejs\\node.exe',
      async (candidate) => {
        probed.push(candidate);
        return candidate === expectedCli ? expectedCli : null;
      },
    );
    expect(command).toEqual({
      executable: 'C:\\Program Files\\nodejs\\node.exe',
      argsPrefix: [expectedCli],
    });
    expect(probed).toEqual([expectedCli]);
  });

  it('passes Wrangler only an explicit minimal environment and never inherits database or Node injection values', async () => {
    const previousPostgres = process.env['POSTGRES_URL'];
    const previousNodeOptions = process.env['NODE_OPTIONS'];
    process.env['POSTGRES_URL'] = POSTGRES_URL;
    process.env['NODE_OPTIONS'] = '--require=C:\\definitely-missing-credential-hook.cjs';
    try {
      const parentEnvironment = {
        POSTGRES_URL,
        NODE_OPTIONS: process.env['NODE_OPTIONS'],
        NODE_PATH: 'C:\\untrusted-node-path',
        RAPIDAPI_PROXY_SECRET: 'must-not-cross-child-boundary',
        CLOUDFLARE_API_TOKEN: 'synthetic-cloudflare-token',
        CLOUDFLARE_ACCOUNT_ID: '1234567890abcdef1234567890abcdef',
        SystemRoot: process.env['SystemRoot'],
      };
      const childEnvironment = buildWranglerEnvironment(parentEnvironment);
      expect(childEnvironment).toEqual({
        ...(process.env['SystemRoot'] === undefined ? {} : { SystemRoot: process.env['SystemRoot'] }),
        CLOUDFLARE_API_TOKEN: 'synthetic-cloudflare-token',
      });
      const processResult = await nodeCredentialProcessRunner.run(
        process.execPath,
        [
          '-e',
          `if (process.env.POSTGRES_URL || process.env.NODE_OPTIONS || process.env.NODE_PATH || process.env.RAPIDAPI_PROXY_SECRET) process.exit(91);
           if (process.env.CLOUDFLARE_ACCOUNT_ID) process.exit(93);
           if (process.env.CLOUDFLARE_API_TOKEN !== 'synthetic-cloudflare-token') process.exit(92);
           process.stdout.write('bounded-runner-output');`,
        ],
        '',
        childEnvironment,
      );
      expect(processResult).toEqual({ exitCode: 0, stdout: 'bounded-runner-output' });
    } finally {
      if (previousPostgres === undefined) delete process.env['POSTGRES_URL'];
      else process.env['POSTGRES_URL'] = previousPostgres;
      if (previousNodeOptions === undefined) delete process.env['NODE_OPTIONS'];
      else process.env['NODE_OPTIONS'] = previousNodeOptions;
    }
  });

  it('fails closed when a real child process exceeds the bounded Wrangler stdout limit', async () => {
    const childEnvironment = process.env['SystemRoot'] === undefined
      ? {}
      : { SystemRoot: process.env['SystemRoot'] };
    await expect(
      nodeCredentialProcessRunner.run(
        process.execPath,
        ['-e', 'process.stdout.write("x".repeat(1024 * 1024 + 1))'],
        '',
        childEnvironment,
      ),
    ).rejects.toThrow(/execute Wrangler safely/i);
  });

  it('fails closed when the Wrangler executable cannot be spawned', async () => {
    const childEnvironment = process.env['SystemRoot'] === undefined
      ? {}
      : { SystemRoot: process.env['SystemRoot'] };
    await expect(
      nodeCredentialProcessRunner.run(
        join(tmpdir(), 'data-foundry-definitely-missing-wrangler-executable'),
        [],
        '',
        childEnvironment,
      ),
    ).rejects.toThrow(/execute Wrangler safely/i);
  });

  it('preserves only supported Cloudflare authentication aliases and not endpoint overrides', () => {
    expect(
      buildWranglerEnvironment({
        CF_API_TOKEN: 'synthetic-deprecated-token',
        CLOUDFLARE_API_BASE_URL: 'https://credential-capture.invalid',
        CLOUDFLARE_BASE_URL: 'https://credential-capture.invalid',
      }),
    ).toEqual({ CF_API_TOKEN: 'synthetic-deprecated-token' });
    expect(
      buildWranglerEnvironment({
        CLOUDFLARE_API_KEY: 'synthetic-global-key',
        CLOUDFLARE_EMAIL: 'operator@example.com',
        CLOUDFLARE_API_USER_SERVICE_KEY: 'unrelated-service-key',
      }),
    ).toEqual({
      CLOUDFLARE_API_KEY: 'synthetic-global-key',
      CLOUDFLARE_EMAIL: 'operator@example.com',
    });
  });
});

describe('CLI environment and output safety', () => {
  it('does not infer the required Cloudflare account id from the parent environment', async () => {
    const args = rapidApiArgs().slice(0, -2);
    const fileSystem = new FakeFileSystem();
    const createDriver = vi.fn();

    await expect(
      runCredentialProvisioningCli(args, {
        env: { POSTGRES_URL, CLOUDFLARE_ACCOUNT_ID },
        createDriver,
        mintApiKey: vi.fn(async () => minted()),
        fileSystem,
        runner: new FakeRunner(),
        wranglerCommand: WRANGLER_COMMAND,
        now: () => NOW,
        writeStdout: vi.fn(),
      }),
    ).rejects.toThrow(/cloudflare-account-id/i);

    expect(createDriver).not.toHaveBeenCalled();
    expect(fileSystem.createdSnapshots).toEqual([]);
  });

  it.each([
    {
      name: 'a non-zero command exit',
      configure: (runner: FakeRunner) => {
        runner.preflightExitCode = 7;
      },
    },
    {
      name: 'a process execution error',
      configure: (runner: FakeRunner) => {
        runner.throwOnPreflight = true;
      },
    },
    {
      name: 'invalid JSON',
      configure: (runner: FakeRunner) => {
        runner.preflightStdout = 'provider-output-must-not-leak';
      },
    },
    {
      name: 'an empty deployment list',
      configure: (runner: FakeRunner) => {
        runner.preflightStdout = '[]';
      },
    },
    {
      name: 'a non-array deployment response',
      configure: (runner: FakeRunner) => {
        runner.preflightStdout = '{"id":"not-a-list"}';
      },
    },
  ])('refuses Wrangler delivery on $name before opening the database', async ({ configure }) => {
    const fileSystem = new FakeFileSystem();
    fileSystem.regularFiles.add(EDGE_CONFIG);
    const createDriver = vi.fn();
    const mint = vi.fn(async () => minted());
    const runner = new FakeRunner();
    const stdout = vi.fn();
    configure(runner);

    const failure = await runCredentialProvisioningCli(rapidApiArgs(), {
      env: {
        POSTGRES_URL,
        CLOUDFLARE_API_TOKEN: 'synthetic-cloudflare-token',
        CLOUDFLARE_ACCOUNT_ID: 'fedcba0987654321fedcba0987654321',
      },
      createDriver,
      mintApiKey: mint,
      fileSystem,
      runner,
      wranglerCommand: WRANGLER_COMMAND,
      now: () => NOW,
      writeStdout: stdout,
    }).then(
      () => null,
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(CredentialProvisioningError);
    expect((failure as Error).message).toMatch(/existing Worker deployment/i);
    expect((failure as Error).message).not.toContain('provider-output-must-not-leak');
    expect(createDriver).not.toHaveBeenCalled();
    expect(mint).not.toHaveBeenCalled();
    expect(stdout).not.toHaveBeenCalled();
    expect(runner.calls).toHaveLength(1);
    expect(runner.calls[0]!.args).toContain('deployments');
    expect(fileSystem.createdSnapshots).toHaveLength(1);
    expect(fileSystem.removedSnapshots).toEqual(fileSystem.createdSnapshots);
  });

  it.each([
    ['environment', rapidApiArgs({ environment: 'test' })],
    ['vertical', rapidApiArgs({ vertical: 'plumbing' })],
  ])('refuses a RapidAPI manifest with the wrong %s before opening the database', async (_name, args) => {
    const fileSystem = new FakeFileSystem();
    fileSystem.regularFiles.add(EDGE_CONFIG);
    const createDriver = vi.fn();
    const mint = vi.fn(async () => minted());
    const runner = new FakeRunner();

    await expect(
      runCredentialProvisioningCli(args, {
        env: { POSTGRES_URL },
        createDriver,
        mintApiKey: mint,
        fileSystem,
        runner,
        wranglerCommand: WRANGLER_COMMAND,
        now: () => NOW,
        writeStdout: vi.fn(),
      }),
    ).rejects.toThrow(/scope|manifest/i);

    expect(createDriver).not.toHaveBeenCalled();
    expect(mint).not.toHaveBeenCalled();
    expect(runner.calls).toEqual([]);
    expect(fileSystem.validationCalls).toEqual([
      {
        kind: 'wrangler',
        path: EDGE_CONFIG,
        environment: args[1],
        verticalSlug: args[7],
      },
    ]);
  });

  it('reads only POSTGRES_URL, closes the driver, and emits only non-secret metadata', async () => {
    const driver = await migratedDriver();
    openDrivers.delete(driver);
    const close = vi.spyOn(driver, 'close');
    const stdout: string[] = [];
    const fileSystem = new FakeFileSystem();
    let openedWith = '';
    let openedOptions: unknown;

    const result = await runCredentialProvisioningCli(DIRECT_ARGS, {
      env: { POSTGRES_URL },
      createDriver: async (connectionString, options) => {
        openedWith = connectionString;
        openedOptions = options;
        return driver;
      },
      mintApiKey: async () => minted(),
      fileSystem,
      runner: new FakeRunner(),
      wranglerCommand: WRANGLER_COMMAND,
      now: () => NOW,
      writeStdout: (text) => stdout.push(text),
    });

    expect(openedWith).toBe(POSTGRES_URL);
    expect(openedOptions).toEqual({ schema: 'data_foundry' });
    expect(close).toHaveBeenCalledOnce();
    expect(result.credentialAction).toBe('CREATED');
    const output = stdout.join('');
    expect(output).toContain(result.credentialId!);
    expect(output).toContain(PREFIX);
    expect(JSON.parse(output)).toMatchObject({ delivery: { path: DIRECT_OUTPUT } });
    expect(output).not.toContain(SECRET);
    expect(output).not.toContain(POSTGRES_URL);
    expect(output).not.toContain('do-not-print');
  });

  it('fails closed without POSTGRES_URL before minting or touching delivery', async () => {
    const mint = vi.fn(async () => minted());
    const createDriver = vi.fn();
    const fileSystem = new FakeFileSystem();
    await expect(
      runCredentialProvisioningCli(DIRECT_ARGS, {
        env: {},
        createDriver,
        mintApiKey: mint,
        fileSystem,
        runner: new FakeRunner(),
        wranglerCommand: WRANGLER_COMMAND,
        now: () => NOW,
        writeStdout: vi.fn(),
      }),
    ).rejects.toThrow(/POSTGRES_URL/);
    expect(createDriver).not.toHaveBeenCalled();
    expect(mint).not.toHaveBeenCalled();
    expect(fileSystem.written.size).toBe(0);
  });
});
