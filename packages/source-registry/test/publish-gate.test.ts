import { describe, expect, it } from 'vitest';
import { RightsViolationError } from '@data-foundry/canonical-schema';
import {
  assertSourceCanPublish,
  evaluateSourceActivationGate,
  evaluateSourcePublishGate,
  type SourceGateCode,
} from '../src/publish-gate.js';
import { SourceRegistryEntrySchema } from '../src/entry.js';
import { NOW, compliantEntry } from './fixtures.js';

const codes = (entry: Parameters<typeof evaluateSourcePublishGate>[0]): SourceGateCode[] =>
  evaluateSourcePublishGate(entry, NOW).blockers.map((blocker) => blocker.code);

describe('publish gate — the happy path', () => {
  it('allows a fully-compliant GREEN source', () => {
    const result = evaluateSourcePublishGate(compliantEntry(), NOW);
    expect(result.blockers).toEqual([]);
    expect(result.allowed).toBe(true);
    expect(result.sourceKey).toBe('ahri-directory');
  });

  it('parses as a valid registry entry', () => {
    expect(SourceRegistryEntrySchema.safeParse(compliantEntry()).success).toBe(true);
  });
});

describe('publish gate — AGENTS.md rule 1', () => {
  it.each(['RED', 'UNREVIEWED'] as const)('blocks %s outright', (rights) => {
    const result = evaluateSourcePublishGate(
      compliantEntry({ rights_classification: rights }),
      NOW,
    );
    expect(result.allowed).toBe(false);
    expect(result.blockers.map((blocker) => blocker.code)).toContain('RIGHTS_BLOCKED');
  });

  it('allows AMBER but warns that review is outstanding', () => {
    const result = evaluateSourcePublishGate(
      compliantEntry({ rights_classification: 'AMBER' }),
      NOW,
    );
    expect(result.allowed).toBe(true);
    expect(result.warnings.map((warning) => warning.code)).toContain('RIGHTS_BLOCKED');
  });

  it('blocks a source with no current human rights review', () => {
    const entry = compliantEntry();
    expect(
      codes({
        ...entry,
        rights_policy: { ...entry.rights_policy, reviewed_at: null, reviewed_by: null },
      }),
    ).toContain('RIGHTS_REVIEW_MISSING_OR_LAPSED');
  });

  it('blocks a source whose rights review has lapsed', () => {
    const entry = compliantEntry();
    expect(
      codes({
        ...entry,
        rights_policy: { ...entry.rights_policy, next_review_at: '2026-01-01' },
      }),
    ).toContain('RIGHTS_REVIEW_MISSING_OR_LAPSED');
  });

  it('warns before a review lapses rather than after', () => {
    const entry = compliantEntry();
    const result = evaluateSourcePublishGate(
      { ...entry, rights_policy: { ...entry.rights_policy, next_review_at: '2026-08-20' } },
      NOW,
    );
    expect(result.allowed).toBe(true);
    expect(result.warnings.map((w) => w.message).join(' ')).toMatch(/lapses in \d+ day/);
  });
});

