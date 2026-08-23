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
  // status and rights_classification are REQUIRED on a real registry entry, so a
  // double that omits them is not a smaller version of the thing — it is a
  // different thing, and it silently stopped exercising the usability check.
  const source = (key: string, type: string) =>
    ({
      key,
      domain: `${key}.example.com`,
      source_type: type,
      status: 'ACTIVE',
      rights_classification: 'GREEN',
    }) as never;

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
  // status and rights_classification are REQUIRED on a real registry entry, so a
  // double that omits them is not a smaller version of the thing — it is a
  // different thing, and it silently stopped exercising the usability check.
  const source = (key: string, type: string) =>
    ({
      key,
      domain: `${key}.example.com`,
      source_type: type,
      status: 'ACTIVE',
      rights_classification: 'GREEN',
    }) as never;

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

/**
 * A declaration satisfied only by sources that can never publish is still
 * unsatisfiable — the check just could not see it.
 *
 * The refusal added above asks one question: does any registered source carry a
 * declared type? That closed the loud case and left a quiet one open, because
 * `domainsOfType` filtered on `source_type` and nothing else. A source in
 * `UNDER_REVIEW`, a source classified `RED`, a source on a prohibited domain —
 * each of them counts, and none of them can ever contribute a published fact.
 *
 * So the declaration compiles, doc 04's criterion 1 points at domains that will
 * never appear in evidence, and selection falls through to corroboration for
 * that property. That is the SAME failure the refusal was written to prevent,
 * reached by a different route, and it is not hypothetical: HVAC's only
 * `CERTIFICATION_BODY` source is a synthetic fixture on a reserved
 * `.example.org` domain.
 *
 * The predicate is deliberately narrower than the acquisition gate. Status,
 * rights and prohibition are properties of the DECLARATION and are stable. The
 * kill switch and robots are operational state, and coupling vertical
 * compilation to them would fail a build because an operator paused a fetch.
 */
describe('an authority declaration satisfied only by unusable sources is refused', () => {
  const source = (
    key: string,
    type: string,
    overrides: Record<string, unknown> = {},
  ) =>
    ({
      key,
      domain: `${key}.example.com`,
      source_type: type,
      status: 'ACTIVE',
      rights_classification: 'GREEN',
      ...overrides,
    }) as never;

  const compile = (sources: readonly unknown[]) => () =>
    buildFactSelectionPolicy(
      {
        slug: 'probe',
        vertical: {},
        entities: {},
        aliasTypes: [],
        sources,
        factSelection: {
          authoritative_by_property: { seer2: { prefer_source_types: ['CERTIFICATION_BODY'] } },
        },
      } as unknown as VerticalConfig,
      { at: AT },
    );

  it('refuses a source that is not in an acquirable status', () => {
    // UNDER_REVIEW is not in ACQUIRABLE_STATUSES, so nothing is ever fetched
    // from it and no claim of its can reach the cascade.
    expect(compile([source('draft', 'CERTIFICATION_BODY', { status: 'UNDER_REVIEW' })])).toThrow(
      PipelineConfigurationError,
    );
  });

  it('refuses a source whose rights forbid publication', () => {
    // RED may be acquirable for internal analysis; its claims are filtered out
    // of the canonical view by requirePublishableRights, so an authority tier
    // resting on it selects nothing.
    expect(compile([source('red', 'CERTIFICATION_BODY', { rights_classification: 'RED' })])).toThrow(
      PipelineConfigurationError,
    );
  });

  it('refuses an UNREVIEWED source, which is the default nobody set', () => {
    expect(
      compile([source('new', 'CERTIFICATION_BODY', { rights_classification: 'UNREVIEWED' })]),
    ).toThrow(PipelineConfigurationError);
  });

  it('refuses a source on a prohibited domain', () => {
    // The one that would actually happen: somebody declares the real
    // certification directory to satisfy the tier the vertical wants.
    expect(
      compile([source('ahri', 'CERTIFICATION_BODY', { domain: 'ahridirectory.org' })]),
    ).toThrow(PipelineConfigurationError);
  });

  it('says which source it disqualified and why', () => {
    // A refusal that only says "no source of that type" would send an operator
    // looking for a source that is sitting right there in the registry.
    expect(compile([source('draft', 'CERTIFICATION_BODY', { status: 'UNDER_REVIEW' })])).toThrow(
      /draft\.example\.com[\s\S]*UNDER_REVIEW/,
    );
  });

  /** Positive control: an ordinary usable source still compiles. */
  it('accepts a source that is acquirable, publishable and permitted', () => {
    expect(compile([source('certifier', 'CERTIFICATION_BODY')])).not.toThrow();
  });

  it('accepts AMBER, which is publishable with conditions', () => {
    expect(
      compile([source('amber', 'CERTIFICATION_BODY', { rights_classification: 'AMBER' })]),
    ).not.toThrow();
  });

  /**
   * Second positive control. One usable source is enough — otherwise the check
   * would refuse every vertical that keeps a retired source in its registry for
   * provenance, which is a thing this platform deliberately does.
   */
  it('accepts when one usable source sits among unusable ones of the same type', () => {
    expect(
      compile([
        source('retired', 'CERTIFICATION_BODY', { status: 'RETIRED' }),
        source('certifier', 'CERTIFICATION_BODY'),
      ]),
    ).not.toThrow();
  });
});
