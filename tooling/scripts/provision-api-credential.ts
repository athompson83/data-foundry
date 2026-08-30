/**
 * Provision one fail-closed, one-vertical Data Foundry credential.
 *
 * The plaintext key exists only in memory between minting and its one selected
 * delivery boundary. It is never accepted as an argument, written to the
 * database, or sent to stdout/stderr. Production connections come only from
 * POSTGRES_URL so a connection string cannot enter shell history through this
 * command's argv.
 */
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { lstat, open, realpath, stat, unlink } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  apiKeyPrefix,
  hashApiKey,
  isApiAccessClassification,
  looksLikeApiKey,
  mintApiKey as mintApiKeyDefault,
  type ApiAccessTier,
  type ApiBillingSource,
  type KeyEnvironment,
  type MintedApiKey,
} from '@data-foundry/api-keys';
import {
  createPostgresDriver,
  type SqlDriver,
  type SqlTransactionExecutor,
} from '@data-foundry/canonical-store';
import {
  canonicalizeEndpointHostname,
  isUnsafeCanonicalProductionHostname,
  parseCanonicalProductionWorkerRoute,
} from '@data-foundry/canonical-schema';
import { parse as parseToml } from 'smol-toml';
import { isMain } from '../lib/cli-entry.js';

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const TOKEN_HASH = /^[0-9a-f]{64}$/;
const CLOUDFLARE_ID = /^[0-9a-f]{32}$/;
const ALLOWED_VERTICAL_STATUSES = new Set(['DRAFT', 'ACTIVE']);
const FILE_MODE = 0o600;
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const EDGE_PRODUCTION_CONFIG = resolve(REPO_ROOT, 'apps', 'edge', 'wrangler.production.toml');
const WRANGLER_ENTRYPOINT = resolve(
  REPO_ROOT,
  'node_modules',
  'wrangler',
  'bin',
  'wrangler.js',
);
const WRANGLER_EMPTY_ENV_FILE = resolve(REPO_ROOT, 'tooling', 'wrangler-empty.env');
const WRANGLER_STDOUT_LIMIT_BYTES = 1024 * 1024;
const WRANGLER_OS_ENVIRONMENT_KEYS = [
  'HOME',
  'USERPROFILE',
  'SystemRoot',
  'SYSTEMROOT',
  'WINDIR',
  'TEMP',
  'TMP',
  'TMPDIR',
  'LANG',
  'LC_ALL',
] as const;

export class CredentialProvisioningError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CredentialProvisioningError';
  }
}

export interface CredentialFileSystem {
  assertNewOutputPath(path: string): Promise<void>;
  createValidatedWranglerConfigSnapshot(
    path: string,
    scope: WranglerManifestScope,
    expectedAccountId: string,
  ): Promise<string>;
  removeWranglerConfigSnapshot(path: string): Promise<void>;
  writeNewRestrictedFile(path: string, contents: string, mode: number): Promise<void>;
  removeNewFile(path: string): Promise<void>;
}

export interface WranglerProcessResult {
  readonly exitCode: number;
  readonly stdout: string;
}

export interface CredentialProcessRunner {
  run(
    executable: string,
    args: readonly string[],
    stdin: string,
    env: Readonly<Record<string, string>>,
  ): Promise<WranglerProcessResult>;
}

export interface WranglerCommand {
  readonly executable: string;
  readonly argsPrefix: readonly string[];
}

export interface WranglerManifestScope {
  readonly environment: KeyEnvironment;
  readonly verticalSlug: string;
}

type FileDelivery = { readonly kind: 'FILE'; readonly path: string };
type WranglerDelivery = {
  readonly kind: 'WRANGLER';
  readonly secretName: 'RAPIDAPI_API_KEY';
  readonly configPath: string;
};
type NoDelivery = { readonly kind: 'NONE' };

export interface CredentialProvisioningOptions {
  readonly environment: KeyEnvironment;
  readonly tenantSlug: string;
  readonly tenantName: string;
  readonly verticalSlug: string;
  readonly credentialLabel: string;
  readonly accessTier: Extract<ApiAccessTier, 'API_PAID' | 'RAPIDAPI' | 'MCP'>;
  readonly billingSource: ApiBillingSource;
  readonly existingCredentialId: string | null;
  readonly cloudflareAccountId: string | null;
  readonly delivery: FileDelivery | WranglerDelivery | NoDelivery;
  readonly dryRun: boolean;
}

export interface ProvisioningDependencies {
  readonly mintApiKey: (environment: KeyEnvironment) => Promise<MintedApiKey>;
  readonly fileSystem: CredentialFileSystem;
  readonly runner: CredentialProcessRunner;
  readonly wranglerCommand: WranglerCommand;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly now: () => Date;
}

type TenantAction = 'CREATED' | 'UPDATED' | 'UNCHANGED' | 'WOULD_CREATE' | 'WOULD_UPDATE';
type CredentialAction = 'CREATED' | 'CLASSIFIED' | 'UNCHANGED' | 'WOULD_CREATE' | 'WOULD_CLASSIFY';

export interface CredentialProvisioningResult {
  readonly tenantAction: TenantAction;
  readonly credentialAction: CredentialAction;
  readonly dryRun: boolean;
  readonly environment: KeyEnvironment;
  readonly tenantSlug: string;
  readonly verticalSlug: string;
  readonly accessTier: CredentialProvisioningOptions['accessTier'];
  readonly billingSource: ApiBillingSource;
  readonly credentialId?: string;
  readonly prefix?: string;
  readonly fingerprint?: string;
  readonly delivery: FileDelivery | WranglerDelivery | NoDelivery;
}

interface VerticalRow extends Record<string, unknown> {
  readonly id: string;
  readonly status: string;
}

interface TenantRow extends Record<string, unknown> {
  readonly id: string;
  readonly name: string;
  readonly status: string;
}

interface CredentialRow extends Record<string, unknown> {
  readonly id: string;
  readonly token_hash: string;
  readonly token_prefix: string;
  readonly access_tier: string | null;
  readonly billing_source: string | null;
  readonly revoked_at: string | null;
  readonly expires_at: string | null;
}

