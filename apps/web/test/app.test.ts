/**
 * Dispatch, end to end, through the real query layer — same discipline as
 * `apps/edge/test/index.test.ts`. The platform-level routes (`/`,
 * `/robots.txt`, `/sitemap-index.xml`, 404, method refusal) are proven against
 * the REAL compiled `hvac` runtime. The quality-gate proof is separate
 * (`gates-live.test.ts`) because it needs entities shaped like the real
 * vertical's `critical` properties, which the shared query-model fixtures
 * (entity_type `equipment`/`part`) are not.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createQueryFixtures, type QueryFixtures } from '../../../packages/query-model/test/support.js';
import { createWebApp } from '../src/app.js';
import { resolveContext } from '../src/config.js';
import { getDeployment, resetDeployments } from '../src/composition.js';
import { RUNTIMES } from '../src/index.js';

let fixtures: QueryFixtures;
const openFixtureDriver = async () => fixtures.driver;

beforeAll(async () => {
  fixtures = await createQueryFixtures();
});

afterAll(async () => {
  await fixtures.driver.close();
});

afterEach(() => {
  resetDeployments();
});

async function appHandler() {
  const deployment = await getDeployment({
    env: { POSTGRES_URL: 'postgres://fixture/db' },
    runtimes: RUNTIMES,
    openDriver: openFixtureDriver,
  });
  return createWebApp(resolveContext(deployment));
}

describe('the parent site', () => {
  it('lists every composed vertical', async () => {
    const app = await appHandler();
    const response = await app({ method: 'GET', url: '/' });
    expect(response.status).toBe(200);
    expect(response.body).toContain('HVAC Equipment');
    expect(response.body).toContain('/data/hvac');
  });

  it('is indexable — this is the discovery hub, not a generated page', async () => {
    const app = await appHandler();
    const response = await app({ method: 'GET', url: '/' });
    expect(response.body).toContain('name="robots" content="index,follow"');
  });
});

describe('robots.txt and the sitemap index', () => {
  it('serves robots.txt pointing at one global sitemap index', async () => {
    const app = await appHandler();
    const response = await app({ method: 'GET', url: '/robots.txt' });
    expect(response.status).toBe(200);
    expect(response.body).toContain('Sitemap: ');
    expect(response.body).toContain('/sitemap-index.xml');
  });

  it('serves a sitemap index naming every segment of every composed vertical', async () => {
    const app = await appHandler();
    const response = await app({ method: 'GET', url: '/sitemap-index.xml' });
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('application/xml');
    expect(response.body).toContain('<sitemapindex');
    expect(response.body).toContain('/data/hvac/sitemaps/');
  });
});

describe('the hvac dataset landing page', () => {
  it('renders 200 with links to every declared entity type', async () => {
    const app = await appHandler();
    const response = await app({ method: 'GET', url: '/data/hvac' });
    expect(response.status).toBe(200);
    expect(response.body).toContain('Equipment Models');
    expect(response.body).toContain('Manufacturers');
  });
});

describe('manual search', () => {
  it('renders the bare search form as indexable', async () => {
    const app = await appHandler();
    const response = await app({ method: 'GET', url: '/data/hvac/search' });
    expect(response.status).toBe(200);
    expect(response.body).toContain('<form class="search"');
    expect(response.body).toContain('name="robots" content="index,follow"');
  });

  it('marks a parametrized query noindex — it is a generated, combinatorial view', async () => {
    const app = await appHandler();
    const response = await app({ method: 'GET', url: '/data/hvac/search?q=acme' });
    expect(response.status).toBe(200);
    expect(response.body).toContain('name="robots" content="noindex,follow"');
  });
});

describe('the docs page', () => {
  it('renders and links to llms.txt', async () => {
    const app = await appHandler();
    const response = await app({ method: 'GET', url: '/data/hvac/docs' });
    expect(response.status).toBe(200);
    expect(response.body).toContain('llms.txt');
  });
});

describe('llms.txt', () => {
  it('is plain text and names the vertical', async () => {
    const app = await appHandler();
    const response = await app({ method: 'GET', url: '/data/hvac/llms.txt' });
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/plain');
    expect(response.body).toContain('HVAC Equipment');
  });
});

describe('unmatched requests', () => {
  it('answers 404 for a path naming no vertical', async () => {
    const app = await appHandler();
    const response = await app({ method: 'GET', url: '/nothing-here' });
    expect(response.status).toBe(404);
  });

  it('answers 404 for a path inside a real vertical that matches no page class', async () => {
    const app = await appHandler();
    const response = await app({ method: 'GET', url: '/data/hvac/this-is-not-a-route' });
    expect(response.status).toBe(404);
  });

  it('answers 404 for an entity slug that does not exist', async () => {
    const app = await appHandler();
    const response = await app({ method: 'GET', url: '/data/hvac/equipment/does-not-exist' });
    expect(response.status).toBe(404);
  });

  it('refuses a write method — this surface is exactly as read-only as the metered API', async () => {
    const app = await appHandler();
    const response = await app({ method: 'POST', url: '/' });
    expect(response.status).toBe(405);
  });
});
