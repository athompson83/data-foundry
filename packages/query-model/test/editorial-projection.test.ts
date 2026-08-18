/**
 * P1 — the customer-facing trust projection (AGENTS.md rule 5).
 *
 * The selection layer and `explainFact` both knew a value had been editorially
 * corrected; `canonicalFacts` — the path that actually serves values to web,
 * REST, MCP and exports — did not. A corrected value therefore reached a
 * customer indistinguishable from an evidence-selected one.
 *
 * These tests pin the projection, its invariants, and the fact that every wire
 * mapper carries it. They also pin the competing-override case, where NO
 * correction is applied but the ambiguity is still material trust information.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FactSelectionPolicyInput } from '@data-foundry/canonical-store';
import { isVerified, type VerificationSignals } from '@data-foundry/provenance';
import {
  CORRECTION_FIELDS_JSON_SCHEMA,
  ReviewerIdentityLeak,
  assertNoReviewerIdentity,
  correctionInvariantViolation,
  toExportRow,
  toMcpFact,
  toRestFact,
  type CanonicalFactView,
} from '../src/index.js';
import { claim, createQueryFixtures, type QueryFixtures } from './support.js';

let fixtures: QueryFixtures;

const REASON = 'The manufacturer bulletin supersedes the earlier catalog specification.';
const REVIEWER = 'A. Editor';

/** Only the editorial desk is declared as an override source. */
const CORRECTED: Partial<FactSelectionPolicyInput> = {
  editorialOverrides: [{ source: 'editorial.internal', reason: REASON, reviewer: REVIEWER }],
};
/** Same declaration with the reviewer missing — unauditable, must be ignored. */
const NO_REVIEWER: Partial<FactSelectionPolicyInput> = {
  editorialOverrides: [{ source: 'editorial.internal', reason: REASON, reviewer: '   ' }],
};
/** Declared against a source whose rights are UNREVIEWED — cannot be published. */
const RIGHTS_BLOCKED: Partial<FactSelectionPolicyInput> = {
  editorialOverrides: [{ source: 'forum.example', reason: REASON, reviewer: REVIEWER }],
};
/** Two independent desks, both auditable, disagreeing. */
const COMPETING: Partial<FactSelectionPolicyInput> = {
  editorialOverrides: [
    { source: 'editorial.internal', reason: REASON, reviewer: REVIEWER },
    { source: 'standards-desk.internal', reason: 'Standards desk revision.', reviewer: 'B. Standards' },
  ],
};

async function view(property: string, policy: Partial<FactSelectionPolicyInput>) {
  const rows = await fixtures.qm.canonicalFacts(fixtures.equipment.id, policy);
  const row = rows.find((candidate) => candidate.property === property);
  if (row === undefined) throw new Error(`no canonical view for ${property}`);
  return row;
}

beforeAll(async () => {
  fixtures = await createQueryFixtures();

  // A rival claim must be PROPOSED: `facts_single_open_version_key` permits one
  // open ACTIVE version per (entity, property), so a second ACTIVE claim would
  // be a new VERSION that closes the first rather than a competitor for it.

  // Corrected: the editorial desk contradicts the manufacturer.
  await claim(fixtures, 'manufacturer', { property: 'seer2', value: 14.5 });
  await claim(fixtures, 'editorial', { property: 'seer2', value: 14.3, status: 'PROPOSED' });

  // Ordinary: no editorial involvement at all.
  await claim(fixtures, 'manufacturer', { property: 'eer2', value: 12 });
  await claim(fixtures, 'aggregator', { property: 'eer2', value: 11.8, status: 'PROPOSED' });

  // Unauditable override (declaration is missing a reviewer).
  await claim(fixtures, 'manufacturer', { property: 'hspf2', value: 8.5 });
  await claim(fixtures, 'editorial', { property: 'hspf2', value: 9, status: 'PROPOSED' });

  // Rights-blocked override source (UNREVIEWED rights).
  await claim(fixtures, 'manufacturer', { property: 'sound_level_db', value: 72 });
  await claim(fixtures, 'blocked', { property: 'sound_level_db', value: 69, status: 'PROPOSED' });

  // Two independent desks disagreeing.
  await claim(fixtures, 'manufacturer', { property: 'voltage', value: 208 });
  await claim(fixtures, 'editorial', { property: 'voltage', value: 230, status: 'PROPOSED' });
  await claim(fixtures, 'editorial_standards', {
    property: 'voltage',
    value: 240,
    status: 'PROPOSED',
  });
});

