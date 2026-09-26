/**
 * Per-vertical edge Workers behind the canonical
 * `api.data.aroqon.com/v1/<slug>/...` contract (ADR-0012), preserving ADR-0011
 * isolation: slugs are validated against the compiled runtime registries,
 * several edge deployments may share one API host with distinct `/v1/<slug>`
 * routes, and every existing deployment safety check still applies to each.
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import {
  BUNDLED_RUNTIME_VERTICALS,
  EDGE_VERTICAL_TEMPLATES,
  validateCloudflareTopology,
  validateCloudflareTopologyReport,
  type CloudflareTopologyOptions,
} from '../scripts/check-cloudflare-topology.js';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const APPS = join(REPO_ROOT, 'apps');
const VEHICLES_TEMPLATE = join(APPS, 'edge', 'wrangler.vehicles.toml');
const ACCOUNT_ID = '1234567890abcdef1234567890abcdef';
const IDS = {
  edge: 'abcdef1234567890abcdef1234567890',
  consumer: 'bcdef1234567890abcdef1234567890a',
  web: 'cdef1234567890abcdef1234567890ab',
  acquisition: 'def1234567890abcdef1234567890abc',
  ingestion: 'f1234567890abcdef1234567890abcde',
  mcp: 'ef1234567890abcdef1234567890abcd',
  vehicles: '0123456789abcdef0123456789abcdef',
};
const WITH_VEHICLES = { edge: [...BUNDLED_RUNTIME_VERTICALS.edge, 'vehicles'] };
const temporaryDirectories: string[] = [];

afterAll(async () => {
  await Promise.all(temporaryDirectories.map((directory) => rm(directory, { recursive: true, force: true })));
});

async function scratch(label: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), `data-foundry-vertical-edge-${label}-`));
  temporaryDirectories.push(directory);
  return directory;
}

const binding = (id: string): string => `\n[[hyperdrive]]\nbinding = "HYPERDRIVE"\nid = "${id}"\n`;
const withTopLevel = (manifest: string, lines: readonly string[]): string =>
  manifest.replace(/^name\s*=\s*[^\n]+/m, (name) => [name, ...lines].join('\n'));
const routesLine = (routes: readonly string[]): string =>
  `routes = [${routes.map((route) => `{ pattern = "${route}", zone_name = "datafoundry.io" }`).join(', ')}]`;

interface DeploymentFixture {
  readonly options: CloudflareTopologyOptions;
  readonly edgePath: string;
  readonly vehiclesPath: string;
}

/** Six ordinary deployment manifests plus a vehicles edge, all internally valid. */
async function writeDeployment(
  directory: string,
  overrides: {
    readonly edgeRoutes?: readonly string[];
    readonly edgeVars?: string;
    readonly vehiclesRoutes?: readonly string[];
    readonly vehiclesVars?: string;
    readonly vehiclesHyperdrive?: string;
    readonly vehiclesAccount?: string;
  } = {},
): Promise<DeploymentFixture> {
  const read = (app: string, file = 'wrangler.toml'): Promise<string> => readFile(join(APPS, app, file), 'utf8');
  const account = `account_id = "${ACCOUNT_ID}"`;
  const edgeVars = overrides.edgeVars ?? '';
  const edge = `${withTopLevel(
    (await read('edge')).replace('API_KEY_ENVIRONMENT = "live"', `API_KEY_ENVIRONMENT = "live"${edgeVars}`),
    [account, routesLine(overrides.edgeRoutes ?? ['api.datafoundry.io/*'])],
  )}${binding(IDS.edge)}`;
  const vehicles = `${withTopLevel(
    (await readFile(VEHICLES_TEMPLATE, 'utf8')).replace(
      'API_KEY_ENVIRONMENT = "live"',
      `API_KEY_ENVIRONMENT = "live"${overrides.vehiclesVars ?? ''}`,
    ),
    [
      `account_id = "${overrides.vehiclesAccount ?? ACCOUNT_ID}"`,
      routesLine(overrides.vehiclesRoutes ?? ['api.datafoundry.io/v1/vehicles/*', 'api.datafoundry.io/v1/vehicles']),
    ],
  )}${binding(overrides.vehiclesHyperdrive ?? IDS.vehicles)}`;
  const consumer = `${withTopLevel(await read('usage-consumer'), [account])}${binding(IDS.consumer)}`;
  const web = `${withTopLevel(
    (await read('web')).replace(
      'DEPLOYMENT_ENVIRONMENT = "production"',
      'DEPLOYMENT_ENVIRONMENT = "production"\nPUBLIC_ORIGIN = "https://www.datafoundry.io"',
    ),
    [account, 'route = "www.datafoundry.io/*"'],
  )}${binding(IDS.web)}`;
  const acquisition = `${withTopLevel(await read('acquisition-worker'), [account])}${binding(IDS.acquisition)}`;
  const ingestion = `${withTopLevel(await read('ingestion-worker'), [account])}${binding(IDS.ingestion)}`;
  const mcp = `${withTopLevel(
    (await read('mcp-worker')).replace(
      'API_KEY_ENVIRONMENT = "live"',
      'API_KEY_ENVIRONMENT = "live"\nMCP_HOSTNAME = "mcp.datafoundry.io"\nMCP_ALLOWED_ORIGINS = "https://app.datafoundry.io"\nPUBLIC_ORIGIN = "https://www.datafoundry.io"',
    ),
    [account, 'route = "mcp.datafoundry.io/*"'],
  )}${binding(IDS.mcp)}`;
  const paths = {
    edgeConfigPath: join(directory, 'edge.toml'),
    consumerConfigPath: join(directory, 'consumer.toml'),
    webConfigPath: join(directory, 'web.toml'),
    acquisitionConfigPath: join(directory, 'acquisition.toml'),
    ingestionConfigPath: join(directory, 'ingestion.toml'),
    mcpConfigPath: join(directory, 'mcp.toml'),
  };
  const vehiclesPath = join(directory, 'wrangler.vehicles.production.toml');
  await Promise.all([
    writeFile(paths.edgeConfigPath, edge, 'utf8'),
    writeFile(paths.consumerConfigPath, consumer, 'utf8'),
    writeFile(paths.webConfigPath, web, 'utf8'),
    writeFile(paths.acquisitionConfigPath, acquisition, 'utf8'),
    writeFile(paths.ingestionConfigPath, ingestion, 'utf8'),
    writeFile(paths.mcpConfigPath, mcp, 'utf8'),
    writeFile(vehiclesPath, vehicles, 'utf8'),
  ]);
  return {
    options: {
      mode: 'deployment',
      ...paths,
      edgeVerticalDeploymentConfigPaths: [vehiclesPath],
      bundledVerticals: WITH_VEHICLES,
    },
    edgePath: paths.edgeConfigPath,
    vehiclesPath,
  };
}