function takeValue(args: readonly string[], index: number, option: string): string {
  const value = args[index + 1];
  if (value === undefined || value.startsWith('--')) {
    throw new CredentialProvisioningError(`${option} requires a value`);
  }
  return value;
}

function nonSecretText(value: string | undefined, option: string, maxLength: number): string {
  if (
    value === undefined ||
    value.trim() === '' ||
    value.length > maxLength ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new CredentialProvisioningError(`${option} must be non-empty printable text`);
  }
  return value;
}

function explicitPath(value: string | undefined, option: string): string {
  if (value === undefined || value.trim() === '' || value.includes('\0')) {
    throw new CredentialProvisioningError(`${option} requires an explicit path`);
  }
  return value;
}

function pathIsWithin(parent: string, candidate: string): boolean {
  const difference = relative(parent, candidate);
  return difference === '' || (!difference.startsWith(`..${sep}`) && difference !== '..' && !isAbsolute(difference));
}

function secureOutputPath(value: string | undefined): string {
  const selected = explicitPath(value, '--output');
  if (!isAbsolute(selected)) {
    throw new CredentialProvisioningError('--output must be an absolute path');
  }
  const resolved = resolve(selected);
  if (pathIsWithin(REPO_ROOT, resolved)) {
    throw new CredentialProvisioningError('--output must be outside the Data Foundry git worktree');
  }
  return resolved;
}

function edgeProductionConfig(value: string | undefined): string {
  const selected = explicitPath(value, '--wrangler-config');
  const resolved = resolve(selected);
  const samePath =
    process.platform === 'win32'
      ? resolved.toLocaleLowerCase('en-US') === EDGE_PRODUCTION_CONFIG.toLocaleLowerCase('en-US')
      : resolved === EDGE_PRODUCTION_CONFIG;
  if (!samePath) {
    throw new CredentialProvisioningError(
      '--wrangler-config must select apps/edge/wrangler.production.toml',
    );
  }
  return EDGE_PRODUCTION_CONFIG;
}

/** Parse a deliberately closed CLI vocabulary without ever echoing a value. */
export function parseCredentialProvisioningArgs(
  rawArgs: readonly string[],
): CredentialProvisioningOptions {
  if (rawArgs.some((argument) => /df_(?:live|test)_[A-Za-z0-9_-]{43}/.test(argument))) {
    throw new CredentialProvisioningError('plaintext API key material is forbidden on argv');
  }
  const values = new Map<string, string>();
  let dryRun = false;
  const args = rawArgs[0] === '--' ? rawArgs.slice(1) : rawArgs;
  const valueOptions = new Set([
    '--environment',
    '--tenant-slug',
    '--tenant-name',
    '--vertical',
    '--credential-label',
    '--access-tier',
    '--billing-source',
    '--output',
    '--wrangler-secret',
    '--wrangler-config',
    '--cloudflare-account-id',
    '--classify-existing',
  ]);

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    if (argument === '--dry-run') {
      if (dryRun) throw new CredentialProvisioningError('--dry-run may be supplied only once');
      dryRun = true;
      continue;
    }
    if (!valueOptions.has(argument)) {
      throw new CredentialProvisioningError('unknown credential provisioning option');
    }
    if (values.has(argument)) {
      throw new CredentialProvisioningError(`${argument} may be supplied only once`);
    }
    values.set(argument, takeValue(args, index, argument));
    index += 1;
  }

  const environment = values.get('--environment');
  if (environment !== 'live' && environment !== 'test') {
    throw new CredentialProvisioningError('--environment must be live or test');
  }

  const tenantSlug = values.get('--tenant-slug');
  if (tenantSlug === undefined || tenantSlug.length > 64 || !SLUG.test(tenantSlug)) {
    throw new CredentialProvisioningError('--tenant-slug must be a lowercase hyphenated slug');
  }
  const verticalSlug = values.get('--vertical');
  if (verticalSlug === undefined || verticalSlug.length > 64 || !SLUG.test(verticalSlug)) {
    throw new CredentialProvisioningError('--vertical must be a lowercase hyphenated slug');
  }
  const tenantName = nonSecretText(values.get('--tenant-name'), '--tenant-name', 200);
  const credentialLabel = nonSecretText(
    values.get('--credential-label'),
    '--credential-label',
    200,
  );

  const accessTier = values.get('--access-tier');
  const billingSource = values.get('--billing-source');
  const classification = { accessTier, billingSource };
  if (
    !isApiAccessClassification(classification) ||
    !(
      (accessTier === 'API_PAID' && billingSource === 'DIRECT') ||
      (accessTier === 'RAPIDAPI' && billingSource === 'RAPIDAPI') ||
      (accessTier === 'MCP' && billingSource === 'NONE')
    )
  ) {
    throw new CredentialProvisioningError(
      'classification must be API_PAID/DIRECT, RAPIDAPI/RAPIDAPI, or MCP/NONE',
    );
  }

  const existingCredentialId = values.get('--classify-existing') ?? null;
  if (existingCredentialId !== null && !UUID.test(existingCredentialId)) {
    throw new CredentialProvisioningError('--classify-existing must be a canonical UUID');
  }

  const output = values.get('--output');
  const wranglerSecret = values.get('--wrangler-secret');
  const wranglerConfig = values.get('--wrangler-config');
  const cloudflareAccountId = values.get('--cloudflare-account-id');
  let delivery: CredentialProvisioningOptions['delivery'];
  if (existingCredentialId !== null) {
    if (
      output !== undefined ||
      wranglerSecret !== undefined ||
      wranglerConfig !== undefined ||
      cloudflareAccountId !== undefined
    ) {
      throw new CredentialProvisioningError(
        'classification-only mode does not accept a credential delivery target',
      );
    }
    delivery = { kind: 'NONE' };
  } else if (accessTier === 'RAPIDAPI') {
    if (output !== undefined) {
      throw new CredentialProvisioningError('RAPIDAPI requires Wrangler delivery');
    }
    if (wranglerSecret !== 'RAPIDAPI_API_KEY') {
      throw new CredentialProvisioningError(
        '--wrangler-secret must be RAPIDAPI_API_KEY for RAPIDAPI delivery',
      );
    }
    if (
      cloudflareAccountId === undefined ||
      !CLOUDFLARE_ID.test(cloudflareAccountId) ||
      /^0{32}$/.test(cloudflareAccountId)
    ) {
      throw new CredentialProvisioningError(
        '--cloudflare-account-id must be an explicit non-zero lowercase 32-hex id for Wrangler delivery',
      );
    }
    delivery = {
      kind: 'WRANGLER',
      secretName: 'RAPIDAPI_API_KEY',
      configPath: edgeProductionConfig(wranglerConfig),
    };
  } else {
    if (
      wranglerSecret !== undefined ||
      wranglerConfig !== undefined ||
      cloudflareAccountId !== undefined
    ) {
      throw new CredentialProvisioningError('this classification requires file delivery');
    }
    delivery = { kind: 'FILE', path: secureOutputPath(output) };
  }

  return {
    environment,
    tenantSlug,
    tenantName,
    verticalSlug,
    credentialLabel,
    accessTier,
    billingSource,
    existingCredentialId,
    cloudflareAccountId: cloudflareAccountId ?? null,
    delivery,
    dryRun,
  };
}

