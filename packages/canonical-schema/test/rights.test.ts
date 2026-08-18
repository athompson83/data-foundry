import { describe, expect, it } from 'vitest';
import {
  BLOCKED_RIGHTS_CLASSIFICATIONS,
  PUBLISHABLE_RIGHTS_CLASSIFICATIONS,
  RIGHTS_CLASSIFICATIONS,
  RightsViolationError,
  assertCanPublish,
  attributionIsSatisfiable,
  canPublish,
  normalizeRightsClassification,
  publishDecision,
  requiresLegalReview,
  type RightsClassification,
} from '../src/rights.js';
import { canCacheMediaAsset, canDisplayMediaAsset } from '../src/objects/media.js';

describe('canPublish — AGENTS.md rule 1', () => {
  it.each([
    ['GREEN', true],
    ['AMBER', true],
    ['RED', false],
    ['UNREVIEWED', false],
  ] as const)('%s -> %s', (rights, expected) => {
    expect(canPublish(rights)).toBe(expected);
  });

  it('refuses RED and UNREVIEWED, exhaustively over the enum', () => {
    const blocked = RIGHTS_CLASSIFICATIONS.filter((rights) => !canPublish(rights));
    expect([...blocked].sort()).toEqual(['RED', 'UNREVIEWED']);
  });

  it('never publishes an unclassified source, however it was spelled', () => {
    for (const junk of ['', '  ', 'green-ish', 'MAYBE', 'unreviewed?', null, undefined]) {
      expect(canPublish(normalizeRightsClassification(junk))).toBe(false);
    }
  });

  it('keeps the publishable/blocked constants in sync with the predicate', () => {
    for (const rights of PUBLISHABLE_RIGHTS_CLASSIFICATIONS) {
      expect(canPublish(rights)).toBe(true);
    }
    for (const rights of BLOCKED_RIGHTS_CLASSIFICATIONS) {
      expect(canPublish(rights)).toBe(false);
    }
    expect(
      [...PUBLISHABLE_RIGHTS_CLASSIFICATIONS, ...BLOCKED_RIGHTS_CLASSIFICATIONS].sort(),
    ).toEqual([...RIGHTS_CLASSIFICATIONS].sort());
  });
});

describe('publishDecision', () => {
  it('explains why RED is blocked', () => {
    const decision = publishDecision('RED');
    expect(decision.allowed).toBe(false);
    expect(decision.allowed === false && decision.reason).toContain('RED');
  });

  it('explains that UNREVIEWED is not implicit permission', () => {
    const decision = publishDecision('UNREVIEWED');
    expect(decision.allowed).toBe(false);
    expect(decision.allowed === false && decision.reason).toMatch(/not permission/i);
  });

  it('flags AMBER as publishable-but-reviewable', () => {
    const decision = publishDecision('AMBER');
    expect(decision.allowed).toBe(true);
    expect(decision.allowed === true && decision.requiresReview).toBe(true);
    expect(requiresLegalReview('AMBER')).toBe(true);
    expect(requiresLegalReview('GREEN')).toBe(false);
  });
});

describe('assertCanPublish', () => {
  it('passes GREEN through', () => {
    expect(() => assertCanPublish('GREEN', 'entity page')).not.toThrow();
  });

  it.each(['RED', 'UNREVIEWED'] as const)('throws RightsViolationError for %s', (rights) => {
    let caught: unknown;
    try {
      assertCanPublish(rights, 'dataset export');
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(RightsViolationError);
    expect((caught as RightsViolationError).rights).toBe(rights);
    expect((caught as Error).message).toContain('dataset export');
  });
});

describe('normalizeRightsClassification', () => {
  it('maps doc 13 YELLOW onto AMBER', () => {
    expect(normalizeRightsClassification('YELLOW')).toBe('AMBER');
    expect(normalizeRightsClassification('yellow')).toBe('AMBER');
  });

  it('is case- and whitespace-insensitive for known values', () => {
    expect(normalizeRightsClassification(' green ')).toBe('GREEN');
  });

  it('fails closed on anything unrecognised', () => {
    const cases: (string | null | undefined)[] = ['PURPLE', '', null, undefined];
    for (const value of cases) {
      expect(normalizeRightsClassification(value)).toBe('UNREVIEWED');
    }
  });
});

describe('attributionIsSatisfiable', () => {
  it('is satisfied when attribution is not required', () => {
    expect(attributionIsSatisfiable({ required: false, text: null, url: null })).toBe(true);
  });

  it('is unsatisfiable when required but no credit line is configured', () => {
    expect(attributionIsSatisfiable({ required: true, text: null, url: null })).toBe(false);
  });

  it('is satisfied when a credit line exists', () => {
    expect(attributionIsSatisfiable({ required: true, text: 'Source: ACME', url: null })).toBe(true);
  });
});

describe('media rights — AGENTS.md rule 9', () => {
  const approvedGreen = {
    rights_classification: 'GREEN' as RightsClassification,
    allowed_display_modes: ['THUMBNAIL', 'INLINE'] as const,
    status: 'APPROVED' as const,
    attribution: { required: false, text: null },
  };

  it('displays an approved, cleared asset in a permitted mode', () => {
    expect(canDisplayMediaAsset(approvedGreen, 'INLINE')).toBe(true);
  });

  it('refuses a mode that was not cleared', () => {
    expect(canDisplayMediaAsset(approvedGreen, 'FULL')).toBe(false);
    expect(canDisplayMediaAsset(approvedGreen, 'NONE')).toBe(false);
  });

  it('refuses RED and UNREVIEWED imagery regardless of display modes', () => {
    for (const rights of ['RED', 'UNREVIEWED'] as const) {
      expect(canDisplayMediaAsset({ ...approvedGreen, rights_classification: rights }, 'INLINE')).toBe(
        false,
      );
      expect(canCacheMediaAsset({ ...approvedGreen, rights_classification: rights })).toBe(false);
    }
  });

  it('refuses display when a required credit line is missing', () => {
    expect(
      canDisplayMediaAsset(
        { ...approvedGreen, attribution: { required: true, text: null } },
        'INLINE',
      ),
    ).toBe(false);
  });

  it('never caches hotlink-only assets into R2', () => {
    expect(
      canCacheMediaAsset({ ...approvedGreen, allowed_display_modes: ['HOTLINK_ONLY', 'INLINE'] }),
    ).toBe(false);
  });

  it('caches only assets that are approved and cleared for a copying mode', () => {
    expect(canCacheMediaAsset(approvedGreen)).toBe(true);
    expect(canCacheMediaAsset({ ...approvedGreen, status: 'PENDING_REVIEW' })).toBe(false);
    expect(canCacheMediaAsset({ ...approvedGreen, allowed_display_modes: [] })).toBe(false);
  });
});
