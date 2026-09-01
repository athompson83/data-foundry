import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const EDGE_CONFIG = join(REPO_ROOT, 'apps', 'edge', 'wrangler.toml');
const CONSUMER_CONFIG = join(REPO_ROOT, 'apps', 'usage-consumer', 'wrangler.toml');
const WEB_CONFIG = join(REPO_ROOT, 'apps', 'web', 'wrangler.toml');
const ACQUISITION_CONFIG = join(REPO_ROOT, 'apps', 'acquisition-worker', 'wrangler.toml');
const MCP_CONFIG = join(REPO_ROOT, 'apps', 'mcp-worker', 'wrangler.toml');
const PRIVATE_CANARY_CONFIG = join(REPO_ROOT, 'apps', 'private-canary', 'wrangler.toml');
const ACCOUNT_ID = '1234567890abcdef1234567890abcdef';
const PRIVATE_CANARY_ACCOUNT_ID = 'fedcba0987654321fedcba0987654321';
const HYPERDRIVE_ID = 'abcdef1234567890abcdef1234567890';
const CONSUMER_HYPERDRIVE_ID = 'bcdef1234567890abcdef1234567890a';
const WEB_HYPERDRIVE_ID = 'cdef1234567890abcdef1234567890ab';
const ACQUISITION_HYPERDRIVE_ID = 'def1234567890abcdef1234567890abc';
const MCP_HYPERDRIVE_ID = 'ef1234567890abcdef1234567890abcd';
const temporaryDirectories: string[] = [];

afterAll(async () => {
  await Promise.all(temporaryDirectories.map((directory) => rm(directory, { recursive: true, force: true })));
});

async function loadValidator(): Promise<(
  options?: {
    readonly mode?: 'repository' | 'deployment' | 'private-canary' | 'private-canary-deployment' | 'private-canary-target' | 'private-canary-target-deployment' | 'private-canary-full-deployment';
    readonly edgeConfigPath?: string;
    readonly consumerConfigPath?: string;
    readonly webConfigPath?: string;
    readonly acquisitionConfigPath?: string;
    readonly mcpConfigPath?: string;
    readonly privateCanaryConfigPath?: string;
    readonly edgePrivateCanaryConfigPath?: string;
    readonly consumerPrivateCanaryConfigPath?: string;
    readonly webPrivateCanaryConfigPath?: string;
    readonly acquisitionPrivateCanaryConfigPath?: string;
    readonly mcpPrivateCanaryConfigPath?: string;
  },
) => Promise<readonly string[]>> {
  const module = await import('../scripts/check-cloudflare-topology.js').catch(() => null);
  expect(module, 'the repository needs a cross-manifest Cloudflare topology validator').not.toBeNull();
  const validate = (module as Record<string, unknown> | null)?.['validateCloudflareTopology'];
  expect(typeof validate).toBe('function');
  return validate as (
    options?: {
      readonly mode?: 'repository' | 'deployment' | 'private-canary' | 'private-canary-deployment' | 'private-canary-target' | 'private-canary-target-deployment' | 'private-canary-full-deployment';
      readonly edgeConfigPath?: string;
      readonly consumerConfigPath?: string;
      readonly webConfigPath?: string;
      readonly acquisitionConfigPath?: string;
      readonly mcpConfigPath?: string;
      readonly privateCanaryConfigPath?: string;
      readonly edgePrivateCanaryConfigPath?: string;
      readonly consumerPrivateCanaryConfigPath?: string;
      readonly webPrivateCanaryConfigPath?: string;
      readonly acquisitionPrivateCanaryConfigPath?: string;
      readonly mcpPrivateCanaryConfigPath?: string;
    },
  ) => Promise<readonly string[]>;
}

async function writeDeploymentManifests(directory: string): Promise<{
  readonly edgeConfigPath: string;
  readonly consumerConfigPath: string;
  readonly webConfigPath: string;
  readonly acquisitionConfigPath: string;
  readonly mcpConfigPath: string;
}> {
  const binding = (id: string): string => `\n[[hyperdrive]]\nbinding = "HYPERDRIVE"\nid = "${id}"\n`;
  const withAccountId = (manifest: string): string =>
    manifest.replace(/^name\s*=\s*[^\n]+/m, (name) => `${name}\naccount_id = "${ACCOUNT_ID}"`);
  const withTopLevelRoute = (manifest: string, route: string): string =>
    manifest.replace(/^name\s*=\s*[^\n]+/m, (name) => `${name}\nroute = "${route}"`);
  const edgeConfigPath = join(directory, 'edge.toml');
  const consumerConfigPath = join(directory, 'consumer.toml');
  const webConfigPath = join(directory, 'web.toml');
  const acquisitionConfigPath = join(directory, 'acquisition.toml');
  const mcpConfigPath = join(directory, 'mcp.toml');
  const edge = `${withAccountId(
    withTopLevelRoute(await readFile(EDGE_CONFIG, 'utf8'), 'api.datafoundry.io/*'),
  )}${binding(HYPERDRIVE_ID)}`;
  const consumer = `${withAccountId(await readFile(CONSUMER_CONFIG, 'utf8'))}${binding(CONSUMER_HYPERDRIVE_ID)}`;
  const web = `${withAccountId((await readFile(WEB_CONFIG, 'utf8')).replace(
    'DEPLOYMENT_ENVIRONMENT = "production"',
    'DEPLOYMENT_ENVIRONMENT = "production"\nPUBLIC_ORIGIN = "https://www.datafoundry.io"',
  ))}${binding(WEB_HYPERDRIVE_ID)}`;
  const acquisition = `${withAccountId(
    (await readFile(ACQUISITION_CONFIG, 'utf8')).replace(
      'RAW_ARTIFACTS_BUCKET_NAME = "data-foundry-raw-artifacts"',
      `RAW_ARTIFACTS_BUCKET_NAME = "data-foundry-raw-artifacts"\nCLOUDFLARE_ACCOUNT_ID = "${ACCOUNT_ID}"`,
    ),
  )}${binding(ACQUISITION_HYPERDRIVE_ID)}`;
  const mcp = `${withAccountId((await readFile(MCP_CONFIG, 'utf8')).replace(
    'API_KEY_ENVIRONMENT = "live"',
    'API_KEY_ENVIRONMENT = "live"\nMCP_HOSTNAME = "mcp.datafoundry.io"\nMCP_ALLOWED_ORIGINS = "https://app.datafoundry.io"\nPUBLIC_ORIGIN = "https://www.datafoundry.io"',
  ))}${binding(MCP_HYPERDRIVE_ID)}`;
  const webWithRoute = `${withTopLevelRoute(web, 'www.datafoundry.io/*')}`;
  const mcpWithRoute = `${withTopLevelRoute(mcp, 'mcp.datafoundry.io/*')}`;
  await Promise.all([
    writeFile(edgeConfigPath, edge, 'utf8'),
    writeFile(consumerConfigPath, consumer, 'utf8'),
    writeFile(webConfigPath, webWithRoute, 'utf8'),
    writeFile(acquisitionConfigPath, acquisition, 'utf8'),
    writeFile(mcpConfigPath, mcpWithRoute, 'utf8'),
  ]);
  return { edgeConfigPath, consumerConfigPath, webConfigPath, acquisitionConfigPath, mcpConfigPath };
}

