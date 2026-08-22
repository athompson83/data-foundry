/**
 * A merge must not make a saved id look unknown.
 *
 * `packages/query-model/src/entities.ts` states the platform-wide intent: every
 * entity read follows the active redirect chain, "so a consumer that saved an
 * id or a slug before a merge still lands on the surviving entity — and is told
 * that it was redirected". `apps/api` has its own suite for the same property,
 * where the failure mode is answering 404. This surface has an analogous one
 * that is quieter and worse: reporting the id in `unresolvedEntityIds`, which
 * tells an agent the catalogue does not know an id whose fate the catalogue
 * knows exactly. An agent told that a model number it holds is unknown stops
 * asking about it; that is a wrong answer dressed as a partial one.
 *
 * The fixtures merge a duplicate into the surviving equipment here rather than
 * in `support.ts`, so the id is a real `entity_redirects` row written by the
 * store's own merge, not a test-local notion of "redirected".
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMcpFixtures, errorOf, resultOf, ts, type McpFixtures } from './support.js';
import { entityQualityScore, type Entity } from '@data-foundry/canonical-schema';
import type { CompareEntitiesResult, GetEntityResult } from '../src/index.js';

let fixtures: McpFixtures;
/** Merged into the surviving equipment; its id is the one callers saved. */
let merged: Entity;

/** A well-formed id nothing in the catalogue has ever held. */
const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000';

beforeAll(async () => {
  fixtures = await createMcpFixtures();

  merged = await fixtures.store.upsertEntity({
    vertical_id: fixtures.vertical.id,
    entity_type: 'equipment',
    canonical_name: 'Carrier Infinity 24ANB7 (duplicate listing)',
    canonical_slug: 'carrier-infinity-24anb7-duplicate',
    status: 'ACTIVE',
    quality_score: entityQualityScore(0.4),
    first_seen_at: ts('2026-01-01T00:00:00Z'),
    last_verified_at: null,
  });
  await fixtures.store.mergeEntities({
    from_entity_id: merged.id,
    to_entity_id: fixtures.equipment.id,
    reason: 'MERGE',
    from_slug: merged.canonical_slug,
    judgment_id: null,
  });
});

afterAll(async () => {
  await fixtures?.driver.close();
});

describe('the fixture is not vacuous', () => {
  it('really does resolve the merged id to the surviving entity', async () => {
    const result = resultOf<GetEntityResult>(
      await fixtures.server.callTool('get_entity', { identifier: merged.id }),
    );
    expect(result.entity.entityId).toBe(fixtures.equipment.id);
    expect(result.redirectedFrom?.fromEntityId).toBe(merged.id);
    expect(result.redirectedFrom?.hops).toBe(1);
  });
});

describe('comparing through an id a merge moved', () => {
  it('compares the surviving entity and calls nothing unresolved', async () => {
    const result = resultOf<CompareEntitiesResult>(
      await fixtures.server.callTool('compare_entities', {
        entity_ids: [merged.id, fixtures.heatPump.id],
      }),
    );

    expect(result.entities.map((entity) => entity.entityId)).toEqual([
      fixtures.equipment.id,
      fixtures.heatPump.id,
    ]);
    // The id resolved. Reporting it as unresolved would say the catalogue does
    // not know an id whose successor it just compared.
    expect(result.unresolvedEntityIds).toEqual([]);
    expect(result.propertiesCompared).toBeGreaterThan(0);
  });

  it('still reports an id that really does resolve to nothing', async () => {
    // The other half: emptying the list would hide a genuinely partial answer,
    // which is the thing `unresolvedEntityIds` exists to make legible.
    const result = resultOf<CompareEntitiesResult>(
      await fixtures.server.callTool('compare_entities', {
        entity_ids: [merged.id, fixtures.heatPump.id, UNKNOWN_ID],
      }),
    );
    expect(result.unresolvedEntityIds).toEqual([UNKNOWN_ID]);
    expect(result.entities).toHaveLength(2);
  });

  it('refuses when too few of the ids resolve, naming the ones that did not', async () => {
    const error = errorOf(
      await fixtures.server.callTool('compare_entities', {
        entity_ids: [merged.id, UNKNOWN_ID],
      }),
    );
    expect(error.code).toBe('TOO_FEW_ENTITIES');
    expect(error.details['unresolved']).toEqual([UNKNOWN_ID]);
    // The merged id counts towards the total, because it resolved.
    expect(error.details['resolved']).toEqual([fixtures.equipment.id]);
  });
});