afterAll(async () => {
  await fixtures?.driver.close();
});

describe('CanonicalFactView projection', () => {
  it('projects an applied editorial correction into CanonicalFactView', async () => {
    const row = await view('seer2', CORRECTED);
    expect(row.editorially_corrected).toBe(true);
    expect(row.rule).toBe('EDITORIAL_OVERRIDE');
    expect(row.value).toBe(14.3);
    expect(row.selection_warnings).toEqual([]);
  });

  it('projects the non-empty customer-visible correction reason', async () => {
    const row = await view('seer2', CORRECTED);
    expect(row.editorial_correction_reason).toBe(REASON);
    expect((row.editorial_correction_reason ?? '').trim().length).toBeGreaterThan(0);
  });

  it('never exposes the reviewer identity on the customer-facing view', async () => {
    const row = await view('seer2', CORRECTED);
    expect(JSON.stringify(row)).not.toContain(REVIEWER);
    // ...while the internal audit surface still has it.
    const explained = await fixtures.qm.explainFact(fixtures.equipment.id, 'seer2', CORRECTED);
    expect(explained?.editorial_correction?.reviewer).toBe(REVIEWER);
  });

  it('never marks an editorially corrected value as source verified', () => {
    const signals: VerificationSignals = {
      corroboratingPublishers: 1,
      hasAuthoritativeSource: true,
      maxAuthorityRank: 95,
      allEvidencePublishable: true,
      freshestEvidenceAgeDays: 1,
      hasDatedAuthoritativeEvidence: true,
      freshestAuthoritativeEvidenceAgeDays: 1,
      hasUnresolvedConflict: false,
      hasEvidence: true,
      decidedBy: 'EDITORIAL_OVERRIDE',
    };
    const verdict = isVerified(signals);
    expect(verdict.verified).toBe(false);
    expect(verdict.blockers).toContain('NON_AUTHORITATIVE_ADJUDICATION');
  });

  it('projects false, null, and no warnings for ordinary source selection', async () => {
    const row = await view('eer2', CORRECTED);
    expect(row.editorially_corrected).toBe(false);
    expect(row.editorial_correction_reason).toBeNull();
    expect(row.selection_warnings).toEqual([]);
    expect(row.rule).not.toBe('EDITORIAL_OVERRIDE');
  });

  it('ignores invalid or rights-blocked overrides in the canonical view', async () => {
    const unauditable = await view('hspf2', NO_REVIEWER);
    expect(unauditable.editorially_corrected).toBe(false);
    expect(unauditable.editorial_correction_reason).toBeNull();
    expect(unauditable.selection_warnings).toEqual([]);
    expect(unauditable.value).toBe(8.5); // the manufacturer's claim still wins

    const blocked = await view('sound_level_db', RIGHTS_BLOCKED);
    expect(blocked.editorially_corrected).toBe(false);
    expect(blocked.editorial_correction_reason).toBeNull();
    expect(blocked.selection_warnings).toEqual([]);
    expect(blocked.value).toBe(72);
  });

  it('does not mark competing overrides as an applied correction', async () => {
    const row = await view('voltage', COMPETING);
    expect(row.editorially_corrected).toBe(false);
    expect(row.editorial_correction_reason).toBeNull();
    expect(row.rule).not.toBe('EDITORIAL_OVERRIDE');
  });

  it('projects AMBIGUOUS_EDITORIAL_INTENT for competing valid overrides', async () => {
    const row = await view('voltage', COMPETING);
    expect(row.selection_warnings).toContain('AMBIGUOUS_EDITORIAL_INTENT');
    // The ordinary value is still returned; nothing throws.
    expect(row.value).not.toBeNull();
  });

  it('agrees with explainFact about correction state and warnings', async () => {
    for (const [property, policy] of [
      ['seer2', CORRECTED],
      ['eer2', CORRECTED],
      ['voltage', COMPETING],
    ] as const) {
      const row = await view(property, policy);
      const explained = await fixtures.qm.explainFact(fixtures.equipment.id, property, policy);
      expect(explained?.editorially_corrected, property).toBe(row.editorially_corrected);
      expect([...(explained?.selection_warnings ?? [])], property).toEqual([
        ...row.selection_warnings,
      ]);
    }
  });
});

