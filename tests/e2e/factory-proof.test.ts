/**
 * THE PHASE 1 PROOF.
 *
 * Roadmap, "Phase 1 — Three-source factory proof". Exit criterion:
 *
 *   > a repeatable incremental re-run produces correct canonical records
 *   > without duplicates or lost provenance
 *
 * Four materially different sources — a JSON API feed, a rendered HTML
 * catalogue, a bulk CSV export and a PDF spec sheet — are ingested into one
 * database and measured against `verticals/hvac/fixtures/golden/`. Nothing is
 * stubbed below the network: real migrations, real registry, real extractors,
 * real normalization, real canonical store, real fact selection.
 *
 * ## What the golden files are compared on, and what they are not
 *
 * Compared exactly: the set of entities, the set of alias join keys, the set of
 * relationship edges, and the set of `(entity, property, value, unit)` claims —
 * winners *and* retained losers, 171 of them.
 *
 * Not compared: the hand-authored per-fact `confidence` numbers, which no
 * documented formula in the vertical derives, and the golden file's `status`
 * vocabulary for a losing claim. The golden file records a retained loser as
 * `SUPERSEDED`; the store records it as an open `PROPOSED` claim, because in
 * this schema `SUPERSEDED` closes a version by setting `valid_to`, which would
 * drop the claim out of the candidate window and stop it being surfaced as a
 * retained conflict at all. The *behaviour* the golden file specifies — both
 * claims survive with their evidence, the documented winner is selected, and
 * the reason is recorded — is asserted in full below.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { explainFact, provenanceCoverage } from '../../packages/provenance/src/index.js';
import type { FactSelectionPolicyInput } from '../../packages/canonical-store/src/index.js';
import type {
  EntityId,
  FactId,
  Identifier,
  IsoDateTime,
} from '../../packages/canonical-schema/src/index.js';
import { identifiersMatch } from '../../packages/normalization/src/index.js';
import {
  AliasNormalizer,
  buildFactSelectionPolicy,
} from '../../services/ingest-worker/src/index.js';
import {
  aliasKeys,
  createFactory,
  difference,
  entityIdByRef,
  entityRefs,
  factKeys,
  goldenAliasKeys,
  goldenEntities,
  goldenFactKeys,
  goldenFacts,
  goldenRelationshipKeys,
  goldenRelationships,
  readFixture,
  relationshipKeys,
  snapshotCanonical,
  RUN_1_AT,
  RUN_2_AT,
  type CanonicalSnapshot,
  type Factory,
} from '../support/harness.js';

/** A third cycle, for the simulated upstream change. */
const RUN_3_AT = '2026-09-01T09:00:00.000Z' as IsoDateTime;

