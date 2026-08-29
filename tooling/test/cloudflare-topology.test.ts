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
      readonly edgeConfigPath?: string;
      readonly consumerConfigPath?: string;
      readonly webConfigPath?: string;
      readonly acquisitionConfigPath?: string;
      readonly mcpConfigPath?: string;
    },
  ) => Promise<readonly string[]>;
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