function fingerprint(tokenHash: string): string {
  return `sha256:${tokenHash.slice(0, 16)}`;
}

function metadataResult(
  options: CredentialProvisioningOptions,
  tenantAction: TenantAction,
  credentialAction: CredentialAction,
  row: Pick<CredentialRow, 'id' | 'token_hash' | 'token_prefix'> | null,
  delivery: CredentialProvisioningResult['delivery'],
): CredentialProvisioningResult {
  const base = {
    tenantAction,
    credentialAction,
    dryRun: options.dryRun,
    environment: options.environment,
    tenantSlug: options.tenantSlug,
    verticalSlug: options.verticalSlug,
    accessTier: options.accessTier,
    billingSource: options.billingSource,
    delivery,
  } as const;
  if (row === null) return base;
  return {
    ...base,
    credentialId: row.id,
    prefix: row.token_prefix,
    fingerprint: fingerprint(row.token_hash),
  };
}

function assertExistingCredentialUsable(
  row: CredentialRow,
  options: CredentialProvisioningOptions,
  now: Date,
): void {
  if (!row.token_prefix.startsWith(`df_${options.environment}_`)) {
    throw new CredentialProvisioningError('existing credential belongs to another environment');
  }
  if (!TOKEN_HASH.test(row.token_hash)) {
    throw new CredentialProvisioningError('existing credential hash is malformed');
  }
  if (row.revoked_at !== null) {
    throw new CredentialProvisioningError('existing credential is revoked; issue a new label');
  }
  if (row.expires_at !== null && new Date(row.expires_at).getTime() <= now.getTime()) {
    throw new CredentialProvisioningError('existing credential is expired; issue a new label');
  }
}

async function validateDeliveryTarget(
  options: CredentialProvisioningOptions,
  fileSystem: CredentialFileSystem,
): Promise<void> {
  const delivery = options.delivery;
  if (delivery.kind === 'FILE') await fileSystem.assertNewOutputPath(delivery.path);
}

function wranglerEnvironment(
  options: CredentialProvisioningOptions,
  dependencies: ProvisioningDependencies,
): Readonly<Record<string, string>> {
  if (options.cloudflareAccountId === null) {
    throw new CredentialProvisioningError(
      'Wrangler delivery requires an explicit Cloudflare account id',
    );
  }
  return {
    ...buildWranglerEnvironment(dependencies.env ?? {}),
    CLOUDFLARE_ACCOUNT_ID: options.cloudflareAccountId,
  };
}

async function prepareWranglerAttempt(
  options: CredentialProvisioningOptions,
  dependencies: ProvisioningDependencies,
): Promise<string | null> {
  if (options.delivery.kind !== 'WRANGLER') return null;
  if (options.cloudflareAccountId === null) {
    throw new CredentialProvisioningError(
      'Wrangler delivery requires an explicit Cloudflare account id',
    );
  }

  let snapshotPath: string | null = null;
  try {
    snapshotPath = await dependencies.fileSystem.createValidatedWranglerConfigSnapshot(
      options.delivery.configPath,
      { environment: options.environment, verticalSlug: options.verticalSlug },
      options.cloudflareAccountId,
    );
    let result: WranglerProcessResult;
    try {
      result = await dependencies.runner.run(
        dependencies.wranglerCommand.executable,
        [
          ...dependencies.wranglerCommand.argsPrefix,
          'deployments',
          'list',
          '--json',
          '--config',
          snapshotPath,
          '--env-file',
          WRANGLER_EMPTY_ENV_FILE,
        ],
        '',
        wranglerEnvironment(options, dependencies),
      );
    } catch {
      throw new CredentialProvisioningError(
        'cannot confirm an existing Worker deployment for the validated Wrangler manifest',
      );
    }

    let deployments: unknown;
    try {
      deployments = JSON.parse(result.stdout) as unknown;
    } catch {
      deployments = null;
    }
    if (result.exitCode !== 0 || !Array.isArray(deployments) || deployments.length === 0) {
      throw new CredentialProvisioningError(
        'cannot confirm an existing Worker deployment for the validated Wrangler manifest',
      );
    }
    return snapshotPath;
  } catch (error) {
    if (snapshotPath !== null) {
      await dependencies.fileSystem.removeWranglerConfigSnapshot(snapshotPath);
    }
    throw error;
  }
}

