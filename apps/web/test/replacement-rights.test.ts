import { afterEach, describe, expect, it } from 'vitest';
import { entityQualityScore, type Entity } from '@data-foundry/canonical-schema';
import {
  addSyntheticEntityEvidence,
  createQueryFixtures,
  relate,
  seedSyntheticSurfaceRights,
  ts,
  type QueryFixtures,
  type SourceKey,
} from '../../../packages/query-model/test/support.js';
import { createWebApp } from '../src/app.js';
import { resolveContext } from '../src/config.js';
import { getDeployment, resetDeployments } from '../src/composition.js';
import { RUNTIMES } from '../src/index.js';
import type { WebRuntime } from '../src/seo.js';

const ORIGIN = 'https://data-foundry.test';
const REPLACEMENT_RUNTIME: WebRuntime = {
  ...RUNTIMES['hvac']!,
  vertical_status: 'ACTIVE',
  entity_types: ['equipment_model'],
  entity_type_meta: {
    equipment_model: RUNTIMES['hvac']!.entity_type_meta['equipment_model']!,
  },
  seo: {
    ...RUNTIMES['hvac']!.seo,
    page_classes: [
      {
        id: 'equipment_model_detail',
        route_kind: 'entity_detail',
        entity_type: 'equipment_model',
        path: '/data/hvac/equipment/{canonical_slug}',
        title: '{canonical_name}',
        structured_data: null,
        sitemap: 'entities',
        indexable: 'conditional',
        quality_gate: 'none',
      },
      {
        id: 'replacement_relationship',
        route_kind: 'relationship',
        subject_entity_type: 'equipment_model',
        path: '/data/hvac/equipment/{canonical_slug}/replacements',
        title: 'What replaces {canonical_name}',
        structured_data: null,
        sitemap: 'relationships',
        indexable: 'conditional',
        quality_gate: 'replacement',
      },
    ],
    quality_gates: {
      none: {},
      replacement: {
        min_supersession_edges: 1,
        min_evidence_coverage: 1,
        require_terminal_model_indexable: true,
      },
    },
  },
};

afterEach(() => resetDeployments());

async function model(fixtures: QueryFixtures, slug: string): Promise<Entity> {
  const entity = await fixtures.store.upsertEntity({
    vertical_id: fixtures.vertical.id,
    entity_type: 'equipment_model',
    canonical_name: slug.replaceAll('-', ' '),
    canonical_slug: slug,
    status: 'ACTIVE',
    quality_score: entityQualityScore(0.8),
    first_seen_at: ts('2026-01-01T00:00:00Z'),
    last_verified_at: ts('2026-02-01T00:00:00Z'),
  });
  await addSyntheticEntityEvidence(fixtures, entity, 'manufacturer');
  return entity;
}

async function responseFor(
  configure: (fixtures: QueryFixtures, legacy: Entity) => Promise<void>,
  grants: readonly { readonly source: SourceKey; readonly search: boolean }[],
) {
  const fixtures = await createQueryFixtures();
  try {
    for (const grant of grants) {
      await seedSyntheticSurfaceRights(
        fixtures,
        grant.search ? ['PUBLIC_WEB', 'SEARCH_INDEX'] : ['PUBLIC_WEB'],
        [grant.source],
      );
    }
    const legacy = await model(fixtures, 'legacy-model');
    await configure(fixtures, legacy);
    const deployment = await getDeployment({
      env: { POSTGRES_URL: 'postgres://fixture/db', PUBLIC_ORIGIN: ORIGIN },
      runtimes: { hvac: REPLACEMENT_RUNTIME },
      openDriver: async () => fixtures.driver,
    });
    return await createWebApp(resolveContext(deployment))({
      method: 'GET',
      url: `/data/hvac/equipment/${legacy.canonical_slug}/replacements`,
    });
  } finally {
    await fixtures.driver.close();
  }
}

describe('replacement relationship publication', () => {
  it('indexes a fully authorized multi-hop terminal chain', async () => {
    const response = await responseFor(
      async (fixtures, legacy) => {
        const middle = await model(fixtures, 'middle-model');
        const terminal = await model(fixtures, 'terminal-model');
        await relate(fixtures, middle, 'supersedes', legacy, 'manufacturer');
        await relate(fixtures, terminal, 'supersedes', middle, 'manufacturer');
      },
      [{ source: 'manufacturer', search: true }],
    );

    expect(response.status).toBe(200);
    expect(response.body).toContain('middle model');
    expect(response.body).toContain('name="robots" content="index,follow"');
  });

  it('fails closed when a later terminal-chain edge is PUBLIC_WEB-only', async () => {
    const response = await responseFor(
      async (fixtures, legacy) => {
        const middle = await model(fixtures, 'middle-model');
        const terminal = await model(fixtures, 'terminal-model');
        await relate(fixtures, middle, 'supersedes', legacy, 'manufacturer');
        await relate(fixtures, terminal, 'supersedes', middle, 'aggregator');
      },
      [
        { source: 'manufacturer', search: true },
        { source: 'aggregator', search: false },
      ],
    );

    expect(response.status).toBe(200);
    expect(response.body).toContain('middle model');
    expect(response.body).toContain('name="robots" content="noindex,follow"');
  });

  it('requires SEARCH_INDEX authorization for every directly rendered replacement target', async () => {
    const response = await responseFor(
      async (fixtures, legacy) => {
        const authorized = await model(fixtures, 'authorized-replacement');
        const publicOnly = await model(fixtures, 'public-only-replacement');
        await relate(fixtures, authorized, 'supersedes', legacy, 'manufacturer');
        await relate(fixtures, publicOnly, 'supersedes', legacy, 'aggregator');
      },
      [
        { source: 'manufacturer', search: true },
        { source: 'aggregator', search: false },
      ],
    );

    expect(response.body).toContain('authorized replacement');
    expect(response.body).toContain('public only replacement');
    expect(response.body).toContain('name="robots" content="noindex,follow"');
  });
});