async function templateVariant(transform: (source: string) => string): Promise<string> {
  const directory = await scratch('template');
  const path = join(directory, 'wrangler.vehicles.toml');
  await writeFile(path, transform(await readFile(VEHICLES_TEMPLATE, 'utf8')), 'utf8');
  return path;
}

describe('the tracked per-vertical edge template', () => {
  it('is registered, route-less, id-free and passes with its runtime gate deferred until vehicles is bundled', async () => {
    expect(EDGE_VERTICAL_TEMPLATES.map(({ configPath }) => configPath)).toContain(VEHICLES_TEMPLATE);
    const source = await readFile(VEHICLES_TEMPLATE, 'utf8');
    expect(source).toContain('name = "data-foundry-edge-vehicles"');
    expect(source).toContain('VERTICAL_SLUG = "vehicles"');
    expect(source).toContain('API_PATH_PREFIX = "/v1/vehicles"');
    expect(source).toContain('queue = "data-foundry-usage-events"');
    expect(source).not.toMatch(/^\s*(account_id|route|routes)\s*=/m);
    expect(source).not.toMatch(/^\s*id\s*=/m);

    const unbundled = await validateCloudflareTopologyReport({ bundledVerticals: { edge: ['hvac'] } });
    expect(unbundled.errors).toEqual([]);
    expect(unbundled.notices.join('\n')).toMatch(/"vehicles" edge runtime is not compiled.*deferred/);

    const bundled = await validateCloudflareTopologyReport({ bundledVerticals: WITH_VEHICLES });
    expect(bundled.errors).toEqual([]);
    expect(bundled.notices).toEqual([]);
  });

  it.each([
    ['a different Worker name', (s: string) => s.replace('data-foundry-edge-vehicles', 'data-foundry-edge'), /distinct Worker names|data-foundry-edge-<VERTICAL_SLUG>/],
    ['a missing prefix', (s: string) => s.replace('API_PATH_PREFIX = "/v1/vehicles"\n', ''), /must set API_PATH_PREFIX/],
    ['a prefix for another vertical', (s: string) => s.replace('"/v1/vehicles"', '"/v1/hvac"'), /API_PATH_PREFIX must match/],
    ['a malformed prefix', (s: string) => s.replace('"/v1/vehicles"', '"/v1/vehicles/"'), /API_PATH_PREFIX must match/],
    ['the primary edge vertical', (s: string) => s.replaceAll('vehicles', 'hvac'), /different vertical/],
    ['test keys', (s: string) => s.replace('API_KEY_ENVIRONMENT = "live"', 'API_KEY_ENVIRONMENT = "test"'), /only live API keys/],
    ['a committed route', (s: string) => s.replace('main = "src/index.ts"', 'main = "src/index.ts"\nroute = "api.data.aroqon.com/v1/vehicles/*"'), /commits deployment-specific route/],
    ['a committed account id', (s: string) => s.replace('main = "src/index.ts"', `main = "src/index.ts"\naccount_id = "${ACCOUNT_ID}"`), /commits deployment-specific account_id/],
    ['an extra capability', (s: string) => `${s}\n[[r2_buckets]]\nbinding = "RAW"\nbucket_name = "data-foundry-raw-artifacts"\n`, /r2_buckets top-level capability/],
    ['another queue', (s: string) => s.replace('queue = "data-foundry-usage-events"', 'queue = "vehicles-usage"'), /USAGE_EVENTS_QUEUE producer/],
    ['different edge code', (s: string) => s.replace('main = "src/index.ts"', 'main = "src/other.ts"'), /same edge entry point/],
    ['a plaintext Stripe secret', (s: string) => s.replace('API_KEY_ENVIRONMENT = "live"', 'API_KEY_ENVIRONMENT = "live"\nSTRIPE_SECRET_KEY = "sk_live_x"'), /STRIPE_SECRET_KEY/],
    ['public billing vars', (s: string) => s.replace('API_KEY_ENVIRONMENT = "live"', 'API_KEY_ENVIRONMENT = "live"\nBILLING_PUBLIC_ORIGIN = "https://api.data.aroqon.com"'), /BILLING_PUBLIC_ORIGIN/],
  ])('rejects a template with %s', async (_label, transform, pattern) => {
    const path = await templateVariant(transform);
    const errors = await validateCloudflareTopology({ edgeVerticalConfigPaths: [path], bundledVerticals: WITH_VEHICLES });
    expect(errors.join('\n')).toMatch(pattern);
  });
});