async function findCredentials(
  tx: SqlTransactionExecutor,
  options: CredentialProvisioningOptions,
  tenantId: string,
  verticalId: string,
): Promise<CredentialRow[]> {
  if (options.existingCredentialId !== null) {
    return tx.query<CredentialRow>(
      `SELECT id, token_hash, token_prefix, access_tier, billing_source,
              revoked_at, expires_at
         FROM api_keys
        WHERE id = $1
          AND tenant_id = $2
          AND vertical_id = $3
          AND label = $4
        FOR UPDATE`,
      [options.existingCredentialId, tenantId, verticalId, options.credentialLabel],
    );
  }
  return tx.query<CredentialRow>(
    `SELECT id, token_hash, token_prefix, access_tier, billing_source,
            revoked_at, expires_at
       FROM api_keys
      WHERE tenant_id = $1 AND vertical_id = $2 AND label = $3
      ORDER BY created_at, id
      FOR UPDATE`,
    [tenantId, verticalId, options.credentialLabel],
  );
}

/**
 * Database and delivery orchestration. File delivery is last inside the
 * transaction and is removed if commit fails. Wrangler delivery begins only
 * after commit so a database failure cannot overwrite a working provider value.
 */
async function provisionApiCredentialPrepared(
  driver: SqlDriver,
  options: CredentialProvisioningOptions,
  dependencies: ProvisioningDependencies,
  wranglerSnapshotPath: string | null,
): Promise<CredentialProvisioningResult> {
  let deliveredFile: string | null = null;
  try {
    const outcome = await driver.transaction(async (tx) => {
      const complete = (
        result: CredentialProvisioningResult,
      ): {
        readonly result: CredentialProvisioningResult;
        readonly pendingWrangler: null;
      } => ({ result, pendingWrangler: null });
      // Every issuance acquires the tenant identity first, then the narrower
      // credential identity. The fixed order prevents two first-time labels
      // for one tenant racing the unique tenant slug (or deadlocking by taking
      // the same locks in opposite order).
      await tx.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
        `data-foundry:tenant:${options.tenantSlug}`,
      ]);
      await tx.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
        `data-foundry:credential:${options.tenantSlug}:${options.verticalSlug}:${options.credentialLabel}`,
      ]);

      const verticals = await tx.query<VerticalRow>(
        `SELECT id, status FROM verticals WHERE slug = $1 FOR UPDATE`,
        [options.verticalSlug],
      );
      const vertical = verticals[0];
      if (vertical === undefined) {
        throw new CredentialProvisioningError('the selected vertical does not exist');
      }
      if (!ALLOWED_VERTICAL_STATUSES.has(vertical.status)) {
        throw new CredentialProvisioningError(
          'the selected vertical is not DRAFT or ACTIVE; credential issuance is refused',
        );
      }

      const tenants = await tx.query<TenantRow>(
        `SELECT id, name, status FROM api_tenants WHERE slug = $1 FOR UPDATE`,
        [options.tenantSlug],
      );
      let tenant = tenants[0];
      let tenantAction: TenantAction;
      if (tenant === undefined) {
        if (options.existingCredentialId !== null) {
          throw new CredentialProvisioningError(
            'classification-only mode requires the existing active tenant',
          );
        }
        if (options.dryRun) {
          if (options.delivery.kind === 'FILE') {
            await validateDeliveryTarget(options, dependencies.fileSystem);
          }
          return complete(
            metadataResult(options, 'WOULD_CREATE', 'WOULD_CREATE', null, options.delivery),
          );
        }
        const inserted = await tx.query<TenantRow>(
          `INSERT INTO api_tenants (slug, name, status)
           VALUES ($1, $2, 'ACTIVE')
           RETURNING id, name, status`,
          [options.tenantSlug, options.tenantName],
        );
        tenant = inserted[0];
        if (tenant === undefined) {
          throw new CredentialProvisioningError('tenant provisioning returned no row');
        }
        tenantAction = 'CREATED';
      } else {
        if (tenant.status !== 'ACTIVE') {
          throw new CredentialProvisioningError('the existing tenant is not ACTIVE');
        }
        if (tenant.name === options.tenantName) {
          tenantAction = 'UNCHANGED';
        } else if (options.dryRun) {
          tenantAction = 'WOULD_UPDATE';
        } else {
          const updated = await tx.query<TenantRow>(
            `UPDATE api_tenants
                SET name = $2, updated_at = now()
              WHERE id = $1
              RETURNING id, name, status`,
            [tenant.id, options.tenantName],
          );
          tenant = updated[0];
          if (tenant === undefined) {
            throw new CredentialProvisioningError('tenant update returned no row');
          }
          tenantAction = 'UPDATED';
        }
      }

      const existingRows = await findCredentials(tx, options, tenant.id, vertical.id);
      if (existingRows.length > 1) {
        throw new CredentialProvisioningError(
          'credential label is ambiguous for this tenant and vertical',
        );
      }
      const existing = existingRows[0];
      if (options.existingCredentialId !== null && existing === undefined) {
        throw new CredentialProvisioningError(
          'the explicitly selected existing credential does not match tenant, vertical, and label',
        );
      }

      if (existing !== undefined) {
        assertExistingCredentialUsable(existing, options, dependencies.now());
        const current = {
          accessTier: existing.access_tier,
          billingSource: existing.billing_source,
        };
        if (isApiAccessClassification(current)) {
          if (
            current.accessTier !== options.accessTier ||
            current.billingSource !== options.billingSource
          ) {
            throw new CredentialProvisioningError(
              'existing credential classification differs and is immutable; issue a new label',
            );
          }
          return complete(
            metadataResult(options, tenantAction, 'UNCHANGED', existing, { kind: 'NONE' }),
          );
        }
        if (existing.access_tier !== null || existing.billing_source !== null) {
          throw new CredentialProvisioningError('existing credential classification is malformed');
        }
        if (options.existingCredentialId === null) {
          throw new CredentialProvisioningError(
            'a quarantined credential requires explicit --classify-existing selection',
          );
        }
        if (options.dryRun) {
          return complete(
            metadataResult(options, tenantAction, 'WOULD_CLASSIFY', existing, { kind: 'NONE' }),
          );
        }
        const classified = await tx.query<CredentialRow>(
          `UPDATE api_keys
              SET access_tier = $2, billing_source = $3
            WHERE id = $1
            RETURNING id, token_hash, token_prefix, access_tier, billing_source,
                      revoked_at, expires_at`,
          [existing.id, options.accessTier, options.billingSource],
        );
        const row = classified[0];
        if (row === undefined) {
          throw new CredentialProvisioningError('credential classification returned no row');
        }
        return complete(
          metadataResult(options, tenantAction, 'CLASSIFIED', row, { kind: 'NONE' }),
        );
      }

      if (options.existingCredentialId !== null) {
        throw new CredentialProvisioningError('the explicitly selected credential does not exist');
      }
      if (options.delivery.kind === 'FILE') {
        await validateDeliveryTarget(options, dependencies.fileSystem);
      }
      if (options.dryRun) {
        return complete(
          metadataResult(options, tenantAction, 'WOULD_CREATE', null, options.delivery),
        );
      }

      const key = await dependencies.mintApiKey(options.environment);
      if (
        key.environment !== options.environment ||
        !looksLikeApiKey(key.secret) ||
        !key.secret.startsWith(`df_${options.environment}_`) ||
        !TOKEN_HASH.test(key.tokenHash) ||
        key.tokenHash !== (await hashApiKey(key.secret)) ||
        key.tokenPrefix !== apiKeyPrefix(key.secret)
      ) {
        throw new CredentialProvisioningError('credential mint returned an invalid key');
      }

      const inserted = await tx.query<CredentialRow>(
        `INSERT INTO api_keys
           (tenant_id, vertical_id, token_hash, token_prefix, label,
            access_tier, billing_source)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, token_hash, token_prefix, access_tier, billing_source,
                   revoked_at, expires_at`,
        [
          tenant.id,
          vertical.id,
          key.tokenHash,
          key.tokenPrefix,
          options.credentialLabel,
          options.accessTier,
          options.billingSource,
        ],
      );
      const row = inserted[0];
      if (row === undefined) {
        throw new CredentialProvisioningError('credential provisioning returned no row');
      }
      const safeMetadata = metadataResult(options, tenantAction, 'CREATED', row, options.delivery);

      if (options.delivery.kind === 'FILE') {
        const contents = `${JSON.stringify(
          {
            credential: key.secret,
            credentialId: row.id,
            environment: options.environment,
            tenantSlug: options.tenantSlug,
            verticalSlug: options.verticalSlug,
            accessTier: options.accessTier,
            billingSource: options.billingSource,
            prefix: row.token_prefix,
            fingerprint: fingerprint(row.token_hash),
          },
          null,
          2,
        )}\n`;
        await dependencies.fileSystem.writeNewRestrictedFile(
          options.delivery.path,
          contents,
          FILE_MODE,
        );
        deliveredFile = options.delivery.path;
      } else if (options.delivery.kind === 'WRANGLER') {
        // Do not overwrite a working Cloudflare secret before the database row
        // commits. Delivery happens immediately after this transaction. An
        // unconfirmed delivery is compensated by revoking the new key. A
        // provider/network failure can be ambiguous after receipt, so recovery
        // must verify and replace the Worker secret before traffic resumes.
        return {
          result: safeMetadata,
          pendingWrangler: {
            credentialId: row.id,
            secret: key.secret,
            delivery: options.delivery,
          },
        };
      }
      return complete(safeMetadata);
    });

    if (outcome.pendingWrangler !== null) {
      let exitCode: number;
      try {
        if (wranglerSnapshotPath === null) {
          throw new CredentialProvisioningError('Wrangler delivery was not safely preflighted');
        }
        const processResult = await dependencies.runner.run(
          dependencies.wranglerCommand.executable,
          [
            ...dependencies.wranglerCommand.argsPrefix,
            'secret',
            'put',
            outcome.pendingWrangler.delivery.secretName,
            '--config',
            wranglerSnapshotPath,
            // Supplying an explicit file replaces Wrangler's implicit
            // .env/.env.local search, so the allowlisted child environment
            // cannot be repopulated from the caller's working directory.
            '--env-file',
            WRANGLER_EMPTY_ENV_FILE,
          ],
          `${outcome.pendingWrangler.secret}\n`,
          wranglerEnvironment(options, dependencies),
        );
        exitCode = processResult.exitCode;
      } catch {
        exitCode = 1;
      }
      if (exitCode !== 0) {
        try {
          await driver.transaction(async (tx) => {
            const revoked = await tx.query<{ readonly id: string } & Record<string, unknown>>(
              `UPDATE api_keys
                  SET revoked_at = now()
                WHERE id = $1 AND revoked_at IS NULL
                RETURNING id`,
              [outcome.pendingWrangler.credentialId],
            );
            if (revoked.length !== 1) throw new Error('revocation did not affect one row');
          });
        } catch {
          throw new CredentialProvisioningError(
            `CRITICAL: Wrangler delivery failed and credential ${outcome.pendingWrangler.credentialId} could not be revoked; revoke that credential before retrying`,
          );
        }
        throw new CredentialProvisioningError(
          'Wrangler did not confirm secret delivery; the newly committed credential was revoked, and the Worker secret must be verified and replaced before traffic resumes',
        );
      }
    }
    return outcome.result;
  } catch (error) {
    if (deliveredFile !== null) {
      try {
        await dependencies.fileSystem.removeNewFile(deliveredFile);
      } catch {
        throw new CredentialProvisioningError(
          'CRITICAL: database commit failed and the uncommitted plaintext credential file could not be removed; securely remove the selected output path before retrying',
        );
      }
    }
    throw error;
  }
}

