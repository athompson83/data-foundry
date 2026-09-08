import { mkdir, mkdtemp, readFile, rm, writeFile }  from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'smol-toml';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { REPO_ROOT } from '../scripts/check-cloudflare-topology.js';
import { checkSyntheticIngestionConfig, validateSyntheticIngestion, syntheticArtifactManifest, SYNTHETIC_CONFIG_PATH } from '../scripts/check-synthetic-ingestion.js';
import { buildCloudflareArtifacts, CLOUDFLARE_ARTIFACT_SERVICES } from '../scripts/check-cloudflare-artifacts.js';
const controls = async (): Promise<Record<string, unknown>[]> => {
  const names = ['edge', 'usage-consumer', 'web', 'acquisition-worker', 'ingestion-worker', 'mcp-worker'];
  return Promise.all([...names.map(name => [name, 'wrangler.toml']), ...names.map(name => [name, 'wrangler.private-canary.toml']), ['private-canary', 'wrangler.toml']].map(async ([name, file]) => ({
    ...parse(await readFile(join(REPO_ROOT, 'apps', name!, file!), 'utf8')), account_id: 'a'.repeat(32), ...(name === 'private-canary' ? {} : { hyperdrive: [{ binding: 'HYPERDRIVE', id: name === 'ingestion-worker' ? 'b'.repeat(32) : String(names.indexOf(name!) + 1).repeat(32) }] }),
  })));
};
const config = async () => parse(await readFile(SYNTHETIC_CONFIG_PATH, 'utf8')) as Record<string, unknown>;
describe('separate synthetic ingestion phase', () => {
  it('keeps the core thirteen profiles separate and validates isolated synthetic resources', async () => {
    expect(CLOUDFLARE_ARTIFACT_SERVICES).toHaveLength(13);
    expect(await validateSyntheticIngestion()).toEqual([]);
  });
  it('emits only the two verified fictional artifact identities for review', async () => {
    expect(await syntheticArtifactManifest()).toMatchObject({ kind: 'data-foundry.synthetic-ingestion-artifacts.v1', bucket: 'data-foundry-private-ingestion-artifacts', artifacts: [
      { sourceKey: 'acme-hvac-catalog', bytes: 4597 }, { sourceKey: 'ahri-directory-export', bytes: 1868 },
    ] });
  });
  it.each(['triggers', 'routes', 'services', 'send_email', 'env', 'hyperdrive', 'account_id'])('refuses unexpected %s capability', async key => {
    expect(checkSyntheticIngestionConfig({ ...await config(), [key]: {} }, [])).not.toEqual([]);
  });
  it('refuses alternate buckets, queues, producer capability and environment overrides', async () => {
    for (const change of [
      { r2_buckets: [{ binding: 'SYNTHETIC_ARTIFACTS', bucket_name: 'data-foundry-raw-artifacts' }] },
      { queues: { producers: [{ binding: 'INGESTION_QUEUE', queue: 'data-foundry-ingestion' }] } },
      { vars: { DEPLOYMENT_ENVIRONMENT: 'production', SYNTHETIC_INGESTION_MODE: 'fixed-fixtures-v1', POSTGRES_URL: 'forbidden' } },
    ]) expect(checkSyntheticIngestionConfig({ ...await config(), ...change }, [])).not.toEqual([]);
  });
  it.each(['data-foundry-private-ingestion', 'data-foundry-private-ingestion-dlq', 'data-foundry-private-ingestion-artifacts'])('refuses another profile sharing %s', async name => {
    expect(checkSyntheticIngestionConfig(await config(), [{ r2_buckets: [{ bucket_name: name }] }])).toContainEqual(expect.stringContaining('distinct'));
  });
  it('only accepts exact deployment metadata on the closed capability profile', async () => {
    const deployed = { ...await config(), account_id: 'a'.repeat(32), hyperdrive: [{ binding: 'HYPERDRIVE', id: 'b'.repeat(32) }] };
    expect(checkSyntheticIngestionConfig(deployed, await controls(), true)).toEqual([]);
    expect(checkSyntheticIngestionConfig({ ...deployed, hyperdrive: [{ binding: 'HYPERDRIVE', id: '0'.repeat(32) }] }, [], true)).not.toEqual([]);
    expect(checkSyntheticIngestionConfig({ ...deployed, hyperdrive: [{ binding: 'HYPERDRIVE', id: 'b'.repeat(32), localConnectionString: 'forbidden' }] }, [], true)).not.toEqual([]);
  });
  it('refuses missing controls, a different account and another role Hyperdrive', async () => {
    const deployed = { ...await config(), account_id: 'a'.repeat(32), hyperdrive: [{ binding: 'HYPERDRIVE', id: 'b'.repeat(32) }] };
    expect(checkSyntheticIngestionConfig(deployed, [], true)).toContainEqual(expect.stringContaining('thirteen reviewed'));
    expect(checkSyntheticIngestionConfig({ ...deployed, account_id: 'd'.repeat(32) }, await controls(), true)).toContainEqual(expect.stringContaining('canonical account'));
    expect(checkSyntheticIngestionConfig({ ...deployed, hyperdrive: [{ binding: 'HYPERDRIVE', id: 'c'.repeat(32) }] }, await controls(), true)).toContainEqual(expect.stringContaining('ingestion Hyperdrive'));
    const changed = await controls(); changed[0] = { ...changed[0], account_id: 'd'.repeat(32) };
    expect(checkSyntheticIngestionConfig(deployed, changed, true)).toContainEqual(expect.stringContaining('canonical account'));
  });
  it('checks collisions in the supplied actual deployment controls', async () => {
    const deployed = { ...await config(), account_id: 'a'.repeat(32), hyperdrive: [{ binding: 'HYPERDRIVE', id: 'b'.repeat(32) }] };
    const changed = await controls(); changed[0] = { ...changed[0], queues: { producers: [{ queue: 'data-foundry-private-ingestion' }] } };
    expect(checkSyntheticIngestionConfig(deployed, changed, true)).toContainEqual(expect.stringContaining('distinct'));
  });
  it('refuses deployment validation without the actual ignored control manifests', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'synthetic-missing-controls-'));
    try { expect(await validateSyntheticIngestion({ deployment: true, controlRoot: directory })).toContainEqual(expect.stringContaining('every exact deployment control')); }
    finally { await rm(directory, { recursive: true, force: true }); }
  });
  it('validates all actual ordinary and reduced deployment manifests before accepting the second phase', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'synthetic-reviewed-controls-'));
    try {
      const profiles = await controls();
      const names = ['edge', 'usage-consumer', 'web', 'acquisition-worker', 'ingestion-worker', 'mcp-worker'];
      for (const [index, profile] of profiles.entries()) {
        const app = index === 12 ? 'private-canary' : names[index % 6]!;
        const vars = profile['vars'] as Record<string, unknown>;
        if (index < 6) {
          if (app === 'edge') profile['route'] = 'api.datafoundry.io/*';
          if (app === 'web') { profile['route'] = 'www.datafoundry.io/*'; vars['PUBLIC_ORIGIN'] = 'https://www.datafoundry.io'; }
          if (app === 'acquisition-worker') vars['CLOUDFLARE_ACCOUNT_ID'] = 'a'.repeat(32);
          if (app === 'mcp-worker') { profile['route'] = 'mcp.datafoundry.io/*'; Object.assign(vars, { MCP_HOSTNAME: 'mcp.datafoundry.io', MCP_ALLOWED_ORIGINS: 'https://app.datafoundry.io', PUBLIC_ORIGIN: 'https://www.datafoundry.io' }); }
        }
        const folder = join(directory, 'apps', app); await mkdir(folder, { recursive: true });
        await writeFile(join(folder, index < 6 || index === 12 ? 'wrangler.production.toml' : 'wrangler.private-canary.production.toml'), stringify(profile));
      }
      const deployed = { ...await config(), account_id: 'a'.repeat(32), hyperdrive: [{ binding: 'HYPERDRIVE', id: 'b'.repeat(32) }] };
      const configPath = join(directory, 'synthetic.toml'); await writeFile(configPath, stringify(deployed));
      expect(await validateSyntheticIngestion({ configPath, deployment: true, controlRoot: directory })).toEqual([]);
      // An actually edited ignored ordinary manifest must be observed; tracked templates are insufficient.
      const changedPath = join(directory, 'apps/edge/wrangler.production.toml');
      const changed = parse(await readFile(changedPath, 'utf8')) as Record<string, unknown>;
      changed['account_id'] = 'd'.repeat(32); await writeFile(changedPath, stringify(changed));
      expect(await validateSyntheticIngestion({ configPath, deployment: true, controlRoot: directory })).toContainEqual(expect.stringContaining('canonical account'));
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  it('builds the separate fourteenth profile with no filesystem/PDF/PGlite runtime', async () => {
    const result = await buildCloudflareArtifacts({ syntheticOnly: true });
    expect(result.services).toEqual(['synthetic-ingestion-worker']);
    expect(result.files).toBeGreaterThan(0);
  }, 60_000);
});