async function writePrivateCanaryDeploymentManifest(directory: string): Promise<string> {
  const privateCanaryConfigPath = join(directory, 'private-canary.production.toml');
  const manifest = (await readFile(PRIVATE_CANARY_CONFIG, 'utf8')).replace(
    /^name\s*=\s*[^\n]+/m,
    (name) => `${name}\naccount_id = "${PRIVATE_CANARY_ACCOUNT_ID}"`,
  );
  await writeFile(privateCanaryConfigPath, manifest, 'utf8');
  return privateCanaryConfigPath;
}

async function writePrivateCanaryTargetDeploymentManifests(directory: string): Promise<{
  readonly edgePrivateCanaryConfigPath: string;
  readonly consumerPrivateCanaryConfigPath: string;
  readonly webPrivateCanaryConfigPath: string;
  readonly acquisitionPrivateCanaryConfigPath: string;
  readonly mcpPrivateCanaryConfigPath: string;
}> {
  const manifest = (name: string, hyperdriveId: string, extra = ''): string => `name = "${name}"
account_id = "${ACCOUNT_ID}"
main = "src/index.ts"
compatibility_date = "2026-08-28"
compatibility_flags = ["nodejs_compat"]
workers_dev = false
preview_urls = false

[observability]
enabled = true

[observability.logs]
invocation_logs = false

[vars]
DEPLOYMENT_ENVIRONMENT = "production"
PRIVATE_CANARY_MODE = "service-binding"

[[hyperdrive]]
binding = "HYPERDRIVE"
id = "${hyperdriveId}"
${extra}`;
  const edgePrivateCanaryConfigPath = join(directory, 'edge.private-canary.production.toml');
  const consumerPrivateCanaryConfigPath = join(directory, 'consumer.private-canary.production.toml');
  const webPrivateCanaryConfigPath = join(directory, 'web.private-canary.production.toml');
  const acquisitionPrivateCanaryConfigPath = join(directory, 'acquisition.private-canary.production.toml');
  const mcpPrivateCanaryConfigPath = join(directory, 'mcp.private-canary.production.toml');
  await Promise.all([
    writeFile(edgePrivateCanaryConfigPath, manifest(
      'data-foundry-edge',
      HYPERDRIVE_ID,
      '\n[[queues.producers]]\nbinding = "USAGE_EVENTS_QUEUE"\nqueue = "data-foundry-usage-events"\n',
    ), 'utf8'),
    writeFile(consumerPrivateCanaryConfigPath, manifest(
      'data-foundry-usage-consumer',
      CONSUMER_HYPERDRIVE_ID,
      '\n[[queues.consumers]]\nqueue = "data-foundry-usage-events"\nmax_batch_size = 100\nmax_batch_timeout = 5\nmax_retries = 3\ndead_letter_queue = "data-foundry-usage-events-dlq"\n',
    ), 'utf8'),
    writeFile(webPrivateCanaryConfigPath, manifest('data-foundry-web', WEB_HYPERDRIVE_ID), 'utf8'),
    writeFile(acquisitionPrivateCanaryConfigPath, manifest('data-foundry-acquisition-worker', ACQUISITION_HYPERDRIVE_ID), 'utf8'),
    writeFile(mcpPrivateCanaryConfigPath, manifest(
      'data-foundry-mcp-hvac',
      MCP_HYPERDRIVE_ID,
      '\n[[queues.producers]]\nbinding = "USAGE_EVENTS_QUEUE"\nqueue = "data-foundry-usage-events"\n',
    ), 'utf8'),
  ]);
  return {
    edgePrivateCanaryConfigPath,
    consumerPrivateCanaryConfigPath,
    webPrivateCanaryConfigPath,
    acquisitionPrivateCanaryConfigPath,
    mcpPrivateCanaryConfigPath,
  };
}

