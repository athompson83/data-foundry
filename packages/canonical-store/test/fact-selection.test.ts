/**
 * Doc 04 fact selection, exercised against real stored claims.
 *
 * One test per rung of the precedence, each constructed so that exactly one
 * criterion can decide it, plus the two properties that make the algorithm
 * trustworthy: it is *not* "latest source wins", and losing claims are retained
 * and reported rather than collapsed.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  DEFAULT_CONSISTENCY_CHECKS,
  DOC04_SELECTION_PRECEDENCE,
  numericRangeCheck,
  selectCanonicalFact,
  type EditorialOverride,
  type FactSelection,
  type FactSelectionRule,
} from '../src/index.js';
import { claim, createFixtures, ts, type Fixtures, type SourceKey } from './support.js';

let fixtures: Fixtures;

const AT = ts('2026-07-01T00:00:00Z');

/** Equal per-field reliability, so a later rung of the cascade has to decide. */
const equalReliability = (property: string, domains: readonly string[]) => ({
  fieldReliability: {
    [property]: Object.fromEntries(domains.map((domain) => [domain, 0.8])),
  },
});

const step = (selection: FactSelection, rule: FactSelectionRule) =>
  selection.steps.find((candidate) => candidate.rule === rule);

const values = (selection: FactSelection) =>
  selection.conflicts.map((conflict) => conflict.value);

beforeAll(async () => {
  fixtures = await createFixtures();
});

afterAll(async () => {
  await fixtures?.driver.close();
});

