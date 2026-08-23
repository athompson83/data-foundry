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

  it('rejects a reason naming the email local part rather than the full address', () => {
    // `j.okafor` identifies the reviewer exactly as completely as the address.
    expect(() =>
      buildFactSelectionPolicy(
        config({
          ...VALID,
          overrides: [
            {
              source: 's',
              reviewer: 'j.okafor@example.com',
              reason: 'Corrected by j.okafor after a supplier call.',
            },
          ],
        }),
        { at: AT },
      ),
    ).toThrow(PipelineConfigurationError);
  });

  it('does not treat a very short local part as an identity match', () => {
    // `bo` appears inside ordinary words; a two-character token would refuse
    // every reason that happens to contain it.
    expect(() =>
      buildFactSelectionPolicy(
        config({
          ...VALID,
          overrides: [
            {
              source: 's',
              reviewer: 'bo@example.com',
              reason: 'The published carbon monoxide threshold was a transcription error.',
            },
          ],
        }),
        { at: AT },
      ),
    ).not.toThrow();
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

/**
 * The third broken promise, and the one with teeth.
 *
 * `authoritative_by_property` declares WHICH SOURCE TYPE decides a property —
 * `seer2: prefer_source_types: [CERTIFICATION_BODY]`, with a rationale in the
 * YAML explaining that a certified measurement must beat a manufacturer's
 * marketing figure even when two other sources agree with the manufacturer.
 *
 * The loader expanded that to the domains of registered sources of those types,
 * and then:
 *
 *     if (domains.length > 0) authoritativeSourcesByProperty[property] = domains;
 *
 * If no registered source has any of the declared types, the property is simply
 * ABSENT from the policy. Doc 04's criterion 1 never fires for it, and selection
 * falls through to reliability, recency and corroboration — a majority vote,
 * which the YAML's own rationale says "gets this backwards".
 *
 * That is not a hypothetical. HVAC declares `CERTIFICATION_BODY` for seven
 * properties, and the only registered source carrying that type is a synthetic
 * fixture; the sole real US HVAC certification directory is prohibited in
 * `packages/source-registry`. The day the fixtures are replaced by lawful
 * sources, the certified-ratings preference disappears with them — silently,
 * with every test still green.
 */
describe('an authority declaration no source can satisfy is refused, not silently dropped', () => {
  const source = (key: string, type: string) =>
    ({ key, domain: `${key}.example.com`, source_type: type }) as never;

  const withSources = (
    sources: readonly unknown[],
    authoritative: Record<string, unknown>,
  ): VerticalConfig =>
    ({
      slug: 'probe',
      vertical: {},
      entities: {},
      aliasTypes: [],
      sources,
      factSelection: { authoritative_by_property: authoritative },
    }) as unknown as VerticalConfig;

  it('refuses a property whose declared types match no registered source', () => {
    expect(() =>
      buildFactSelectionPolicy(
        withSources(
          [source('maker', 'MANUFACTURER')],
          { seer2: { prefer_source_types: ['CERTIFICATION_BODY'] } },
        ),
        { at: AT },
      ),
    ).toThrow(PipelineConfigurationError);
  });

  it('names the property and the unsatisfied types, so the fix is obvious', () => {
    // A refusal that does not say which declaration is wrong just moves the
    // silent failure from the data to the operator.
    expect(() =>
      buildFactSelectionPolicy(
        withSources(
          [source('maker', 'MANUFACTURER')],
          { seer2: { prefer_source_types: ['CERTIFICATION_BODY'] } },
        ),
        { at: AT },
      ),
    ).toThrow(/seer2[\s\S]*CERTIFICATION_BODY/);
  });

  /**
   * Positive control. Without it, an implementation that threw on EVERY
   * `authoritative_by_property` declaration would pass the two tests above.
   */
  it('compiles when a registered source does carry the declared type', () => {
    expect(() =>
      buildFactSelectionPolicy(
        withSources(
          [source('maker', 'MANUFACTURER'), source('filings', 'REGULATORY_FILING')],
          { seer2: { prefer_source_types: ['REGULATORY_FILING', 'MANUFACTURER'] } },
        ),
        { at: AT },
      ),
    ).not.toThrow();
  });

  it('is satisfied when any one of several declared types is present', () => {
    // The declaration is a preference ORDER, not a conjunction: one match is
    // enough for criterion 1 to have something to rank.
    expect(() =>
      buildFactSelectionPolicy(
        withSources(
          [source('maker', 'MANUFACTURER')],
          { sound_level_db: { prefer_source_types: ['CERTIFICATION_BODY', 'MANUFACTURER'] } },
        ),
        { at: AT },
      ),
    ).not.toThrow();
  });

  it('ignores a property that declares no preference at all', () => {
    expect(() =>
      buildFactSelectionPolicy(
        withSources([source('maker', 'MANUFACTURER')], { seer2: {} }),
        { at: AT },
      ),
    ).not.toThrow();
  });
});

/**
 * `prefer_source_types` is a membership set, not a ranking — pinned here
 * because the name says otherwise and the mistake is silent.
 *
 * The list expands to the domains of every registered source of ANY listed
 * type, and doc 04's criterion 1 treats all of them as equally authoritative.
 * Order inside the list is never read. So adding a BROADER type does not add a
 * lower tier; it promotes that type to full authority and levels the
 * distinction the declaration existed to make.
 *
 * This was not theoretical. Adding MANUFACTURER to the seer2 tier — intending a
 * fallback below the certified value — made the manufacturer's marketing figure
 * equally authoritative, and Conflict A in the e2e proof silently began
 * resolving on SOURCE_FIELD_RELIABILITY instead of DIRECT_AUTHORITATIVE_SOURCE.
 * Two sources agreeing on the marketing number stopped losing.
 */
describe('prefer_source_types confers authority; it does not order it', () => {
  const source = (key: string, type: string) =>
    ({ key, domain: `${key}.example.com`, source_type: type }) as never;

  const policy = (types: readonly string[]) =>
    buildFactSelectionPolicy(
      {
        slug: 'probe',
        vertical: {},
        entities: {},
        aliasTypes: [],
        sources: [
          source('certifier', 'CERTIFICATION_BODY'),
          source('filings', 'REGULATORY_FILING'),
          source('maker', 'MANUFACTURER'),
        ],
        factSelection: { authoritative_by_property: { seer2: { prefer_source_types: types } } },
      } as unknown as VerticalConfig,
      { at: AT },
    );

  it('names exactly one source when one type is declared', () => {
    expect(policy(['CERTIFICATION_BODY']).authoritativeSourcesByProperty?.['seer2']).toEqual([
      'certifier.example.com',
    ]);
  });

  it('promotes every listed type to the same authority, in declaration-independent order', () => {
    // Both spellings produce the same SET. If order mattered, these would differ.
    const forwards = policy(['CERTIFICATION_BODY', 'MANUFACTURER']).authoritativeSourcesByProperty?.[
      'seer2'
    ];
    const backwards = policy(['MANUFACTURER', 'CERTIFICATION_BODY'])
      .authoritativeSourcesByProperty?.['seer2'];
    expect([...(forwards ?? [])].sort()).toEqual([...(backwards ?? [])].sort());
    expect(forwards).toHaveLength(2);
  });

  it('keeps a manufacturer OUT of the ratings tier, which is the point', () => {
    // The shape the vertical actually ships: classes that outrank a
    // specification sheet, and nothing else.
    expect(
      policy(['CERTIFICATION_BODY', 'STANDARDS_BODY', 'REGULATORY_FILING'])
        .authoritativeSourcesByProperty?.['seer2'],
    ).not.toContain('maker.example.com');
  });
});