describe('slug selection is validated against the compiled registries, not a hard-coded vertical', () => {
  it('keeps the committed HVAC single-deployment templates valid', async () => {
    expect(BUNDLED_RUNTIME_VERTICALS.edge).toContain('hvac');
    expect(await validateCloudflareTopology({ edgeVerticalConfigPaths: [] })).toEqual([]);
  });

  it('refuses a Worker that selects a vertical its bundle does not carry', async () => {
    const errors = await validateCloudflareTopology({
      edgeVerticalConfigPaths: [],
      bundledVerticals: { edge: ['vehicles'], mcp: ['vehicles'], acquisition: ['vehicles'], ingestion: ['vehicles'] },
    });
    const joined = errors.join('\n');
    expect(joined).toMatch(/edge must select a vertical compiled into the edge runtime registry/);
    expect(joined).toMatch(/mcp-worker must select a vertical compiled into the MCP runtime registry/);
    expect(joined).toMatch(/acquisition-worker must select a vertical compiled into the acquisition runtime registry/);
    expect(joined).toMatch(/ingestion-worker must select a vertical compiled into the ingestion runtime registry/);
  });

  it('accepts any bundled slug, including a primary edge on its own canonical prefix', async () => {
    const directory = await scratch('primary-prefix');
    const edgePath = join(directory, 'edge.toml');
    const source = await readFile(join(APPS, 'edge', 'wrangler.toml'), 'utf8');
    await writeFile(edgePath, source.replace('VERTICAL_SLUG = "hvac"', 'VERTICAL_SLUG = "hvac"\nAPI_PATH_PREFIX = "/v1/hvac"'), 'utf8');
    expect(await validateCloudflareTopology({ edgeConfigPath: edgePath, edgeVerticalConfigPaths: [] })).toEqual([]);

    await writeFile(edgePath, source.replace('VERTICAL_SLUG = "hvac"', 'VERTICAL_SLUG = "hvac"\nAPI_PATH_PREFIX = "/v1/vehicles"'), 'utf8');
    expect((await validateCloudflareTopology({ edgeConfigPath: edgePath, edgeVerticalConfigPaths: [] })).join('\n')).toMatch(
      /edge API_PATH_PREFIX must match/,
    );
  });
});

