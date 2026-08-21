/**
 * Tests for the "Source verified" badge policy.
 *
 * The badge is an assertion this company makes to a technician, buyer or
 * procurement agent who may act on it before ordering a part. It is therefore
 * a deterministic policy, not a confidence calculation, and it fails closed.
 *
 * These tests pin PUBLIC BEHAVIOUR of the policy — never its internals.
 */

import { describe, expect, it } from 'vitest';
import type { SourceType } from '@data-foundry/canonical-schema';
import {
  AUTHORITATIVE_SOURCE_TYPES,
  SOURCE_VERIFIED_DEFINITION,
  VERIFICATION_POLICY_VERSION,
  VERIFICATION_POLICY_VERSIONS,
  VERIFIED_DECIDERS,
  isVerified,
  verificationSignals,
  type VerificationSignals,
} from '../src/verification-policy.js';
import type { ClaimAttribution, FactExplanation } from '../src/explain.js';

const NOW = new Date('2026-08-14T00:00:00.000Z');

function attribution(over: Partial<ClaimAttribution> = {}): ClaimAttribution {
  return {
    publisher: 'Acme HVAC',
    domain: 'acme-hvac.example',
    source_type: 'MANUFACTURER' as SourceType,
    authority_rank: 70,
    rights: 'GREEN',
    publishable: true,
    source_value: '14.5',
    locator: 'JSON_POINTER /models/0/seer2',
    artifact_url: 'https://acme-hvac.example/catalog.json',
    retrieved_at: '2026-08-01T00:00:00.000Z',
    observed_at: '2026-08-01T00:00:00.000Z',
    ...over,
  } as ClaimAttribution;
}

function explanation(
  attributions: readonly ClaimAttribution[],
  over: Partial<FactExplanation> = {},
): FactExplanation {
  return {
    selected: attributions.length
      ? ({ attributions, selected: true } as FactExplanation['selected'])
      : null,
    unresolved_conflict: false,
    rule: 'DIRECT_AUTHORITATIVE_SOURCE',
    ...over,
  } as FactExplanation;
}

/** A fully qualifying signal set; each policy case mutates one axis of it. */
const QUALIFYING: VerificationSignals = {
  corroboratingPublishers: 1,
  hasAuthoritativeSource: true,
  maxAuthorityRank: 95,
  allEvidencePublishable: true,
  freshestEvidenceAgeDays: 13,
  hasDatedAuthoritativeEvidence: true,
  freshestAuthoritativeEvidenceAgeDays: 13,
  hasUnresolvedConflict: false,
  hasEvidence: true,
  decidedBy: 'DIRECT_AUTHORITATIVE_SOURCE',
};

// ---------------------------------------------------------------------------
// Mechanical signal extraction (not policy)
// ---------------------------------------------------------------------------

describe('verificationSignals (mechanical extraction)', () => {
  it('counts DISTINCT publishers, not evidence rows', () => {
    const s = verificationSignals(
      explanation([
        attribution({ publisher: 'Acme HVAC', locator: 'a' }),
        attribution({ publisher: 'Acme HVAC', locator: 'b' }),
        attribution({ publisher: 'AHRI Directory' }),
      ]),
      NOW,
    );
    expect(s.corroboratingPublishers).toBe(2);
  });

  it('detects a primary-authority backer', () => {
    expect(
      verificationSignals(
        explanation([attribution({ source_type: 'DISTRIBUTOR' as SourceType })]),
        NOW,
      ).hasAuthoritativeSource,
    ).toBe(false);

    expect(
      verificationSignals(
        explanation([attribution({ source_type: 'CERTIFICATION_BODY' as SourceType })]),
        NOW,
      ).hasAuthoritativeSource,
    ).toBe(true);
  });

  it('scopes signals to the SELECTED claim only, never to losing rivals', () => {
    // The documented failure mode: a recent distributor backs the LOSING value
    // while the winning value rests on an old certification record. The winner
    // must not inherit the rival's freshness or its publishability.
    const explained = {
      selected: {
        attributions: [
          attribution({
            publisher: 'AHRI Directory',
            source_type: 'CERTIFICATION_BODY' as SourceType,
            retrieved_at: '2019-03-01T00:00:00.000Z',
          }),
        ],
        selected: true,
      },
      claims: [
        {
          attributions: [
            attribution({
              publisher: 'CoolSupply',
              source_type: 'DISTRIBUTOR' as SourceType,
              publishable: false,
              retrieved_at: '2026-08-13T00:00:00.000Z',
            }),
          ],
          selected: false,
        },
      ],
      unresolved_conflict: false,
      rule: 'DIRECT_AUTHORITATIVE_SOURCE',
    } as unknown as FactExplanation;

    const s = verificationSignals(explained, NOW);
    expect(s.corroboratingPublishers).toBe(1);
    expect(s.allEvidencePublishable).toBe(true); // rival's non-publishable row ignored
    expect(s.freshestEvidenceAgeDays).toBeGreaterThan(2000); // 2019, not yesterday
  });

  it('returns null age rather than guessing when timestamps are unparseable', () => {
    const s = verificationSignals(
      explanation([attribution({ retrieved_at: 'not-a-date' as ClaimAttribution['retrieved_at'] })]),
      NOW,
    );
    expect(s.freshestEvidenceAgeDays).toBeNull();
  });

  it('requires EVERY backer of the selected value to be publishable', () => {
    const s = verificationSignals(
      explanation([
        attribution({ publishable: true }),
        attribution({ publisher: 'Murky Feed', publishable: false }),
      ]),
      NOW,
    );
    expect(s.allEvidencePublishable).toBe(false);
  });

  it('treats a fact with no selected claim as having no evidence', () => {
    const s = verificationSignals(explanation([]), NOW);
    expect(s.hasEvidence).toBe(false);
    expect(s.corroboratingPublishers).toBe(0);
  });
});