/**
 * Programmatic provisioning entrypoint. Wrangler delivery validates and
 * snapshots the production manifest, proves an existing deployment, and only
 * then opens the database transaction. The same immutable snapshot is retained
 * until secret delivery finishes and is removed on every exit path.
 */
export async function provisionApiCredential(
  driver: SqlDriver,
  options: CredentialProvisioningOptions,
  dependencies: ProvisioningDependencies,
): Promise<CredentialProvisioningResult> {
  const snapshotPath = await prepareWranglerAttempt(options, dependencies);
  try {
    return await provisionApiCredentialPrepared(driver, options, dependencies, snapshotPath);
  } finally {
    if (snapshotPath !== null) {
      await dependencies.fileSystem.removeWranglerConfigSnapshot(snapshotPath);
    }
  }
}

function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { readonly code?: unknown }).code)
    : undefined;
}

/**
 * Prove cleanup after a failed snapshot create/write without exposing the
 * manifest, provider output, or host error details. Both operations are
 * attempted so unlink can still succeed after an uncertain close.
 */
export async function cleanupFailedWranglerSnapshot(
  snapshotPath: string | null,
  closeSnapshot: (() => Promise<void>) | null,
  removeSnapshot: (path: string) => Promise<void> = unlink,
): Promise<void> {
  let cleanupUnconfirmed = false;
  if (closeSnapshot !== null) {
    try {
      await closeSnapshot();
    } catch {
      cleanupUnconfirmed = true;
    }
  }
  if (snapshotPath !== null) {
    try {
      await removeSnapshot(snapshotPath);
    } catch (error) {
      if (errorCode(error) !== 'ENOENT') cleanupUnconfirmed = true;
    }
  }
  if (cleanupUnconfirmed) {
    throw new CredentialProvisioningError(
      'CRITICAL: Wrangler snapshot cleanup could not be confirmed; securely remove the temporary credential snapshot beside the canonical production manifest before retrying',
    );
  }
}