describe('publish gate — the rest of the checklist', () => {
  it('respects the kill switch above everything else', () => {
    expect(codes(compliantEntry({ kill_switch_engaged: true }))).toContain('KILL_SWITCH_ENGAGED');
  });

  it.each(['PROPOSED', 'UNDER_REVIEW', 'APPROVED', 'PAUSED', 'SUSPENDED', 'RETIRED'] as const)(
    'refuses to publish a source in status %s',
    (status) => {
      expect(codes(compliantEntry({ status }))).toContain('SOURCE_NOT_ACTIVE');
    },
  );

  it('blocks when redistribution is not permitted', () => {
    const entry = compliantEntry();
    expect(
      codes({
        ...entry,
        rights_policy: { ...entry.rights_policy, redistribution_allowed: false },
      }),
    ).toContain('REDISTRIBUTION_NOT_ALLOWED');
  });

  it('blocks when commercial use is not permitted', () => {
    const entry = compliantEntry();
    expect(
      codes({
        ...entry,
        rights_policy: { ...entry.rights_policy, commercial_use_allowed: false },
      }),
    ).toContain('COMMERCIAL_USE_NOT_ALLOWED');
  });

  it('blocks when derivative normalization is not permitted', () => {
    const entry = compliantEntry();
    expect(
      codes({
        ...entry,
        rights_policy: { ...entry.rights_policy, derivative_normalization_allowed: false },
      }),
    ).toContain('DERIVATIVE_NORMALIZATION_NOT_ALLOWED');
  });

  it('blocks when attribution is required but unconfigured', () => {
    expect(
      codes(
        compliantEntry({
          attribution_requirement: { required: true, text: null, url: null },
        }),
      ),
    ).toContain('ATTRIBUTION_UNSATISFIABLE');
  });

  it('blocks when the acquisition method has not been approved', () => {
    const entry = compliantEntry();
    expect(
      codes({
        ...entry,
        acquisition_policy: { ...entry.acquisition_policy, approved: false },
      }),
    ).toContain('ACQUISITION_METHOD_NOT_APPROVED');
  });

  it('blocks when artifacts would not be retained (rule 10)', () => {
    const entry = compliantEntry();
    expect(
      codes({
        ...entry,
        provenance_retention: { ...entry.provenance_retention, retain_artifacts: false },
      }),
    ).toContain('PROVENANCE_RETENTION_NOT_CONFIGURED');
  });

  it('blocks image caching that outruns image rights (rule 9)', () => {
    const entry = compliantEntry();
    expect(
      codes({
        ...entry,
        image_policy: { ...entry.image_policy, cache_to_r2_permitted: true, images_reusable: false },
      }),
    ).toContain('IMAGE_POLICY_INCONSISTENT');
  });

  it('reports every blocker at once rather than the first', () => {
    const entry = compliantEntry();
    const result = evaluateSourcePublishGate(
      {
        ...entry,
        rights_classification: 'RED',
        status: 'PAUSED',
        kill_switch_engaged: true,
        acquisition_policy: { ...entry.acquisition_policy, approved: false },
      },
      NOW,
    );
    expect(result.blockers.length).toBeGreaterThanOrEqual(4);
    expect(new Set(result.blockers.map((b) => b.code))).toEqual(
      new Set(['RIGHTS_BLOCKED', 'SOURCE_NOT_ACTIVE', 'KILL_SWITCH_ENGAGED', 'ACQUISITION_METHOD_NOT_APPROVED']),
    );
  });
});

describe('assertSourceCanPublish', () => {
  it('passes a compliant source', () => {
    expect(() => assertSourceCanPublish(compliantEntry(), NOW)).not.toThrow();
  });

  it('throws a RightsViolationError naming the source and every blocker', () => {
    let caught: unknown;
    try {
      assertSourceCanPublish(compliantEntry({ rights_classification: 'RED' }), NOW);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(RightsViolationError);
    expect((caught as Error).message).toContain('ahri-directory');
    expect((caught as Error).message).toContain('RIGHTS_BLOCKED');
  });
});

describe('activation gate — doc 13 checklist', () => {
  it('activates a compliant source', () => {
    expect(evaluateSourceActivationGate(compliantEntry(), NOW).allowed).toBe(true);
  });

  it('refuses to activate an unclassified source', () => {
    const result = evaluateSourceActivationGate(
      compliantEntry({ rights_classification: 'UNREVIEWED' }),
      NOW,
    );
    expect(result.allowed).toBe(false);
    expect(result.blockers.map((b) => b.message).join(' ')).toMatch(/classification/i);
  });

  it('refuses to activate a RED source', () => {
    expect(
      evaluateSourceActivationGate(compliantEntry({ rights_classification: 'RED' }), NOW).allowed,
    ).toBe(false);
  });

  it('is weaker than the publish gate: an AMBER source may be active but flagged', () => {
    const amber = compliantEntry({ rights_classification: 'AMBER' });
    expect(evaluateSourceActivationGate(amber, NOW).allowed).toBe(true);
    expect(evaluateSourcePublishGate(amber, NOW).allowed).toBe(true);
  });

  it('requires an approved acquisition method', () => {
    const entry = compliantEntry();
    const result = evaluateSourceActivationGate(
      { ...entry, acquisition_policy: { ...entry.acquisition_policy, approved: false } },
      NOW,
    );
    expect(result.blockers.map((b) => b.code)).toContain('ACQUISITION_METHOD_NOT_APPROVED');
  });
});
