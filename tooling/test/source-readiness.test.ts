/**
 * The readiness report has to be able to say no.
 *
 * A gate that cannot fail is worse than no gate: it produces the word "pass"
 * and a false sense that something was checked. Two of these gates were written
 * as tautologies on the first pass (`!required || required`, and a `typeof`
 * check on an already-parsed boolean), so every case below drives the gate to
 * FAIL as well as to pass. If one of them silently becomes unfalsifiable again,
 * its failing case here goes green and this file starts lying instead.
 */
import { describe, expect, it } from 'vitest';
import {
  assess as assessAt,
  isReservedDomain,
  readVertical as readVerticalAt,
} from '../scripts/source-readiness.js';
import { join } from 'node:path';
import { VERTICALS_DIR } from '../validators/validate-verticals.js';

/**
 * Both entry points require the moment to ask about, so that nothing guesses
 * it. Every case that is not itself about the clock is asked at this one fixed
 * instant — otherwise these assertions would start answering differently on a
 * future Tuesday, when a fixture's `next_review_at` quietly passes.
 */
const NOW = '2026-08-21T00:00:00.000Z';
const assess = (
  slug: string,
  status: string,
  raws: readonly Record<string, unknown>[],
  asOf: string = NOW,
) => assessAt(slug, status, raws, asOf);
const readVertical = (dir: string, slug: string) => readVerticalAt(dir, slug, NOW);

/** A fully permissive, fully reviewed real source. Each case spoils one field. */
const REAL = {
  key: 'a-real-source',
  domain: 'catalog.example-manufacturer.co.uk',
  status: 'ACTIVE',
  rights_classification: 'GREEN',
  kill_switch_engaged: false,
  image_policy: { images_reusable: false },
  provenance_retention: { retain_artifacts: true },
  acquisition_policy: { approved: true },
  rights_policy: {
    commercial_use_allowed: true,
    redistribution_allowed: true,
    derivative_normalization_allowed: true,
    images_reusable: false,
    personal_data_present: false,
    reviewed_at: '2026-08-01T00:00:00.000Z',
    reviewed_by: 'A. Reviewer',
    next_review_at: '2027-08-01',
    attribution: { required: true, text: 'Data from Example Manufacturer.' },
  },
} as const;

const source = (patch: Record<string, unknown> = {}) => ({ ...REAL, ...patch });
const withRights = (patch: Record<string, unknown>) =>
  source({ rights_policy: { ...REAL.rights_policy, ...patch } });

describe('a reserved domain cannot name a real publisher', () => {
  it('classifies the reserved names as synthetic', () => {
    for (const domain of [
      'example.com',
      'catalog.acme-climate.example.com',
      'ratings-directory.example.org',
      'anything.test',
      'host.invalid',
      'localhost',
      // Fully qualified, with the root label written out. Same DNS name.
      'example.com.',
      'catalog.acme-climate.example.com.',
      // The reserved top-level labels standing alone. `.test` is reserved as a
      // TLD, so the TLD itself is the most reserved name there is — but a rule
      // written as "ends with `.test`" does not match `test`, and the apex form
      // is exactly what a trailing root dot normalizes down to.
      'example',
      'example.',
      'test',
      'test.',
      'invalid',
      'invalid.',
      'localhost.',
    ]) {
      expect(isReservedDomain(domain), domain).toBe(true);
    }
  });

  it('does not mistake an ordinary domain for a reserved one', () => {
    for (const domain of [
      'catalog.example-manufacturer.co.uk',
      'exampleteam.io',
      'notexample.com',
      'ahridirectory.org',
      // The reserved label has to be a whole label, not a string ending.
      'attest.com',
      'contest.example-registry.io',
      'notlocalhost.net',
    ]) {
      expect(isReservedDomain(domain), domain).toBe(false);
    }
  });

  it('treats a missing domain as unknown rather than reserved', () => {
    expect(isReservedDomain('')).toBe(false);
  });
});