describe('wire serialization carries the projection', () => {
  it('preserves correction metadata through REST serialization', async () => {
    const row = await view('seer2', CORRECTED);
    const rest = JSON.parse(JSON.stringify(toRestFact(row, { verified: false })));
    expect(rest.editoriallyCorrected).toBe(true);
    expect(rest.editorialCorrectionReason).toBe(REASON);
    expect(rest.selectionWarnings).toEqual([]);
    expect(rest.verified).toBe(false);
    expect(JSON.stringify(rest)).not.toContain(REVIEWER);
  });

  it('preserves correction metadata through MCP serialization', async () => {
    const ambiguous = await view('voltage', COMPETING);
    const mcp = JSON.parse(JSON.stringify(toMcpFact(ambiguous)));
    expect(mcp.editoriallyCorrected).toBe(false);
    expect(mcp.editorialCorrectionReason).toBeNull();
    expect(mcp.selectionWarnings).toEqual(['AMBIGUOUS_EDITORIAL_INTENT']);
  });

  it('preserves correction metadata through bulk export mapping', async () => {
    const corrected = toExportRow(await view('seer2', CORRECTED));
    expect(corrected.editorially_corrected).toBe(true);
    expect(corrected.editorial_correction_reason).toBe(REASON);
    expect(corrected.selection_warnings).toBe('');

    const ambiguous = toExportRow(await view('voltage', COMPETING));
    expect(ambiguous.editorially_corrected).toBe(false);
    expect(ambiguous.selection_warnings).toBe('AMBIGUOUS_EDITORIAL_INTENT');

    // Every export cell must be a flat scalar — CSV and Parquet have no nesting.
    for (const value of Object.values(ambiguous)) {
      expect(['string', 'number', 'boolean', 'object']).toContain(typeof value);
      expect(Array.isArray(value)).toBe(false);
    }
  });

  it('publishes a JSON Schema fragment so OpenAPI and MCP schemas cannot drift', () => {
    expect(CORRECTION_FIELDS_JSON_SCHEMA.required).toEqual([
      'editoriallyCorrected',
      'editorialCorrectionReason',
      'selectionWarnings',
    ]);
    // Open string array: enumerating today's codes would make tomorrow's
    // payloads fail validation at an older client.
    expect(CORRECTION_FIELDS_JSON_SCHEMA.properties.selectionWarnings.items).toEqual({
      type: 'string',
    });
  });

  it('does not throw on an unrecognised warning code', () => {
    const forged = {
      editoriallyCorrected: false,
      editorialCorrectionReason: null,
      selectionWarnings: ['SOME_FUTURE_WARNING'],
    } as never;
    expect(() => correctionInvariantViolation(forged)).not.toThrow();
    expect(correctionInvariantViolation(forged)).toBeNull();
  });
});

