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
import { entityQualityScore } from '@data-foundry/canonical-schema';
import { createQueryFixtures, ts, type QueryFixtures } from '../../../packages/query-model/test/support.js';
import { getDeployment, resetDeployments, type VerticalDeployment } from '../src/composition.js';
import { sitemapSegmentXml } from '../src/sitemap.js';
import { DEFAULT_CONCURRENCY } from '../src/concurrency.js';
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

/**
 * Seeds `count` `equipment_model` entities so the `entities` segment's
 * per-entity fan-out in `sitemapSegmentXml` actually has more than one hit to
 * iterate — the shared query-model fixtures only carry `equipment`/`part`
 * entities (used by search/identity tests elsewhere), none of which match
 * hvac's real `equipment_model_detail` page class.
 */
async function seedEquipmentModels(f: QueryFixtures, count: number, prefix: string): Promise<void> {
  for (let i = 0; i < count; i += 1) {
    await f.store.upsertEntity({
      vertical_id: f.vertical.id,
      entity_type: 'equipment_model',
      canonical_name: `${prefix} Model ${i}`,
      canonical_slug: `${prefix}-model-${i}`,
      status: 'ACTIVE',
      quality_score: entityQualityScore(0.5),
      first_seen_at: ts('2026-01-01T00:00:00Z'),
      last_verified_at: null,
    });
  }
}

describe('sitemapSegmentXml — per-entity fan-out performance', () => {
  it('never re-fetches an entity search() already returned in full (no getEntity call)', async () => {
    // RED under the pre-fix code: isIndexable used to call
    // `queryModel.getEntity(entityId)` once per hit even though `search()`
    // already returns the full entity (quality_score, updated_at included).
    await seedEquipmentModels(fixtures, 3, 'nolookup');
    const deployment = await getDeployment({
      env: { POSTGRES_URL: 'postgres://fixture/db' },
      runtimes: RUNTIMES,
      openDriver: openFixtureDriver,
    });
    const vertical = deployment.verticals.get('hvac')!;

    let getEntityCalls = 0;
    const spied: VerticalDeployment = {
      ...vertical,
      queryModel: {
        ...vertical.queryModel,
        getEntity: async (id) => {
          getEntityCalls += 1;
          return vertical.queryModel.getEntity(id);
        },
      },
    };

    await sitemapSegmentXml(spied, deployment.publicOrigin, 'entities', new Date('2026-03-01T00:00:00Z'));
    expect(getEntityCalls).toBe(0);
  });

  it('evaluates more than one entity concurrently, bounded by DEFAULT_CONCURRENCY', async () => {
    // RED under the pre-fix code: the per-hit loop was a plain serial
    // `for...of` with a sequential `await` — at most one `canonicalFacts`
    // call was ever in flight. This proves the replacement is neither that
    // nor unbounded.
    await seedEquipmentModels(fixtures, 5, 'concurrency');
    const deployment = await getDeployment({
      env: { POSTGRES_URL: 'postgres://fixture/db' },
      runtimes: RUNTIMES,
      openDriver: openFixtureDriver,
    });
    const vertical = deployment.verticals.get('hvac')!;

    let active = 0;
    let maxActive = 0;
    const spied: VerticalDeployment = {
      ...vertical,
      queryModel: {
        ...vertical.queryModel,
        canonicalFacts: async (entityId, policy) => {
          active += 1;
          maxActive = Math.max(maxActive, active);
          await new Promise((resolve) => setTimeout(resolve, 5));
          try {
            return await vertical.queryModel.canonicalFacts(entityId, policy);
          } finally {
            active -= 1;
          }
        },
      },
    };

    await sitemapSegmentXml(spied, deployment.publicOrigin, 'entities', new Date('2026-03-01T00:00:00Z'));
    expect(maxActive).toBeGreaterThan(1);
    expect(maxActive).toBeLessThanOrEqual(DEFAULT_CONCURRENCY);
  });
});