describe('AUTHORITATIVE_SOURCE_TYPES', () => {
  it('excludes restating source types', () => {
    for (const restater of ['DISTRIBUTOR', 'MARKETPLACE', 'AGGREGATOR', 'COMMUNITY']) {
      expect(AUTHORITATIVE_SOURCE_TYPES).not.toContain(restater as SourceType);
    }
  });
});

// ---------------------------------------------------------------------------
// The seven policy cases
// ---------------------------------------------------------------------------

describe('isVerified — policy', () => {
  // 1
  it('rejects a fact with no evidence', () => {
    const v = isVerified({ ...QUALIFYING, hasEvidence: false });
    expect(v.verified).toBe(false);
    expect(v.blockers).toContain('NO_EVIDENCE');
    expect(v.reason).toMatch(/no source evidence/i);
  });

  // 2
  it('rejects agreement among multiple non-authoritative publishers', () => {
    // Three distributors agreeing may be three copies of one catalog entry.
    const v = isVerified({
      ...QUALIFYING,
      hasAuthoritativeSource: false,
      corroboratingPublishers: 3,
      maxAuthorityRank: 40,
      decidedBy: 'CORROBORATION',
    });
    expect(v.verified).toBe(false);
    expect(v.blockers).toContain('NO_AUTHORITATIVE_SUPPORT');
    expect(v.reason).toMatch(/authoritative/i);
  });

  // 3
  it('verifies one dated and publishable authoritative source without conflict', () => {
    // Selection short-circuits to SOLE_ELIGIBLE_CANDIDATE when only one claim is
    // eligible, so a lone certification body never reaches the authority rule.
    // It still qualifies: hasAuthoritativeSource independently guards it.
    const sole = isVerified({
      ...QUALIFYING,
      corroboratingPublishers: 1,
      decidedBy: 'SOLE_ELIGIBLE_CANDIDATE',
    });
    expect(sole.verified).toBe(true);
    expect(sole.blockers).toEqual([]);

    const contested = isVerified({ ...QUALIFYING, decidedBy: 'DIRECT_AUTHORITATIVE_SOURCE' });
    expect(contested.verified).toBe(true);
  });

  // 4
  it('allows old dated authoritative evidence because verified is not the same as current', () => {
    // A 2019 spec sheet may be exactly right for a discontinued 2019 model.
    const v = isVerified({
      ...QUALIFYING,
      freshestEvidenceAgeDays: 2_600,
      freshestAuthoritativeEvidenceAgeDays: 2_600,
    });
    expect(v.verified).toBe(true);
    expect(v.blockers).toEqual([]);
  });

  // 5
  it('rejects an authoritative value while a source conflict remains unresolved', () => {
    // Authority may still decide WHICH value displays; it does not resolve the
    // contradiction, and the badge must not paper over that.
    const v = isVerified({ ...QUALIFYING, hasUnresolvedConflict: true });
    expect(v.verified).toBe(false);
    expect(v.blockers).toContain('UNRESOLVED_CONFLICT');
    expect(v.reason).toMatch(/disagree/i);
  });

  // 6
  it('rejects a fact whose verification evidence is not publishable', () => {
    // A customer must be able to inspect the basis of our assertion.
    const v = isVerified({ ...QUALIFYING, allEvidencePublishable: false });
    expect(v.verified).toBe(false);
    expect(v.blockers).toContain('RIGHTS_RESTRICTED');
    expect(v.reason).toMatch(/cannot be displayed or cited/i);
  });

  // 7
  it('rejects undated evidence and non-authoritative decision paths', () => {
    const undated = isVerified({
      ...QUALIFYING,
      freshestEvidenceAgeDays: null,
      hasDatedAuthoritativeEvidence: false,
      freshestAuthoritativeEvidenceAgeDays: null,
    });
    expect(undated.verified).toBe(false);
    expect(undated.blockers).toContain('UNKNOWN_EVIDENCE_DATE');

    // Every non-allowlisted decision path fails CLOSED, including a future one.
    for (const rule of [
      'RECENCY',
      'CORROBORATION',
      'CONSISTENCY_CHECK',
      'SOURCE_FIELD_RELIABILITY',
      'EDITORIAL_OVERRIDE',
      'DETERMINISTIC_TIEBREAK',
    ] as const) {
      const v = isVerified({ ...QUALIFYING, decidedBy: rule });
      expect(v.verified, `${rule} must not earn the badge`).toBe(false);
      expect(v.blockers).toContain('NON_AUTHORITATIVE_ADJUDICATION');
    }
  });
});