describe('several edge deployments share api host with distinct /v1/<slug> routes', () => {
  it('accepts an un-prefixed HVAC edge plus a prefixed vehicles edge on the same host', async () => {
    const fixture = await writeDeployment(await scratch('shared-host'));
    expect(await validateCloudflareTopology(fixture.options)).toEqual([]);
  });

  it('accepts both verticals on canonical prefixes and a shared edge-role Hyperdrive', async () => {
    const fixture = await writeDeployment(await scratch('both-prefixed'), {
      edgeRoutes: ['api.datafoundry.io/v1/hvac/*', 'api.datafoundry.io/v1/hvac'],
      edgeVars: '\nAPI_PATH_PREFIX = "/v1/hvac"',
      vehiclesHyperdrive: IDS.edge,
    });
    expect(await validateCloudflareTopology(fixture.options)).toEqual([]);
  });

  it.each([
    [{ vehiclesRoutes: ['api.datafoundry.io/*'] }, /routes must be exactly <public-host>\/v1\/vehicles\/\*/],
    [{ vehiclesRoutes: ['api.datafoundry.io/v1/hvac/*'] }, /routes must be exactly <public-host>\/v1\/vehicles\/\*/],
    [{ vehiclesRoutes: ['api.datafoundry.io/v1/vehicles*'] }, /routes must be exactly/],
    [{ vehiclesRoutes: ['api.datafoundry.io/v1/vehicles'] }, /routes must be exactly/],
    [{ vehiclesRoutes: ['localhost./v1/vehicles/*'] }, /routes must be exactly/],
    [
      { edgeRoutes: ['api.datafoundry.io/v1/vehicles/*'], edgeVars: '\nAPI_PATH_PREFIX = "/v1/hvac"' },
      /routes must be exactly <public-host>\/v1\/hvac\/\*/,
    ],
    [{ vehiclesHyperdrive: IDS.web }, /edge role's Hyperdrive configuration, never another Worker role's/],
    [{ vehiclesAccount: 'fedcba0987654321fedcba0987654321' }, /one canonical account_id/],
  ])('rejects an unsafe edge deployment %#', async (overrides, pattern) => {
    const fixture = await writeDeployment(await scratch('reject'), overrides);
    const errors = await validateCloudflareTopology(fixture.options);
    expect(errors.join('\n')).toMatch(pattern);
    expect(errors.join('\n')).not.toContain('fedcba0987654321fedcba0987654321');
  });

  it('rejects two edge deployments claiming the same route pattern', async () => {
    const directory = await scratch('duplicate');
    const fixture = await writeDeployment(directory);
    const second = join(directory, 'second.toml');
    await writeFile(
      second,
      (await readFile(fixture.vehiclesPath, 'utf8')).replace('data-foundry-edge-vehicles', 'data-foundry-edge-vehicles-copy'),
      'utf8',
    );
    const errors = await validateCloudflareTopology({
      ...fixture.options,
      edgeVerticalDeploymentConfigPaths: [fixture.vehiclesPath, second],
    });
    expect(errors.join('\n')).toMatch(/claim the same edge route pattern/);
    expect(errors.join('\n')).toMatch(/already serves/);
  });

  it('refuses a vehicles deployment until the vehicles runtime is bundled', async () => {
    const fixture = await writeDeployment(await scratch('unbundled'));
    const errors = await validateCloudflareTopology({ ...fixture.options, bundledVerticals: { edge: ['hvac'] } });
    expect(errors.join('\n')).toMatch(/not compiled into the edge runtime registry/);
  });

  it('keeps an HVAC-only deployment valid and reports the absent vehicles manifest as a notice', async () => {
    const fixture = await writeDeployment(await scratch('hvac-only'));
    const { edgeVerticalDeploymentConfigPaths: _omitted, ...hvacOnly } = fixture.options;
    const report = await validateCloudflareTopologyReport(hvacOnly);
    expect(report.errors).toEqual([]);
    // Only a conventional ignored path is named; no id, host or secret.
    for (const notice of report.notices) expect(notice).not.toMatch(/[0-9a-f]{32}|datafoundry\.io/);

    const missing = await validateCloudflareTopology({
      ...fixture.options,
      edgeVerticalDeploymentConfigPaths: [join(await scratch('missing'), 'absent.toml')],
    });
    expect(missing.join('\n')).toMatch(/could not be read/);
  });

  it('keeps RapidAPI hostname rules per edge deployment', async () => {
    const shared = await writeDeployment(await scratch('rapidapi-shared'), {
      vehiclesVars: '\nRAPIDAPI_HOSTNAME = "api.datafoundry.io"',
    });
    expect((await validateCloudflareTopology(shared.options)).join('\n')).toMatch(
      /edge:wrangler\.vehicles\.production\.toml RAPIDAPI_HOSTNAME requires a distinct DIRECT API/,
    );
    const separate = await writeDeployment(await scratch('rapidapi-separate'), {
      vehiclesRoutes: ['api.datafoundry.io/v1/vehicles/*', 'marketplace.datafoundry.io/v1/vehicles/*'],
      vehiclesVars: '\nRAPIDAPI_HOSTNAME = "marketplace.datafoundry.io"',
    });
    expect(await validateCloudflareTopology(separate.options)).toEqual([]);
  });
});

