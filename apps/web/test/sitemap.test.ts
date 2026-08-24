/**
 * Regression coverage for a defect review found: `sitemapSegmentXml`
 * unconditionally listed `dataset_landing` in the `datasets` segment, even
 * when the SAME gate `renderDatasetLanding` evaluates for that page's own
 * robots meta tag says `noindex`. `include_only_indexable: true` and
 * `on_gate_failure.in_sitemap: false` in `seo.yaml` both say a failed gate
 * must not appear in the sitemap; this proves it does not, against the real
 * compiled hvac gate thresholds (`min_entities: 25`), which the shared
 * fixtures (four entities) genuinely fail — not a contrived double.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createQueryFixtures, type QueryFixtures } from '../../../packages/query-model/test/support.js';
import { getDeployment, resetDeployments } from '../src/composition.js';
import { sitemapSegmentXml } from '../src/sitemap.js';
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

describe('sitemapSegmentXml — dataset_landing is gate-checked, not assumed', () => {
  it('excludes the dataset landing page when the real dataset gate is not met', async () => {
    // hvac's compiled seo.yaml requires min_entities: 25; the shared fixtures
    // seed four. This is the fixture set every other apps/web test already
    // uses, not one written to make this assertion pass.
    const deployment = await getDeployment({
      env: { POSTGRES_URL: 'postgres://fixture/db' },
      runtimes: RUNTIMES,
      openDriver: openFixtureDriver,
    });
    const vertical = deployment.verticals.get('hvac')!;

    const xml = await sitemapSegmentXml(vertical, deployment.publicOrigin, 'datasets', new Date());
    expect(xml).not.toContain(`<loc>${deployment.publicOrigin}/data/hvac</loc>`);
  });

  it('still includes docs_api_mcp — its gate is `none`, unconditionally indexable', async () => {
    const deployment = await getDeployment({
      env: { POSTGRES_URL: 'postgres://fixture/db' },
      runtimes: RUNTIMES,
      openDriver: openFixtureDriver,
    });
    const vertical = deployment.verticals.get('hvac')!;

    const xml = await sitemapSegmentXml(vertical, deployment.publicOrigin, 'datasets', new Date());
    expect(xml).toContain(`<loc>${deployment.publicOrigin}/data/hvac/docs</loc>`);
  });
});