// ---------------------------------------------------------------------------
// Cross-cutting policy guarantees
// ---------------------------------------------------------------------------

describe('isVerified — guarantees', () => {
  it('reports EVERY applicable blocker, not just the first', () => {
    const v = isVerified({
      ...QUALIFYING,
      hasAuthoritativeSource: false,
      freshestEvidenceAgeDays: null,
      hasDatedAuthoritativeEvidence: false,
      freshestAuthoritativeEvidenceAgeDays: null,
      decidedBy: 'CORROBORATION',
    });
    expect(v.blockers).toEqual(
      expect.arrayContaining(['NO_AUTHORITATIVE_SUPPORT', 'NON_AUTHORITATIVE_ADJUDICATION']),
    );
  });

  it('does not report undated authoritative evidence when there is none to date', () => {
    // The whole list is rendered in the "why this is not verified" panel, so
    // "the authoritative evidence could not be dated" must not appear beside
    // "there is no authoritative evidence". Absent and undated are different
    // refusals; the first already has its own code.
    const v = isVerified({
      ...QUALIFYING,
      hasAuthoritativeSource: false,
      hasDatedAuthoritativeEvidence: false,
      freshestAuthoritativeEvidenceAgeDays: null,
    });
    expect(v.blockers).toContain('NO_AUTHORITATIVE_SUPPORT');
    expect(v.blockers).not.toContain('UNKNOWN_EVIDENCE_DATE');
    expect(v.verified).toBe(false);
  });

  it('still reports an authoritative backer that carries no usable date', () => {
    const v = isVerified({
      ...QUALIFYING,
      hasAuthoritativeSource: true,
      hasDatedAuthoritativeEvidence: false,
      freshestAuthoritativeEvidenceAgeDays: null,
    });
    expect(v.blockers).toContain('UNKNOWN_EVIDENCE_DATE');
    expect(v.verified).toBe(false);
  });

  it('orders the primary reason by the documented blocker priority', () => {
    // No evidence outranks everything else.
    const v = isVerified({
      ...QUALIFYING,
      hasEvidence: false,
      hasUnresolvedConflict: true,
      hasAuthoritativeSource: false,
    });
    expect(v.reason).toMatch(/no source evidence/i);
    expect(v.blockers[0]).toBe('NO_EVIDENCE');

    // Unresolved conflict outranks missing authority.
    const c = isVerified({
      ...QUALIFYING,
      hasUnresolvedConflict: true,
      hasAuthoritativeSource: false,
    });
    expect(c.blockers[0]).toBe('UNRESOLVED_CONFLICT');
  });

  it('fails closed for an unrecognised decision path', () => {
    const v = isVerified({
      ...QUALIFYING,
      decidedBy: 'SOME_FUTURE_RULE' as VerificationSignals['decidedBy'],
    });
    expect(v.verified).toBe(false);
  });

  it('stamps the policy version so the badge stays auditable if criteria change', () => {
    expect(isVerified(QUALIFYING).policy_version).toBe(VERIFICATION_POLICY_VERSION);
    // v1 -> v2 when the date requirement moved from "some backer is dated" to
    // "an authoritative backer is dated": a stored v1 verdict may say verified
    // where v2 refuses, so the version has to travel with the verdict.
    expect(VERIFICATION_POLICY_VERSION).toBe('verification-policy-v2');
    expect(VERIFICATION_POLICY_VERSIONS).toContain('verification-policy-v1');
    expect(VERIFICATION_POLICY_VERSIONS.at(-1)).toBe(VERIFICATION_POLICY_VERSION);
  });

  it('always returns a non-empty reason and echoes the signals it judged', () => {
    const v = isVerified(QUALIFYING);
    expect(v.reason.trim().length).toBeGreaterThan(0);
    expect(v.signals).toEqual(QUALIFYING);
  });

  it('keeps the allowlist explicit and narrow', () => {
    expect([...VERIFIED_DECIDERS].sort()).toEqual([
      'DIRECT_AUTHORITATIVE_SOURCE',
      'SOLE_ELIGIBLE_CANDIDATE',
    ]);
  });

  it('states the customer-facing meaning without overclaiming', () => {
    expect(SOURCE_VERIFIED_DEFINITION).toMatch(/does not guarantee/i);
    expect(SOURCE_VERIFIED_DEFINITION).not.toMatch(/\b(we tested|certified by us|guarantee[sd] fitness)\b/i);
  });
});

