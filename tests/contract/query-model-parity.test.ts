/**
 * One source of truth (AGENTS.md rule 5).
 *
 * > Web/API/MCP must read from the same canonical query layer.
 *
 * Those three surfaces do not exist yet, so this suite proves the property they
 * will depend on: asking the same question through `@data-foundry/query-model`
 * returns exactly what the canonical store itself would answer, and three
 * independent consumers of the query layer get byte-identical results. If that
 * ever stops being true, the surfaces will drift and the drift will be
 * invisible until a customer notices the API and the page disagree.
 *
 * It also pins the traversal the vertical exists to answer — "what replaces this
 * discontinued unit?" — because a one-hop answer is wrong in a way that looks
 * right.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { provenanceCoverage } from '../../packages/provenance/src/index.js';
import type { QueryModel } from '../../packages/query-model/src/index.js';
import type { FactSelectionPolicyInput } from '../../packages/canonical-store/src/index.js';
import type { EntityId, Identifier } from '../../packages/canonical-schema/src/index.js';
import { buildFactSelectionPolicy } from '../../services/ingest-worker/src/index.js';
import {
  createFactory,
  entityIdByRef,
  entityRefs,
  goldenRelationships,
  RUN_1_AT,
  type Factory,
} from '../support/harness.js';

describe('canonical query layer parity', () => {
  let factory: Factory;
  let policy: FactSelectionPolicyInput;
  /** Three consumers standing in for the web, REST and MCP surfaces. */
  let web: QueryModel;
  let api: QueryModel;
  let mcp: QueryModel;

  beforeAll(async () => {
    factory = await createFactory();
    const run = await factory.run({ at: RUN_1_AT, runId: 'cycle-1' });
    for (const source of run.sources) expect(source.error).toBeNull();
    policy = buildFactSelectionPolicy(factory.config, { at: RUN_1_AT });
    web = factory.queryModel();
    api = factory.queryModel();
    mcp = factory.queryModel();
  }, 300_000);

  afterAll(async () => {
    await factory?.close();
  });

  it('derives its filterable fields from the vertical config, not from code', () => {
    const declared = new Set(
      (factory.config.filters.fields as { field: string }[]).map((field) => field.field),
    );
    const registered = new Set(web.fields.all().map((field) => field.field));
    expect(registered).toEqual(declared);
    expect(registered.size).toBeGreaterThan(0);
  });

  it('answers the same entity question identically for every surface', async () => {
    const entityId = await entityIdByRef(factory.driver, 'equipment_model:24ACC636A003');
    const answers = await Promise.all([web.getEntity(entityId), api.getEntity(entityId), mcp.getEntity(entityId)]);
    expect(answers[1]).toEqual(answers[0]);
    expect(answers[2]).toEqual(answers[0]);

    // …and it is the same row the store itself holds.
    const direct = await factory.store.getEntityById(entityId);
    expect(answers[0]?.entity).toEqual(direct);

    const bySlug = await web.getEntityBySlug(
      direct!.vertical_id,
      'equipment_model' as Identifier,
      direct!.canonical_slug,
    );
    expect(bySlug?.entity.id).toBe(entityId);
  });

  it('publishes the same canonical values through the query layer as the store selects', async () => {
    const refs = await entityRefs(factory.driver);
    let checked = 0;

    for (const [id, ref] of refs) {
      if (!ref.startsWith('equipment_model:')) continue;
      const entityId = id as EntityId;

      const throughQueryModel = await web.canonicalFacts(entityId, policy);
      const fromStore = await factory.store.canonicalView(entityId, policy);

      // Same properties, same selected values, same deciding rule. The query
      // layer re-implements none of it.
      expect(throughQueryModel.map((row) => row.property).sort()).toEqual(
        [...fromStore.keys()].sort(),
      );
      for (const row of throughQueryModel) {
        const selection = fromStore.get(row.property);
        expect(selection, `${ref}.${row.property}`).toBeDefined();
        expect(row.value, `${ref}.${row.property}`).toEqual(
          selection?.selected?.fact.normalized_value ?? null,
        );
        expect(row.unit).toEqual(selection?.selected?.fact.unit ?? null);
        expect(row.rule).toBe(selection?.rule);
        expect(row.fact_id).toEqual(selection?.selected?.fact.id ?? null);
      }
      checked += 1;
    }
    expect(checked).toBe(13);
  }, 120_000);

  it('gives all three surfaces the same answer on the contested value', async () => {
    const entityId = await entityIdByRef(factory.driver, 'equipment_model:24ACC636A003');
    const property = 'seer2' as Identifier;

    const answers = await Promise.all([
      web.explainFact(entityId, property, policy),
      api.explainFact(entityId, property, policy),
      mcp.explainFact(entityId, property, policy),
    ]);
    expect(answers[1]).toEqual(answers[0]);
    expect(answers[2]).toEqual(answers[0]);
    expect(answers[0]?.selected?.value).toBe(14.3);

    // The conflict is surfaced, not hidden: fact-selection.yaml requires it of
    // the API and of MCP, and the page has to be able to explain the brochure
    // number a customer is holding.
    expect(answers[0]?.unresolved_conflict).toBe(true);
    expect(answers[0]?.conflicts.map((conflict) => conflict.value)).toContain(14.5);
  });

  it('serves facts with their evidence, never a value on its own', async () => {
    const entityId = await entityIdByRef(factory.driver, 'equipment_model:24ACC648A003');
    const facts = await api.facts({ entity_id: entityId, at: RUN_1_AT });
    expect(facts.length).toBeGreaterThan(0);
    for (const fact of facts) {
      expect(fact.evidence.length, fact.fact.property).toBeGreaterThan(0);
      expect(fact.source_count, fact.fact.property).toBeGreaterThan(0);
      expect(fact.lineage?.traceable, fact.fact.property).toBe(true);
    }
  });

  it('reports the same provenance coverage through the query layer as directly', async () => {
    const throughQueryModel = await mcp.provenanceCoverage();
    const direct = await provenanceCoverage(factory.driver);
    expect(throughQueryModel.facts).toEqual(direct.facts);
    expect(throughQueryModel.relationships).toEqual(direct.relationships);
    expect(throughQueryModel.facts.coverage).toBe(1);
  });

  it('derives facet counts from field metadata rather than from a hard-coded list', async () => {
    const vertical = await factory.store.getVerticalBySlug('hvac');
    const facets = await web.facets({
      vertical_id: vertical!.id,
      entity_type: 'equipment_model' as Identifier,
    });
    const productType = facets.find((facet) => facet.property === 'product_type');
    expect(productType, 'product_type is declared facetable in filters.yaml').toBeDefined();

    const values = Object.fromEntries(
      (productType?.values ?? []).map((value) => [String(value.value), value.count]),
    );
    // 10 air conditioners and 3 heat pumps across the 13 models.
    expect(values['air_conditioner']).toBe(10);
    expect(values['heat_pump']).toBe(3);

    const sameForApi = await api.facets({
      vertical_id: vertical!.id,
      entity_type: 'equipment_model' as Identifier,
    });
    expect(sameForApi).toEqual(facets);
  });

  describe('the replacement traversal this vertical exists to answer', () => {
    it.each(goldenRelationships().expected_traversals as any[])(
      '$query',
      async (expected: any) => {
        const start = await entityIdByRef(factory.driver, expected.start);
        // The canonical edge runs successor → predecessor, so "what replaces
        // this?" walks inbound edges.
        const traversal = await mcp.relationships({
          entity_id: start,
          predicate: 'supersedes' as Identifier,
          direction: 'in',
          depth: 4,
        });

        expect(traversal.edges).toHaveLength(expected.hops);

        const refs = await entityRefs(factory.driver);
        const path = [expected.start, ...traversal.edges.map((edge) => refs.get(edge.neighbor.id))];
        expect(path).toEqual(expected.expected_path);

        const terminal = path[path.length - 1];
        expect(terminal).toBe(expected.expected_terminal);

        // Every hop is evidenced; a replacement recommendation with no
        // provenance is a warranty problem, not a UX one.
        for (const edge of traversal.edges) {
          expect(edge.evidence_count).toBeGreaterThan(0);
        }
      },
    );

    it('reports a current model as current rather than as an empty result', async () => {
      const current = await entityIdByRef(factory.driver, 'equipment_model:24ACC636A003');
      const traversal = await mcp.relationships({
        entity_id: current,
        predicate: 'supersedes' as Identifier,
        direction: 'in',
        depth: 4,
      });
      expect(traversal.edges).toHaveLength(0);
      // The distinction the consumer needs: nothing supersedes it, and it does
      // supersede something — so it is the head of the chain, not an unknown.
      const outbound = await mcp.relationships({
        entity_id: current,
        predicate: 'supersedes' as Identifier,
        direction: 'out',
        depth: 1,
      });
      expect(outbound.edges).toHaveLength(1);
    });

    it('crosses a refrigerant change without hiding it', async () => {
      const head = await entityIdByRef(factory.driver, 'equipment_model:24ACA636A003');
      const terminal = await entityIdByRef(factory.driver, 'equipment_model:24ACC636A003');
      const [from, to] = await Promise.all([
        web.canonicalFacts(head, policy),
        web.canonicalFacts(terminal, policy),
      ]);
      expect(from.find((row) => row.property === 'refrigerant')?.value).toBe('R-410A');
      expect(to.find((row) => row.property === 'refrigerant')?.value).toBe('R-454B');
    });
  });

  it('compares two models on the same canonical values every surface would show', async () => {
    const left = await entityIdByRef(factory.driver, 'equipment_model:24ACC636A003');
    const right = await entityIdByRef(factory.driver, 'equipment_model:NWA1436AC1');
    const comparison = await api.compare({ entity_ids: [left, right] });
    const capacity = comparison.rows.find((row) => row.property === 'cooling_capacity_btu');
    expect(capacity?.cells.map((cell) => cell.value)).toEqual([36000, 36000]);

    const seer2 = comparison.rows.find((row) => row.property === 'seer2');
    // Same capacity, different manufacturers, different certified ratings —
    // which is exactly why they must never have been merged.
    expect(seer2?.cells.map((cell) => cell.value)).toEqual([14.3, 14.6]);
  });
});
