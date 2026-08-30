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
const temporaryDirectories: string[] = [];

afterAll(async () => {
  await Promise.all(temporaryDirectories.map((directory) => rm(directory, { recursive: true, force: true })));
});

async function loadValidator(): Promise<(
  options?: {
    readonly mode?: 'repository' | 'deployment';
    readonly edgeConfigPath?: string;
    readonly consumerConfigPath?: string;
    readonly webConfigPath?: string;
    readonly acquisitionConfigPath?: string;
    readonly mcpConfigPath?: string;
  },
) => Promise<readonly string[]>> {
  const module = await import('../scripts/check-cloudflare-topology.js').catch(() => null);
  expect(module, 'the repository needs a cross-manifest Cloudflare topology validator').not.toBeNull();
  const validate = (module as Record<string, unknown> | null)?.['validateCloudflareTopology'];
  expect(typeof validate).toBe('function');
  return validate as (
    options?: {
      readonly mode?: 'repository' | 'deployment';
      readonly edgeConfigPath?: string;
      readonly consumerConfigPath?: string;
      readonly webConfigPath?: string;
      readonly acquisitionConfigPath?: string;
      readonly mcpConfigPath?: string;
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
  const binding = '\n[[hyperdrive]]\nbinding = "HYPERDRIVE"\nid = "00000000000000000000000000000000"\n';
  const edgeConfigPath = join(directory, 'edge.toml');
  const consumerConfigPath = join(directory, 'consumer.toml');
  const webConfigPath = join(directory, 'web.toml');
  const acquisitionConfigPath = join(directory, 'acquisition.toml');
  const mcpConfigPath = join(directory, 'mcp.toml');
  const edge = `${await readFile(EDGE_CONFIG, 'utf8')}${binding}\nroute = "edge.example.invalid/*"\n`;
  const consumer = `${await readFile(CONSUMER_CONFIG, 'utf8')}${binding}`;
  const web = `${(await readFile(WEB_CONFIG, 'utf8')).replace(
    'DEPLOYMENT_ENVIRONMENT = "production"',
    'DEPLOYMENT_ENVIRONMENT = "production"\nPUBLIC_ORIGIN = "https://web.example.invalid"',
  )}${binding}\nroute = "web.example.invalid/*"\n`;
  const acquisition = `${await readFile(ACQUISITION_CONFIG, 'utf8')}${binding}`;
  const mcp = `${(await readFile(MCP_CONFIG, 'utf8')).replace(
    'API_KEY_ENVIRONMENT = "live"',
    'API_KEY_ENVIRONMENT = "live"\nMCP_HOSTNAME = "mcp.example.invalid"\nMCP_ALLOWED_ORIGINS = "https://client.example.invalid"\nPUBLIC_ORIGIN = "https://web.example.invalid"',
  )}${binding}\nroute = "mcp.example.invalid/*"\n`;
  await Promise.all([
    writeFile(edgeConfigPath, edge, 'utf8'),
    writeFile(consumerConfigPath, consumer, 'utf8'),
    writeFile(webConfigPath, web, 'utf8'),
    writeFile(acquisitionConfigPath, acquisition, 'utf8'),
    writeFile(mcpConfigPath, mcp, 'utf8'),
  ]);
  return { edgeConfigPath, consumerConfigPath, webConfigPath, acquisitionConfigPath, mcpConfigPath };
}

describe('the committed Cloudflare topology', () => {
  it('defines a production edge producer and idempotent consumer with one matching queue and DLQ', async () => {
    const validate = await loadValidator();
    expect(await validate()).toEqual([]);
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