describe('the commercial publication gate can fail on each of its conditions', () => {
  it('passes when a real, fully reviewed, fully permissive source is declared', () => {
    const report = assess('probe', 'ACTIVE', [source()]);
    expect(Object.values(report.commercialGate).every(Boolean)).toBe(true);
    expect(report.blockers).toEqual([]);
    expect(report.realSourceCount).toBe(1);
  });

  it('fails when an enabled source was never rights-reviewed', () => {
    // The read boundary refuses UNREVIEWED data, so this source publishes
    // nothing today. It is still a blocker for selling a dataset: an enabled
    // source nobody has looked at is exactly what condition 1 of DATA_RIGHTS.md
    // forbids, and the gate must be able to see it.
    const report = assess('probe', 'DRAFT', [source({ rights_classification: 'UNREVIEWED' })]);
    expect(report.commercialGate.noUnreviewedSources).toBe(false);
  });

  it('does not count a disabled unreviewed source against the gate', () => {
    const report = assess('probe', 'DRAFT', [
      source({ rights_classification: 'UNREVIEWED', status: 'PAUSED' }),
    ]);
    expect(report.commercialGate.noUnreviewedSources).toBe(true);
  });

  it('accepts AMBER, which publishes on conditions rather than not at all', () => {
    const report = assess('probe', 'DRAFT', [source({ rights_classification: 'AMBER' })]);
    expect(report.commercialGate.noUnreviewedSources).toBe(true);
  });

  it('fails when a publishing source forbids commercial use', () => {
    const report = assess('probe', 'DRAFT', [withRights({ commercial_use_allowed: false })]);
    expect(report.commercialGate.everyPublishingSourcePermitsCommercialUse).toBe(false);
  });

  it('fails when a publishing source forbids derivative normalization', () => {
    // The permission the whole platform depends on: normalizing and deriving is
    // what the factory does to every byte it acquires. A source that forbids it
    // can be read and cited but cannot be processed, and that has to be visible
    // rather than merely printed alongside the passing gates.
    const report = assess('probe', 'DRAFT', [
      withRights({ derivative_normalization_allowed: false }),
    ]);
    expect(report.commercialGate.everyPublishingSourcePermitsDerivativeNormalization).toBe(false);
    expect(Object.values(report.commercialGate).every(Boolean)).toBe(false);
  });

  it('fails when a publishing source forbids redistribution', () => {
    const report = assess('probe', 'DRAFT', [withRights({ redistribution_allowed: false })]);
    expect(report.commercialGate.everyPublishingSourcePermitsRedistribution).toBe(false);
  });

  it('fails when attribution is required but no text was recorded', () => {
    const report = assess('probe', 'DRAFT', [
      withRights({ attribution: { required: true, text: null } }),
    ]);
    expect(report.commercialGate.attributionObligationsRecorded).toBe(false);
  });

  it('passes attribution when none is required', () => {
    const report = assess('probe', 'DRAFT', [
      withRights({ attribution: { required: false, text: null } }),
    ]);
    expect(report.commercialGate.attributionObligationsRecorded).toBe(true);
  });

  it('fails when images are claimed reusable with no image policy governing them', () => {
    const raw = withRights({ images_reusable: true }) as Record<string, unknown>;
    delete raw['image_policy'];
    const report = assess('probe', 'DRAFT', [raw]);
    expect(report.commercialGate.imageRightsSettledSeparately).toBe(false);
  });

  it('does not require an image policy from a source that publishes no images', () => {
    const raw = source() as Record<string, unknown>;
    delete raw['image_policy'];
    expect(assess('probe', 'DRAFT', [raw]).commercialGate.imageRightsSettledSeparately).toBe(true);
  });
});

