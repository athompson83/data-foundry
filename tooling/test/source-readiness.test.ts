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
import { assess, isReservedDomain, readVertical } from '../scripts/source-readiness.js';
import { join } from 'node:path';
import { VERTICALS_DIR } from '../validators/validate-verticals.js';

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
    expect(report.blockers.join(' ')).toMatch(/no real source has completed a rights review/);
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
