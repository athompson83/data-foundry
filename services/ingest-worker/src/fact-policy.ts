/**
 * Doc 04 fact selection, parameterised from `normalizers/fact-selection.yaml`.
 *
 * The cascade itself lives in `@data-foundry/canonical-store`; what this module
 * does is translate the vertical's declaration of *which source is authoritative
 * for which property* into the shape that cascade consumes.
 *
 * One translation is worth spelling out. The vertical declares authority by
 * **source type** (`seer2: prefer_source_types: [CERTIFICATION_BODY]`), while
 * the selection policy keys on source identity. Expanding one to the other from
 * the registry is what makes "two sources agree on 14.5 and still lose to the
 * one that disagrees" a consequence of configuration rather than of code:
 * corroboration is doc 04's criterion 4 and cannot outvote criterion 1.
 */
import {
  DEFAULT_AUTHORITATIVE_SOURCE_TYPES,
  DEFAULT_CONSISTENCY_CHECKS,
  enumMembershipCheck,
  numericRangeCheck,
  type ConsistencyCheck,
  type EditorialOverride,
  type FactSelectionPolicyInput,
} from '@data-foundry/canonical-store';
import { canPublish, prohibitedSourceFor } from '@data-foundry/source-registry';
import { ACQUIRABLE_STATUSES } from '@data-foundry/acquisition';
import type { Identifier, IsoDateTime, SourceType } from '@data-foundry/canonical-schema';
import type { SourceRegistryEntry } from '@data-foundry/source-registry';
import type { VerticalConfig } from './config.js';
import { PipelineConfigurationError } from './errors.js';
import { reviewerIdentityTokens } from '@data-foundry/query-model';

/** YAML arrives untyped; every reader below narrows what it needs. */
type Yaml = any;

export interface FactPolicyOptions {
  readonly at: IsoDateTime;
}

export function buildFactSelectionPolicy(
  config: VerticalConfig,
  options: FactPolicyOptions,
): FactSelectionPolicyInput {
  assertEditorialOverrideDeclarationIsHonest(config);

  const byDomain = new Map<string, SourceRegistryEntry>();
  for (const source of config.sources) byDomain.set(source.key, source);

  /**
   * Why this source can never contribute a published fact, or `null`.
   *
   * Deliberately NARROWER than `evaluateAcquisitionGate`. Status, rights and
   * prohibition are properties of the declaration and are stable; the kill
   * switch and robots are operational state, and failing a vertical build
   * because an operator paused a fetch would couple compilation to something it
   * has no business knowing.
   *
   * `ACQUIRABLE_STATUSES` is imported rather than restated, for the reason
   * `refresh-schedule.ts` gives: a second copy of the rule is how the two drift,
   * and the drift shows up as a source this file thinks is usable and the gate
   * refuses.
   */
  const unusableBecause = (source: SourceRegistryEntry): string | null => {
    if (!ACQUIRABLE_STATUSES.has(source.status)) return `status ${source.status}`;
    if (!canPublish(source.rights_classification)) {
      return `rights ${source.rights_classification}`;
    }
    const prohibition = prohibitedSourceFor(source.domain);
    if (prohibition !== null) return `prohibited (${prohibition.publisher})`;
    return null;
  };

  const ofType = (types: readonly string[]): readonly SourceRegistryEntry[] =>
    config.sources.filter((source) => types.includes(source.source_type));

  const domainsOfType = (types: readonly string[]): string[] =>
    ofType(types)
      .filter((source) => unusableBecause(source) === null)
      .map((source) => source.domain);

  const authoritativeSourcesByProperty: Record<string, readonly string[]> = {};
  const declared: Yaml = config.factSelection?.authoritative_by_property ?? {};
  for (const [property, rule] of Object.entries(declared)) {
    const types = ((rule as Yaml)?.prefer_source_types ?? []).map(String);
    if (types.length === 0) continue;
    const domains = domainsOfType(types);

    // A declaration nothing can satisfy is refused here rather than dropped.
    //
    // This line used to read `if (domains.length > 0)`, and the `else` was
    // silence: the property vanished from the policy, doc 04's criterion 1 never
    // fired for it, and selection fell through to reliability, recency and
    // corroboration. That is a majority vote, which this vertical's own YAML
    // rationale says "gets this backwards" — and it would have happened with
    // every test green.
    //
    // It is not hypothetical. HVAC declares CERTIFICATION_BODY for seven
    // properties, the only registered source carrying that type is a synthetic
    // fixture, and the sole real US HVAC certification directory is prohibited
    // in `packages/source-registry`. Replacing the fixtures with lawful sources
    // would have removed the certified-ratings preference silently.
    if (domains.length === 0) {
      // Name the sources that ALMOST satisfied it. A refusal that only says
      // "no source of that type" sends an operator looking for a source that is
      // sitting in the registry, disqualified for a reason nobody mentioned.
      const disqualified = ofType(types)
        .map((source) => `${source.domain} (${unusableBecause(source) ?? 'usable'})`)
        .join(', ');
      throw new PipelineConfigurationError(
        `authoritative_by_property.${property} declares prefer_source_types ` +
          `[${types.join(', ')}], and no source registered for this vertical both has one of ` +
          'those types and can contribute a published fact. The preference cannot be ' +
          'applied, so selection would fall through to corroboration — a majority vote ' +
          'over exactly the claims this declaration exists to outrank. ' +
          (disqualified === ''
            ? 'No registered source carries any of those types at all.'
            : `Disqualified: ${disqualified}.`) +
          ' Declare a type a usable source actually has, or remove the property rather ' +
          'than shipping a preference that never fires.',
      );
    }
    authoritativeSourcesByProperty[property] = domains;
  }

  // `field_reliability` is declared per source KEY; the cascade matches on the
  // source's id or domain, so the key is resolved through the registry rather
  // than assumed to be the domain.
  const fieldReliability: Record<string, Record<string, number>> = {};
  for (const [sourceKey, properties] of Object.entries(config.factSelection?.field_reliability ?? {})) {
    const entry = byDomain.get(sourceKey);
    if (entry === undefined) continue;
    for (const [property, spec] of Object.entries(properties as Yaml)) {
      const reliability = (spec as Yaml)?.reliability;
      if (typeof reliability !== 'number') continue;
      (fieldReliability[property] ??= {})[entry.domain] = reliability;
    }
  }

  return {
    at: options.at,
    // Rule 1 at the read boundary: a claim backed only by RED/UNREVIEWED
    // evidence never becomes a published value.
    requirePublishableRights: true,
    authoritativeSourceTypes: [...DEFAULT_AUTHORITATIVE_SOURCE_TYPES] as readonly SourceType[],
    authoritativeSourcesByProperty,
    fieldReliability,
    editorialOverrides: editorialOverrides(config),
    consistencyChecks: [...DEFAULT_CONSISTENCY_CHECKS, ...verticalConsistencyChecks(config)],
  };
}