describe('real-source blockers', () => {
  it('names the synthetic-only state, which is where the project actually is', () => {
    const report = assess('probe', 'DRAFT', [
      source({ domain: 'catalog.acme.example.com' }),
    ]);
    expect(report.realSourceCount).toBe(0);
    expect(report.syntheticSourceCount).toBe(1);
    expect(report.blockers.join(' ')).toMatch(/every source is synthetic/);
  });

  it('refuses to call a real source reviewed when its acquisition is unapproved', () => {
    const report = assess('probe', 'DRAFT', [source({ acquisition_policy: { approved: false } })]);
    expect(report.hasRealRightsReviewedSource).toBe(false);
    expect(report.blockers.join(' ')).toMatch(/no real source has a current, named rights review/);
  });

  it('blocks a publishing source that does not retain its raw artifacts', () => {
    const report = assess('probe', 'DRAFT', [
      source({ provenance_retention: { retain_artifacts: false } }),
    ]);
    expect(report.blockers.join(' ')).toMatch(/retaining its raw artifacts/);
  });

  it('blocks a source declaring personal data until someone decides how to handle it', () => {
    const report = assess('probe', 'DRAFT', [withRights({ personal_data_present: true })]);
    expect(report.blockers.join(' ')).toMatch(/personal data/);
  });

  it('calls out a vertical that left DRAFT with blockers outstanding', () => {
    const report = assess('probe', 'ACTIVE', [source({ domain: 'x.example.com' })]);
    expect(report.blockers.join(' ')).toMatch(/status: ACTIVE while the conditions above are unmet/);
  });

  it('a kill-switched source is not treated as publishing', () => {
    const report = assess('probe', 'DRAFT', [
      { ...withRights({ commercial_use_allowed: false }), kill_switch_engaged: true },
    ]);
    expect(report.commercialGate.everyPublishingSourcePermitsCommercialUse).toBe(true);
  });
});

describe('the shipped vertical, read from its real declarations', () => {
  it('reports hvac as not ready, because every one of its sources is synthetic', async () => {
    const report = await readVertical(join(VERTICALS_DIR, 'hvac'), 'hvac');
    expect(report.status).toBe('DRAFT');
    expect(report.realSourceCount).toBe(0);
    expect(report.syntheticSourceCount).toBe(4);
    expect(report.hasRealRightsReviewedSource).toBe(false);
    expect(report.blockers.length).toBeGreaterThan(0);
  });

  it('still shows its rights machinery passing, which is the thing that IS proven', async () => {
    const report = await readVertical(join(VERTICALS_DIR, 'hvac'), 'hvac');
    expect(Object.values(report.commercialGate).every(Boolean)).toBe(true);
  });
});

/**
 * Three ways the verdict could say READY while the report below it said no.
 *
 * A readiness report exists to be believed at a glance. The headline is the
 * only line most people read, so a headline that disagrees with the detail
 * under it is worse than no headline — it converts a careful report into a
 * confident wrong answer.
 */
describe('the verdict cannot contradict the report underneath it', () => {
  it('is not READY while a commercial condition is failing', () => {
    const report = assess('probe', 'DRAFT', [
      withRights({ derivative_normalization_allowed: false }),
    ]);
    expect(Object.values(report.commercialGate).every(Boolean)).toBe(false);
    // The headline is computed from `blockers`, so a failing gate has to reach
    // it or the two halves of the report disagree.
    expect(report.blockers.length).toBeGreaterThan(0);
    expect(report.blockers.join(' ')).toMatch(/derivative|commercial|publication/i);
  });

  it('is not READY on a lone reviewed RED source, which may never publish', () => {
    // RED is reviewed, so it satisfies "someone looked at it". It is also
    // excluded from the publishing set, so every commercial condition passes
    // with nothing to check. Vacuous truth is the most dangerous kind of green.
    const report = assess('probe', 'DRAFT', [source({ rights_classification: 'RED' })]);
    expect(report.blockers.length).toBeGreaterThan(0);
    expect(report.blockers.join(' ')).toMatch(/publish/i);
  });

  it('is still READY when a real source genuinely may publish', () => {
    expect(assess('probe', 'ACTIVE', [source()]).blockers).toEqual([]);
  });
});

describe('a rights review has to be current and attributable', () => {
  it('rejects a review with no named reviewer', () => {
    const report = assess('probe', 'DRAFT', [withRights({ reviewed_by: null })]);
    expect(report.hasRealRightsReviewedSource).toBe(false);
  });

  it('rejects a review whose next_review_at has already passed', () => {
    const report = assess(
      'probe',
      'DRAFT',
      [withRights({ reviewed_by: 'A. Reviewer', next_review_at: '2020-01-01' })],
      '2026-08-21T00:00:00.000Z',
    );
    expect(report.hasRealRightsReviewedSource).toBe(false);
    expect(report.blockers.join(' ')).toMatch(/rights review/i);
  });

  it('accepts a named review that has not lapsed', () => {
    const report = assess(
      'probe',
      'DRAFT',
      [withRights({ reviewed_by: 'A. Reviewer', next_review_at: '2027-08-01' })],
      '2026-08-21T00:00:00.000Z',
    );
    expect(report.hasRealRightsReviewedSource).toBe(true);
  });

  it('accepts a named review with no expiry set', () => {
    const report = assess('probe', 'DRAFT', [
      withRights({ reviewed_by: 'A. Reviewer', next_review_at: null }),
    ]);
    expect(report.hasRealRightsReviewedSource).toBe(true);
  });
});