// ---------------------------------------------------------------------------
// Mixed attributions: which evidence has to be dated
// ---------------------------------------------------------------------------

describe('the date requirement is about the AUTHORITATIVE evidence', () => {
  /** An authoritative backer with no usable retrieval date. */
  const undatedManufacturer = attribution({
    publisher: 'Acme HVAC',
    source_type: 'MANUFACTURER' as SourceType,
    authority_rank: 90,
    retrieved_at: '' as never,
  });
  /** A non-authoritative backer crawled this morning. */
  const datedDistributor = attribution({
    publisher: 'CoolSupply',
    domain: 'coolsupply.example',
    source_type: 'DISTRIBUTOR' as SourceType,
    authority_rank: 30,
    retrieved_at: '2026-08-13T00:00:00.000Z',
  });

  it('does not treat a dated distributor as dating an undated manufacturer', () => {
    const signals = verificationSignals(
      explanation([undatedManufacturer, datedDistributor]),
      NOW,
    );
    expect(
      signals.hasDatedAuthoritativeEvidence,
      'the badge claims the AUTHORITATIVE evidence is dated; a marketplace listing ' +
        'crawled this morning does not date a manufacturer sheet of unknown vintage',
    ).toBe(false);
    expect(signals.freshestAuthoritativeEvidenceAgeDays).toBeNull();
  });

  it('refuses the badge in that mixed case', () => {
    const verdict = isVerified(
      verificationSignals(explanation([undatedManufacturer, datedDistributor]), NOW),
    );
    expect(verdict.verified).toBe(false);
    expect(verdict.blockers).toContain('UNKNOWN_EVIDENCE_DATE');
  });

  it('ages the authoritative evidence on its own dates, not the freshest of all', () => {
    const signals = verificationSignals(
      explanation([
        attribution({ source_type: 'MANUFACTURER' as SourceType, retrieved_at: '2026-07-15T00:00:00.000Z' }),
        datedDistributor,
      ]),
      NOW,
    );
    expect(signals.freshestEvidenceAgeDays).toBe(1);
    expect(signals.freshestAuthoritativeEvidenceAgeDays).toBe(30);
  });

  it('still grants the badge when the authoritative evidence is itself dated', () => {
    const verdict = isVerified(
      verificationSignals(
        explanation([
          attribution({ source_type: 'MANUFACTURER' as SourceType, retrieved_at: '2019-01-01T00:00:00.000Z' }),
          datedDistributor,
        ]),
        NOW,
      ),
    );
    // No maximum evidence age: a 2019 manufacturer spec may be exactly right
    // for a discontinued 2019 model. Dated, not recent, is the requirement.
    expect(verdict.verified).toBe(true);
  });
});