/**
 * `editorial_override.overrides` — declared staff corrections (ADR-0002).
 *
 * An override outranks every source-derived criterion, so the only thing that
 * makes it legitimate is that it is attributable: a named reviewer and a
 * written reason, on top of the evidence row the eligibility filter already
 * demands. Both are enforced by the cascade unconditionally — the YAML's
 * `requires_reason` / `requires_reviewer` keys document that invariant, they do
 * not switch it off. Declarations are therefore passed through as written and
 * discarded at evaluation time, so the selection trace can report how many were
 * dropped rather than losing them silently here.
 *
 * `enabled: false` is the one real switch: it withdraws the whole mechanism for
 * a vertical.
 */
/**
 * Refuse a declaration that promises behaviour the platform does not implement.
 *
 * A configuration option is a promise to whoever reads the YAML. Two were being
 * accepted and disregarded:
 *
 * `max_age_days` says a correction expires so a manual patch cannot outlive the
 * problem it fixed. Nothing expires: ADR-0002 records that enforcing it needs a
 * `declared_at` on each override entry, which the schema does not have and the
 * cascade does not read. Accepting the key means someone reads "365" and
 * believes an override lapses in a year when it never will. It is rejected
 * whether or not the mechanism is `enabled` — a promise left lying in a file is
 * still read.
 *
 * `requires_reason` and `requires_reviewer` are invariants, not switches: the
 * cascade discards an override with a blank reason or reviewer unconditionally.
 * Restating them as `true` is fine, and documents what happens. Writing `false`
 * declares an intention to publish unaccountable corrections; being silently
 * overruled is the right outcome reached the wrong way, because nobody is told
 * the file does not mean what it says.
 */