export interface NodeCredentialFileSystemOptions {
  readonly platform: NodeJS.Platform;
  readonly workspaceRoot: string;
  readonly edgeProductionConfigPath?: string;
  readonly snapshotId?: () => string;
}

export function isSafeEdgeWranglerConfig(
  contents: string,
  expectedScope: WranglerManifestScope,
  expectedAccountId?: string,
): boolean {
  const object = (value: unknown): Record<string, unknown> =>
    value !== null && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const values = (value: unknown): string[] => {
    if (value === undefined || value === null) return [];
    if (typeof value === 'string') return [value];
    if (Array.isArray(value)) return value.flatMap(values);
    const candidate = object(value);
    return [candidate['pattern'], candidate['route']].flatMap(values);
  };
  const productionHostname = (value: unknown): string | null => {
    if (typeof value !== 'string') return null;
    const hostname = value;
    if (
      hostname === '' ||
      hostname !== hostname.trim() ||
      hostname !== canonicalizeEndpointHostname(hostname) ||
      isUnsafeCanonicalProductionHostname(hostname)
    ) {
      return null;
    }
    try {
      const parsed = new URL(`https://${hostname}`);
      return parsed.hostname === hostname &&
        parsed.port === '' &&
        parsed.pathname === '/' &&
        parsed.search === '' &&
        parsed.hash === ''
        ? hostname
        : null;
    } catch {
      return null;
    }
  };

  try {
    const config = object(parseToml(contents));
    const accountId = config['account_id'];
    const observabilityLogs = object(object(config['observability'])['logs']);
    const vars = object(config['vars']);
    const hyperdrive = Array.isArray(config['hyperdrive']) ? config['hyperdrive'].map(object) : [];
    const routes = [config['route'], config['routes']].flatMap(values);
    const parsedRoutes = routes.map((route) => parseCanonicalProductionWorkerRoute(route));
    const rapidApiHostname = vars['RAPIDAPI_HOSTNAME'] === undefined
      ? null
      : productionHostname(vars['RAPIDAPI_HOSTNAME']);
    const exactCloudflareId = (value: unknown): value is string =>
      typeof value === 'string' && /^[0-9a-f]{32}$/.test(value) && !/^0{32}$/.test(value);
    const protectedVar = Object.keys(vars).some((key) =>
      /(?:POSTGRES_URL|RAPIDAPI_API_KEY|RAPIDAPI_PROXY_SECRET|PASSWORD|TOKEN|SECRET)$/i.test(key),
    );
    return (
      config['name'] === 'data-foundry-edge' &&
      config['main'] === 'src/index.ts' &&
      config['workers_dev'] === false &&
      config['preview_urls'] === false &&
      observabilityLogs['invocation_logs'] === false &&
      vars['DEPLOYMENT_ENVIRONMENT'] === 'production' &&
      vars['API_KEY_ENVIRONMENT'] === 'live' &&
      vars['API_KEY_ENVIRONMENT'] === expectedScope.environment &&
      vars['VERTICAL_SLUG'] === expectedScope.verticalSlug &&
      rapidApiHostname !== null &&
      parsedRoutes.some((route) => route?.hostname === rapidApiHostname) &&
      exactCloudflareId(accountId) &&
      routes.length > 0 &&
      parsedRoutes.every((route) => route !== null) &&
      parsedRoutes.some((route) => route?.hostname === 'api.datafoundry.io') &&
      hyperdrive.some(
        (binding) =>
          binding['binding'] === 'HYPERDRIVE' &&
          exactCloudflareId(binding['id']),
      ) &&
      hyperdrive.every((binding) => exactCloudflareId(binding['id'])) &&
      (expectedAccountId === undefined || accountId === expectedAccountId) &&
      !protectedVar &&
      !/df_(?:live|test)_[A-Za-z0-9_-]{43}/.test(contents) &&
      !/postgres(?:ql)?:\/\//i.test(
        contents
          .split(/\r?\n/)
          .filter((line) => !line.trimStart().startsWith('#'))
          .join('\n'),
      )
    );
  } catch {
    return false;
  }
}