describe('Phase 1 factory proof — four HVAC sources into one canonical database', () => {
  let factory: Factory;
  /** The exact selection policy the pipeline publishes with, read from the vertical. */
  let policy: FactSelectionPolicyInput;

  beforeAll(async () => {
    factory = await createFactory();
    const run = await factory.run({ at: RUN_1_AT, runId: 'cycle-1' });
    for (const source of run.sources) {
      expect(source.error, `${source.sourceKey} must publish`).toBeNull();
      expect(source.finalState).toBe('PUBLISHED');
    }
    policy = buildFactSelectionPolicy(factory.config, { at: RUN_1_AT });
  }, 300_000);

  afterAll(async () => {
    await factory?.close();
  });

  /* ------------------------------------------------------------------ *
   * (a) the canonical output matches the golden records
   * ------------------------------------------------------------------ */

  describe('(a) canonical output matches verticals/hvac/fixtures/golden', () => {
    it('produces exactly the golden entity population', async () => {
      const refs = new Set((await entityRefs(factory.driver)).values());
      const expected = new Set<string>(goldenEntities().entities.map((entity: any) => entity.ref));

      expect(difference(expected, refs), 'entities the pipeline failed to produce').toEqual([]);
      expect(difference(refs, expected), 'entities the pipeline invented').toEqual([]);
      expect(refs.size).toBe(goldenEntities().counts.total);

      const counts = await factory.driver.query<{ entity_type: string; n: string }>(
        `SELECT entity_type, count(*)::text AS n FROM entities GROUP BY entity_type`,
      );
      const byType = Object.fromEntries(counts.map((row) => [row.entity_type, Number(row.n)]));
      expect(byType).toEqual({ manufacturer: 3, equipment_model: 13, certification: 11 });
    });

    it('produces exactly the golden alias join keys', async () => {
      const actual = await aliasKeys(factory.driver);
      const expected = goldenAliasKeys();
      expect(difference(expected, actual), 'missing aliases').toEqual([]);
      expect(difference(actual, expected), 'unexpected aliases').toEqual([]);
    });

    it('names and slugs every entity the way the golden file does', async () => {
      const refs = await entityRefs(factory.driver);
      const rows = await factory.driver.query<{
        id: string;
        canonical_name: string;
        canonical_slug: string;
        status: string;
      }>(`SELECT id::text AS id, canonical_name, canonical_slug, status FROM entities`);
      const byRef = new Map(
        rows.map((row) => [refs.get(row.id) ?? '?', row] as const),
      );

      for (const entity of goldenEntities().entities as any[]) {
        const actual = byRef.get(entity.ref);
        expect(actual, `no entity for ${entity.ref}`).toBeDefined();
        expect(actual?.canonical_name, entity.ref).toBe(entity.canonical_name);
        expect(actual?.canonical_slug, entity.ref).toBe(entity.canonical_slug);
        expect(actual?.status, entity.ref).toBe(entity.status);
      }
    });

    it('produces exactly the golden claim set — winners and retained losers, 171 of them', async () => {
      const actual = await factKeys(factory.driver);
      const expected = goldenFactKeys();
      expect(difference(expected, actual), 'claims the pipeline failed to produce').toEqual([]);
      expect(difference(actual, expected), 'claims the pipeline invented').toEqual([]);
      expect(actual.size).toBe(goldenFacts().counts.total);

      const rows = await factory.driver.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM facts`,
      );
      expect(Number(rows[0]?.n)).toBe(171);
    });

    it('produces exactly the golden relationship set, and asserts no compatibility', async () => {
      const actual = await relationshipKeys(factory.driver);
      const expected = goldenRelationshipKeys();
      expect(difference(expected, actual), 'missing edges').toEqual([]);
      expect(difference(actual, expected), 'fabricated edges').toEqual([]);

      const counts = await factory.driver.query<{ predicate: string; n: string }>(
        `SELECT predicate, count(*)::text AS n FROM relationships GROUP BY predicate`,
      );
      const byPredicate = Object.fromEntries(counts.map((row) => [row.predicate, Number(row.n)]));
      const goldenCounts = goldenRelationships().counts as Record<string, number>;
      expect(byPredicate).toEqual({
        manufactures: goldenCounts['manufactures'],
        supersedes: goldenCounts['supersedes'],
        certified_by: goldenCounts['certified_by'],
      });

      // An absence that is an assertion: no source claims compatibility,
      // inference is forbidden, and a fabricated compatibility edge is a
      // safety- and warranty-relevant claim.
      expect(byPredicate['compatible_with'] ?? 0).toBe(0);
    });

    it('honours the golden absences: discontinued models carry no certification', async () => {
      const absences = goldenRelationships().expected_absences as any[];
      const certified = absences.find((absence) => absence.predicate === 'certified_by');
      for (const subjectRef of certified.subjects as string[]) {
        const entityId = await entityIdByRef(factory.driver, subjectRef);
        const rows = await factory.driver.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM relationships
            WHERE subject_entity_id = $1 AND predicate = 'certified_by'`,
          [entityId],
        );
        // Directories drop withdrawn models. Back-filling one from an older
        // export would assert a certification that does not currently exist.
        expect(Number(rows[0]?.n), subjectRef).toBe(0);
      }
    });
  });

  /* ------------------------------------------------------------------ *
   * (b) one model number, written four ways, is one entity
   * ------------------------------------------------------------------ */

  describe('(b) deterministic identity across differently-formatted sources', () => {
    it('collapses four source spellings of one model number onto one canonical entity', async () => {
      // Exactly how each source writes this model, taken from the fixtures.
      const spellings: Readonly<Record<string, string>> = {
        'acme-hvac-catalog': '24ACC636A003',
        'acme-spec-sheets': '24ACC636A003',
        'ahri-directory-export': '24ACC6 36A003',
        'coolsupply-distributor': '24acc6-36a003',
      };
      const normalizer = new AliasNormalizer(factory.config);
      const vertical = await factory.store.getVerticalBySlug('hvac');
      expect(vertical).not.toBeNull();

      const resolved = new Set<string>();
      for (const [sourceKey, spelling] of Object.entries(spellings)) {
        const normalized = normalizer.normalize('model_number', spelling);
        expect(normalized, sourceKey).toBe('24ACC636A003');
        // Rule 7: deterministic equality, not a similarity score. The
        // normalization package's own predicate has to agree.
        expect(identifiersMatch(spelling, '24ACC636A003'), sourceKey).toBe(true);

        const matches = await factory.store.lookupByAlias({
          vertical_id: vertical!.id,
          values: [normalized],
          alias_type: 'model_number' as Identifier,
          entity_type: 'equipment_model' as Identifier,
        });
        expect(matches.length, `${sourceKey} spelling "${spelling}" must resolve`).toBe(1);
        resolved.add(String(matches[0]?.entity.id));
      }
      expect(resolved.size, 'four spellings, one entity').toBe(1);

      const entityId = [...resolved][0] as EntityId;
      const entity = await factory.store.getEntityById(entityId);
      expect(entity?.canonical_slug).toBe('acme-climate-systems-24acc636a003');
      // Display form is preserved; only the join key is normalized.
      expect(entity?.canonical_name).toBe('Acme Climate Systems 24ACC636A003');

      // One alias row, not four: the spellings collapsed rather than piling up.
      const aliases = await factory.store.listAliases(entityId);
      expect(aliases.filter((alias) => alias.alias_type === 'model_number')).toHaveLength(1);

      // And all four sources really did land on this one entity — the join is
      // observable in the evidence, not just in the alias table.
      const publishers = await factory.driver.query<{ n: string }>(
        `SELECT count(DISTINCT s.domain)::text AS n
           FROM facts f
           JOIN fact_evidence fe ON fe.fact_id = f.id
           JOIN source_records sr ON sr.id = fe.source_record_id
           JOIN sources s ON s.id = sr.source_id
          WHERE f.entity_id = $1`,
        [entityId],
      );
      expect(Number(publishers[0]?.n)).toBe(4);
    });

    it('serves the canonical identifier through the query layer', async () => {
      const vertical = await factory.store.getVerticalBySlug('hvac');
      const lookup = await factory.queryModel().lookupIdentifier({
        vertical_id: vertical!.id,
        value: '24ACC636A003',
        alias_type: 'model_number' as Identifier,
      });
      expect(lookup.entities).toHaveLength(1);
      expect(lookup.entities[0]?.entity.canonical_slug).toBe('acme-climate-systems-24acc636a003');
    });

    it('collapses a hyphenated model number onto a key no source writes', async () => {
      // `BTW-C2036` and `btw-c2036` both normalize to `BTWC2036`, which appears
      // in no source verbatim — the strongest form of the rule-7 claim.
      const entityId = await entityIdByRef(factory.driver, 'equipment_model:BTWC2036');
      const entity = await factory.store.getEntityById(entityId);
      expect(entity?.canonical_slug).toBe('borealis-thermal-works-btwc2036');
      expect(entity?.canonical_name).toBe('Borealis Thermal Works BTW-C2036');

      const aliases = await factory.store.listAliases(entityId);
      const modelNumbers = aliases.filter((alias) => alias.alias_type === 'model_number');
      expect(modelNumbers).toHaveLength(1);
      expect(modelNumbers[0]?.normalized_value).toBe('BTWC2036');
    });

    it('keeps the traps that blocking proposes from ever merging', async () => {
      const negatives = goldenEntities().negative_judgments as any[];
      expect(negatives.length).toBeGreaterThanOrEqual(3);

      for (const negative of negatives) {
        const left = await entityIdByRef(factory.driver, negative.left);
        const right = await entityIdByRef(factory.driver, negative.right);
        expect(left, `${negative.left} vs ${negative.right}`).not.toBe(right);

        // Rule 3: the decision is durable and auditable, so the matcher never
        // re-proposes a pair it has already been told is wrong.
        const rows = await factory.driver.query<{ rationale: string }>(
          `SELECT rationale FROM resolution_judgments
            WHERE verdict = 'NOT_MERGE' AND active
              AND ((left_entity_id = $1 AND right_entity_id = $2)
                OR (left_entity_id = $2 AND right_entity_id = $1))`,
          [left, right],
        );
        expect(rows.length, `${negative.left} ↔ ${negative.right} must be recorded`).toBeGreaterThan(0);
        expect(String(rows[0]?.rationale).length).toBeGreaterThan(0);
      }
    });

    it('makes no false merges and records every merge it did make', async () => {
      // Every merge in Phase 1 is a source record joining a canonical entity on
      // an exact identifier; there are no entity-to-entity merges at all.
      const merges = await factory.driver.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM resolution_judgments
          WHERE verdict = 'MERGE' AND left_entity_id IS NOT NULL`,
      );
      expect(Number(merges[0]?.n)).toBe(0);

      const records = await factory.driver.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM source_records`,
      );
      const recordMerges = await factory.driver.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM resolution_judgments
          WHERE verdict = 'MERGE' AND left_source_record_id IS NOT NULL AND active`,
      );
      expect(Number(recordMerges[0]?.n)).toBe(Number(records[0]?.n));

      const nonDeterministic = await factory.driver.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM resolution_candidates WHERE method <> 'DETERMINISTIC'`,
      );
      // Phase 2 adds probabilistic matching. Phase 1 must not have any.
      expect(Number(nonDeterministic[0]?.n)).toBe(0);
    });
  });

  /* ------------------------------------------------------------------ *
   * (c) BTU in one source, tons in another, one normalized answer
   * ------------------------------------------------------------------ */

  describe('(c) unit convergence: BTU/h and tons describe the same fact', () => {
    it('lands both units on one pair of canonical values for every model', async () => {
      const entityId = await entityIdByRef(factory.driver, 'equipment_model:24ACC636A003');
      const capacity = await factory.store.selectFact(
        entityId,
        'cooling_capacity_btu' as Identifier,
        { at: RUN_1_AT },
      );
      const tonnage = await factory.store.selectFact(entityId, 'nominal_tonnage' as Identifier, {
        at: RUN_1_AT,
      });

      expect(capacity.selected?.fact.normalized_value).toBe(36000);
      expect(capacity.selected?.fact.unit).toBe('BTU/h');
      expect(tonnage.selected?.fact.normalized_value).toBe(3);
      expect(tonnage.selected?.fact.unit).toBe('ton');
      // 12000 BTU/h = 1 ton, exact by definition — not an approximation, so the
      // consistency rule can be an equality rather than a tolerance.
      expect(Number(capacity.selected?.fact.normalized_value)).toBe(
        Number(tonnage.selected?.fact.normalized_value) * 12000,
      );
    });

    it('reaches the same value from a source that only publishes tons', async () => {
      // `coolsupply-distributor` publishes "3 Ton" and no BTU figure at all.
      const entityId = await entityIdByRef(factory.driver, 'equipment_model:BTWC2036');
      const capacity = await factory.store.selectFact(
        entityId,
        'cooling_capacity_btu' as Identifier,
        { at: RUN_1_AT },
      );
      expect(capacity.selected?.fact.normalized_value).toBe(36000);
      expect(capacity.selected?.fact.unit).toBe('BTU/h');
    });

    it('keeps every capacity and tonnage pair mutually consistent across the vertical', async () => {
      const rows = await factory.driver.query<{
        slug: string;
        capacity: string;
        tonnage: string;
      }>(
        `SELECT e.canonical_slug AS slug,
                (SELECT f.normalized_value::text FROM facts f
                  WHERE f.entity_id = e.id AND f.property = 'cooling_capacity_btu'
                    AND f.status = 'ACTIVE' AND f.valid_to IS NULL LIMIT 1) AS capacity,
                (SELECT f.normalized_value::text FROM facts f
                  WHERE f.entity_id = e.id AND f.property = 'nominal_tonnage'
                    AND f.status = 'ACTIVE' AND f.valid_to IS NULL LIMIT 1) AS tonnage
           FROM entities e
          WHERE e.entity_type = 'equipment_model'
          ORDER BY e.canonical_slug`,
      );
      expect(rows).toHaveLength(13);
      for (const row of rows) {
        expect(row.capacity, row.slug).not.toBeNull();
        expect(row.tonnage, row.slug).not.toBeNull();
        expect(Number(row.capacity), row.slug).toBe(Number(row.tonnage) * 12000);
      }
    });

    it('retains the source unit alongside the canonical one', async () => {
      // "3 Ton" must still be readable as evidence for a fact published in
      // BTU/h; a converted number with the original thrown away is unfalsifiable.
      const entityId = await entityIdByRef(factory.driver, 'equipment_model:BTWC2036');
      const facts = await factory.store.listFacts(entityId, {
        property: 'cooling_capacity_btu' as Identifier,
        at: RUN_1_AT,
      });
      const evidence = await factory.store.listFactEvidence(facts[0]!.id);
      expect(evidence.some((row) => row.source_value === '3 Ton')).toBe(true);
    });
  });

  /* ------------------------------------------------------------------ *
   * (d) the seeded conflicts are retained and decided on the record
   * ------------------------------------------------------------------ */

  describe('(d) genuine conflicts are retained and decided by authority, not recency', () => {
    it.each(goldenFacts().conflicts as any[])(
      'conflict $id: $property on $entity resolves to $winner and keeps $loser',
      async (conflict: any) => {
        const entityId = await entityIdByRef(factory.driver, conflict.entity);
        const explanation = await explainFact(
          factory.store,
          entityId,
          conflict.property as Identifier,
          policy,
        );
        expect(explanation).not.toBeNull();

        // The documented winner, and it won for the documented reason.
        expect(explanation?.selected?.value).toBe(conflict.winner);
        expect(explanation?.rule).toBe('DIRECT_AUTHORITATIVE_SOURCE');
        expect(explanation?.reason.length).toBeGreaterThan(0);

        // Both claims survive. The losing value is exactly the one the golden
        // file says a customer will phone up about.
        const values = explanation?.claims.map((claim) => claim.value) ?? [];
        expect(values).toContain(conflict.winner);
        expect(values).toContain(conflict.loser);
        expect(explanation?.unresolved_conflict).toBe(true);
        expect(explanation?.conflicts.map((rival) => rival.value)).toContain(conflict.loser);

        // The losing claim keeps its own evidence, traceable to its own source.
        const loser = explanation?.claims.find((claim) => claim.value === conflict.loser);
        expect(loser?.attributions.length).toBeGreaterThan(0);
        const losingDomains = new Set(loser?.attributions.map((row) => row.publisher));
        expect(losingDomains.size).toBe((conflict.loser_sources as string[]).length);

        // The trust surface can answer "why does your site say this?".
        expect(explanation?.narrative.join('\n')).toContain('DIRECT_AUTHORITATIVE_SOURCE');
      },
    );

    it('does not let corroboration outvote authority', async () => {
      // Conflict A: two sources say 14.5, one says 14.3, and 14.3 wins. A
      // majority vote or a confidence average gets this backwards.
      const entityId = await entityIdByRef(factory.driver, 'equipment_model:24ACC636A003');
      const explanation = await explainFact(
        factory.store,
        entityId,
        'seer2' as Identifier,
        policy,
      );
      const winner = explanation?.claims.find((claim) => claim.selected);
      const loser = explanation?.claims.find((claim) => !claim.selected);
      expect(winner?.value).toBe(14.3);
      expect(winner?.attributions).toHaveLength(1);
      expect(loser?.value).toBe(14.5);
      expect(loser?.attributions.length).toBe(2);
      expect(loser!.attributions.length).toBeGreaterThan(winner!.attributions.length);
    });

    it('records which doc-04 criterion decided every published property', async () => {
      const entityId = await entityIdByRef(factory.driver, 'equipment_model:24ACC636A003');
      const view = await factory.queryModel().canonicalFacts(entityId, policy);
      expect(view.length).toBeGreaterThan(0);
      for (const row of view) {
        expect(row.value, row.property).not.toBeNull();
        // "Because we said so" is not an available answer.
        expect(row.rule, row.property).toMatch(
          /^(SOLE_ELIGIBLE_CANDIDATE|DIRECT_AUTHORITATIVE_SOURCE|SOURCE_FIELD_RELIABILITY|RECENCY|CORROBORATION|CONSISTENCY_CHECK|EDITORIAL_OVERRIDE|DETERMINISTIC_TIEBREAK)$/,
        );
        expect(row.reason.length, row.property).toBeGreaterThan(0);
      }
    });
  });

  /* ------------------------------------------------------------------ *
   * (e) provenance coverage is exactly 1.0
   * ------------------------------------------------------------------ */

  describe('(e) every published fact traces to an artifact', () => {
    it('measures provenance coverage at exactly 1.0', async () => {
      const report = await provenanceCoverage(factory.driver);
      expect(report.facts.total).toBe(171);
      expect(report.facts.traceable).toBe(171);
      expect(report.facts.coverage).toBe(1);
      expect(report.untraceable_fact_ids).toEqual([]);

      expect(report.relationships.total).toBe(26);
      expect(report.relationships.traceable).toBe(26);
      expect(report.relationships.coverage).toBe(1);
      expect(report.untraceable_relationship_ids).toEqual([]);

      for (const entity of report.by_entity) {
        expect(entity.coverage, entity.canonical_slug).toBe(1);
      }
    });

    it('resolves each evidence chain all the way to stored bytes', async () => {
      const entityId = await entityIdByRef(factory.driver, 'equipment_model:24ACC636A003');
      const facts = await factory.queryModel().facts({ entity_id: entityId, at: RUN_1_AT });
      expect(facts.length).toBeGreaterThan(0);
      for (const fact of facts) {
        expect(fact.lineage, fact.fact.property).not.toBeNull();
        expect(fact.lineage?.chain.length, fact.fact.property).toBeGreaterThan(0);
        for (const link of fact.lineage?.chain ?? []) {
          expect(link.artifact.content_hash).toMatch(/^[0-9a-f]{64}$/);
          expect(link.artifact.url.startsWith('https://')).toBe(true);
          expect(link.source.publisher.length).toBeGreaterThan(0);
          // The bytes the fact was read from are still in the raw evidence store.
          const stored = await factory.artifacts.get(
            link.artifact.r2_uri.replace(/^memory:\/\//, ''),
          );
          expect(stored, link.artifact.r2_uri).not.toBeNull();
        }
      }
    });

    it('publishes nothing from a source without a current rights record', async () => {
      const rows = await factory.driver.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM fact_evidence fe
           JOIN source_records sr ON sr.id = fe.source_record_id
           JOIN sources s ON s.id = sr.source_id
          WHERE s.rights_classification IN ('RED', 'UNREVIEWED')`,
      );
      expect(Number(rows[0]?.n)).toBe(0);
    });
  });

  /* ------------------------------------------------------------------ *
   * (f) a full re-run is a no-op
   * ------------------------------------------------------------------ */

  describe('(f) the incremental re-run', () => {
    let before: CanonicalSnapshot;
    let after: CanonicalSnapshot;

    beforeAll(async () => {
      before = await snapshotCanonical(factory.driver);
      // A cold refresh cycle: new job identity, later instant, fresh validator
      // cache, so every byte is genuinely fetched and every stage genuinely
      // re-runs. A 304 short-circuit would prove nothing about the write path.
      const run = await factory.run({ at: RUN_2_AT, runId: 'cycle-2' });
      for (const source of run.sources) {
        expect(source.error).toBeNull();
        expect(source.outcome).toBe('FETCHED');
      }
      after = await snapshotCanonical(factory.driver);
    }, 300_000);

    it('creates zero new entities', () => {
      expect(after.entities).toBe(before.entities);
      expect(after.entityIds).toEqual(before.entityIds);
      expect(after.aliases).toBe(before.aliases);
    });

    it('creates zero new fact versions — the same rows, not merely the same count', () => {
      expect(after.facts).toBe(before.facts);
      expect(after.factIds).toEqual(before.factIds);
    });

    it('creates zero duplicate evidence rows and loses none', () => {
      expect(after.factEvidence).toBe(before.factEvidence);
      expect(after.evidenceIds).toEqual(before.evidenceIds);
      expect(after.relationshipEvidence).toBe(before.relationshipEvidence);
    });

    it('creates zero duplicate artifacts, records, edges or resolution rows', () => {
      expect(after.artifacts).toBe(before.artifacts);
      expect(after.sourceRecords).toBe(before.sourceRecords);
      expect(after.relationships).toBe(before.relationships);
      expect(after.resolutionCandidates).toBe(before.resolutionCandidates);
      expect(after.resolutionJudgments).toBe(before.resolutionJudgments);
    });

    it('is byte-identical across the whole canonical layer', () => {
      expect(after).toEqual(before);
    });

    it('still matches the golden records after the re-run', async () => {
      expect(difference(goldenFactKeys(), await factKeys(factory.driver))).toEqual([]);
      expect(difference(goldenAliasKeys(), await aliasKeys(factory.driver))).toEqual([]);
      expect(difference(goldenRelationshipKeys(), await relationshipKeys(factory.driver))).toEqual([]);
    });

    it('keeps provenance coverage at 1.0', async () => {
      const report = await provenanceCoverage(factory.driver);
      expect(report.facts.coverage).toBe(1);
      expect(report.relationships.coverage).toBe(1);
    });
  });

  /* ------------------------------------------------------------------ *
   * (g) a changed upstream value appends a version and closes the old one
   * ------------------------------------------------------------------ */

  describe('(g) a changed upstream value', () => {
    const CHANGED_PROPERTY = 'weight_lb' as Identifier;
    let entityId: EntityId;
    let originalFactId: FactId;
    let before: CanonicalSnapshot;

    beforeAll(async () => {
      entityId = await entityIdByRef(factory.driver, 'equipment_model:25HPA630A003');
      const facts = await factory.store.listFacts(entityId, {
        property: CHANGED_PROPERTY,
        at: RUN_2_AT,
      });
      expect(facts).toHaveLength(1);
      originalFactId = facts[0]!.id;
      before = await snapshotCanonical(factory.driver);

      // The manufacturer feed now says 199 lb where it said 196 lb. Only this
      // source publishes the weight of this model, so the change is
      // unambiguous — the pipeline is being asked to version a value, not to
      // arbitrate a disagreement.
      const changed = readFixture('acme-catalog.json').replace(
        '"net_weight_lb": 196',
        '"net_weight_lb": 199',
      );
      expect(changed).not.toBe(readFixture('acme-catalog.json'));

      const run = await factory.run({
        at: RUN_3_AT,
        runId: 'cycle-3',
        fixtureOverrides: { 'acme-hvac-catalog': changed },
      });
      for (const source of run.sources) expect(source.error).toBeNull();
    }, 300_000);

    it('appends exactly one new fact version', async () => {
      const after = await snapshotCanonical(factory.driver);
      expect(after.facts).toBe(before.facts + 1);
      const added = after.factIds.filter((id) => !before.factIds.includes(id));
      expect(added).toHaveLength(1);
    });

    it('closes the previous version instead of rewriting it', async () => {
      const previous = await factory.store.getFactById(originalFactId);
      expect(previous).not.toBeNull();
      // ADR-0001: `normalized_value` is never rewritten.
      expect(previous?.normalized_value).toBe(196);
      expect(previous?.status).toBe('SUPERSEDED');
      expect(previous?.valid_to).not.toBeNull();
    });

    it('publishes the new value as the current one', async () => {
      const current = await factory.store.selectFact(entityId, CHANGED_PROPERTY, {
        at: RUN_3_AT,
      });
      expect(current.selected?.fact.normalized_value).toBe(199);
      expect(current.selected?.fact.status).toBe('ACTIVE');
      expect(current.selected?.fact.unit).toBe('lb');
    });

    it('keeps the old version and its evidence retrievable (rule 10)', async () => {
      const history = await factory.store.listFacts(entityId, {
        property: CHANGED_PROPERTY,
        include_history: true,
      });
      expect(history.map((fact) => fact.normalized_value).sort()).toEqual([196, 199]);

      const evidence = await factory.store.listFactEvidence(originalFactId);
      expect(evidence.length).toBeGreaterThan(0);
      expect(evidence.every((row) => row.source_value === '196')).toBe(true);

      // The point-in-time question still answers correctly.
      const asOfJuly = await factory.store.selectFact(entityId, CHANGED_PROPERTY, { at: RUN_1_AT });
      expect(asOfJuly.selected?.fact.normalized_value).toBe(196);
    });

    it('changes nothing else: one new version, no new entities, no lost evidence', async () => {
      const after = await snapshotCanonical(factory.driver);
      expect(after.entities).toBe(before.entities);
      expect(after.relationships).toBe(before.relationships);
      expect(after.artifacts).toBe(before.artifacts + 1); // new bytes, new artifact
      expect(after.factEvidence).toBe(before.factEvidence + 1);
      // Every evidence row that existed before still exists.
      expect(before.evidenceIds.every((id) => after.evidenceIds.includes(id))).toBe(true);

      const report = await provenanceCoverage(factory.driver);
      expect(report.facts.coverage).toBe(1);
    });
  });

});
