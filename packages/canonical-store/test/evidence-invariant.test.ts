/**
 * AGENTS.md rule 2 — "No published fact without evidence."
 *
 * These tests exist to prove the rule is structural, not procedural: there is
 * no public method that writes a bare fact, an empty evidence set is rejected,
 * and a failure while writing evidence takes the fact down with it.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MissingEvidenceError, type FactEvidenceInput, type NonEmptyArray } from '../src/index.js';
import { factConfidence } from '@data-foundry/canonical-schema';
import { countRows, createFixtures, claim, ts, type Fixtures } from './support.js';

let fixtures: Fixtures;

beforeAll(async () => {
  fixtures = await createFixtures();
});

afterAll(async () => {
  await fixtures?.driver.close();
});

describe('rule 2: no fact without evidence', () => {
  /**
   * Finding #11 replaced the original version of this test. It matched method
   * NAMES against a regex, which had two holes the audit demonstrated:
   *   1. it would have passed for `putFact`, `recordClaim` or `persistFact`;
   *   2. it enumerated only the PROTOTYPE, so it could not see `driver` — an
   *      instance field — which was the actual escape hatch.
   * The replacement snapshots the entire reachable public surface, instance
   * fields included, so a renamed writer or a new raw handle shows up as a diff
   * rather than slipping through a pattern.
   */
  it('pins the full reachable public surface, instance fields included', () => {
    const own = Object.keys(fixtures.store);
    const proto = Object.getOwnPropertyNames(Object.getPrototypeOf(fixtures.store)).filter(
      (name) => name !== 'constructor',
    );
    const surface = [...new Set([...own, ...proto])].filter((name) => !name.startsWith('_'));

    // Anything that can create a claim must carry evidence in its signature.
    // The noun match is CASE-SENSITIVE on purpose: `recordSourceArtifact`
    // contains the substring "fact" ("Arti-fact-") and is not a claim writer.
    // The verb list is deliberately much broader than the original regex, which
    // only caught insert/create/add/write/upsert/append and would have passed a
    // method named `putFact` or `persistFact`.
    const claimWriters = surface.filter(
      (name) =>
        /Fact|Relationship/.test(name) &&
        /^(append|upsert|insert|create|add|write|put|record|persist|save|store)/i.test(name),
    );
    // `recordFactVerification` is name-shaped like a claim writer and is not
    // one: it stores a VERDICT ABOUT a claim. Listing it here rather than
    // renaming it around the guard is the point — the guard exists to force
    // that decision to be made visibly, and the test below proves the claim by
    // behaviour rather than by the reader taking this comment on trust.
    expect(claimWriters.sort()).toEqual([
      'appendFactWithEvidence',
      'recordFactVerification',
      'upsertRelationshipWithEvidence',
    ]);

    // The ONLY non-method handle on the surface is the documented trusted
    // driver. If a second raw handle appears, this fails and forces a decision
    // rather than silently widening the bypass.
    const rawHandles = surface.filter((name) => {
      const value = (fixtures.store as unknown as Record<string, unknown>)[name];
      return (
        value !== null &&
        typeof value === 'object' &&
        (typeof (value as Record<string, unknown>)['query'] === 'function' ||
          typeof (value as Record<string, unknown>)['transaction'] === 'function')
      );
    });
    expect(rawHandles).toEqual(['driver']);
  });

  it('lets the verdict writer write no claim, which is why it is not a claim writer', async () => {
    // A property no other test in this file reads, so the shared fixture's
    // state stays exactly as its neighbours expect it.
    const PROBE = 'verdict_probe_property' as never;
    const fact = await claim(fixtures, 'manufacturer', {
      property: PROBE,
      value: 'probe',
      valid_from: '2026-03-01T00:00:00Z',
      observed_at: '2026-03-01T00:00:00Z',
    });
    const factsBefore = await countRows(fixtures.driver, 'facts');
    const evidenceBefore = await countRows(fixtures.driver, 'fact_evidence');

    await fixtures.store.recordFactVerification({
      entity_id: fixtures.entity.id,
      property: PROBE,
      fact_id: fact.fact.id,
      selected_value: 'probe',
      unit: null,
      verified: false,
      reason: 'probe',
      blockers: ['NO_AUTHORITATIVE_SUPPORT'],
      signals: {},
      evidence_refs: [],
      selection_rule: 'RECENCY',
      policy_version: 'verification-policy-v2',
      evaluated_at: ts('2026-03-01T00:00:00Z'),
      verdict_fingerprint: 'c'.repeat(64),
    });

    expect(await countRows(fixtures.driver, 'facts')).toBe(factsBefore);
    expect(await countRows(fixtures.driver, 'fact_evidence')).toBe(evidenceBefore);
  });

  it('keeps the raw driver off the customer-facing query facade', async () => {
    // The store's `driver` is a deliberate hatch for TRUSTED infrastructure
    // (the ingest worker's job/resolution tables, provenance lineage reads).
    // What must never happen is an application-layer object carrying it —
    // `packages/query-model` asserts that boundary in driver-boundary.test.ts.
    // Here we assert the complementary half: the hatch exists ON THE STORE and
    // the store is not something a request handler is given.
    const store = fixtures.store as unknown as Record<string, unknown>;
    expect(typeof store['driver']).toBe('object');

    // A bare fact through that hatch is still accepted by SQL — the invariant
    // is in the API, not the schema. This is recorded as remaining exposure,
    // not as passing behaviour, and is why the hatch must stay off any facade.
    const bare = await fixtures.driver
      .query(`SELECT 1 FROM information_schema.table_constraints
              WHERE table_name = 'facts' AND constraint_type = 'CHECK'
                AND constraint_name LIKE '%evidence%'`);
    expect(bare.length).toBe(0); // documents the gap: no SQL-level evidence constraint
  });

  it('rejects an empty evidence set at runtime as well as at compile time', async () => {
    const empty = [] as unknown as NonEmptyArray<FactEvidenceInput>;
    await expect(
      fixtures.store.appendFactWithEvidence(
        {
          entity_id: fixtures.entity.id,
          property: 'refrigerant',
          normalized_value: 'R-454B',
          value_type: 'string',
          unit: null,
          valid_from: ts('2026-02-01T00:00:00Z'),
          confidence: factConfidence(0.9),
          recorded_at: ts('2026-02-01T00:00:00Z'),
          status: 'ACTIVE',
        },
        empty,
      ),
    ).rejects.toBeInstanceOf(MissingEvidenceError);

    const facts = await fixtures.store.listFacts(fixtures.entity.id, { property: 'refrigerant' });
    expect(facts).toEqual([]);
  });

  it('rolls the fact back when its evidence cannot be written', async () => {
    const before = await countRows(fixtures.driver, 'facts');
    const evidenceBefore = await countRows(fixtures.driver, 'fact_evidence');

    // A syntactically valid artifact id that does not exist: the evidence
    // INSERT violates its foreign key *after* the fact row was inserted.
    const orphanArtifact = '99999999-9999-4999-8999-999999999999' as (typeof fixtures.sources.manufacturer.artifact)['id'];

    await expect(
      fixtures.store.appendFactWithEvidence(
        {
          entity_id: fixtures.entity.id,
          property: 'compressor_stages',
          normalized_value: 2,
          value_type: 'integer',
          unit: null,
          valid_from: ts('2026-02-01T00:00:00Z'),
          confidence: factConfidence(0.9),
          recorded_at: ts('2026-02-01T00:00:00Z'),
          status: 'ACTIVE',
        },
        [
          {
            artifact_id: orphanArtifact,
            source_record_id: fixtures.sources.manufacturer.record.id,
            source_value: '2-stage',
            locator_type: 'WHOLE_DOCUMENT',
            locator_value: '',
            observed_at: ts('2026-02-01T00:00:00Z'),
          },
        ],
      ),
    ).rejects.toThrow();

    // The transaction took the fact with it. No unsupported claim survives.
    expect(await countRows(fixtures.driver, 'facts')).toBe(before);
    expect(await countRows(fixtures.driver, 'fact_evidence')).toBe(evidenceBefore);
    expect(await fixtures.store.listFacts(fixtures.entity.id, { property: 'compressor_stages' })).toEqual([]);
  });

  it('commits the fact and its evidence together on the happy path', async () => {
    const result = await claim(fixtures, 'manufacturer', {
      property: 'refrigerant',
      value: 'R-454B',
    });
    expect(result.outcome).toBe('CREATED');
    expect(result.evidence).toHaveLength(1);

    const evidence = await fixtures.store.listFactEvidence(result.fact.id);
    expect(evidence).toHaveLength(1);
    expect(evidence[0]?.fact_id).toBe(result.fact.id);
  });

  it('applies the same contract to relationships', async () => {
    const part = await fixtures.store.upsertEntity({
      vertical_id: fixtures.vertical.id,
      entity_type: 'part',
      canonical_name: 'Carrier HK32EA001',
      canonical_slug: 'carrier-hk32ea001',
      status: 'ACTIVE',
      quality_score: fixtures.entity.quality_score,
      first_seen_at: ts('2026-01-01T00:00:00Z'),
      last_verified_at: null,
    });

    const empty = [] as unknown as NonEmptyArray<FactEvidenceInput>;
    await expect(
      fixtures.store.upsertRelationshipWithEvidence(
        {
          vertical_id: fixtures.vertical.id,
          subject_entity_id: fixtures.entity.id,
          predicate: 'uses_part',
          object_entity_id: part.id,
          confidence: factConfidence(0.9) as never,
          valid_from: ts('2026-02-01T00:00:00Z'),
          recorded_at: ts('2026-02-01T00:00:00Z'),
          status: 'ACTIVE',
        },
        empty,
      ),
    ).rejects.toBeInstanceOf(MissingEvidenceError);

    expect(await fixtures.store.listRelationships(fixtures.entity.id)).toEqual([]);
  });
});
