/**
 * The RapidAPI listing package for `vehicles` is copy-paste input for an owner
 * action. Its plan table must not drift from `verticals/vehicles/product.yaml`,
 * and its OpenAPI import instructions must match the generated artifact.
 */
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { beforeAll, describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const LISTING = join(REPO_ROOT, 'docs', 'owner-actions', 'rapidapi-vehicles-listing.md');
const PRODUCT = join(REPO_ROOT, 'verticals', 'vehicles', 'product.yaml');
const OPENAPI = 'openapi/data-foundry-vehicles-rapidapi-v1.openapi.json';

interface Plan {
  readonly name: string;
  readonly monthly_usd: number;
  readonly included_requests: number;
}

let listing: string;
let product: { plans: Plan[] };

beforeAll(async () => {
  listing = await readFile(LISTING, 'utf8');
  product = parseYaml(await readFile(PRODUCT, 'utf8'));
});

function planTable(): { tier: string; plan: Plan; visibility: string }[] {
  const start = listing.indexOf('<!-- plan-table:start -->');
  const end = listing.indexOf('<!-- plan-table:end -->');
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  const rows = listing
    .slice(start, end)
    .split('\n')
    .filter((line) => line.startsWith('|'))
    .slice(2); // header and separator
  return rows.map((row) => {
    const cells = row.split('|').slice(1, -1).map((cell) => cell.trim());
    expect(cells, row).toHaveLength(5);
    const [tier, name, price, requests, visibility] = cells as [string, string, string, string, string];
    expect(price, row).toMatch(/^\$\d+$/);
    expect(requests, row).toMatch(/^\d{1,3}(,\d{3})*$/);
    return {
      tier,
      visibility,
      plan: {
        name,
        monthly_usd: Number(price.slice(1)),
        included_requests: Number(requests.replaceAll(',', '')),
      },
    };
  });
}

describe('RapidAPI vehicles listing package', () => {
  it('lists exactly product.yaml plans, prices and monthly allowances, in order', () => {
    expect(planTable().map(({ plan }) => plan)).toEqual(product.plans);
  });

  it('maps the conversion-first ladder onto RapidAPI tiers, with the free tier on BASIC', () => {
    const table = planTable();
    expect(table.map(({ tier }) => tier)).toEqual(['BASIC', 'PRO', 'ULTRA', 'MEGA', 'Custom']);
    expect(table[0]!.plan.monthly_usd).toBe(0);
    expect(table.slice(0, 4).every(({ visibility }) => visibility === 'Public')).toBe(true);
    expect(table[4]!.visibility).toMatch(/^Private/);
  });

  it('keeps a hard quota with no overage on every plan', () => {
    expect(listing).toContain('**hard limit**');
    expect(listing).toContain('no overage fee');
    expect(listing).toMatch(/Limit type: \*\*Hard limit\*\*/);
  });

  it('states current coverage honestly: prelaunch, and VIN → recalls not yet available', () => {
    expect(listing).toMatch(/Status: prelaunch/);
    expect(listing).toMatch(/VIN → open recalls/);
    expect(listing).toMatch(/\*\*not available yet\*\*/);
    expect(listing).toMatch(/vPIC/);
  });

  it('carries the US-government-source attribution and non-endorsement text', () => {
    expect(listing).toContain('not endorsed by NHTSA, EPA, DOE or the U.S. Department of Transportation');
    expect(listing).toContain('Not endorsed by NHTSA, EPA, DOE or the U.S. Department of Transportation');
  });

  it('imports the generated RapidAPI projection with the vehicles path prefix applied', async () => {
    expect(listing).toContain(`\`${OPENAPI}\``);
    const document = JSON.parse(await readFile(join(REPO_ROOT, OPENAPI), 'utf8')) as {
      paths: Record<string, unknown>;
      components?: { securitySchemes?: Record<string, unknown> };
    };
    // The marketplace projection never documents the origin bearer.
    expect(document.components?.securitySchemes ?? {}).toEqual({});
    const prefixed = Object.keys(document.paths).map((path) => path.replace(/^\/v1\//, '/v1/vehicles/'));
    expect(Object.keys(document.paths).every((path) => path.startsWith('/v1/'))).toBe(true);
    for (const path of prefixed) expect(listing, path).toContain(`\`${path}\``);
    expect(listing).toMatch(new RegExp(`exactly ${['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'][prefixed.length]} GET endpoints`));
  });

  it('keeps the origin credential and proxy secret off argv and out of RapidAPI', () => {
    expect(listing).toContain(
      'pnpm exec wrangler secret put RAPIDAPI_PROXY_SECRET --config apps/edge/wrangler.vehicles.production.toml --env-file tooling/wrangler-empty.env',
    );
    expect(listing).toContain('cloudflare-deployment.md` section 10.2');
    expect(listing).not.toMatch(/df_(?:live|test)_[A-Za-z0-9_-]{8,}/);
  });
});
