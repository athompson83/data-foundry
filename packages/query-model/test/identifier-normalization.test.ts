/**
 * AGENTS.md rule 7 regression — "Exact identifiers beat semantic search."
 *
 * The adversarial audit found the query layer could not find identifiers the
 * ingest pipeline had just stored. Two independent defects, one root cause:
 *
 *   1. `identifierCandidates` generated a separator-stripped form only in LOWER
 *      case, while a vertical's alias op chain case-folds to UPPER before
 *      stripping (HVAC: `03-domain-normalization.yaml`). A stored
 *      `24ACC636A003` was therefore unreachable from `24acc6-36a003` — a
 *      spelling the vertical's own YAML documents as the same identifier and
 *      that two of its four sources publish.
 *   2. `lookupByIdentifier` used its own weaker set — {raw, lower, upper}, no
 *      separator stripping at all — so ONE package held TWO disagreeing
 *      definitions of "exact".
 *
 * Why the existing 887-test suite never caught it: `test/support.ts` seeds
 * `normalized_value` in lower case (`hk32ea001`, `25vna4`), which the
 * lower-cased candidate happened to match. The fixtures agreed with the bug.
 * These tests seed UPPER case, the way the real pipeline writes.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { entityQualityScore, identityConfidence } from '@data-foundry/canonical-schema';
import { collapseIdentifierUpper, identifierCandidates } from '../src/index.js';
import { createQueryFixtures, ts, type QueryFixtures } from './support.js';

let fixtures: QueryFixtures;

/** The exact spellings the HVAC vertical documents as one identifier. */
const SPELLINGS = ['24ACC636A003', '24acc6-36a003', '24ACC6 36A003', '24ACC6-36A003'] as const;
/** What the ingest pipeline actually stores: upper-cased, separators stripped. */
const STORED = '24ACC636A003';

let condenserId: string;
let decoyId: string;

beforeAll(async () => {
  fixtures = await createQueryFixtures();
  const { store, vertical, sources } = fixtures;

  // The entity that genuinely owns the model number.
  const condenser = await store.upsertEntity({
    vertical_id: vertical.id,
    entity_type: 'equipment',
    canonical_name: 'Acme Comfort 16 Condenser',
    canonical_slug: 'acme-comfort-16-condenser',
    status: 'ACTIVE',
    quality_score: entityQualityScore(0.8),
    first_seen_at: ts('2026-01-01T00:00:00Z'),
    last_verified_at: null,
  });
  condenserId = condenser.id;
  await store.addAlias({
    entity_id: condenser.id,
    alias_type: 'model_number',
    // The manufacturer publishes it unpunctuated, so BOTH stored columns hold
    // the plain form. Users arrive with the distributor's and the certification
    // body's punctuated spellings instead — which is the real-world shape of
    // this bug, and which a `raw.toUpperCase()` probe cannot reach.
    alias_value: STORED,
    normalized_value: STORED, // upper-cased + collapsed, as ingest writes it
    source_id: sources.manufacturer.source.id,
    identity_confidence: identityConfidence(0.99),
    valid_from: ts('2026-01-01T00:00:00Z'),
    valid_to: null,
  });

  // An unrelated aftermarket listing whose NAME is the punctuated spelling.
  // Before the fix this outranked the real owner and was flagged exact:true.
  const decoy = await store.upsertEntity({
    vertical_id: vertical.id,
    entity_type: 'equipment',
    canonical_name: '24acc6-36a003',
    canonical_slug: 'aftermarket-24acc6-36a003',
    status: 'ACTIVE',
    quality_score: entityQualityScore(0.1),
    first_seen_at: ts('2026-01-01T00:00:00Z'),
    last_verified_at: null,
  });
  decoyId = decoy.id;
});

afterAll(async () => {
  await fixtures?.driver.close();
});