describe('doc 04 fact selection', () => {
  it('states the precedence actually implemented, override first (ADR-0002)', () => {
    // ADR-0002 promoted the editorial override from criterion 6 to criterion 0.
    // The five source-derived criteria keep doc 04's relative order behind it.
    expect([...DOC04_SELECTION_PRECEDENCE]).toEqual([
      'EDITORIAL_OVERRIDE',
      'DIRECT_AUTHORITATIVE_SOURCE',
      'SOURCE_FIELD_RELIABILITY',
      'RECENCY',
      'CORROBORATION',
      'CONSISTENCY_CHECK',
    ]);
  });

  it('rule 1 — a direct authoritative source wins, and it is not "latest wins"', async () => {
    // The manufacturer spoke first; the aggregator spoke most recently.
    await claim(fixtures, 'manufacturer', {
      property: 'refrigerant',
      value: 'R-454B',
      valid_from: '2026-02-01T00:00:00Z',
      observed_at: '2026-02-01T00:00:00Z',
    });
    await claim(fixtures, 'aggregator', {
      property: 'refrigerant',
      value: 'R-410A',
      status: 'PROPOSED',
      valid_from: '2026-05-01T00:00:00Z',
      observed_at: '2026-05-01T00:00:00Z',
    });

    const selection = await fixtures.store.selectFact(fixtures.entity.id, 'refrigerant', { at: AT });

    expect(selection.rule).toBe('DIRECT_AUTHORITATIVE_SOURCE');
    expect(selection.selected?.fact.normalized_value).toBe('R-454B');
    expect(step(selection, 'DIRECT_AUTHORITATIVE_SOURCE')?.decided).toBe(true);
    // Recency never got a chance to speak.
    expect(step(selection, 'RECENCY')).toBeUndefined();
    expect(selection.reason).toContain('Acme Climate');

    // The rival claim is retained, reported, and still in the database.
    expect(values(selection)).toEqual(['R-410A']);
    expect(selection.unresolved_conflict).toBe(true);
    const stored = await fixtures.store.listFacts(fixtures.entity.id, { property: 'refrigerant' });
    expect(stored.map((fact) => fact.normalized_value).sort()).toEqual(['R-410A', 'R-454B']);
  });

  it('rule 2 — per-field source reliability separates two authoritative sources', async () => {
    await claim(fixtures, 'manufacturer', {
      property: 'seer2_rating',
      value: 16,
      value_type: 'number',
      valid_from: '2026-02-01T00:00:00Z',
    });
    await claim(fixtures, 'certifier', {
      property: 'seer2_rating',
      value: 15.2,
      value_type: 'number',
      status: 'PROPOSED',
      valid_from: '2026-02-01T00:00:00Z',
    });

    // Default reliability falls back to authority_rank: the ratings directory (95)
    // beats the manufacturer catalog (90).
    const byAuthority = await fixtures.store.selectFact(fixtures.entity.id, 'seer2_rating', {
      at: AT,
    });
    expect(byAuthority.rule).toBe('SOURCE_FIELD_RELIABILITY');
    expect(byAuthority.selected?.fact.normalized_value).toBe(15.2);

    // A vertical that trusts the manufacturer for this specific field flips it,
    // without touching authority_rank, which is field-independent.
    const byFieldPolicy = await fixtures.store.selectFact(fixtures.entity.id, 'seer2_rating', {
      at: AT,
      fieldReliability: {
        seer2_rating: { 'catalog.acme-climate.example.com': 0.99, 'ratings-directory.example.org': 0.4 },
      },
    });
    expect(byFieldPolicy.rule).toBe('SOURCE_FIELD_RELIABILITY');
    expect(byFieldPolicy.selected?.fact.normalized_value).toBe(16);
  });

  it('treats certification and regulatory-filing authority as membership, not list rank', async () => {
    const property = 'authority_membership_probe';
    const certifier = 'ratings-directory.example.org';
    const filing = 'filings.regulator.example.gov';
    await claim(fixtures, 'certifier', {
      property,
      value: 15.2,
      value_type: 'number',
    });
    await claim(fixtures, 'filing', {
      property,
      value: 16,
      value_type: 'number',
      status: 'PROPOSED',
    });

    const select = (authoritativeSources: readonly string[]) =>
      fixtures.store.selectFact(fixtures.entity.id, property, {
        at: AT,
        authoritativeSourcesByProperty: { [property]: authoritativeSources },
        fieldReliability: { [property]: { [certifier]: 0.4, [filing]: 0.9 } },
      });

    const forwards = await select([certifier, filing]);
    const backwards = await select([filing, certifier]);
    for (const selection of [forwards, backwards]) {
      expect(selection.rule).toBe('SOURCE_FIELD_RELIABILITY');
      expect(selection.selected?.fact.normalized_value).toBe(16);
      expect(step(selection, 'DIRECT_AUTHORITATIVE_SOURCE')?.decided).toBe(false);
    }
  });

  it('rule 3 — recency breaks a reliability tie (and only then)', async () => {
    await claim(fixtures, 'manufacturer', {
      property: 'tonnage',
      value: 3,
      value_type: 'number',
      valid_from: '2026-02-01T00:00:00Z',
      observed_at: '2026-02-01T00:00:00Z',
    });
    await claim(fixtures, 'certifier', {
      property: 'tonnage',
      value: 4,
      value_type: 'number',
      status: 'PROPOSED',
      valid_from: '2026-05-01T00:00:00Z',
      observed_at: '2026-05-01T00:00:00Z',
    });

    const selection = await fixtures.store.selectFact(fixtures.entity.id, 'tonnage', {
      at: AT,
      ...equalReliability('tonnage', ['catalog.acme-climate.example.com', 'ratings-directory.example.org']),
    });

    expect(selection.rule).toBe('RECENCY');
    expect(selection.selected?.fact.normalized_value).toBe(4);
    expect(step(selection, 'SOURCE_FIELD_RELIABILITY')?.decided).toBe(false);
    expect(step(selection, 'RECENCY')?.detail).toContain('2026-05-01');
  });

  it('rule 4 — corroboration counts independent sources for the same value', async () => {
    await claim(fixtures, 'manufacturer', {
      property: 'compressor_stages',
      value: 2,
      value_type: 'integer',
      valid_from: '2026-03-01T00:00:00Z',
      observed_at: '2026-03-01T00:00:00Z',
    });
    // Same value from a second source: corroboration, not a new version.
    const corroboration = await claim(fixtures, 'aggregator', {
      property: 'compressor_stages',
      value: 2,
      value_type: 'integer',
      valid_from: '2026-03-01T00:00:00Z',
      observed_at: '2026-03-01T00:00:00Z',
    });
    expect(corroboration.outcome).toBe('UNCHANGED');

    await claim(fixtures, 'certifier', {
      property: 'compressor_stages',
      value: 3,
      value_type: 'integer',
      status: 'PROPOSED',
      valid_from: '2026-03-01T00:00:00Z',
      observed_at: '2026-03-01T00:00:00Z',
    });

    const selection = await fixtures.store.selectFact(fixtures.entity.id, 'compressor_stages', {
      at: AT,
      ...equalReliability('compressor_stages', [
        'catalog.acme-climate.example.com',
        'aggregator.example',
        'ratings-directory.example.org',
      ]),
    });

    expect(selection.rule).toBe('CORROBORATION');
    expect(selection.selected?.fact.normalized_value).toBe(2);
    expect(step(selection, 'CORROBORATION')?.detail).toContain('2 independent source');
    expect(values(selection)).toEqual([3]);
  });

  it('rule 5 — a deterministic consistency check eliminates an impossible value', async () => {
    await claim(fixtures, 'manufacturer', {
      property: 'airflow_cfm',
      value: 1200,
      value_type: 'number',
      valid_from: '2026-03-01T00:00:00Z',
      observed_at: '2026-03-01T00:00:00Z',
    });
    await claim(fixtures, 'certifier', {
      property: 'airflow_cfm',
      value: 99999,
      value_type: 'number',
      status: 'PROPOSED',
      valid_from: '2026-03-01T00:00:00Z',
      observed_at: '2026-03-01T00:00:00Z',
    });

    const selection = await fixtures.store.selectFact(fixtures.entity.id, 'airflow_cfm', {
      at: AT,
      ...equalReliability('airflow_cfm', ['catalog.acme-climate.example.com', 'ratings-directory.example.org']),
      consistencyChecks: [
        ...DEFAULT_CONSISTENCY_CHECKS,
        numericRangeCheck('airflow_cfm', { min: 100, max: 5000 }),
      ],
    });

    expect(selection.rule).toBe('CONSISTENCY_CHECK');
    expect(selection.selected?.fact.normalized_value).toBe(1200);
    expect(step(selection, 'CONSISTENCY_CHECK')?.detail).toContain('failed a deterministic check');
    // The impossible value is still retained and reported as a conflict.
    expect(values(selection)).toEqual([99999]);
  });

  it('criterion 0 — an auditable editorial override decides before anything else', async () => {
    await claim(fixtures, 'aggregator', {
      property: 'marketing_name',
      value: 'Infinity 24ANB7 AC',
      valid_from: '2026-03-01T00:00:00Z',
      observed_at: '2026-03-01T00:00:00Z',
    });
    await claim(fixtures, 'editorial', {
      property: 'marketing_name',
      value: 'Carrier Infinity 24 Air Conditioner',
      status: 'PROPOSED',
      valid_from: '2026-03-01T00:00:00Z',
      observed_at: '2026-03-01T00:00:00Z',
    });

    const selection = await fixtures.store.selectFact(fixtures.entity.id, 'marketing_name', {
      at: AT,
      editorialOverrides: [
        {
          source: 'editorial.internal',
          reason: 'Product name standardised to the manufacturer catalogue spelling.',
          reviewer: 'r.mensah@data-foundry.example',
        },
      ],
    });

    expect(selection.rule).toBe('EDITORIAL_OVERRIDE');
    expect(selection.selected?.fact.normalized_value).toBe('Carrier Infinity 24 Air Conditioner');
    expect(step(selection, 'EDITORIAL_OVERRIDE')?.decided).toBe(true);
    // The five source-derived criteria never got a chance to speak.
    expect(step(selection, 'DIRECT_AUTHORITATIVE_SOURCE')).toBeUndefined();
    expect(step(selection, 'SOURCE_FIELD_RELIABILITY')).toBeUndefined();
  });

  it('excludes claims backed only by RED/UNREVIEWED sources (rule 1) but keeps them', async () => {
    await claim(fixtures, 'manufacturer', {
      property: 'warranty_years',
      value: 10,
      value_type: 'integer',
      valid_from: '2026-03-01T00:00:00Z',
    });
    const forumClaim = await claim(fixtures, 'blocked', {
      property: 'warranty_years',
      value: 5,
      value_type: 'integer',
      status: 'PROPOSED',
      valid_from: '2026-03-01T00:00:00Z',
    });

    const selection = await fixtures.store.selectFact(fixtures.entity.id, 'warranty_years', {
      at: AT,
    });

    expect(selection.rule).toBe('SOLE_ELIGIBLE_CANDIDATE');
    expect(selection.selected?.fact.normalized_value).toBe(10);
    expect(selection.excluded).toContainEqual(
      expect.objectContaining({ fact_id: forumClaim.fact.id, reason: 'RIGHTS_BLOCKED' }),
    );
    // Retained: the evidence is preserved even though it may not publish.
    expect(await fixtures.store.getFactById(forumClaim.fact.id)).not.toBeNull();
  });

  it('publishes nothing when every claim is rights-blocked', async () => {
    await claim(fixtures, 'blocked', {
      property: 'street_price',
      value: 6200,
      value_type: 'number',
      valid_from: '2026-03-01T00:00:00Z',
    });

    const selection = await fixtures.store.selectFact(fixtures.entity.id, 'street_price', { at: AT });

    expect(selection.rule).toBe('NO_ELIGIBLE_CANDIDATE');
    expect(selection.selected).toBeNull();
    expect(selection.excluded[0]?.reason).toBe('RIGHTS_BLOCKED');
  });

  it('refuses to select an unevidenced claim even if one somehow exists', () => {
    const orphan = {
      fact: {
        id: '00000000-0000-4000-8000-000000000001',
        entity_id: fixtures.entity.id,
        property: 'ghost',
        normalized_value: 'unsupported',
        value_type: 'string',
        unit: null,
        valid_from: ts('2026-01-01T00:00:00Z'),
        valid_to: null,
        status: 'ACTIVE',
        confidence: 0.99,
        supersedes_fact_id: null,
        recorded_at: ts('2026-01-01T00:00:00Z'),
        created_at: ts('2026-01-01T00:00:00Z'),
      },
      evidence: [],
    } as unknown as Parameters<typeof selectCanonicalFact>[1][number];

    const selection = selectCanonicalFact('ghost', [orphan], { at: AT });
    expect(selection.selected).toBeNull();
    expect(selection.excluded[0]?.reason).toBe('NO_EVIDENCE');
  });

  it('builds a canonical view over every property of an entity', async () => {
    const view = await fixtures.store.canonicalView(fixtures.entity.id, { at: AT });
    expect([...view.keys()]).toContain('refrigerant');
    expect(view.get('refrigerant')?.rule).toBe('DIRECT_AUTHORITATIVE_SOURCE');
    // Every entry carries its own explanation, not just a value.
    for (const selection of view.values()) {
      expect(selection.steps.length).toBeGreaterThan(0);
      expect(selection.reason.length).toBeGreaterThan(0);
    }
  });
});