describe('the committed Cloudflare topology', () => {
  it('defines a production edge producer and idempotent consumer with one matching queue and DLQ', async () => {
    const validate = await loadValidator();
    expect(await validate()).toEqual([]);
  });

  it('defines a route-less private canary which consumes only the existing DLQ through five named RPC bindings', async () => {
    const validate = await loadValidator();
    expect(await validate({ mode: 'private-canary' })).toEqual([]);
  });

  it('defines five route-less private-target templates with only their intended synthetic queue capabilities', async () => {
    const validate = await loadValidator();
    expect(await validate({ mode: 'private-canary-target' })).toEqual([]);
  });

  it('validates an ignored private-canary deployment manifest with an account but no database or public surface', async () => {
    const validate = await loadValidator();
    const directory = await mkdtemp(join(tmpdir(), 'data-foundry-private-canary-deployment-'));
    temporaryDirectories.push(directory);
    const privateCanaryConfigPath = await writePrivateCanaryDeploymentManifest(directory);

    expect(await validate({
      mode: 'private-canary-deployment',
      privateCanaryConfigPath,
    })).toEqual([]);
  });

  it('validates five ignored private-target manifests as distinct, route-less Hyperdrive capabilities', async () => {
    const validate = await loadValidator();
    const directory = await mkdtemp(join(tmpdir(), 'data-foundry-private-canary-target-deployment-'));
    temporaryDirectories.push(directory);
    const paths = await writePrivateCanaryTargetDeploymentManifests(directory);

    expect(await validate({
      mode: 'private-canary-target-deployment',
      ...paths,
    })).toEqual([]);
  });

  it('fails closed when the private-canary harness and target manifests name different accounts', async () => {
    const validate = await loadValidator();
    const directory = await mkdtemp(join(tmpdir(), 'data-foundry-private-canary-account-drift-'));
    temporaryDirectories.push(directory);
    const privateCanaryConfigPath = await writePrivateCanaryDeploymentManifest(directory);
    const paths = await writePrivateCanaryTargetDeploymentManifests(directory);

    const errors = await validate({
      mode: 'private-canary-full-deployment',
      privateCanaryConfigPath,
      ...paths,
    });

    expect(errors.join('\n')).toMatch(/private-canary.*account_id.*target/i);
    expect(errors.join('\n')).not.toContain(PRIVATE_CANARY_ACCOUNT_ID);
  });

  it('accepts one account across the route-less harness and all five route-less targets', async () => {
    const validate = await loadValidator();
    const directory = await mkdtemp(join(tmpdir(), 'data-foundry-private-canary-full-deployment-'));
    temporaryDirectories.push(directory);
    const privateCanaryConfigPath = await writePrivateCanaryDeploymentManifest(directory);
    await writeFile(
      privateCanaryConfigPath,
      (await readFile(privateCanaryConfigPath, 'utf8')).replace(PRIVATE_CANARY_ACCOUNT_ID, ACCOUNT_ID),
      'utf8',
    );
    const paths = await writePrivateCanaryTargetDeploymentManifests(directory);

    expect(await validate({
      mode: 'private-canary-full-deployment',
      privateCanaryConfigPath,
      ...paths,
    })).toEqual([]);
  });

  it('rejects a private-canary service binding scoped to an unreviewed Worker environment', async () => {
    const validate = await loadValidator();
    const directory = await mkdtemp(join(tmpdir(), 'data-foundry-private-canary-service-environment-drift-'));
    temporaryDirectories.push(directory);
    const privateCanaryConfigPath = await writePrivateCanaryDeploymentManifest(directory);
    await writeFile(
      privateCanaryConfigPath,
      (await readFile(privateCanaryConfigPath, 'utf8'))
        .replace(PRIVATE_CANARY_ACCOUNT_ID, ACCOUNT_ID)
        .replace(
          'entrypoint = "PrivateCanaryEntrypoint"',
          'entrypoint = "PrivateCanaryEntrypoint"\nenvironment = "staging"',
        ),
      'utf8',
    );
    const paths = await writePrivateCanaryTargetDeploymentManifests(directory);

    const errors = await validate({
      mode: 'private-canary-full-deployment',
      privateCanaryConfigPath,
      ...paths,
    });

    expect(errors.join('\n')).toMatch(/private-canary.*service.*environment/i);
  });

  it('rejects a direct connection field in a private-target Hyperdrive manifest', async () => {
    const validate = await loadValidator();
    const directory = await mkdtemp(join(tmpdir(), 'data-foundry-private-canary-hyperdrive-secret-drift-'));
    temporaryDirectories.push(directory);
    const privateCanaryConfigPath = await writePrivateCanaryDeploymentManifest(directory);
    await writeFile(
      privateCanaryConfigPath,
      (await readFile(privateCanaryConfigPath, 'utf8')).replace(PRIVATE_CANARY_ACCOUNT_ID, ACCOUNT_ID),
      'utf8',
    );
    const paths = await writePrivateCanaryTargetDeploymentManifests(directory);
    await writeFile(
      paths.edgePrivateCanaryConfigPath,
      (await readFile(paths.edgePrivateCanaryConfigPath, 'utf8')).replace(
        `id = "${HYPERDRIVE_ID}"`,
        `id = "${HYPERDRIVE_ID}"\nlocalConnectionString = "postgres://local.invalid/forbidden"`,
      ),
      'utf8',
    );

    const errors = await validate({
      mode: 'private-canary-full-deployment',
      privateCanaryConfigPath,
      ...paths,
    });

    expect(errors.join('\n')).toMatch(/edge.*Hyperdrive.*binding.*id/i);
    expect(errors.join('\n')).not.toMatch(/local\.invalid|postgres:/i);
  });

  it('rejects a private-target route, public endpoint configuration, missing service binding mode, and shared Hyperdrive', async () => {
    const validate = await loadValidator();
    const directory = await mkdtemp(join(tmpdir(), 'data-foundry-private-canary-target-deployment-drift-'));
    temporaryDirectories.push(directory);
    const paths = await writePrivateCanaryTargetDeploymentManifests(directory);
    await Promise.all([
      writeFile(
        paths.edgePrivateCanaryConfigPath,
        `${await readFile(paths.edgePrivateCanaryConfigPath, 'utf8')}\nroute = "private.example.invalid/*"\n`,
        'utf8',
      ),
      writeFile(
        paths.webPrivateCanaryConfigPath,
        `${await readFile(paths.webPrivateCanaryConfigPath, 'utf8')}\n[env.production.vars]\nPUBLIC_ORIGIN = "https://www.datafoundry.io"\n`,
        'utf8',
      ),
      writeFile(
        paths.mcpPrivateCanaryConfigPath,
        (await readFile(paths.mcpPrivateCanaryConfigPath, 'utf8'))
          .replace('PRIVATE_CANARY_MODE = "service-binding"', '')
          .replace(MCP_HYPERDRIVE_ID, HYPERDRIVE_ID) +
          '\n[env.production.vars]\nMCP_HOSTNAME = "mcp.datafoundry.io"\n',
        'utf8',
      ),
    ]);

    const errors = await validate({ mode: 'private-canary-target-deployment', ...paths });
    expect(errors.join('\n')).toMatch(/edge.*route-less/i);
    expect(errors.join('\n')).toMatch(/web.*PUBLIC_ORIGIN/i);
    expect(errors.join('\n')).toMatch(/mcp-worker.*PRIVATE_CANARY_MODE/i);
    expect(errors.join('\n')).toMatch(/mcp-worker.*MCP_HOSTNAME/i);
    expect(errors.join('\n')).toMatch(/distinct Hyperdrive/i);
  });

  it('fails closed when the ignored private-canary deployment manifest is absent', async () => {
    const validate = await loadValidator();
    const directory = await mkdtemp(join(tmpdir(), 'data-foundry-private-canary-deployment-missing-'));
    temporaryDirectories.push(directory);

    expect(await validate({
      mode: 'private-canary-deployment',
      privateCanaryConfigPath: join(directory, 'missing-private-canary.production.toml'),
    })).toEqual(['private-canary manifest could not be read and parsed as TOML.']);
  });

  it('rejects account drift and every public or privileged production override without exposing the account value', async () => {
    const validate = await loadValidator();
    const directory = await mkdtemp(join(tmpdir(), 'data-foundry-private-canary-deployment-drift-'));
    temporaryDirectories.push(directory);
    const privateCanaryConfigPath = await writePrivateCanaryDeploymentManifest(directory);
    const invalidAccountId = 'not-a-private-canary-account-id';
    await writeFile(
      privateCanaryConfigPath,
      (await readFile(privateCanaryConfigPath, 'utf8'))
        .replace(PRIVATE_CANARY_ACCOUNT_ID, invalidAccountId)
        .replace('workers_dev = false', 'workers_dev = true')
        .replace('preview_urls = false', 'preview_urls = true')
        .replace('queue = "data-foundry-usage-events-dlq"', 'queue = "private-canary-extra-queue"') +
        '\nroute = "private-canary.example.invalid/*"\n' +
        '[[hyperdrive]]\nbinding = "HYPERDRIVE"\nid = "abcdef1234567890abcdef1234567890"\n' +
        '[[queues.producers]]\nbinding = "EXTRA_QUEUE"\nqueue = "private-canary-extra-queue"\n',
      'utf8',
    );

    const errors = await validate({ mode: 'private-canary-deployment', privateCanaryConfigPath });
    expect(errors.join('\n')).toMatch(/private-canary.*32-hex account_id/i);
    expect(errors.join('\n')).toMatch(/workers[_\. ]dev/i);
    expect(errors.join('\n')).toMatch(/preview/i);
    expect(errors.join('\n')).toMatch(/route-less/i);
    expect(errors.join('\n')).toMatch(/must not bind Hyperdrive/i);
    expect(errors.join('\n')).toMatch(/must not declare Queue producers/i);
    expect(errors.join('\n')).toMatch(/data-foundry-usage-events-dlq/i);
    expect(errors.join('\n')).not.toContain(invalidAccountId);
  });

  it('rejects public reachability, Hyperdrive, an extra queue, and service-binding drift from the private canary', async () => {
    const validate = await loadValidator();
    const directory = await mkdtemp(join(tmpdir(), 'data-foundry-private-canary-topology-'));
    temporaryDirectories.push(directory);
    const privateCanaryPath = join(directory, 'private-canary.toml');
    const privateCanary = await readFile(PRIVATE_CANARY_CONFIG, 'utf8');
    await writeFile(
      privateCanaryPath,
      privateCanary
        .replace('workers_dev = false', 'workers_dev = true')
        .replace('queue = "data-foundry-usage-events-dlq"', 'queue = "private-canary-extra-queue"')
        .replace(
          'entrypoint = "PrivateCanaryEntrypoint"',
          'entrypoint = "UnexpectedEntrypoint"',
        ) +
        '\nroute = "private-canary.example.invalid/*"\n' +
        '[[hyperdrive]]\nbinding = "HYPERDRIVE"\nid = "abcdef1234567890abcdef1234567890"\n' +
        '[[queues.producers]]\nbinding = "EXTRA_QUEUE"\nqueue = "private-canary-extra-queue"\n',
      'utf8',
    );

    const errors = await validate({ mode: 'private-canary', privateCanaryConfigPath: privateCanaryPath });
    expect(errors.join('\n')).toMatch(/workers[_\. ]dev/i);
    expect(errors.join('\n')).toMatch(/route-less/i);
    expect(errors.join('\n')).toMatch(/must not bind Hyperdrive/i);
    expect(errors.join('\n')).toMatch(/must not declare Queue producers/i);
    expect(errors.join('\n')).toMatch(/data-foundry-usage-events-dlq/i);
    expect(errors.join('\n')).toMatch(/PrivateCanaryEntrypoint/i);
  });

  it('detects cross-file queue drift and a missing DLQ', async () => {
    const validate = await loadValidator();
    const directory = await mkdtemp(join(tmpdir(), 'data-foundry-cloudflare-topology-'));
    temporaryDirectories.push(directory);
    const edgePath = join(directory, 'edge.toml');
    const consumerPath = join(directory, 'consumer.toml');
    const edge = await readFile(EDGE_CONFIG, 'utf8');
    const consumer = await readFile(CONSUMER_CONFIG, 'utf8');
    await writeFile(
      edgePath,
      edge.replace('queue = "data-foundry-usage-events"', 'queue = "drifted-usage-events"'),
      'utf8',
    );
    await writeFile(
      consumerPath,
      consumer.replace(/^dead_letter_queue\s*=.*$/m, ''),
      'utf8',
    );

    const errors = await validate({ edgeConfigPath: edgePath, consumerConfigPath: consumerPath });
    expect(errors).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/producer.*consumer.*queue/i),
        expect.stringMatching(/dead.?letter/i),
      ]),
    );
  });

  it('rejects account-specific ids, database URLs, and plaintext marketplace secrets in committed TOML', async () => {
    const validate = await loadValidator();
    const directory = await mkdtemp(join(tmpdir(), 'data-foundry-cloudflare-policy-'));
    temporaryDirectories.push(directory);
    const edgePath = join(directory, 'edge.toml');
    const consumerPath = join(directory, 'consumer.toml');
    const edge = await readFile(EDGE_CONFIG, 'utf8');
    await writeFile(
      edgePath,
      `${edge}\naccount_id = "00000000000000000000000000000000"\n` +
        '[[env.production.hyperdrive]]\nbinding = "HYPERDRIVE"\nid = "11111111111111111111111111111111"\n' +
        '[env.production.vars]\nPOSTGRES_URL = "postgres://plain.example/db"\n' +
        'RAPIDAPI_PROXY_SECRET = "plain-secret"\n',
      'utf8',
    );
    await writeFile(consumerPath, await readFile(CONSUMER_CONFIG, 'utf8'), 'utf8');

    const errors = await validate({ edgeConfigPath: edgePath, consumerConfigPath: consumerPath });
    expect(errors.join('\n')).toMatch(/account_id/);
    expect(errors.join('\n')).toMatch(/hyperdrive.*id/i);
    expect(errors.join('\n')).toMatch(/POSTGRES_URL/);
    expect(errors.join('\n')).toMatch(/RAPIDAPI_PROXY_SECRET/);
  });

  it('rejects deployment-only routes and host/origin values in repository templates', async () => {
    const validate = await loadValidator();
    const directory = await mkdtemp(join(tmpdir(), 'data-foundry-cloudflare-deployment-facts-'));
    temporaryDirectories.push(directory);
    const edgePath = join(directory, 'edge.toml');
    const webPath = join(directory, 'web.toml');
    const mcpPath = join(directory, 'mcp.toml');
    await writeFile(
      edgePath,
      `${await readFile(EDGE_CONFIG, 'utf8')}\nroute = "edge.example.invalid/*"\nroutes = ["alt.example.invalid/*"]\n[env.production.vars]\nRAPIDAPI_HOSTNAME = "marketplace.example.invalid"\n`,
      'utf8',
    );
    await writeFile(
      webPath,
      `${await readFile(WEB_CONFIG, 'utf8')}\n[env.production.vars]\nPUBLIC_ORIGIN = "https://web.example.invalid"\n`,
      'utf8',
    );
    await writeFile(
      mcpPath,
      `${await readFile(MCP_CONFIG, 'utf8')}\n[env.production.vars]\nMCP_HOSTNAME = "mcp.example.invalid"\nMCP_ALLOWED_ORIGINS = "https://client.example.invalid"\n`,
      'utf8',
    );

    const errors = await validate({ edgeConfigPath: edgePath, webConfigPath: webPath, mcpConfigPath: mcpPath });
    expect(errors.join('\n')).toMatch(/route/i);
    expect(errors.join('\n')).toMatch(/PUBLIC_ORIGIN/);
    expect(errors.join('\n')).toMatch(/MCP_HOSTNAME/);
    expect(errors.join('\n')).toMatch(/MCP_ALLOWED_ORIGINS/);
    expect(errors.join('\n')).toMatch(/RAPIDAPI_HOSTNAME/);
  });

  it('requires workers.dev, preview URL, and invocation-log privacy controls on every template', async () => {
    const validate = await loadValidator();
    const directory = await mkdtemp(join(tmpdir(), 'data-foundry-cloudflare-privacy-controls-'));
    temporaryDirectories.push(directory);
    const edgePath = join(directory, 'edge.toml');
    const webPath = join(directory, 'web.toml');
    await writeFile(
      edgePath,
      (await readFile(EDGE_CONFIG, 'utf8'))
        .replace('workers_dev = false', 'workers_dev = true')
        .replace('preview_urls = false', 'preview_urls = true')
        .replace('invocation_logs = false', 'invocation_logs = true'),
      'utf8',
    );
    await writeFile(
      webPath,
      (await readFile(WEB_CONFIG, 'utf8'))
        .replace('workers_dev = false', 'workers_dev = true')
        .replace('preview_urls = false', 'preview_urls = true'),
      'utf8',
    );

    const errors = await validate({ edgeConfigPath: edgePath, webConfigPath: webPath });
    expect(errors.join('\n')).toMatch(/edge.*workers[_\.]dev/i);
    expect(errors.join('\n')).toMatch(/edge.*preview/i);
    expect(errors.join('\n')).toMatch(/edge.*invocation/i);
    expect(errors.join('\n')).toMatch(/web.*workers[_\.]dev/i);
    expect(errors.join('\n')).toMatch(/web.*preview/i);
  });

  it('validates ignored deployment manifests without exposing their values in success output', async () => {
    const validate = await loadValidator();
    const directory = await mkdtemp(join(tmpdir(), 'data-foundry-cloudflare-deployment-mode-'));
    temporaryDirectories.push(directory);
    const paths = await writeDeploymentManifests(directory);

    expect(await validate({ mode: 'deployment', ...paths })).toEqual([]);
  });

  it('rejects deployment manifests that reuse a Hyperdrive configuration across Worker roles', async () => {
    const validate = await loadValidator();
    const directory = await mkdtemp(join(tmpdir(), 'data-foundry-cloudflare-duplicate-hyperdrive-'));
    temporaryDirectories.push(directory);
    const paths = await writeDeploymentManifests(directory);
    await writeFile(
      paths.webConfigPath,
      (await readFile(paths.webConfigPath, 'utf8')).replace(WEB_HYPERDRIVE_ID, HYPERDRIVE_ID),
      'utf8',
    );

    const errors = await validate({ mode: 'deployment', ...paths });

    expect(errors.join('\n')).toMatch(/five distinct Hyperdrive configuration ids/i);
    expect(errors.join('\n')).not.toContain(HYPERDRIVE_ID);
  });

  it('rejects a deployment Worker with two valid Hyperdrive bindings', async () => {
    const validate = await loadValidator();
    const directory = await mkdtemp(join(tmpdir(), 'data-foundry-cloudflare-multiple-hyperdrives-'));
    temporaryDirectories.push(directory);
    const paths = await writeDeploymentManifests(directory);
    await writeFile(
      paths.edgeConfigPath,
      `${await readFile(paths.edgeConfigPath, 'utf8')}\n[[hyperdrive]]\nbinding = "HYPERDRIVE"\nid = "${WEB_HYPERDRIVE_ID}"\n`,
      'utf8',
    );

    const errors = await validate({ mode: 'deployment', ...paths });

    expect(errors.join('\n')).toMatch(/edge.*exactly one HYPERDRIVE binding/i);
  });

  it('rejects a production web manifest that enables shared caching', async () => {
    const validate = await loadValidator();
    const directory = await mkdtemp(join(tmpdir(), 'data-foundry-cloudflare-web-cache-'));
    temporaryDirectories.push(directory);
    const paths = await writeDeploymentManifests(directory);
    await writeFile(
      paths.webConfigPath,
      (await readFile(paths.webConfigPath, 'utf8')).replace(
        'PUBLIC_CACHE_MODE = "no-store"',
        'PUBLIC_CACHE_MODE = "cache"',
      ),
      'utf8',
    );

    const errors = await validate({ mode: 'deployment', ...paths });
    expect(errors.join('\n')).toMatch(/PUBLIC_CACHE_MODE.*no-store/i);
  });

  it('requires one well-formed canonical account id across every deployment manifest', async () => {
    const validate = await loadValidator();
    const directory = await mkdtemp(join(tmpdir(), 'data-foundry-cloudflare-account-id-'));
    temporaryDirectories.push(directory);
    const paths = await writeDeploymentManifests(directory);

    await writeFile(
      paths.consumerConfigPath,
      (await readFile(paths.consumerConfigPath, 'utf8')).replace(
        `account_id = "${ACCOUNT_ID}"\n`,
        '',
      ),
      'utf8',
    );
    await writeFile(
      paths.webConfigPath,
      (await readFile(paths.webConfigPath, 'utf8')).replace(
        `account_id = "${ACCOUNT_ID}"`,
        'account_id = "not-an-account-id"',
      ),
      'utf8',
    );
    await writeFile(
      paths.mcpConfigPath,
      (await readFile(paths.mcpConfigPath, 'utf8')).replace(
        `account_id = "${ACCOUNT_ID}"`,
        'account_id = "11111111111111111111111111111111"',
      ),
      'utf8',
    );

    const errors = await validate({ mode: 'deployment', ...paths });
    expect(errors.join('\n')).toMatch(/usage-consumer.*32-hex account_id/i);
    expect(errors.join('\n')).toMatch(/web.*32-hex account_id/i);
    expect(errors.join('\n')).toMatch(/one canonical account_id/i);
    expect(errors.join('\n')).not.toContain('11111111111111111111111111111111');
    expect(errors.join('\n')).not.toContain('not-an-account-id');
  });

  it.each([
    ['all-zero', '00000000000000000000000000000000'],
    ['too-short', '1234567890abcdef1234567890abcde'],
    ['uppercase', '1234567890ABCDEF1234567890ABCDEF'],
  ])('rejects a %s deployment account id without exposing it', async (_label, accountId) => {
    const validate = await loadValidator();
    const directory = await mkdtemp(join(tmpdir(), 'data-foundry-cloudflare-invalid-account-'));
    temporaryDirectories.push(directory);
    const paths = await writeDeploymentManifests(directory);
    await writeFile(
      paths.edgeConfigPath,
      (await readFile(paths.edgeConfigPath, 'utf8')).replace(ACCOUNT_ID, accountId),
      'utf8',
    );

    const errors = await validate({ mode: 'deployment', ...paths });
    expect(errors.join('\n')).toMatch(/edge.*non-zero lowercase 32-hex account_id/i);
    expect(errors.join('\n')).not.toContain(accountId);
  });

  it.each([
    ['all-zero', '00000000000000000000000000000000'],
    ['too-short', 'abcdef1234567890abcdef123456789'],
    ['uppercase', 'ABCDEF1234567890ABCDEF1234567890'],
  ])('rejects a %s Hyperdrive id without exposing it', async (_label, hyperdriveId) => {
    const validate = await loadValidator();
    const directory = await mkdtemp(join(tmpdir(), 'data-foundry-cloudflare-invalid-hyperdrive-'));
    temporaryDirectories.push(directory);
    const paths = await writeDeploymentManifests(directory);
    await writeFile(
      paths.webConfigPath,
      (await readFile(paths.webConfigPath, 'utf8')).replace(WEB_HYPERDRIVE_ID, hyperdriveId),
      'utf8',
    );

    const errors = await validate({ mode: 'deployment', ...paths });
    expect(errors.join('\n')).toMatch(/web.*HYPERDRIVE.*non-zero lowercase 32-hex id/i);
    expect(errors.join('\n')).not.toContain(hyperdriveId);
  });

  it('rejects canonical loopback aliases in ignored deployment endpoints', async () => {
    const validate = await loadValidator();
    const directory = await mkdtemp(join(tmpdir(), 'data-foundry-cloudflare-loopback-alias-'));
    temporaryDirectories.push(directory);
    const paths = await writeDeploymentManifests(directory);
    await Promise.all([
      writeFile(
        paths.edgeConfigPath,
        (await readFile(paths.edgeConfigPath, 'utf8')).replace(
          'VERTICAL_SLUG = "hvac"',
          'VERTICAL_SLUG = "hvac"\nRAPIDAPI_HOSTNAME = "localhost."',
        ),
        'utf8',
      ),
      writeFile(
        paths.webConfigPath,
        (await readFile(paths.webConfigPath, 'utf8')).replace(
          'https://www.datafoundry.io',
          'https://localhost.',
        ),
        'utf8',
      ),
      writeFile(
        paths.mcpConfigPath,
        (await readFile(paths.mcpConfigPath, 'utf8'))
          .replace('MCP_HOSTNAME = "mcp.datafoundry.io"', 'MCP_HOSTNAME = "localhost."')
          .replace('https://app.datafoundry.io', 'https://localhost.')
          .replace('https://www.datafoundry.io', 'https://localhost.'),
        'utf8',
      ),
    ]);

    const errors = await validate({ mode: 'deployment', ...paths });
    expect(errors.join('\n')).toMatch(/RAPIDAPI_HOSTNAME.*non-loopback/i);
    expect(errors.join('\n')).toMatch(/web.*non-loopback.*PUBLIC_ORIGIN/i);
    expect(errors.join('\n')).toMatch(/non-loopback.*MCP_HOSTNAME/i);
    expect(errors.join('\n')).toMatch(/non-loopback.*MCP_ALLOWED_ORIGINS/i);
  });

  it.each([
    'marketplace.invalid',
    'marketplace.invalid.',
    'marketplace.example',
    'marketplace.test.',
    'data-foundry-edge.workers.dev',
    'data-foundry-edge.workers.dev.',
    'data-foundry-edge.pages.dev',
    'data-foundry-edge.trycloudflare.com',
    'marketplace.example.com',
    'marketplace.local',
    'marketplace.onion',
    'marketplace.home.arpa',
    '8.8.8.8',
    'marketplace_datafoundry.io',
  ])('rejects a reserved marketplace deployment hostname %s', async (hostname) => {
    const validate = await loadValidator();
    const directory = await mkdtemp(join(tmpdir(), 'data-foundry-cloudflare-marketplace-host-'));
    temporaryDirectories.push(directory);
    const paths = await writeDeploymentManifests(directory);
    await writeFile(
      paths.edgeConfigPath,
      (await readFile(paths.edgeConfigPath, 'utf8')).replace(
        'VERTICAL_SLUG = "hvac"',
        `VERTICAL_SLUG = "hvac"\nRAPIDAPI_HOSTNAME = "${hostname}"`,
      ),
      'utf8',
    );

    const errors = await validate({ mode: 'deployment', ...paths });
    expect(errors.join('\n')).toMatch(/RAPIDAPI_HOSTNAME.*production hostname/i);
  });

  it.each([
    'catalog.invalid/*',
    'catalog.invalid./*',
    'data-foundry-edge.workers.dev./*',
    'localhost./*',
    '*.datafoundry.io/*',
    'API.datafoundry.io/*',
    'https://api.datafoundry.io/*',
    'api.datafoundry.io:443/*',
    'api.datafoundry.io/path/*',
    'api.datafoundry.io/*?preview=1',
    'api_datafoundry.io/*',
    'api.123/*',
    '1.2.3.4.5/*',
    'data-foundry-edge.pages.dev/*',
    'data-foundry-edge.trycloudflare.com/*',
  ])('rejects a non-canonical production route %s', async (route) => {
    const validate = await loadValidator();
    const directory = await mkdtemp(join(tmpdir(), 'data-foundry-cloudflare-route-host-'));
    temporaryDirectories.push(directory);
    const paths = await writeDeploymentManifests(directory);
    await writeFile(
      paths.edgeConfigPath,
      (await readFile(paths.edgeConfigPath, 'utf8')).replace('api.datafoundry.io/*', route),
      'utf8',
    );

    const errors = await validate({ mode: 'deployment', ...paths });
    expect(errors.join('\n')).toMatch(/edge.*canonical production route/i);
  });

  it('rejects endpoint hostnames that do not match their Worker routes or canonical web origin', async () => {
    const validate = await loadValidator();
    const directory = await mkdtemp(join(tmpdir(), 'data-foundry-cloudflare-endpoint-drift-'));
    temporaryDirectories.push(directory);
    const paths = await writeDeploymentManifests(directory);
    await Promise.all([
      writeFile(
        paths.edgeConfigPath,
        (await readFile(paths.edgeConfigPath, 'utf8')).replace(
          'VERTICAL_SLUG = "hvac"',
          'VERTICAL_SLUG = "hvac"\nRAPIDAPI_HOSTNAME = "marketplace.datafoundry.io"',
        ),
        'utf8',
      ),
      writeFile(
        paths.webConfigPath,
        (await readFile(paths.webConfigPath, 'utf8')).replace(
          'https://www.datafoundry.io',
          'https://web.datafoundry.io',
        ),
        'utf8',
      ),
      writeFile(
        paths.mcpConfigPath,
        (await readFile(paths.mcpConfigPath, 'utf8'))
          .replace('MCP_HOSTNAME = "mcp.datafoundry.io"', 'MCP_HOSTNAME = "agent.datafoundry.io"')
          .replace('https://www.datafoundry.io', 'https://elsewhere.datafoundry.io'),
        'utf8',
      ),
    ]);

    const errors = await validate({ mode: 'deployment', ...paths });
    expect(errors.join('\n')).toMatch(/RAPIDAPI_HOSTNAME.*edge.*route/i);
    expect(errors.join('\n')).toMatch(/web PUBLIC_ORIGIN.*web.*route/i);
    expect(errors.join('\n')).toMatch(/MCP_HOSTNAME.*mcp-worker.*route/i);
    expect(errors.join('\n')).toMatch(/mcp-worker PUBLIC_ORIGIN.*web PUBLIC_ORIGIN/i);
  });

  it('requires a distinct direct API route when a dedicated RapidAPI hostname is configured', async () => {
    const validate = await loadValidator();
    const directory = await mkdtemp(join(tmpdir(), 'data-foundry-cloudflare-direct-route-'));
    temporaryDirectories.push(directory);
    const paths = await writeDeploymentManifests(directory);
    await writeFile(
      paths.edgeConfigPath,
      (await readFile(paths.edgeConfigPath, 'utf8'))
        .replace('api.datafoundry.io/*', 'marketplace.datafoundry.io/*')
        .replace(
          'VERTICAL_SLUG = "hvac"',
          'VERTICAL_SLUG = "hvac"\nRAPIDAPI_HOSTNAME = "marketplace.datafoundry.io"',
        ),
      'utf8',
    );

    const errors = await validate({ mode: 'deployment', ...paths });
    expect(errors.join('\n')).toMatch(/RAPIDAPI_HOSTNAME.*distinct.*DIRECT.*route/i);
  });

  it('does not treat duplicate RapidAPI routes as a distinct direct API route', async () => {
    const validate = await loadValidator();
    const directory = await mkdtemp(join(tmpdir(), 'data-foundry-cloudflare-duplicate-direct-route-'));
    temporaryDirectories.push(directory);
    const paths = await writeDeploymentManifests(directory);
    await writeFile(
      paths.edgeConfigPath,
      (await readFile(paths.edgeConfigPath, 'utf8'))
        .replace(
          'route = "api.datafoundry.io/*"',
          'routes = ["marketplace.datafoundry.io/*", "marketplace.datafoundry.io/*"]',
        )
        .replace(
          'VERTICAL_SLUG = "hvac"',
          'VERTICAL_SLUG = "hvac"\nRAPIDAPI_HOSTNAME = "marketplace.datafoundry.io"',
        ),
      'utf8',
    );

    const errors = await validate({ mode: 'deployment', ...paths });
    expect(errors.join('\n')).toMatch(/RAPIDAPI_HOSTNAME.*distinct.*DIRECT.*route/i);
  });

  it.each([
    ['malformed', 'not-an-account-id'],
    ['all-zero', '00000000000000000000000000000000'],
    ['different', 'fedcba0987654321fedcba0987654321'],
  ])('rejects a %s acquisition provider account id', async (_label, accountId) => {
    const validate = await loadValidator();
    const directory = await mkdtemp(join(tmpdir(), 'data-foundry-cloudflare-acquisition-account-'));
    temporaryDirectories.push(directory);
    const paths = await writeDeploymentManifests(directory);
    await writeFile(
      paths.acquisitionConfigPath,
      (await readFile(paths.acquisitionConfigPath, 'utf8')).replace(
        `CLOUDFLARE_ACCOUNT_ID = "${ACCOUNT_ID}"`,
        `CLOUDFLARE_ACCOUNT_ID = "${accountId}"`,
      ),
      'utf8',
    );

    const errors = await validate({ mode: 'deployment', ...paths });
    expect(errors.join('\n')).toMatch(/acquisition-worker CLOUDFLARE_ACCOUNT_ID.*canonical account_id/i);
    expect(errors.join('\n')).not.toContain(accountId);
  });

  it.each([
    ['IPv4-mapped IPv6 loopback', '[::ffff:7f00:1]'],
    ['unspecified IPv6', '[::]'],
    ['public IP literal', '8.8.8.8'],
    ['invalid LDH name', 'bad_host.datafoundry.io'],
    ['documentation name', 'service.example.com'],
    ['local special-use name', 'service.local'],
    ['provider fallback name', 'data-foundry-preview.pages.dev'],
  ])('rejects %s in every ignored deployment endpoint', async (_label, hostname) => {
    const validate = await loadValidator();
    const directory = await mkdtemp(join(tmpdir(), 'data-foundry-cloudflare-canonical-host-'));
    temporaryDirectories.push(directory);
    const paths = await writeDeploymentManifests(directory);
    await Promise.all([
      writeFile(
        paths.edgeConfigPath,
        (await readFile(paths.edgeConfigPath, 'utf8')).replace(
          'VERTICAL_SLUG = "hvac"',
          `VERTICAL_SLUG = "hvac"\nRAPIDAPI_HOSTNAME = "${hostname}"`,
        ),
        'utf8',
      ),
      writeFile(
        paths.webConfigPath,
        (await readFile(paths.webConfigPath, 'utf8')).replace(
          'https://www.datafoundry.io',
          `https://${hostname}`,
        ),
        'utf8',
      ),
      writeFile(
        paths.mcpConfigPath,
        (await readFile(paths.mcpConfigPath, 'utf8'))
          .replace('MCP_HOSTNAME = "mcp.datafoundry.io"', `MCP_HOSTNAME = "${hostname}"`)
          .replace('https://app.datafoundry.io', `https://${hostname}`)
          .replace('https://www.datafoundry.io', `https://${hostname}`),
        'utf8',
      ),
    ]);

    const errors = await validate({ mode: 'deployment', ...paths });
    expect(errors.join('\n')).toMatch(/RAPIDAPI_HOSTNAME.*non-loopback/i);
    expect(errors.join('\n')).toMatch(/web.*non-loopback.*PUBLIC_ORIGIN/i);
    expect(errors.join('\n')).toMatch(/non-loopback.*MCP_HOSTNAME/i);
    expect(errors.join('\n')).toMatch(/non-loopback.*MCP_ALLOWED_ORIGINS/i);
  });

  it('rejects lower and mixed-case plaintext credentials but not a Hyperdrive id binding', async () => {
    const validate = await loadValidator();
    const directory = await mkdtemp(join(tmpdir(), 'data-foundry-cloudflare-case-secret-'));
    temporaryDirectories.push(directory);
    const paths = await writeDeploymentManifests(directory);
    await writeFile(
      paths.edgeConfigPath,
      (await readFile(paths.edgeConfigPath, 'utf8')).replace(
        'VERTICAL_SLUG = "hvac"',
        'VERTICAL_SLUG = "hvac"\nrapidApiToken = "fixture-value"\nprivateKey = "fixture-value"',
      ),
      'utf8',
    );

    const errors = await validate({ mode: 'deployment', ...paths });
    expect(errors.join('\n')).toMatch(/rapidApiToken/);
    expect(errors.join('\n')).toMatch(/privateKey/);
    expect(errors.join('\n')).not.toMatch(/HYPERDRIVE.*protected/i);
  });

  it('rejects mixed-case plaintext protected variables nested under repository env vars', async () => {
    const validate = await loadValidator();
    const directory = await mkdtemp(join(tmpdir(), 'data-foundry-cloudflare-repository-case-secret-'));
    temporaryDirectories.push(directory);
    const edgePath = join(directory, 'edge.toml');
    await writeFile(
      edgePath,
      `${await readFile(EDGE_CONFIG, 'utf8')}\n[env.production.vars]\nrapidApiToken = "fixture-value"\nprivateKey = "fixture-value"\n`,
      'utf8',
    );

    const errors = await validate({ edgeConfigPath: edgePath });
    expect(errors.join('\n')).toMatch(/rapidApiToken/);
    expect(errors.join('\n')).toMatch(/privateKey/);
  });

  it('rejects deployment-only topology fields nested under a Hyperdrive binding', async () => {
    const validate = await loadValidator();
    const directory = await mkdtemp(join(tmpdir(), 'data-foundry-cloudflare-nested-route-'));
    temporaryDirectories.push(directory);
    const paths = await writeDeploymentManifests(directory);
    await writeFile(
      paths.edgeConfigPath,
      (await readFile(paths.edgeConfigPath, 'utf8')).replace(
        `binding = "HYPERDRIVE"\nid = "${HYPERDRIVE_ID}"`,
        `binding = "HYPERDRIVE"\nid = "${HYPERDRIVE_ID}"\nroute = "nested.example.invalid/*"`,
      ),
      'utf8',
    );

    const errors = await validate({ mode: 'deployment', ...paths });
    expect(errors.join('\n')).toMatch(/edge.*hyperdrive\[0\]\.route.*top-level/i);
  });

  it('fails deployment mode clearly when a conventional manifest is unreadable', async () => {
    const validate = await loadValidator();
    const directory = await mkdtemp(join(tmpdir(), 'data-foundry-cloudflare-deployment-missing-'));
    temporaryDirectories.push(directory);
    const paths = await writeDeploymentManifests(directory);

    const errors = await validate({
      mode: 'deployment',
      ...paths,
      mcpConfigPath: join(directory, 'missing-mcp.toml'),
    });
    expect(errors).toEqual(['mcp-worker manifest could not be read and parsed as TOML.']);
  });

  it('validates the public web Worker manifest under the same repository policy', async () => {
    const validate = await loadValidator();
    const directory = await mkdtemp(join(tmpdir(), 'data-foundry-cloudflare-web-policy-'));
    temporaryDirectories.push(directory);
    const webPath = join(directory, 'web.toml');
    await writeFile(
      webPath,
      `${await readFile(WEB_CONFIG, 'utf8')}\naccount_id = "00000000000000000000000000000000"\n`,
      'utf8',
    );

    const errors = await validate({ webConfigPath: webPath });
    expect(errors.join('\n')).toMatch(/web.*account_id/i);
  });

  it('requires the acquisition Worker hourly Cron, canonical R2 binding, and no usage Queue', async () => {
    const validate = await loadValidator();
    const directory = await mkdtemp(join(tmpdir(), 'data-foundry-cloudflare-acquisition-'));
    temporaryDirectories.push(directory);
    const acquisitionPath = join(directory, 'acquisition.toml');
    const acquisition = await readFile(ACQUISITION_CONFIG, 'utf8');
    await writeFile(
      acquisitionPath,
      acquisition
        .replace('crons = ["0 * * * *"]', 'crons = ["*/5 * * * *"]')
        .replace('binding = "RAW_ARTIFACTS"', 'binding = "DRIFTED_BUCKET"') +
        '\n[[queues.producers]]\nbinding = "USAGE_EVENTS_QUEUE"\nqueue = "data-foundry-usage-events"\n',
      'utf8',
    );
    const errors = await validate({ acquisitionConfigPath: acquisitionPath });
    expect(errors.join('\n')).toMatch(/hourly/i);
    expect(errors.join('\n')).toMatch(/RAW_ARTIFACTS/);
    expect(errors.join('\n')).toMatch(/must not declare.*Queue/i);
  });

  it('rejects acquisition provider identity and credentials committed as plaintext vars', async () => {
    const validate = await loadValidator();
    const directory = await mkdtemp(join(tmpdir(), 'data-foundry-cloudflare-acquisition-policy-'));
    temporaryDirectories.push(directory);
    const acquisitionPath = join(directory, 'acquisition.toml');
    await writeFile(
      acquisitionPath,
      `${await readFile(ACQUISITION_CONFIG, 'utf8')}\n` +
        '[env.production.vars]\n' +
        'CLOUDFLARE_ACCOUNT_ID = "account-id"\n' +
        'CLOUDFLARE_API_TOKEN = "plain-cloudflare-token"\n' +
        'CRAWL4AI_API_TOKEN = "plain-crawl-token"\n',
      'utf8',
    );

    const errors = await validate({ acquisitionConfigPath: acquisitionPath });
    expect(errors.join('\n')).toMatch(/acquisition-worker.*CLOUDFLARE_ACCOUNT_ID/i);
    expect(errors.join('\n')).toMatch(/acquisition-worker.*CLOUDFLARE_API_TOKEN/i);
    expect(errors.join('\n')).toMatch(/acquisition-worker.*CRAWL4AI_API_TOKEN/i);
  });

  it('requires MCP to share the usage queue while selecting live MCP configuration', async () => {
    const validate = await loadValidator();
    const directory = await mkdtemp(join(tmpdir(), 'data-foundry-cloudflare-mcp-policy-'));
    temporaryDirectories.push(directory);
    const mcpPath = join(directory, 'mcp.toml');
    const mcp = await readFile(MCP_CONFIG, 'utf8');
    await writeFile(
      mcpPath,
      mcp
        .replace('API_KEY_ENVIRONMENT = "live"', 'API_KEY_ENVIRONMENT = "test"')
        .replace('queue = "data-foundry-usage-events"', 'queue = "mcp-private-queue"'),
      'utf8',
    );

    const errors = await validate({ mcpConfigPath: mcpPath });
    expect(errors.join('\n')).toMatch(/mcp.*live/i);
    expect(errors.join('\n')).toMatch(/mcp.*data-foundry-usage-events/i);
  });
});