/** Node-backed delivery that fails closed where mode 0600 is not enforceable. */
export function createNodeCredentialFileSystem(
  options: NodeCredentialFileSystemOptions,
): CredentialFileSystem {
  const edgeProductionConfigPath = resolve(
    options.edgeProductionConfigPath ?? EDGE_PRODUCTION_CONFIG,
  );
  const requirePosixFileDelivery = (): void => {
    if (options.platform === 'win32') {
      throw new CredentialProvisioningError(
        'file delivery requires a POSIX Node runtime and filesystem (for example WSL); Windows chmod is not an owner-only ACL',
      );
    }
  };
  const assertCanonicalParentOutsideWorkspace = async (path: string): Promise<void> => {
    const [workspace, parent] = await Promise.all([
      realpath(options.workspaceRoot),
      realpath(dirname(path)),
    ]).catch(() => {
      throw new CredentialProvisioningError('the output parent directory does not exist');
    });
    if (pathIsWithin(workspace, parent)) {
      throw new CredentialProvisioningError(
        'the canonical output parent must be outside the Data Foundry git worktree',
      );
    }
  };

  return {
    async assertNewOutputPath(path) {
      requirePosixFileDelivery();
      await assertCanonicalParentOutsideWorkspace(path);
      try {
        await lstat(path);
        throw new CredentialProvisioningError('output path already exists; refusing to overwrite it');
      } catch (error) {
        if (error instanceof CredentialProvisioningError) throw error;
        if (errorCode(error) !== 'ENOENT') {
          throw new CredentialProvisioningError('cannot validate the selected output path');
        }
      }
    },

    async createValidatedWranglerConfigSnapshot(path, scope, expectedAccountId) {
      let snapshotPath: string | null = null;
      let snapshotHandle: Awaited<ReturnType<typeof open>> | null = null;
      let snapshotCreated = false;
      try {
        const [selected, expected] = await Promise.all([
          realpath(path),
          realpath(edgeProductionConfigPath),
        ]);
        const samePath = options.platform === 'win32'
          ? selected.toLocaleLowerCase('en-US') === expected.toLocaleLowerCase('en-US')
          : selected === expected;
        if (!samePath) throw new Error('wrong file');

        const sourceHandle = await open(path, fsConstants.O_RDONLY);
        let exactBytes: Buffer;
        try {
          if (!(await sourceHandle.stat()).isFile()) throw new Error('wrong file');
          exactBytes = await sourceHandle.readFile();
        } finally {
          await sourceHandle.close();
        }
        if (!isSafeEdgeWranglerConfig(exactBytes.toString('utf8'), scope, expectedAccountId)) {
          throw new Error('unsafe manifest');
        }

        const snapshotId = (options.snapshotId ?? randomUUID)();
        if (!UUID.test(snapshotId)) throw new Error('invalid snapshot id');
        snapshotPath = resolve(
          dirname(edgeProductionConfigPath),
          `.wrangler-credential-snapshot-${snapshotId}.toml`,
        );
        snapshotHandle = await open(
          snapshotPath,
          fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY,
          FILE_MODE,
        );
        snapshotCreated = true;
        await snapshotHandle.writeFile(exactBytes);
        await snapshotHandle.sync();
        await snapshotHandle.close();
        snapshotHandle = null;
        return snapshotPath;
      } catch {
        const handleToClose = snapshotHandle;
        await cleanupFailedWranglerSnapshot(
          snapshotCreated ? snapshotPath : null,
          !snapshotCreated || handleToClose === null ? null : () => handleToClose.close(),
        );
        throw new CredentialProvisioningError(
          'the selected Wrangler config is not the fail-closed edge production manifest',
        );
      }
    },

    async removeWranglerConfigSnapshot(path) {
      const expectedParent = dirname(edgeProductionConfigPath);
      const selectedParent = dirname(resolve(path));
      const sameParent = options.platform === 'win32'
        ? selectedParent.toLocaleLowerCase('en-US') === expectedParent.toLocaleLowerCase('en-US')
        : selectedParent === expectedParent;
      if (
        !sameParent ||
        !/^\.wrangler-credential-snapshot-[0-9a-f-]+\.toml$/.test(path.split(/[\\/]/).at(-1) ?? '')
      ) {
        throw new CredentialProvisioningError('refusing to remove an unrecognized Wrangler snapshot');
      }
      try {
        await unlink(path);
      } catch (error) {
        if (errorCode(error) !== 'ENOENT') {
          throw new CredentialProvisioningError('cannot remove the Wrangler config snapshot');
        }
      }
    },

    async writeNewRestrictedFile(path, contents, mode) {
      requirePosixFileDelivery();
      await assertCanonicalParentOutsideWorkspace(path);
      let handle: Awaited<ReturnType<typeof open>> | null = null;
      let created = false;
      try {
        const flags = fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY;
        handle = await open(path, flags, mode);
        created = true;
        await handle.chmod(mode);
        if (((await handle.stat()).mode & 0o077) !== 0) {
          throw new Error('permissions are not restrictive');
        }
        // The secret is written only after owner-only permissions are proved.
        await handle.writeFile(contents, { encoding: 'utf8' });
        await handle.sync();
        await handle.close();
        handle = null;
      } catch (error) {
        if (handle !== null) await handle.close().catch(() => undefined);
        if (created) {
          try {
            await unlink(path);
          } catch (cleanupError) {
            if (errorCode(cleanupError) !== 'ENOENT') {
              throw new CredentialProvisioningError(
                'CRITICAL: a failed credential-file write could not be removed; securely remove the selected output path before retrying',
              );
            }
          }
        }
        if (!created && errorCode(error) === 'EEXIST') {
          throw new CredentialProvisioningError(
            'output path already exists; refusing to overwrite it',
          );
        }
        throw new CredentialProvisioningError(
          'cannot create a new credential file with restrictive permissions',
        );
      }
    },

    async removeNewFile(path) {
      try {
        await unlink(path);
      } catch (error) {
        if (errorCode(error) !== 'ENOENT') {
          throw new CredentialProvisioningError('cannot remove an uncommitted credential file');
        }
      }
    },
  };
}

export const nodeCredentialFileSystem = createNodeCredentialFileSystem({
  platform: process.platform,
  workspaceRoot: REPO_ROOT,
});

/**
 * Build the complete child environment for Wrangler from an explicit allowlist.
 * Database access, Node injection controls, marketplace proof, and provider
 * runtime secrets are deliberately absent even when present in the parent.
 */
