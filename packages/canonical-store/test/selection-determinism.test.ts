/**
 * Findings #8 / #14 — reproducible selection must not rest on a random id or on
 * the host's collator.
 *
 * `DETERMINISTIC_TIEBREAK` promised that "the same inputs must always publish
 * the same value". It delivered something weaker: `recorded_at DESC`, then
 * `fact.id.localeCompare(...)`. `facts.id` is `gen_random_uuid()`, so the
 * winner was decided by which random id each claim happened to draw. Re-ingest
 * the same artifacts into a fresh database — a rebuild, a replay, a restore
 * into a new environment — and a different claim gets published from identical
 * inputs. `localeCompare` then made the same comparison depend on the machine's
 * locale, which is not a property of the data at all.
 *
 * These tests drive the real `selectCanonicalFact` with real candidate shapes.
 * Nothing here is a re-implementation of the cascade.
 */
import { describe, expect, it } from 'vitest';
import {
  selectCanonicalFact,
  type CandidateEvidence,
  type FactCandidate,
  type FactSelectionPolicyInput,
} from '../src/index.js';
import {
  factConfidence,
  type FactId,
  type Identifier,
  type IsoDateTime,
} from '@data-foundry/canonical-schema';

const AT = '2026-07-01T00:00:00.000Z' as IsoDateTime;
const PROPERTY = 'refrigerant' as Identifier;

const UUID_LOW = '0000aaaa-1111-4111-8111-111111111111' as FactId;
const UUID_HIGH = 'ffffbbbb-2222-4222-8222-222222222222' as FactId;

/**
 * Both claims come from the same source, with the same reliability, recorded at
 * the same instant, both consistent — so every rung of the cascade ties and the
 * final tiebreak is the only thing left to decide.
 */
function candidate(options: {
  readonly id: FactId;
  readonly value: string;
  readonly contentHash?: string;
}): FactCandidate {
  const evidence: CandidateEvidence = {
    evidence: {
      id: `e${options.id.slice(1)}` as never,
      fact_id: options.id,
      artifact_id: 'aaaaaaaa-0000-4000-8000-000000000001' as never,
      source_record_id: 'bbbbbbbb-0000-4000-8000-000000000001' as never,
      source_value: options.value,
      locator_type: 'JSON_POINTER',
      locator_value: '/refrigerant',
      observed_at: '2026-06-01T00:00:00.000Z' as IsoDateTime,
      created_at: '2026-06-01T00:00:00.000Z' as IsoDateTime,
    },
    source: {
      source_id: 'cccccccc-0000-4000-8000-000000000001' as never,
      publisher: 'Carrier',
      domain: 'carrier.com',
      source_type: 'MANUFACTURER',
      authority_rank: 90,
      rights_classification: 'GREEN',
    },
    artifact: {
      id: 'aaaaaaaa-0000-4000-8000-000000000001' as never,
      url: 'https://carrier.com/spec',
      retrieved_at: '2026-06-01T00:00:00.000Z' as IsoDateTime,
      content_hash: (options.contentHash ?? 'a'.repeat(64)) as never,
    },
  };

  return {
    fact: {
      id: options.id,
      entity_id: 'dddddddd-0000-4000-8000-000000000001' as never,
      property: PROPERTY,
      normalized_value: options.value,
      value_type: 'string',
      unit: null,
      valid_from: '2026-01-01T00:00:00.000Z' as IsoDateTime,
      valid_to: null,
      status: 'ACTIVE',
      confidence: factConfidence(0.9),
      supersedes_fact_id: null,
      recorded_at: '2026-06-01T00:00:00.000Z' as IsoDateTime,
      created_at: '2026-06-01T00:00:00.000Z' as IsoDateTime,
    },
    evidence: [evidence],
  };
}

const POLICY: FactSelectionPolicyInput = { at: AT };

const select = (candidates: readonly FactCandidate[]) =>
  selectCanonicalFact(PROPERTY, candidates, POLICY);