describe('identifierCandidates', () => {
  it('generates the separator-stripped form in BOTH case conventions', () => {
    // The regression itself: the upper-cased collapse was simply absent.
    for (const spelling of SPELLINGS) {
      expect(identifierCandidates(spelling), spelling).toContain(STORED);
    }
  });

  it('still generates the lower-cased collapse for verticals that fold down', () => {
    expect(identifierCandidates('24ACC6-36A003')).toContain('24acc636a003');
  });

  it('does not widen the match class beyond case-fold + separator strip', () => {
    // Two genuinely different identifiers must not collide.
    const left = new Set(identifierCandidates('AB-100'));
    const right = identifierCandidates('AB-1000');
    expect(right.some((candidate) => left.has(candidate))).toBe(false);
  });

  it('collapseIdentifierUpper matches the documented op chain', () => {
    expect(collapseIdentifierUpper('24acc6-36a003')).toBe(STORED);
    expect(collapseIdentifierUpper('24ACC6 36A003')).toBe(STORED);
    expect(collapseIdentifierUpper('HK-32EA/001')).toBe('HK32EA001');
  });
});

describe('lookupIdentifier finds what the pipeline stored', () => {
  it.each(SPELLINGS)('resolves %s to the owning entity', async (spelling) => {
    const result = await fixtures.qm.lookupIdentifier({
      vertical_id: fixtures.vertical.id,
      value: spelling,
    });
    expect(result.entities.map((view) => view.entity.id)).toContain(condenserId);
  });

  it('agrees with the search path about what "exact" means', async () => {
    // The two-definitions-of-exact bug: these read paths must not diverge.
    for (const spelling of SPELLINGS) {
      const direct = await fixtures.qm.lookupIdentifier({
        vertical_id: fixtures.vertical.id,
        value: spelling,
      });
      const searched = await fixtures.qm.search({
        vertical_id: fixtures.vertical.id,
        text: spelling,
      });
      const directHit = direct.entities.some((view) => view.entity.id === condenserId);
      const searchHit = searched.hits.some(
        (hit) => hit.entity.id === condenserId && hit.match_kind === 'EXACT_IDENTIFIER',
      );
      expect(searchHit, `search disagreed with lookup for ${spelling}`).toBe(directHit);
    }
  });

  it('returns nothing for an identifier no entity holds', async () => {
    const result = await fixtures.qm.lookupIdentifier({
      vertical_id: fixtures.vertical.id,
      value: 'ZZ-NOT-A-REAL-MODEL-9999',
    });
    expect(result.entities).toEqual([]);
  });
});

describe('the identifier owner outranks a name-collision decoy', () => {
  it.each(SPELLINGS)('serves the real owner first for %s', async (spelling) => {
    const result = await fixtures.qm.search({
      vertical_id: fixtures.vertical.id,
      text: spelling,
    });

    const winner = result.hits[0];
    expect(winner?.entity.id, `decoy won for ${spelling}`).toBe(condenserId);
    expect(winner?.match_kind).toBe('EXACT_IDENTIFIER');
    expect(winner?.exact).toBe(true);
  });

  it('never flags the decoy as the exact identifier match', async () => {
    // Previously: decoy served at rank 1, EXACT_NAME, score 1.0, exact:true,
    // while the true owner was demoted to the TRIGRAM tier at ~0.48.
    const result = await fixtures.qm.search({
      vertical_id: fixtures.vertical.id,
      text: '24acc6-36a003',
    });
    const decoyHit = result.hits.find((hit) => hit.entity.id === decoyId);
    expect(decoyHit?.match_kind).not.toBe('EXACT_IDENTIFIER');

    const ownerRank = result.hits.findIndex((hit) => hit.entity.id === condenserId);
    const decoyRank = result.hits.findIndex((hit) => hit.entity.id === decoyId);
    expect(ownerRank).toBeGreaterThanOrEqual(0);
    if (decoyRank >= 0) expect(ownerRank).toBeLessThan(decoyRank);
  });
});