export function buildWranglerEnvironment(
  parent: Readonly<Record<string, string | undefined>>,
): Readonly<Record<string, string>> {
  const child: Record<string, string> = {};
  const copy = (key: string): boolean => {
    const value = parent[key];
    if (value === undefined || value === '') return false;
    child[key] = value;
    return true;
  };
  for (const key of WRANGLER_OS_ENVIRONMENT_KEYS) copy(key);

  // Match Wrangler's supported auth order while carrying at most one secret
  // mechanism across the boundary. Endpoint and config override variables are
  // intentionally never copied because they could redirect that credential.
  if (!copy('CLOUDFLARE_API_TOKEN') && !copy('CF_API_TOKEN')) {
    if (
      parent['CLOUDFLARE_API_KEY'] !== undefined &&
      parent['CLOUDFLARE_API_KEY'] !== '' &&
      parent['CLOUDFLARE_EMAIL'] !== undefined &&
      parent['CLOUDFLARE_EMAIL'] !== ''
    ) {
      copy('CLOUDFLARE_API_KEY');
      copy('CLOUDFLARE_EMAIL');
    } else if (
      parent['CF_API_KEY'] !== undefined &&
      parent['CF_API_KEY'] !== '' &&
      parent['CF_EMAIL'] !== undefined &&
      parent['CF_EMAIL'] !== ''
    ) {
      copy('CF_API_KEY');
      copy('CF_EMAIL');
    }
  }
  return child;
}

export const nodeCredentialProcessRunner: CredentialProcessRunner = {
  async run(executable, args, stdin, env) {
    return new Promise<WranglerProcessResult>((resolvePromise, rejectPromise) => {
      let child: ReturnType<typeof spawn>;
      try {
        child = spawn(executable, [...args], {
          shell: false,
          windowsHide: true,
          stdio: ['pipe', 'pipe', 'ignore'],
          env: { ...env },
        });
      } catch {
        rejectPromise(new CredentialProvisioningError('cannot execute Wrangler safely'));
        return;
      }
      let settled = false;
      let stdoutBytes = 0;
      const stdoutChunks: Buffer[] = [];
      const reject = (): void => {
        if (settled) return;
        settled = true;
        child.kill();
        rejectPromise(new CredentialProvisioningError('cannot execute Wrangler safely'));
      };
      child.once('error', reject);
      const input = child.stdin;
      const output = child.stdout;
      if (input === null || output === null) {
        reject();
        return;
      }
      input.once('error', reject);
      output.once('error', reject);
      output.on('data', (chunk: Buffer | string) => {
        if (settled) return;
        const bytes = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
        stdoutBytes += bytes.length;
        if (stdoutBytes > WRANGLER_STDOUT_LIMIT_BYTES) {
          reject();
          return;
        }
        stdoutChunks.push(bytes);
      });
      child.once('close', (code) => {
        if (settled) return;
        settled = true;
        resolvePromise({
          exitCode: code ?? 1,
          stdout: Buffer.concat(stdoutChunks, stdoutBytes).toString('utf8'),
        });
      });
      input.end(stdin);
    });
  },
};

type RegularFileProbe = (path: string) => Promise<string | null>;

const nodeRegularFileProbe: RegularFileProbe = async (path) => {
  try {
    const canonical = await realpath(path);
    return (await stat(canonical)).isFile() ? canonical : null;
  } catch {
    return null;
  }
};

/** Resolve the repository-pinned Wrangler JavaScript CLI through Node. */
export async function resolveWranglerCommand(
  nodeExecutable: string,
  probe: RegularFileProbe = nodeRegularFileProbe,
): Promise<WranglerCommand> {
  const canonical = await probe(WRANGLER_ENTRYPOINT);
  if (canonical !== null) {
    return { executable: nodeExecutable, argsPrefix: [canonical] };
  }
  throw new CredentialProvisioningError(
    'cannot verify the repository-pinned Wrangler JavaScript entrypoint',
  );
}

export interface CredentialCliRuntime extends ProvisioningDependencies {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly createDriver: (connectionString: string) => Promise<SqlDriver>;
  readonly writeStdout: (text: string) => void;
}

/** Run the CLI with injectable database/process/filesystem boundaries. */
export async function runCredentialProvisioningCli(
  args: readonly string[],
  runtime: CredentialCliRuntime,
): Promise<CredentialProvisioningResult> {
  const options = parseCredentialProvisioningArgs(args);
  const connectionString = runtime.env['POSTGRES_URL'];
  if (connectionString === undefined || connectionString.trim() === '') {
    throw new CredentialProvisioningError('POSTGRES_URL is required');
  }

  const snapshotPath = await prepareWranglerAttempt(options, runtime);
  try {
    let driver: SqlDriver;
    try {
      driver = await runtime.createDriver(connectionString);
    } catch {
      throw new CredentialProvisioningError('cannot connect using POSTGRES_URL');
    }

    let result: CredentialProvisioningResult | null = null;
    let failure: unknown = null;
    try {
      result = await provisionApiCredentialPrepared(driver, options, runtime, snapshotPath);
    } catch (error) {
      failure = error;
    } finally {
      try {
        await driver.close();
      } catch {
        if (failure === null) {
          failure = new CredentialProvisioningError('cannot close the POSTGRES_URL connection');
        }
      }
    }
    if (failure !== null) throw failure;
    if (result === null) {
      throw new CredentialProvisioningError('credential provisioning returned no result');
    }
    runtime.writeStdout(`${JSON.stringify(result)}\n`);
    return result;
  } finally {
    if (snapshotPath !== null) {
      await runtime.fileSystem.removeWranglerConfigSnapshot(snapshotPath);
    }
  }
}

if (isMain(import.meta.url)) {
  try {
    const wranglerCommand = await resolveWranglerCommand(process.execPath);
    await runCredentialProvisioningCli(process.argv.slice(2), {
      env: process.env,
      createDriver: createPostgresDriver,
      mintApiKey: mintApiKeyDefault,
      fileSystem: nodeCredentialFileSystem,
      runner: nodeCredentialProcessRunner,
      wranglerCommand,
      now: () => new Date(),
      writeStdout: (text) => process.stdout.write(text),
    });
  } catch (error) {
    const message =
      error instanceof CredentialProvisioningError
        ? error.message
        : 'unexpected credential provisioning failure';
    process.stderr.write(`Credential provisioning refused: ${message}\n`);
    process.exitCode = 1;
  }
}