/**
 * A domain is the identity this report is built on: it decides real vs
 * synthetic, and distinct domains are what "independent publishers" counts. A
 * value that is missing, or spelled two ways, corrupts both answers at once.
 */
describe('the domain a source is identified by is normalized first', () => {
  it('does not count a source with no domain as a real publisher', () => {
    // `isReservedDomain('')` is false — correctly, an absent domain is unknown
    // rather than reserved — so "not reserved therefore real" turned a missing
    // field into evidence that a real publisher exists.
    const raw = source() as Record<string, unknown>;
    delete raw['domain'];
    const report = assess('probe', 'DRAFT', [raw]);
    expect(report.realSourceCount).toBe(0);
    expect(report.sources[0]!.real).toBe(false);
  });

  it('does not count a blank domain as a real publisher', () => {
    expect(assess('probe', 'DRAFT', [source({ domain: '   ' })]).realSourceCount).toBe(0);
  });

  it('counts two spellings of one publisher once', () => {
    const report = assess('probe', 'DRAFT', [
      { ...source({ domain: 'acme-climate.com' }), key: 'a' },
      { ...source({ domain: 'ACME-CLIMATE.COM.' }), key: 'b' },
    ]);
    expect(report.realSourceCount).toBe(2);
    expect(
      report.realPublisherCount,
      'case and a trailing root label do not make two organisations',
    ).toBe(1);
  });

  it('still counts genuinely different publishers separately', () => {
    const report = assess('probe', 'DRAFT', [
      { ...source({ domain: 'acme-climate.com' }), key: 'a' },
      { ...source({ domain: 'borealis-hvac.com' }), key: 'b' },
    ]);
    expect(report.realPublisherCount).toBe(2);
  });
});

/**
 * Two ways the fix for vacuous green was itself vacuous.
 */
describe('the no-publishable-source blocker counts only real sources', () => {
  it('fires when the only real source is RED and a synthetic one is publishable', () => {
    // `live` counted synthetic sources, so a publishable fixture satisfied the
    // check on behalf of a real source that may never publish. The fixtures
    // standing in for the thing being measured is the whole failure this tool
    // exists to name.
    const report = assess('probe', 'DRAFT', [
      { ...source({ rights_classification: 'RED' }), key: 'real-red' },
      { ...source({ domain: 'catalog.acme.example.com' }), key: 'synthetic-green' },
    ]);
    expect(report.realSourceCount).toBe(1);
    expect(report.blockers.join(' ')).toMatch(/no real source is cleared to publish/i);
  });

  it('does not fire when a real source genuinely may publish', () => {
    const report = assess('probe', 'ACTIVE', [
      { ...source(), key: 'real-green' },
      { ...source({ domain: 'catalog.acme.example.com' }), key: 'synthetic-green' },
    ]);
    expect(report.blockers).toEqual([]);
  });
});

describe('review expiry is measured against the run, not against a date in the source', () => {
  it('expires a review that lapsed before the moment being asked about', () => {
    const lapsed = [withRights({ next_review_at: '2026-09-01' })];
    // Current at the start of August...
    expect(assess('probe', 'DRAFT', lapsed, '2026-08-01T00:00:00.000Z').hasRealRightsReviewedSource)
      .toBe(true);
    // ...and lapsed by December. A fixed default would answer the same for both.
    expect(assess('probe', 'DRAFT', lapsed, '2026-12-01T00:00:00.000Z').hasRealRightsReviewedSource)
      .toBe(false);
  });

  it('has no default clock baked into the module', async () => {
    // A hardcoded `asOf` looks right on the day it is written and is wrong
    // forever after, silently. The signature must require one.
    const src = await import('node:fs/promises').then((fs) =>
      fs.readFile(new URL('../scripts/source-readiness.ts', import.meta.url), 'utf8'),
    );
    expect(src).not.toMatch(/asOf\s*=\s*['"]20\d\d-/);
  });
});