describe('#8 — selection does not depend on which random UUID a claim drew', () => {
  it('publishes the same value when the ids are swapped between the claims', () => {
    // The only difference between the two runs is which random id each claim
    // was assigned — exactly what a rebuild into a fresh database changes.
    const asIngested = select([
      candidate({ id: UUID_LOW, value: 'R-410A' }),
      candidate({ id: UUID_HIGH, value: 'R-454B' }),
    ]);
    const afterReplay = select([
      candidate({ id: UUID_HIGH, value: 'R-410A' }),
      candidate({ id: UUID_LOW, value: 'R-454B' }),
    ]);

    expect(asIngested.rule).toBe('DETERMINISTIC_TIEBREAK');
    expect(afterReplay.rule).toBe('DETERMINISTIC_TIEBREAK');
    expect(
      afterReplay.selected?.fact.normalized_value,
      'a replay into a fresh database must publish the same value',
    ).toBe(asIngested.selected?.fact.normalized_value);
  });

  it('publishes the same value regardless of the order the claims arrive in', () => {
    const forwards = select([
      candidate({ id: UUID_LOW, value: 'R-410A' }),
      candidate({ id: UUID_HIGH, value: 'R-454B' }),
    ]);
    const backwards = select([
      candidate({ id: UUID_HIGH, value: 'R-454B' }),
      candidate({ id: UUID_LOW, value: 'R-410A' }),
    ]);
    expect(backwards.selected?.fact.normalized_value).toBe(
      forwards.selected?.fact.normalized_value,
    );
  });

  it('still prefers the most recently recorded claim before reaching the tiebreak', () => {
    // Recency is the semantic half of the rule and must not be lost while
    // removing the arbitrary half.
    const older = candidate({ id: UUID_LOW, value: 'R-410A' });
    const newer: FactCandidate = {
      ...candidate({ id: UUID_HIGH, value: 'R-454B' }),
      fact: {
        ...candidate({ id: UUID_HIGH, value: 'R-454B' }).fact,
        recorded_at: '2026-06-20T00:00:00.000Z' as IsoDateTime,
      },
    };
    expect(select([older, newer]).selected?.fact.normalized_value).toBe('R-454B');
    expect(select([newer, older]).selected?.fact.normalized_value).toBe('R-454B');
  });
});

describe('#14 — the final tiebreak is codepoint-ordered, not collator-ordered', () => {
  it('orders tied claims by their canonical value in codepoint order', () => {
    // ICU (any locale this repo has been run under) orders lowercase before
    // uppercase, so a collator would publish "r-410a". Codepoint order puts
    // "R-410A" first. The point is not which one is nicer — it is that the
    // answer cannot move when the host, its ICU build or its locale changes.
    // Asserted under both id assignments, so it cannot pass by the random ids
    // happening to agree with codepoint order on this run.
    for (const [lower, upper] of [
      [UUID_HIGH, UUID_LOW],
      [UUID_LOW, UUID_HIGH],
    ] as const) {
      const selection = select([
        candidate({ id: lower, value: 'r-410a' }),
        candidate({ id: upper, value: 'R-410A' }),
      ]);
      expect(selection.selected?.fact.normalized_value).toBe('R-410A');
    }
  });

  it('names the tiebreak it actually applied', () => {
    const selection = select([
      candidate({ id: UUID_LOW, value: 'R-410A' }),
      candidate({ id: UUID_HIGH, value: 'R-454B' }),
    ]);
    expect(selection.reason).toMatch(/recorded_at/);
    expect(selection.reason).not.toMatch(/fact id/);
    expect(selection.unresolved_conflict).toBe(true);
  });

  it('falls back to the evidence chain when two claims carry the same value', () => {
    // Same value, different evidence: the published value is identical either
    // way, so the tiebreak only has to be stable — and it must be stable on
    // something a rebuild reproduces, which a content hash is and an id is not.
    const first = select([
      candidate({ id: UUID_LOW, value: 'R-410A', contentHash: 'b'.repeat(64) }),
      candidate({ id: UUID_HIGH, value: 'R-410A', contentHash: 'c'.repeat(64) }),
    ]);
    const swapped = select([
      candidate({ id: UUID_HIGH, value: 'R-410A', contentHash: 'b'.repeat(64) }),
      candidate({ id: UUID_LOW, value: 'R-410A', contentHash: 'c'.repeat(64) }),
    ]);
    expect(swapped.selected?.evidence[0]?.artifact.content_hash).toBe(
      first.selected?.evidence[0]?.artifact.content_hash,
    );
  });
});