/* ------------------------------------------------------------------ *
 * ADR-0002 — the editorial override as an auditable trump card
 * ------------------------------------------------------------------ */

describe('editorial override (ADR-0002)', () => {
  const REASON = 'Manufacturer erratum EC-2026-14 supersedes the printed nameplate value.';
  const REVIEWER = 'j.okafor@data-foundry.example';

  const VALID: EditorialOverride = {
    source: 'editorial.internal',
    reason: REASON,
    reviewer: REVIEWER,
  };

  /**
   * A direct authoritative source (the manufacturer) and an editor disagree.
   * Without an override the manufacturer wins on criterion 1, so every test
   * below is measuring exactly one thing: whether the override fired.
   */
  const disagreement = async (property: string, editor: SourceKey = 'editorial'): Promise<void> => {
    await claim(fixtures, 'manufacturer', {
      property,
      value: 'nameplate',
      valid_from: '2026-03-01T00:00:00Z',
      observed_at: '2026-03-01T00:00:00Z',
    });
    await claim(fixtures, editor, {
      property,
      value: 'corrected',
      status: 'PROPOSED',
      valid_from: '2026-03-01T00:00:00Z',
      observed_at: '2026-03-01T00:00:00Z',
    });
  };

  const select = (property: string, overrides: readonly EditorialOverride[]) =>
    fixtures.store.selectFact(fixtures.entity.id, property, {
      at: AT,
      editorialOverrides: overrides,
    });

  it('beats a direct authoritative source that disagrees', async () => {
    await disagreement('condenser_finish');

    const selection = await select('condenser_finish', [VALID]);

    expect(selection.rule).toBe('EDITORIAL_OVERRIDE');
    expect(selection.selected?.fact.normalized_value).toBe('corrected');
    // An override that only fires on a tie is not an override.
    expect(step(selection, 'DIRECT_AUTHORITATIVE_SOURCE')).toBeUndefined();
    expect(step(selection, 'EDITORIAL_OVERRIDE')?.decided).toBe(true);
  });

  it('labels the corrected selection with its reason and reviewer', async () => {
    await disagreement('cabinet_finish');

    const corrected = await select('cabinet_finish', [VALID]);
    expect(corrected.editorially_corrected).toBe(true);
    expect(corrected.editorial_correction).toEqual({
      source: 'editorial.internal',
      reason: REASON,
      reviewer: REVIEWER,
    });
    // `reason` is projected verbatim onto the customer-facing
    // `CanonicalFactView`, so it carries the PUBLIC explanation only. The
    // reviewer identity — an internal email address — must NOT be in it; it
    // lives in the structured `editorial_correction.reviewer` asserted above,
    // which `explainFact` and the audit record expose and the query view does not.
    expect(corrected.reason).toContain(REASON);
    expect(corrected.reason).not.toContain(REVIEWER);

    // The identical claims, selected without an override declaration, are not
    // labelled. The label tracks the decision, never the source.
    const plain = await fixtures.store.selectFact(fixtures.entity.id, 'cabinet_finish', { at: AT });
    expect(plain.rule).toBe('DIRECT_AUTHORITATIVE_SOURCE');
    expect(plain.editorially_corrected).toBe(false);
    expect(plain.editorial_correction).toBeNull();
  });

  it('ignores an override declaration with no reason', async () => {
    await disagreement('drain_pan_material');

    const selection = await select('drain_pan_material', [
      { source: 'editorial.internal', reason: '', reviewer: REVIEWER },
    ]);

    // Fail closed: not a tiebreaker, not a throw — simply not there.
    expect(selection.rule).toBe('DIRECT_AUTHORITATIVE_SOURCE');
    expect(selection.selected?.fact.normalized_value).toBe('nameplate');
    expect(selection.editorially_corrected).toBe(false);
    expect(selection.editorial_correction).toBeNull();
    expect(step(selection, 'EDITORIAL_OVERRIDE')?.applied).toBe(false);
    expect(step(selection, 'EDITORIAL_OVERRIDE')?.detail).toMatch(/ignored/i);
  });

  it('ignores an override declaration with no reviewer', async () => {
    await disagreement('coil_material');

    const selection = await select('coil_material', [
      { source: 'editorial.internal', reason: REASON, reviewer: '' },
    ]);

    expect(selection.rule).toBe('DIRECT_AUTHORITATIVE_SOURCE');
    expect(selection.selected?.fact.normalized_value).toBe('nameplate');
    expect(selection.editorially_corrected).toBe(false);
    expect(step(selection, 'EDITORIAL_OVERRIDE')?.detail).toMatch(/ignored/i);
  });

  it('treats a whitespace-only reason or reviewer as missing', async () => {
    await disagreement('filter_type');
    await disagreement('fan_type');

    const blankReason = await select('filter_type', [
      { source: 'editorial.internal', reason: '   \t\n ', reviewer: REVIEWER },
    ]);
    expect(blankReason.rule).toBe('DIRECT_AUTHORITATIVE_SOURCE');
    expect(blankReason.editorially_corrected).toBe(false);

    const blankReviewer = await select('fan_type', [
      { source: 'editorial.internal', reason: REASON, reviewer: '\t  ' },
    ]);
    expect(blankReviewer.rule).toBe('DIRECT_AUTHORITATIVE_SOURCE');
    expect(blankReviewer.editorially_corrected).toBe(false);
  });

  it('does not leak a property-restricted override to another property', async () => {
    await disagreement('sound_rating_label');
    await disagreement('warranty_note');

    const restricted: EditorialOverride = {
      source: 'editorial.internal',
      reason: REASON,
      reviewer: REVIEWER,
      properties: ['sound_rating_label'],
    };

    const inScope = await select('sound_rating_label', [restricted]);
    expect(inScope.rule).toBe('EDITORIAL_OVERRIDE');
    expect(inScope.editorially_corrected).toBe(true);

    const outOfScope = await select('warranty_note', [restricted]);
    expect(outOfScope.rule).toBe('DIRECT_AUTHORITATIVE_SOURCE');
    expect(outOfScope.selected?.fact.normalized_value).toBe('nameplate');
    expect(outOfScope.editorially_corrected).toBe(false);
    expect(step(outOfScope, 'EDITORIAL_OVERRIDE')?.applied).toBe(false);
  });

  it('refuses to choose between two competing overrides and falls through', async () => {
    await claim(fixtures, 'aggregator', {
      property: 'listing_title',
      value: 'aggregator title',
      valid_from: '2026-02-01T00:00:00Z',
      observed_at: '2026-02-01T00:00:00Z',
    });
    await claim(fixtures, 'editorial', {
      property: 'listing_title',
      value: 'editorial title',
      status: 'PROPOSED',
      valid_from: '2026-03-01T00:00:00Z',
      observed_at: '2026-03-01T00:00:00Z',
    });
    await claim(fixtures, 'editorial_standards', {
      property: 'listing_title',
      value: 'standards title',
      status: 'PROPOSED',
      valid_from: '2026-04-01T00:00:00Z',
      observed_at: '2026-04-01T00:00:00Z',
    });

    const selection = await select('listing_title', [
      VALID,
      {
        source: 'standards-desk.internal',
        reason: 'The standards desk reads the same erratum the other way.',
        reviewer: 'a.silva@data-foundry.example',
      },
    ]);

    const overrideStep = step(selection, 'EDITORIAL_OVERRIDE');
    expect(overrideStep?.applied).toBe(true);
    expect(overrideStep?.decided).toBe(false);
    expect(overrideStep?.detail).toMatch(/compet/i);
    // The pool is untouched: ambiguity must not quietly narrow the field either.
    expect(overrideStep?.survivors).toHaveLength(3);

    // Ambiguous editorial intent is not a decision — the ordinary criteria run.
    expect(selection.rule).toBe('RECENCY');
    expect(selection.selected?.fact.normalized_value).toBe('standards title');
    expect(selection.editorially_corrected).toBe(false);
    expect(selection.editorial_correction).toBeNull();
  });

  it('retains the overridden authoritative claim as a conflict, never deletes it', async () => {
    await disagreement('nameplate_voltage_label');

    const selection = await select('nameplate_voltage_label', [VALID]);

    expect(selection.rule).toBe('EDITORIAL_OVERRIDE');
    // AGENTS.md rule 10: correcting a value does not erase what the source said.
    expect(values(selection)).toEqual(['nameplate']);
    expect(selection.unresolved_conflict).toBe(true);

    const stored = await fixtures.store.listFacts(fixtures.entity.id, {
      property: 'nameplate_voltage_label',
    });
    expect(stored.map((fact) => fact.normalized_value).sort()).toEqual(['corrected', 'nameplate']);
    const overridden = stored.find((fact) => fact.normalized_value === 'nameplate');
    expect(await fixtures.store.listFactEvidence(overridden!.id)).toHaveLength(1);
  });

  it('cannot be exercised through a rights-blocked source', async () => {
    // The eligibility pre-filter runs first and is not weakened by the override:
    // an editor cannot launder an UNREVIEWED claim into publication.
    await claim(fixtures, 'manufacturer', {
      property: 'install_note',
      value: 'nameplate',
      valid_from: '2026-03-01T00:00:00Z',
    });
    await claim(fixtures, 'blocked', {
      property: 'install_note',
      value: 'forum correction',
      status: 'PROPOSED',
      valid_from: '2026-03-01T00:00:00Z',
    });

    const selection = await select('install_note', [
      { source: 'forum.example', reason: REASON, reviewer: REVIEWER },
    ]);

    expect(selection.selected?.fact.normalized_value).toBe('nameplate');
    expect(selection.editorially_corrected).toBe(false);
    expect(selection.excluded[0]?.reason).toBe('RIGHTS_BLOCKED');
  });
});
