/**
 * Configuration honesty in `normalizers/fact-selection.yaml`.
 *
 * Two keys were being accepted and then quietly disregarded:
 *
 *   `max_age_days` promised that a staff correction expires so a manual patch
 *   cannot outlive the problem it fixed. ADR-0002 records that it is "declared
 *   but not enforced" — expiry needs a `declared_at` on each override entry and
 *   the cascade does not read one. A vertical that sets it gets no expiry and
 *   no warning, which is worse than not offering the knob: someone reads the
 *   YAML and believes the override lapses in a year.
 *
 *   `requires_reason` and `requires_reviewer` are invariants, not switches. The
 *   cascade enforces both unconditionally; setting either to `false` changes
 *   nothing. A vertical that writes `requires_reason: false` has declared an
 *   intention to publish unaccountable corrections and been silently overruled,
 *   which is the right outcome reached the wrong way — nobody was told.
 *
 * A configuration option is a promise. The loader now either keeps it or
 * refuses it at the point the vertical is compiled, where the run can still be
 * stopped, rather than after it has published.
 */
import { describe, expect, it } from 'vitest';
import { buildFactSelectionPolicy, editorialOverrides } from '../src/fact-policy.js';
import { PipelineConfigurationError } from '../src/errors.js';
import type { VerticalConfig } from '../src/config.js';
import type { IsoDateTime } from '@data-foundry/canonical-schema';

const AT = '2026-08-14T00:00:00.000Z' as IsoDateTime;

function config(editorialOverride: Record<string, unknown>): VerticalConfig {
  return {
    slug: 'probe',
    vertical: {},
    entities: {},
    aliasTypes: [],
    sources: [],
    factSelection: { editorial_override: editorialOverride },
  } as unknown as VerticalConfig;
}

const VALID = {
  enabled: true,
  requires_reason: true,
  requires_reviewer: true,
  overrides: [],
};

describe('fact-selection configuration is honest about what it enforces', () => {
  it('compiles a declaration that only uses implemented options', () => {
    expect(() => buildFactSelectionPolicy(config(VALID), { at: AT })).not.toThrow();
    expect(editorialOverrides(config(VALID))).toEqual([]);
  });

  it('rejects max_age_days rather than accepting an expiry it does not apply', () => {
    expect(() =>
      buildFactSelectionPolicy(config({ ...VALID, max_age_days: 365 }), { at: AT }),
    ).toThrow(PipelineConfigurationError);
  });

  it('rejects max_age_days even when the override mechanism is switched off', () => {
    // `enabled: false` withdraws the mechanism; it does not make a promise the
    // platform cannot keep acceptable to leave lying in the file.
    expect(() =>
      buildFactSelectionPolicy(
        config({ ...VALID, enabled: false, max_age_days: 365 }),
        { at: AT },
      ),
    ).toThrow(PipelineConfigurationError);
  });

  it('names the missing mechanism, so the reader knows what would have to exist', () => {
    let message = '';
    try {
      buildFactSelectionPolicy(config({ ...VALID, max_age_days: 1 }), { at: AT });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toMatch(/declared_at/);
    expect(message).toMatch(/max_age_days/);
  });

  it('rejects requires_reason: false instead of silently overruling it', () => {
    expect(() =>
      buildFactSelectionPolicy(config({ ...VALID, requires_reason: false }), { at: AT }),
    ).toThrow(PipelineConfigurationError);
  });

  it('rejects requires_reviewer: false instead of silently overruling it', () => {
    expect(() =>
      buildFactSelectionPolicy(config({ ...VALID, requires_reviewer: false }), { at: AT }),
    ).toThrow(PipelineConfigurationError);
  });

  it('accepts the invariants restated as true, since that is what the code does', () => {
    expect(() =>
      buildFactSelectionPolicy(
        config({ enabled: true, requires_reason: true, requires_reviewer: true, overrides: [] }),
        { at: AT },
      ),
    ).not.toThrow();
  });

  it('rejects an override whose customer-visible reason names its own reviewer', () => {
    // The reason is projected to every customer surface; the reviewer is not.
    // A reason that names the reviewer publishes the identity through the field
    // that is explicitly documented never to carry it.
    expect(() =>
      buildFactSelectionPolicy(
        config({
          ...VALID,
          overrides: [
            {
              source: 'acme-hvac-catalog',
              reviewer: 'j.okafor@example.com',
              reason: 'Corrected by j.okafor@example.com after a supplier call.',
            },
          ],
        }),
        { at: AT },
      ),
    ).toThrow(PipelineConfigurationError);
  });

  it('matches the reviewer regardless of case', () => {
    expect(() =>
      buildFactSelectionPolicy(
        config({
          ...VALID,
          overrides: [
            { source: 's', reviewer: 'M. Ruiz', reason: 'Reviewed (M. RUIZ), 2026-04-02.' },
          ],
        }),
        { at: AT },
      ),
    ).toThrow(PipelineConfigurationError);
  });

  it('does not put the identity into the error it raises about the identity', () => {
    let message = '';
    try {
      buildFactSelectionPolicy(
        config({
          ...VALID,
          overrides: [
            { source: 's', reviewer: 'j.okafor@example.com', reason: 'set by j.okafor@example.com' },
          ],
        }),
        { at: AT },
      );
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toMatch(/reason/i);
    expect(message).not.toContain('j.okafor@example.com');
  });

  it('accepts a reason that explains the correction without naming anyone', () => {
    expect(() =>
      buildFactSelectionPolicy(
        config({
          ...VALID,
          overrides: [
            {
              source: 'acme-hvac-catalog',
              reviewer: 'j.okafor@example.com',
              reason: 'Manufacturer erratum 2026-03: the published SEER2 was a transcription error.',
            },
          ],
        }),
        { at: AT },
      ),
    ).not.toThrow();
  });

  it('accepts a declaration that omits the invariants entirely', () => {
    expect(() =>
      buildFactSelectionPolicy(config({ enabled: true, overrides: [] }), { at: AT }),
    ).not.toThrow();
  });
});