describe('edge billing vars are all-or-nothing and bound to a DIRECT route', () => {
  const billing = (overrides: Record<string, string> = {}): string =>
    Object.entries({
      STRIPE_PRICE_IDS: '{"developer":"price_Dev0001","growth":"price_Growth0001","scale":"price_Scale0001"}',
      BILLING_PUBLIC_ORIGIN: 'https://api.datafoundry.io',
      BILLING_RETURN_URL: 'https://www.datafoundry.io/vehicles/pricing',
      ...overrides,
    })
      .filter(([, value]) => value !== '')
      .map(([key, value]) => `\n${key} = '${value}'`)
      .join('');

  it('accepts a complete billing configuration on each edge', async () => {
    const fixture = await writeDeployment(await scratch('billing-ok'), {
      edgeVars: billing({ BILLING_RETURN_URL: 'https://www.datafoundry.io/hvac/pricing' }),
      vehiclesVars: billing(),
    });
    expect(await validateCloudflareTopology(fixture.options)).toEqual([]);
  });

  it.each([
    [{ BILLING_RETURN_URL: '' }, /must be configured together/],
    [{ BILLING_PUBLIC_ORIGIN: 'https://pay.datafoundry.io' }, /BILLING_PUBLIC_ORIGIN hostname must match a DIRECT/],
    [{ BILLING_PUBLIC_ORIGIN: 'https://api.datafoundry.io/v1/vehicles' }, /BILLING_PUBLIC_ORIGIN must be a non-loopback exact HTTPS origin/],
    [{ BILLING_RETURN_URL: 'http://www.datafoundry.io/pricing' }, /BILLING_RETURN_URL must be/],
    [{ STRIPE_PRICE_IDS: '{"developer":"sk_live_oops"}' }, /STRIPE_PRICE_IDS must be/],
    [{ STRIPE_PRICE_IDS: 'not json' }, /STRIPE_PRICE_IDS must be/],
  ])('rejects %#', async (overrides, pattern) => {
    const fixture = await writeDeployment(await scratch('billing-bad'), { vehiclesVars: billing(overrides) });
    expect((await validateCloudflareTopology(fixture.options)).join('\n')).toMatch(pattern);
  });
});