export function assertEditorialOverrideDeclarationIsHonest(config: VerticalConfig): void {
  const declaration: Yaml = config.factSelection?.editorial_override ?? {};

  if (declaration.max_age_days !== undefined) {
    throw new PipelineConfigurationError(
      'editorial_override.max_age_days is declared but cannot be enforced: override expiry ' +
        'needs a declared_at on each override entry, which the vertical schema does not have ' +
        'and the selection cascade does not read (ADR-0002). Remove the key rather than ' +
        'shipping an expiry that never expires.',
    );
  }

  // The declared reason is projected to every customer surface; the reviewer is
  // not, by contract (`packages/query-model/src/serialization.ts`). A reason
  // that names its own reviewer publishes the identity through the one field
  // documented never to carry it. Caught here, before a run can publish it —
  // `assertNoReviewerIdentity` guards the wire boundary as the second line.
  const declaredOverrides: Yaml[] = Array.isArray(declaration.overrides)
    ? declaration.overrides
    : [];
  for (const [index, entry] of declaredOverrides.entries()) {
    const reason = String(entry?.reason ?? '').toLowerCase();
    // Same token rule as the wire guard, imported rather than restated so the
    // two gates cannot drift into disagreeing about what counts as an identity.
    const tokens = reviewerIdentityTokens(String(entry?.reviewer ?? ''));
    if (!tokens.some((token) => reason.includes(token))) continue;
    // The identity is deliberately absent from the message: an error string
    // reaches logs and trackers, and a guard that leaks what it guards is
    // worse than none. The index locates the entry without repeating it.
    throw new PipelineConfigurationError(
      `editorial_override.overrides[${index}].reason names its own reviewer. The reason is ` +
        'customer-visible on every surface that renders a corrected value; the reviewer is not. ' +
        'Rewrite the reason so it explains the correction without identifying who made it — the ' +
        'reviewer stays in the audit record and in explainFact.',
    );
  }

  for (const key of ['requires_reason', 'requires_reviewer'] as const) {
    const value = declaration[key];
    if (value === undefined || value === true) continue;
    throw new PipelineConfigurationError(
      `editorial_override.${key} must be true or absent: it is an invariant of the selection ` +
        'cascade, not a switch. An override with no written reason and no named reviewer is ' +
        'discarded whatever this says, so a "false" here is a declaration the platform will ' +
        'not honour (ADR-0002).',
    );
  }
}

export function editorialOverrides(config: VerticalConfig): EditorialOverride[] {
  const declaration: Yaml = config.factSelection?.editorial_override ?? {};
  assertEditorialOverrideDeclarationIsHonest(config);
  if (declaration.enabled !== true) return [];
  const declared: Yaml[] = Array.isArray(declaration.overrides) ? declaration.overrides : [];

  return declared.map((entry: Yaml) => ({
    source: String(entry?.source ?? ''),
    reason: String(entry?.reason ?? ''),
    reviewer: String(entry?.reviewer ?? ''),
    ...(Array.isArray(entry?.properties)
      ? { properties: entry.properties.map((property: unknown) => String(property)) }
      : {}),
  }));
}

/**
 * Deterministic checks derived from `entities/*.yaml` `quality_rules`.
 *
 * Doc 04 step 5 is explicitly *deterministic*: bounds, enum membership, unit
 * sanity. A failing check demotes a claim in the cascade; it never deletes one.
 */
export function verticalConsistencyChecks(config: VerticalConfig): ConsistencyCheck[] {
  const checks: ConsistencyCheck[] = [];
  const seen = new Set<string>();

  for (const definition of Object.values(config.entities)) {
    for (const rule of (definition as Yaml)?.quality_rules ?? []) {
      const property = rule.property === undefined ? null : String(rule.property);
      if (property === null || rule.applies_to_alias === true) continue;

      if (String(rule.rule) === 'range') {
        const id = `range:${property}`;
        if (seen.has(id)) continue;
        seen.add(id);
        checks.push(
          numericRangeCheck(property as Identifier, {
            ...(typeof rule.min === 'number' ? { min: rule.min } : {}),
            ...(typeof rule.max === 'number' ? { max: rule.max } : {}),
          }),
        );
      }

      if (String(rule.rule) === 'enum' && Array.isArray(rule.values)) {
        const id = `enum:${property}`;
        if (seen.has(id)) continue;
        seen.add(id);
        checks.push(
          enumMembershipCheck(
            property as Identifier,
            rule.values.map((value: unknown) => String(value)),
          ),
        );
      }
    }

    for (const property of (definition as Yaml)?.properties ?? []) {
      if (!Array.isArray(property.enum)) continue;
      const id = `enum:${String(property.name)}`;
      if (seen.has(id)) continue;
      seen.add(id);
      checks.push(
        enumMembershipCheck(
          String(property.name) as Identifier,
          property.enum.map((value: unknown) => String(value)),
        ),
      );
    }
  }

  return checks;
}

/**
 * Field metadata for `@data-foundry/query-model`, read from `filters.yaml`.
 *
 * Facets, filters, sorting and search boosts are derived from this file so that
 * web, API and MCP cannot drift apart in what they consider filterable
 * (AGENTS.md rules 4 and 5).
 */
export function buildFieldMetadata(config: VerticalConfig): Yaml[] {
  const defaults: Yaml = config.filters?.defaults ?? {};
  return (config.filters?.fields ?? []).map((field: Yaml) => ({
    field: String(field.field),
    value_type: String(field.value_type),
    unit: field.unit === undefined || field.unit === null ? null : String(field.unit),
    filter:
      field.filter === undefined || field.filter === null
        ? null
        : {
            type: String(field.filter.type),
            facet_count: Boolean(field.filter.facet_count ?? defaults.facet_count ?? false),
          },
    sort: Boolean(field.sort ?? defaults.sort ?? false),
    search_boost: Number(field.search_boost ?? defaults.search_boost ?? 0),
    indexable: Boolean(field.indexable ?? defaults.indexable ?? true),
  }));
}
