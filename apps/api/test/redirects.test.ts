/**
 * A merge must not break a saved id or a bookmarked URL.
 *
 * `entities.ts` states the intent for the whole query layer: a consumer "is
 * told that it was redirected, so the web layer can answer 301 instead of
 * silently serving different content at the old address." An API has the same
 * obligation and one extra failure mode — answering 404 — which would tell a
 * client the equipment was withdrawn when in fact it was merged.
 *
 * So: never 404 for a redirected identifier, always 301, and always with the
 * hop chain in the body so a client that does not follow redirects can still
 * explain what happened.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  entityQualityScore,
  type Entity,
} from '../../../packages/canonical-schema/src/index.js';
import {
  addSyntheticEntityEvidence,
  call,
  createApiFixtures,
  errorOf,
  ts,
  type ApiFixtures,
} from './support.js';

let fixtures: ApiFixtures;
/** Merged into the surviving equipment; keeps its own slug. */
let merged: Entity;
/** Merged into `merged`, so resolving it takes two hops. */
let older: Entity;
/** Merged away under a slug it no longer holds — the retired-slug path. */
let renamed: Entity;

const RETIRED_SLUG = 'carrier-infinity-24anb7-2024';

async function makeEntity(name: string, slug: string): Promise<Entity> {
  const entity = await fixtures.store.upsertEntity({
    vertical_id: fixtures.vertical.id,
    entity_type: 'equipment',
    canonical_name: name,
    canonical_slug: slug,
    status: 'ACTIVE',
    quality_score: entityQualityScore(0.4),
    first_seen_at: ts('2026-01-01T00:00:00Z'),
    last_verified_at: null,
  });
  await addSyntheticEntityEvidence(fixtures, entity);
  return entity;
}

beforeAll(async () => {
  fixtures = await createApiFixtures();

  merged = await makeEntity('Carrier Infinity 24ANB7 (duplicate)', 'carrier-infinity-24anb7-dup');
  older = await makeEntity('Carrier 24ANB7 (older record)', 'carrier-24anb7-older');
  renamed = await makeEntity('Carrier Infinity 24ANB7 (2024 listing)', 'carrier-24anb7-2024-listing');

  await fixtures.store.mergeEntities({
    from_entity_id: merged.id,
    to_entity_id: fixtures.equipment.id,
    reason: 'MERGE',
    from_slug: merged.canonical_slug,
    judgment_id: null,
  });
  await fixtures.store.mergeEntities({
    from_entity_id: older.id,
    to_entity_id: merged.id,
    reason: 'MERGE',
    from_slug: older.canonical_slug,
    judgment_id: null,
  });
  await fixtures.store.mergeEntities({
    from_entity_id: renamed.id,
    to_entity_id: fixtures.equipment.id,
    reason: 'RENAME',
    // A slug no entity holds any more: only the redirect row remembers it.
    from_slug: RETIRED_SLUG,
    judgment_id: null,
  });
}, 300_000);

afterAll(async () => {
  await fixtures?.driver.close();
});

interface RedirectBody {
  readonly redirect: {
    readonly status: number;
    readonly location: string;
    readonly canonicalEntityId: string;
    readonly redirectedFrom: {
      readonly fromEntityId: string | null;
      readonly fromSlug: string | null;
      readonly reason: string | null;
      readonly hops: { readonly fromEntityId: string; readonly toEntityId: string }[];
    };
  };
}

describe('a merged-away id', () => {
  it('answers 301 to the surviving entity, not 404', async () => {
    const response = await call(fixtures.app, `/v1/entities/${merged.id}`);
    expect(response.status).toBe(301);
    expect(response.headers['location']).toBe(`/v1/entities/${fixtures.equipment.id}`);
    const body = response.body as RedirectBody;
    expect(body.redirect.canonicalEntityId).toBe(fixtures.equipment.id);
    expect(body.redirect.redirectedFrom.reason).toBe('MERGE');
    expect(body.redirect.redirectedFrom.fromEntityId).toBe(merged.id);
  });

  it('reports the whole chain when a merge was itself merged', async () => {
    const response = await call(fixtures.app, `/v1/entities/${older.id}`);
    expect(response.status).toBe(301);
    const hops = (response.body as RedirectBody).redirect.redirectedFrom.hops;
    expect(hops).toHaveLength(2);
    expect(hops[0]?.fromEntityId).toBe(older.id);
    expect(hops[1]?.toEntityId).toBe(fixtures.equipment.id);
    expect(response.headers['location']).toBe(`/v1/entities/${fixtures.equipment.id}`);
  });

  it('redirects sub-resources to the same sub-resource, not to the entity', async () => {
    for (const suffix of ['/facts', '/relationships']) {
      const response = await call(fixtures.app, `/v1/entities/${merged.id}${suffix}`);
      expect(response.status, suffix).toBe(301);
      expect(response.headers['location'], suffix).toBe(
        `/v1/entities/${fixtures.equipment.id}${suffix}`,
      );
    }
  });

  it('keeps query parameters out of the redirect target, which is a resource', async () => {
    const response = await call(fixtures.app, `/v1/entities/${merged.id}/facts?limit=5`);
    expect(response.headers['location']).toBe(`/v1/entities/${fixtures.equipment.id}/facts`);
  });
});

describe('a slug a merge took away', () => {
  it('redirects while the retired entity still holds the slug', async () => {
    const response = await call(
      fixtures.app,
      `/v1/entities/by-slug/${merged.canonical_slug}?type=equipment`,
    );
    expect(response.status).toBe(301);
    expect(response.headers['location']).toBe(`/v1/entities/${fixtures.equipment.id}`);
    expect((response.body as RedirectBody).redirect.redirectedFrom.fromSlug).toBe(
      merged.canonical_slug,
    );
  });

  it('redirects a slug that only the redirect row still remembers', async () => {
    const response = await call(fixtures.app, `/v1/entities/by-slug/${RETIRED_SLUG}?type=equipment`);
    expect(response.status).toBe(301);
    expect(response.headers['location']).toBe(`/v1/entities/${fixtures.equipment.id}`);
    expect((response.body as RedirectBody).redirect.redirectedFrom.reason).toBe('RENAME');
  });

  it('still 404s a slug that never existed, so a redirect is not a catch-all', async () => {
    const response = await call(fixtures.app, '/v1/entities/by-slug/never-existed?type=equipment');
    expect(response.status).toBe(404);
    expect(errorOf(response).code).toBe('ENTITY_NOT_FOUND');
  });
});

describe('compare across a merge', () => {
  it('compares the surviving entity and reports the substitution', async () => {
    const response = await call(
      fixtures.app,
      `/v1/compare?ids=${merged.id},${fixtures.heatPump.id}`,
    );
    expect(response.status).toBe(200);
    const body = response.body as {
      data: { entities: { id: string }[] };
      redirects: { requestedId: string; canonicalEntityId: string }[];
    };
    expect(body.data.entities.map((entity) => entity.id)).toEqual([
      fixtures.equipment.id,
      fixtures.heatPump.id,
    ]);
    expect(body.redirects).toEqual([
      { requestedId: merged.id, canonicalEntityId: fixtures.equipment.id },
    ]);
  });

  it('refuses a comparison that collapses to one entity after following redirects', async () => {
    const response = await call(
      fixtures.app,
      `/v1/compare?ids=${merged.id},${fixtures.equipment.id}`,
    );
    expect(response.status).toBe(400);
    expect(errorOf(response).details).toMatchObject({ parameter: 'ids' });
  });
});