describe('correction invariant', () => {
  const cases: Array<[string, Partial<FactSelectionPolicyInput>, string]> = [
    ['corrected', CORRECTED, 'seer2'],
    ['ordinary', CORRECTED, 'eer2'],
    ['unauditable', NO_REVIEWER, 'hspf2'],
    ['rights-blocked', RIGHTS_BLOCKED, 'sound_level_db'],
    ['competing', COMPETING, 'voltage'],
  ];

  it.each(cases)('holds for the %s case', async (_label, policy, property) => {
    const row = await view(property, policy);
    // corrected  => reason non-empty after trim
    // !corrected => reason strictly null
    if (row.editorially_corrected) {
      expect((row.editorial_correction_reason ?? '').trim().length).toBeGreaterThan(0);
    } else {
      expect(row.editorial_correction_reason).toBeNull();
    }
    expect(correctionInvariantViolation(toRestFact(row))).toBeNull();
  });

  it('detects a hand-forged violation in either direction', () => {
    expect(
      correctionInvariantViolation({
        editoriallyCorrected: true,
        editorialCorrectionReason: '   ',
        selectionWarnings: [],
      }),
    ).toMatch(/blank/);
    expect(
      correctionInvariantViolation({
        editoriallyCorrected: false,
        editorialCorrectionReason: 'leaked',
        selectionWarnings: [],
      }),
    ).toMatch(/not corrected/);
  });

  it('every projected view satisfies the invariant', async () => {
    const rows: CanonicalFactView[] = await fixtures.qm.canonicalFacts(
      fixtures.equipment.id,
      COMPETING,
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(correctionInvariantViolation(toRestFact(row)), row.property).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// The privacy enforcement the module has always claimed to have
// ---------------------------------------------------------------------------

describe('reviewer identity never reaches a wire shape', () => {
  const REVIEWERS = ['j.okafor@example.com', 'M. Ruiz'];

  const fields = (reason: string | null) => ({
    editoriallyCorrected: reason !== null,
    editorialCorrectionReason: reason,
    selectionWarnings: [] as const,
  });

  it('passes a reason that names no reviewer', () => {
    expect(() =>
      assertNoReviewerIdentity(
        fields('Manufacturer erratum 2026-03: published SEER2 was a typo.'),
        REVIEWERS,
      ),
    ).not.toThrow();
  });

  it('throws when the customer-visible reason carries a reviewer identity', () => {
    // The one that actually happens: an editor writes their own name into the
    // reason, and the reason is projected to every customer surface.
    expect(() =>
      assertNoReviewerIdentity(fields('Corrected by j.okafor@example.com after a supplier call.'), REVIEWERS),
    ).toThrow(ReviewerIdentityLeak);
  });

  it('matches regardless of case or surrounding punctuation', () => {
    expect(() =>
      assertNoReviewerIdentity(fields('Reviewed (M. RUIZ), 2026-04-02.'), REVIEWERS),
    ).toThrow(ReviewerIdentityLeak);
  });

  it('names the field and not the identity, so the error is not itself a leak', () => {
    let message = '';
    try {
      assertNoReviewerIdentity(fields('set by j.okafor@example.com'), REVIEWERS);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toMatch(/editorialCorrectionReason/);
    expect(message).not.toContain('j.okafor@example.com');
  });

  it('ignores blank reviewer entries rather than matching everything', () => {
    // A blank identity is a substring of every string; treating it as a match
    // would refuse to publish any correction at all.
    expect(() =>
      assertNoReviewerIdentity(fields('A perfectly ordinary reason.'), ['', '   ']),
    ).not.toThrow();
  });

  it('has nothing to check when no correction was applied', () => {
    expect(() => assertNoReviewerIdentity(fields(null), REVIEWERS)).not.toThrow();
  });

  it('guards the export row and the REST/MCP shapes through the same reason', async () => {
    const row = await view('seer2', CORRECTED);
    const rest = toRestFact(row);
    const exported = toExportRow(row);
    expect(exported.editorial_correction_reason).toBe(rest.editorialCorrectionReason);
    expect(() => assertNoReviewerIdentity(rest, [REVIEWER])).not.toThrow();
  });
});
