/**
 * Doc 04 — "Fact selection / canonical view".
 *
 * The canonical value a user sees is *computed*, not stored. Doc 04 states the
 * precedence in bold and then, also in bold, states what not to do:
 *
 *   1. direct authoritative source
 *   2. source-specific reliability for that field
 *   3. recency
 *   4. corroboration
 *   5. deterministic consistency checks
 *   6. explicit editorial override
 *
 *   > "Do not simply use latest source wins."
 *
 * Recency is *third*. It is a tiebreaker between claims that an authoritative
 * source and a field-reliability weighting could not separate — never the first
 * question asked. This module implements those five source-derived criteria in
 * exactly that relative order.
 *
 * **ADR-0002 amends doc 04's sixth criterion.** Read literally, "explicit
 * editorial override" last means an override only fires once the five criteria
 * above it have tied — which is precisely the case where nothing needed
 * overriding. An editor could not correct a wrong value coming from an
 * authoritative source, so the override could not override. It now runs FIRST,
 * as criterion 0, and wins outright — but only when it is auditable:
 *
 *   * it is backed by its own evidence row (guaranteed by the eligibility
 *     pre-filter, which runs ahead of it and is not relaxed for it);
 *   * it carries a written REASON;
 *   * it carries a named REVIEWER.
 *
 * A declaration missing either is ignored entirely. It does not degrade into a
 * tiebreaker and it does not throw: an unauditable override is not a weaker
 * override, it is not an override. Two valid overrides competing for the same
 * property are likewise not a decision — the cascade falls through to the
 * ordinary criteria and says so in the trace.
 *
 * Two properties matter as much as the ordering itself:
 *
 *   * **Explainable.** Every run returns the ordered trace of which criteria
 *     were applied, which candidates survived each one, and which rule actually
 *     decided. The UI has to render a trust surface; "we picked this one" is
 *     not a trust surface.
 *   * **Non-destructive.** Losing claims are *retained* and reported as
 *     conflicts. Selection never deletes, merges or silently collapses a rival
 *     value (doc 04: "Do not overwrite conflicting facts prematurely").
 *
 * This file is pure: no SQL, no IO. The store loads candidates; this decides.
 */
import {
  canPublish,
  canonicalValuesEqual,
  type CanonicalValue,
  type Fact,
  type FactEvidence,
  type FactId,
  type Identifier,
  type IsoDateTime,
  type RightsClassification,
  type SourceArtifact,
  type SourceId,
  type SourceType,
} from '@data-foundry/canonical-schema';

/** Source metadata selection needs, denormalized onto each evidence row. */
export interface CandidateSourceInfo {
  readonly source_id: SourceId;
  readonly publisher: string;
  readonly domain: string;
  readonly source_type: SourceType;
  /** Field-independent trust weight, 0–100. Not a confidence score. */
  readonly authority_rank: number;
  readonly rights_classification: RightsClassification;
}

/** One evidence row with the source chain already resolved. */
export interface CandidateEvidence {
  readonly evidence: FactEvidence;
  readonly source: CandidateSourceInfo;
  readonly artifact: Pick<SourceArtifact, 'id' | 'url' | 'retrieved_at' | 'content_hash'>;
}

/** A stored fact version plus everything that backs it. */
export interface FactCandidate {
  readonly fact: Fact;
  readonly evidence: readonly CandidateEvidence[];
}

export const FACT_SELECTION_RULES = [
  /** Trace-only: the pre-filter that decides which claims may compete at all. */
  'ELIGIBILITY',
  /** Nothing survived eligibility. No canonical value is published. */
  'NO_ELIGIBLE_CANDIDATE',
  /** Exactly one eligible claim; no criterion needed to be applied. */
  'SOLE_ELIGIBLE_CANDIDATE',
  /** ADR-0002: an auditable staff correction, evaluated ahead of everything. */
  'EDITORIAL_OVERRIDE',
  'DIRECT_AUTHORITATIVE_SOURCE',
  'SOURCE_FIELD_RELIABILITY',
  'RECENCY',
  'CORROBORATION',
  'CONSISTENCY_CHECK',
  /** All six criteria tied. Stable, reproducible, and flagged as unresolved. */
  'DETERMINISTIC_TIEBREAK',
] as const;
export type FactSelectionRule = (typeof FACT_SELECTION_RULES)[number];

/**
 * The selection criteria in the order they are actually applied.
 *
 * Doc 04 lists the editorial override sixth; ADR-0002 moved it to the front
 * (see the module header for why). The five source-derived criteria keep doc
 * 04's relative order behind it. This constant is the order the code runs, not
 * the order a document once wished for — a precedence list that disagrees with
 * the cascade is worse than no list at all.
 */
export const DOC04_SELECTION_PRECEDENCE = [
  'EDITORIAL_OVERRIDE',
  'DIRECT_AUTHORITATIVE_SOURCE',
  'SOURCE_FIELD_RELIABILITY',
  'RECENCY',
  'CORROBORATION',
  'CONSISTENCY_CHECK',
] as const satisfies readonly FactSelectionRule[];

/**
 * Trust signals a selection can raise about itself that are *not* the deciding
 * rule and *not* an exclusion — states a consumer must be able to disclose even
 * though a perfectly ordinary value was published.
 *
 * A general channel rather than one boolean per condition: the next such state
 * (a stale override, a check that could not run) belongs in this list, not in a
 * new field that every consumer has to learn about separately.
 *
 * `AMBIGUOUS_EDITORIAL_INTENT` — two valid editorial overrides competed for one
 * property, so no override applied and the ordinary criteria decided. The value
 * is sound; the fact that staff disagreed about it is material and would
 * otherwise only be inferable by reading the trace text.
 */
export const SELECTION_WARNINGS = ['AMBIGUOUS_EDITORIAL_INTENT'] as const;
export type SelectionWarning = (typeof SELECTION_WARNINGS)[number];

export const CANDIDATE_EXCLUSION_REASONS = [
  'NO_EVIDENCE',
  'RETRACTED',
  'NOT_VALID_AT',
  'RIGHTS_BLOCKED',
] as const;
export type CandidateExclusionReason = (typeof CANDIDATE_EXCLUSION_REASONS)[number];

export interface ExcludedCandidate {
  readonly fact_id: FactId;
  readonly reason: CandidateExclusionReason;
  readonly detail: string;
}

/** One rung of the cascade, recorded whether or not it decided anything. */
export interface FactSelectionStep {
  readonly rule: FactSelectionRule;
  /** Did the criterion have any information to act on? */
  readonly applied: boolean;
  /** Did it reduce the pool to a single candidate? */
  readonly decided: boolean;
  readonly survivors: readonly FactId[];
  /** Human-readable, for the trust surface. */
  readonly detail: string;
}

/** A rival value that lost but was kept. */
export interface RetainedConflict {
  readonly value: CanonicalValue;
  readonly value_type: Fact['value_type'];
  readonly unit: string | null;
  readonly fact_ids: readonly FactId[];
  readonly claimed_by: readonly CandidateSourceInfo[];
  readonly last_observed_at: IsoDateTime | null;
}

/**
 * A declared editorial correction (ADR-0002).
 *
 * `source` is matched exactly like every other source key in this policy —
 * against a `source_id` or a `domain` — so an override is scoped to claims that
 * a specific editorial desk actually made and evidenced. It cannot conjure a
 * value that no source ever asserted.
 *
 * `reason` and `reviewer` are the audit contract. They are what a customer
 * disputing the value, or a regulator asking who changed it, is owed. Both are
 * required and must be non-empty after trimming; see
 * `isAuditableEditorialOverride`.
 */
export interface EditorialOverride {
  /** Source id or domain, matched like the other source keys in this policy. */
  readonly source: string;
  /** Why the correction was made. Required, non-empty after trim. */
  readonly reason: string;
  /** Who made it. Required, non-empty after trim. */
  readonly reviewer: string;
  /**
   * Restrict the override to specific properties. Omit to apply everywhere.
   * An explicitly EMPTY list restricts it to nothing, which is the fail-closed
   * reading of "these properties" when the list names none.
   */
  readonly properties?: readonly string[];
}

/** The winning override, recorded on the selection so the UI can render it. */
export interface EditorialCorrection {
  readonly source: string;
  readonly reason: string;
  readonly reviewer: string;
}

export interface FactSelection {
  readonly property: Identifier;
  readonly at: IsoDateTime;
  readonly selected: FactCandidate | null;
  readonly rule: FactSelectionRule;
  readonly reason: string;
  /** Ordered trace of the selection criteria plus eligibility. */
  readonly steps: readonly FactSelectionStep[];
  readonly considered: readonly FactId[];
  readonly excluded: readonly ExcludedCandidate[];
  /** Rival values, retained. Never collapsed away. */
  readonly conflicts: readonly RetainedConflict[];
  /** True when rivals remain after the winner was chosen. */
  readonly unresolved_conflict: boolean;
  /**
   * True when an auditable editorial override decided this selection. The
   * trust surface must be able to say "editorially corrected" out loud — a
   * staff correction that looks identical to a source-derived value is exactly
   * the thing a reader would want to have been told about.
   */
  readonly editorially_corrected: boolean;
  /** The override that won, or null. Non-null iff `editorially_corrected`. */
  readonly editorial_correction: EditorialCorrection | null;
  /**
   * Machine-readable trust warnings about HOW this value was selected, as
   * opposed to what was selected. A first-class field precisely so consumers
   * never have to string-match `steps[].detail` to learn something material.
   *
   * Deliberately a list rather than another boolean: future trust signals join
   * it without a breaking change to every consumer of this type.
   */
  readonly selection_warnings: readonly SelectionWarning[];
}

export interface ConsistencyCheckResult {
  readonly ok: boolean;
  readonly detail: string;
}

/**
 * A deterministic, non-LLM check. Doc 04 step 5 is explicitly *deterministic*:
 * unit sanity, range bounds, enum membership, type agreement. A model score is
 * not a consistency check.
 */
export interface ConsistencyCheck {
  readonly id: string;
  readonly describe: string;
  /** Restrict to specific properties; omit to apply everywhere. */
  readonly appliesTo?: (property: Identifier) => boolean;
  readonly check: (candidate: FactCandidate) => ConsistencyCheckResult;
}

export interface FactSelectionPolicy {
  readonly at: IsoDateTime;
  /** AGENTS.md rule 1: RED/UNREVIEWED evidence cannot back a published value. */
  readonly requirePublishableRights: boolean;
  /** Source types treated as speaking directly for their own data. */
  readonly authoritativeSourceTypes: readonly SourceType[];
  /** Per-property allow-list of source ids/domains that are authoritative for it. */
  readonly authoritativeSourcesByProperty: Readonly<Record<string, readonly string[]>>;
  /**
   * Per-property, per-source reliability in [0, 1] — doc 04 criterion 2. Keys
   * may be a source id or a domain. Falls back to `authority_rank / 100`.
   */
  readonly fieldReliability: Readonly<Record<string, Readonly<Record<string, number>>>>;
  /**
   * Declared editorial corrections (ADR-0002, criterion 0). Entries that are
   * not auditable are ignored at evaluation time rather than filtered here, so
   * that a compiled policy still round-trips what the vertical declared and the
   * trace can report how many declarations were discarded and why.
   */
  readonly editorialOverrides: readonly EditorialOverride[];
  readonly consistencyChecks: readonly ConsistencyCheck[];
}

export type FactSelectionPolicyInput = Partial<FactSelectionPolicy> &
  Pick<FactSelectionPolicy, 'at'>;

/**
 * Default "direct authoritative" source types: the publisher of record for the
 * thing being described. An aggregator repeating a manufacturer's spec is
 * evidence, but it is not the authority for it.
 */
export const DEFAULT_AUTHORITATIVE_SOURCE_TYPES = [
  'REGULATORY',
  'STANDARDS_BODY',
  'CERTIFICATION_BODY',
  'MANUFACTURER',
] as const satisfies readonly SourceType[];

export function resolveFactSelectionPolicy(input: FactSelectionPolicyInput): FactSelectionPolicy {
  return {
    at: input.at,
    requirePublishableRights: input.requirePublishableRights ?? true,
    authoritativeSourceTypes: input.authoritativeSourceTypes ?? DEFAULT_AUTHORITATIVE_SOURCE_TYPES,
    authoritativeSourcesByProperty: input.authoritativeSourcesByProperty ?? {},
    fieldReliability: input.fieldReliability ?? {},
    editorialOverrides: input.editorialOverrides ?? [],
    consistencyChecks: input.consistencyChecks ?? DEFAULT_CONSISTENCY_CHECKS,
  };
}

/* ------------------------------------------------------------------ *
 * Built-in deterministic consistency checks
 * ------------------------------------------------------------------ */

const isScalarArray = (value: CanonicalValue): value is (string | number | boolean | null)[] =>
  Array.isArray(value);

/** The stored `value_type` must actually describe the stored value. */
export const VALUE_TYPE_AGREEMENT_CHECK: ConsistencyCheck = {
  id: 'value_type_agreement',
  describe: 'normalized_value matches its declared value_type',
  check: ({ fact }) => {
    const value = fact.normalized_value;
    switch (fact.value_type) {
      case 'number':
      case 'quantity':
        return result(typeof value === 'number', `value_type=${fact.value_type}`);
      case 'integer':
        return result(typeof value === 'number' && Number.isInteger(value), 'expected an integer');
      case 'boolean':
        return result(typeof value === 'boolean', 'expected a boolean');
      case 'array':
        return result(isScalarArray(value), 'expected an array');
      case 'object':
        return result(
          typeof value === 'object' && value !== null && !Array.isArray(value),
          'expected an object',
        );
      case 'string':
      case 'date':
      case 'datetime':
      case 'enum':
      case 'url':
        return result(typeof value === 'string', `expected a string for ${fact.value_type}`);
    }
  },
};

/** A `quantity` without a unit is not a comparable quantity. */
export const QUANTITY_REQUIRES_UNIT_CHECK: ConsistencyCheck = {
  id: 'quantity_requires_unit',
  describe: 'quantity values carry a unit',
  check: ({ fact }) =>
    result(
      fact.value_type !== 'quantity' || (fact.unit !== null && fact.unit.length > 0),
      'quantity values must carry a unit',
    ),
};

/** A published claim should not be an empty string masquerading as a value. */
export const NON_EMPTY_VALUE_CHECK: ConsistencyCheck = {
  id: 'non_empty_value',
  describe: 'value is not empty',
  check: ({ fact }) => {
    const value = fact.normalized_value;
    if (typeof value === 'string') return result(value.trim().length > 0, 'empty string');
    if (isScalarArray(value)) return result(value.length > 0, 'empty array');
    return result(value !== null, 'null value');
  },
};

export const DEFAULT_CONSISTENCY_CHECKS: readonly ConsistencyCheck[] = [
  VALUE_TYPE_AGREEMENT_CHECK,
  QUANTITY_REQUIRES_UNIT_CHECK,
  NON_EMPTY_VALUE_CHECK,
];

/** Build a numeric bounds check from vertical field metadata. */
export function numericRangeCheck(
  property: Identifier,
  bounds: { readonly min?: number; readonly max?: number },
): ConsistencyCheck {
  const min = bounds.min ?? Number.NEGATIVE_INFINITY;
  const max = bounds.max ?? Number.POSITIVE_INFINITY;
  return {
    id: `numeric_range:${property}`,
    describe: `${property} within [${min}, ${max}]`,
    appliesTo: (candidateProperty) => candidateProperty === property,
    check: ({ fact }) => {
      const value = fact.normalized_value;
      if (typeof value !== 'number') return result(false, 'not numeric');
      return result(value >= min && value <= max, `${value} outside [${min}, ${max}]`);
    },
  };
}

/** Build an enum-membership check from vertical field metadata. */
export function enumMembershipCheck(
  property: Identifier,
  allowed: readonly string[],
): ConsistencyCheck {
  const permitted = new Set(allowed);
  return {
    id: `enum_membership:${property}`,
    describe: `${property} is one of ${allowed.join(', ')}`,
    appliesTo: (candidateProperty) => candidateProperty === property,
    check: ({ fact }) => {
      const value = fact.normalized_value;
      if (typeof value !== 'string') return result(false, 'not a string');
      return result(permitted.has(value), `"${value}" is not an allowed value`);
    },
  };
}

function result(ok: boolean, detail: string): ConsistencyCheckResult {
  return { ok, detail: ok ? 'ok' : detail };
}

/* ------------------------------------------------------------------ *
 * Scoring helpers
 * ------------------------------------------------------------------ */

const epoch = (iso: IsoDateTime | null): number => (iso === null ? 0 : Date.parse(iso));

/** Stable key for grouping equal values; `canonicalValuesEqual` is the arbiter. */
function valueGroups(candidates: readonly FactCandidate[]): FactCandidate[][] {
  const groups: FactCandidate[][] = [];
  for (const candidate of candidates) {
    const group = groups.find((existing) => {
      const head = existing[0];
      return (
        head !== undefined &&
        head.fact.value_type === candidate.fact.value_type &&
        head.fact.unit === candidate.fact.unit &&
        canonicalValuesEqual(head.fact.normalized_value, candidate.fact.normalized_value)
      );
    });
    if (group === undefined) groups.push([candidate]);
    else group.push(candidate);
  }
  return groups;
}

function usableEvidence(
  candidate: FactCandidate,
  policy: FactSelectionPolicy,
): readonly CandidateEvidence[] {
  if (!policy.requirePublishableRights) return candidate.evidence;
  return candidate.evidence.filter((item) => canPublish(item.source.rights_classification));
}

function sourcesOf(candidate: FactCandidate, policy: FactSelectionPolicy): CandidateSourceInfo[] {
  const seen = new Map<string, CandidateSourceInfo>();
  for (const item of usableEvidence(candidate, policy)) {
    seen.set(item.source.source_id, item.source);
  }
  return [...seen.values()];
}

function latestObservedAt(
  candidate: FactCandidate,
  policy: FactSelectionPolicy,
): IsoDateTime | null {
  let latest: IsoDateTime | null = null;
  for (const item of usableEvidence(candidate, policy)) {
    if (latest === null || epoch(item.evidence.observed_at) > epoch(latest)) {
      latest = item.evidence.observed_at;
    }
  }
  return latest;
}

function matchesSourceKey(source: CandidateSourceInfo, keys: readonly string[]): boolean {
  return keys.includes(source.source_id) || keys.includes(source.domain);
}

function isDirectAuthoritative(
  candidate: FactCandidate,
  policy: FactSelectionPolicy,
  property: Identifier,
): boolean {
  const perProperty = policy.authoritativeSourcesByProperty[property];
  const sources = sourcesOf(candidate, policy);
  if (perProperty !== undefined && perProperty.length > 0) {
    return sources.some((source) => matchesSourceKey(source, perProperty));
  }
  return sources.some((source) => policy.authoritativeSourceTypes.includes(source.source_type));
}

function reliabilityScore(
  candidate: FactCandidate,
  policy: FactSelectionPolicy,
  property: Identifier,
): number {
  const table = policy.fieldReliability[property] ?? {};
  let best = Number.NEGATIVE_INFINITY;
  for (const source of sourcesOf(candidate, policy)) {
    const explicit = table[source.source_id] ?? table[source.domain];
    const score = explicit ?? source.authority_rank / 100;
    if (score > best) best = score;
  }
  return best;
}

const filled = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

/**
 * Is this declaration auditable enough to be allowed to overrule an
 * authoritative source? A missing reason or reviewer means nobody can be asked
 * "why?" or "who?" later, which is the entire justification for letting staff
 * outrank a publisher of record. Fails closed, and never throws: a malformed
 * declaration (including one arriving untyped from YAML) is simply not one.
 */
export function isAuditableEditorialOverride(override: EditorialOverride): boolean {
  return (
    override !== null &&
    typeof override === 'object' &&
    filled(override.source) &&
    filled(override.reason) &&
    filled(override.reviewer)
  );
}

function overrideCoversProperty(override: EditorialOverride, property: Identifier): boolean {
  return override.properties === undefined || override.properties.includes(property);
}

/** Identity of a declaration, so a duplicated config entry is not a rival. */
const overrideKey = (override: EditorialOverride): string =>
  JSON.stringify([
    override.source.trim(),
    override.reason.trim(),
    override.reviewer.trim(),
    override.properties === undefined ? null : [...override.properties].sort(),
  ]);

function claimsOverride(candidate: FactCandidate, policy: FactSelectionPolicy, override: EditorialOverride): boolean {
  // `sourcesOf` only reports rights-usable evidence, so an override cannot
  // launder a RED/UNREVIEWED claim into publication (AGENTS.md rule 1).
  return sourcesOf(candidate, policy).some((source) => matchesSourceKey(source, [override.source]));
}

function failedChecks(
  candidate: FactCandidate,
  policy: FactSelectionPolicy,
  property: Identifier,
): ConsistencyCheck[] {
  return policy.consistencyChecks.filter((check) => {
    if (check.appliesTo !== undefined && !check.appliesTo(property)) return false;
    return !check.check(candidate).ok;
  });
}

const ids = (candidates: readonly FactCandidate[]): FactId[] =>
  candidates.map((candidate) => candidate.fact.id);

/**
 * Reproducibility beats arbitrariness: whenever the algorithm must pick one of
 * several indistinguishable claims, it picks the same one every time.
 */
const byRecordedThenId = (left: FactCandidate, right: FactCandidate): number => {
  const byRecorded = Date.parse(right.fact.recorded_at) - Date.parse(left.fact.recorded_at);
  return byRecorded !== 0 ? byRecorded : left.fact.id.localeCompare(right.fact.id);
};

/** Argmax over a pool, keeping every candidate tied at the best score. */
function argmax(
  pool: readonly FactCandidate[],
  score: (candidate: FactCandidate) => number,
): { readonly best: number; readonly winners: FactCandidate[] } {
  let best = Number.NEGATIVE_INFINITY;
  for (const candidate of pool) {
    const value = score(candidate);
    if (value > best) best = value;
  }
  return { best, winners: pool.filter((candidate) => score(candidate) === best) };
}

/* ------------------------------------------------------------------ *
 * The algorithm
 * ------------------------------------------------------------------ */

/**
 * Run the doc-04 cascade over every claim about one `(entity, property)`.
 *
 * Eligibility is applied first and is *not* one of the six criteria: a claim
 * with no evidence (rule 2), a retracted claim, a claim outside its validity
 * window at `at`, or a claim backed only by RED/UNREVIEWED sources (rule 1)
 * never enters the contest. Exclusions are reported, not hidden.
 */
export function selectCanonicalFact(
  property: Identifier,
  candidates: readonly FactCandidate[],
  policyInput: FactSelectionPolicyInput,
): FactSelection {
  const policy = resolveFactSelectionPolicy(policyInput);
  const at = policy.at;
  const atMs = Date.parse(at);

  const excluded: ExcludedCandidate[] = [];
  const eligible: FactCandidate[] = [];

  for (const candidate of candidates) {
    const { fact } = candidate;
    if (fact.status === 'RETRACTED') {
      excluded.push({ fact_id: fact.id, reason: 'RETRACTED', detail: 'fact is RETRACTED' });
      continue;
    }
    const from = Date.parse(fact.valid_from);
    const to = fact.valid_to === null ? Number.POSITIVE_INFINITY : Date.parse(fact.valid_to);
    if (atMs < from || atMs >= to) {
      excluded.push({
        fact_id: fact.id,
        reason: 'NOT_VALID_AT',
        detail: `validity [${fact.valid_from}, ${fact.valid_to ?? '∞'}) does not contain ${at}`,
      });
      continue;
    }
    if (candidate.evidence.length === 0) {
      excluded.push({
        fact_id: fact.id,
        reason: 'NO_EVIDENCE',
        detail: 'no fact_evidence rows (AGENTS.md rule 2)',
      });
      continue;
    }
    if (usableEvidence(candidate, policy).length === 0) {
      excluded.push({
        fact_id: fact.id,
        reason: 'RIGHTS_BLOCKED',
        detail: 'every backing source is RED or UNREVIEWED (AGENTS.md rule 1)',
      });
      continue;
    }
    eligible.push(candidate);
  }

  const considered = ids(candidates);
  const steps: FactSelectionStep[] = [
    {
      rule: 'ELIGIBILITY',
      applied: true,
      decided: false,
      survivors: ids(eligible),
      detail:
        `${eligible.length} of ${candidates.length} claim(s) eligible ` +
        `(evidenced, valid at ${at}, rights-clear).`,
    },
  ];

  if (eligible.length === 0) {
    return {
      property,
      at,
      selected: null,
      rule: 'NO_ELIGIBLE_CANDIDATE',
      reason:
        'No claim about this property is publishable: every candidate was retracted, out of its ' +
        'validity window, unevidenced, or backed only by RED/UNREVIEWED sources.',
      steps,
      considered,
      excluded,
      conflicts: [],
      unresolved_conflict: false,
      editorially_corrected: false,
      editorial_correction: null,
      selection_warnings: [],
    };
  }

  if (eligible.length === 1) {
    // Nothing to override: with one surviving claim there is no rival value for
    // an editorial correction to correct, so this path is never labelled.
    const sole = eligible[0] as FactCandidate;
    return finish(
      property,
      at,
      sole,
      'SOLE_ELIGIBLE_CANDIDATE',
      'Exactly one evidenced, rights-clear claim exists, so no selection criterion was needed.',
      steps,
      considered,
      excluded,
      eligible,
      policy,
      null,
    );
  }

  let pool: FactCandidate[] = [...eligible];
  let decidedBy: FactSelectionRule | null = null;
  let reason = '';
  let correction: EditorialCorrection | null = null;
  const warnings: SelectionWarning[] = [];

  // ---- 0. explicit editorial override — the trump card (ADR-0002) --------
  {
    const declared = policy.editorialOverrides;
    const auditable = declared.filter(isAuditableEditorialOverride);
    const ignored = declared.length - auditable.length;

    // Deduplicated: the same declaration written twice is one editorial
    // intent, not two rivals.
    const applicable = new Map<string, EditorialOverride>();
    for (const override of auditable) {
      if (overrideCoversProperty(override, property)) applicable.set(overrideKey(override), override);
    }

    const matched = [...applicable.values()]
      .map((override) => ({
        override,
        candidates: pool.filter((candidate) => claimsOverride(candidate, policy, override)),
      }))
      .filter((match) => match.candidates.length > 0);

    // Two desks overriding the same field, or one desk's override standing
    // behind two different values, is ambiguous editorial intent. Picking one
    // would be inventing an editorial decision nobody made.
    const only = matched.length === 1 ? matched[0] : undefined;
    const ambiguous = matched.length > 1 || (only !== undefined && valueGroups(only.candidates).length > 1);
    const winner = only === undefined || ambiguous ? undefined : [...only.candidates].sort(byRecordedThenId)[0];

    // Contradictory editorial intent is material trust information even though
    // no correction was applied, so it travels as a first-class warning rather
    // than being left inferable only from the step detail below.
    if (ambiguous) warnings.push('AMBIGUOUS_EDITORIAL_INTENT');

    const ignoredNote =
      ignored === 0
        ? ''
        : ` ${ignored} declaration(s) ignored: an override without a written reason and a named ` +
          'reviewer is not auditable, and an unauditable override is not an override.';

    steps.push({
      rule: 'EDITORIAL_OVERRIDE',
      applied: matched.length > 0,
      decided: winner !== undefined,
      survivors: ids(winner === undefined ? pool : [winner]),
      detail:
        (matched.length === 0
          ? 'No auditable editorial override applies to this field.'
          : ambiguous
            ? `${matched.length} competing editorial override(s) claim this field. Ambiguous ` +
              'editorial intent decides nothing, so the ordinary criteria were applied instead.'
            : 'An auditable editorial override applies to this field and outranks every ' +
              'source-derived criterion.') + ignoredNote,
    });

    if (only !== undefined && winner !== undefined) {
      pool = [winner];
      decidedBy = 'EDITORIAL_OVERRIDE';
      correction = {
        source: only.override.source,
        reason: only.override.reason.trim(),
        reviewer: only.override.reviewer.trim(),
      };
      // `reason` is projected verbatim onto the customer-facing
      // `CanonicalFactView`, so it must carry the PUBLIC explanation only. The
      // reviewer's identity stays in `correction.reviewer`, which `explainFact`
      // and the audit record expose and the query view deliberately does not.
      reason =
        `${describeWinner(winner, policy, 'carries an explicit editorial override, which outranks every source-derived criterion')} ` +
        `Editorially corrected: ${correction.reason}`;
    }
  }

  // ---- 1. direct authoritative source -----------------------------------
  if (decidedBy === null) {
    const authoritative = pool.filter((candidate) =>
      isDirectAuthoritative(candidate, policy, property),
    );
    const applied = authoritative.length > 0 && authoritative.length < pool.length;
    const survivors = authoritative.length > 0 ? authoritative : pool;
    const decided = applied && authoritative.length === 1;
    steps.push({
      rule: 'DIRECT_AUTHORITATIVE_SOURCE',
      applied,
      decided,
      survivors: ids(survivors),
      detail:
        authoritative.length === 0
          ? 'No claim comes from a source that is authoritative for this field.'
          : `${authoritative.length} claim(s) come directly from an authoritative source ` +
            `(${policy.authoritativeSourceTypes.join(', ')} or a per-field allow-list).`,
    });
    pool = [...survivors];
    if (decided) {
      decidedBy = 'DIRECT_AUTHORITATIVE_SOURCE';
      reason = describeWinner(pool[0] as FactCandidate, policy, 'is the only claim made directly by an authoritative source for this field');
    }
  }

  // ---- 2. source-specific reliability for that field ---------------------
  if (decidedBy === null) {
    const { best, winners } = argmax(pool, (candidate) =>
      reliabilityScore(candidate, policy, property),
    );
    const applied = winners.length < pool.length;
    const decided = applied && winners.length === 1;
    steps.push({
      rule: 'SOURCE_FIELD_RELIABILITY',
      applied,
      decided,
      survivors: ids(winners),
      detail: `Best per-field source reliability is ${best.toFixed(3)}; ${winners.length} claim(s) hold it.`,
    });
    pool = winners;
    if (decided) {
      decidedBy = 'SOURCE_FIELD_RELIABILITY';
      reason = describeWinner(
        pool[0] as FactCandidate,
        policy,
        `has the highest reliability for "${property}" (${best.toFixed(3)})`,
      );
    }
  }

  // ---- 3. recency --------------------------------------------------------
  if (decidedBy === null) {
    const { best, winners } = argmax(pool, (candidate) =>
      epoch(latestObservedAt(candidate, policy)),
    );
    const applied = winners.length < pool.length;
    const decided = applied && winners.length === 1;
    const bestIso = Number.isFinite(best) && best > 0 ? new Date(best).toISOString() : 'unknown';
    steps.push({
      rule: 'RECENCY',
      applied,
      decided,
      survivors: ids(winners),
      detail: `Most recent supporting observation is ${bestIso}; ${winners.length} claim(s) share it.`,
    });
    pool = winners;
    if (decided) {
      decidedBy = 'RECENCY';
      reason = describeWinner(
        pool[0] as FactCandidate,
        policy,
        `was observed most recently (${bestIso}) among claims that authority and reliability could not separate`,
      );
    }
  }

  // ---- 4. corroboration --------------------------------------------------
  if (decidedBy === null) {
    // Corroboration is a property of the *value*, not of one row: two sources
    // asserting the same value corroborate each other even when they were
    // recorded as separate claims.
    const groups = valueGroups(pool);
    const corroborationOf = (candidate: FactCandidate): number => {
      const group = groups.find((members) => members.includes(candidate)) ?? [candidate];
      const distinct = new Set<string>();
      for (const member of group) {
        for (const source of sourcesOf(member, policy)) distinct.add(source.source_id);
      }
      return distinct.size;
    };
    const { best, winners } = argmax(pool, corroborationOf);
    const applied = winners.length < pool.length;
    const decided = applied && winners.length === 1;
    steps.push({
      rule: 'CORROBORATION',
      applied,
      decided,
      survivors: ids(winners),
      detail: `Best-corroborated value has ${best} independent source(s); ${winners.length} claim(s) hold it.`,
    });
    pool = winners;
    if (decided) {
      decidedBy = 'CORROBORATION';
      reason = describeWinner(
        pool[0] as FactCandidate,
        policy,
        `is corroborated by ${best} independent source(s), more than any rival value`,
      );
    }
  }

  // ---- 5. deterministic consistency checks -------------------------------
  if (decidedBy === null) {
    const passing = pool.filter((candidate) => failedChecks(candidate, policy, property).length === 0);
    const applied = passing.length > 0 && passing.length < pool.length;
    const survivors = passing.length > 0 ? passing : pool;
    const decided = applied && passing.length === 1;
    steps.push({
      rule: 'CONSISTENCY_CHECK',
      applied,
      decided,
      survivors: ids(survivors),
      detail:
        passing.length === 0
          ? 'Every remaining claim fails at least one deterministic check; none could be eliminated.'
          : `${pool.length - passing.length} claim(s) failed a deterministic check and were dropped.`,
    });
    pool = [...survivors];
    if (decided) {
      decidedBy = 'CONSISTENCY_CHECK';
      reason = describeWinner(
        pool[0] as FactCandidate,
        policy,
        'is the only remaining claim that passes every deterministic consistency check',
      );
    }
  }

  if (decidedBy === null) {
    // Reproducibility beats arbitrariness: the same inputs must always publish
    // the same value, and the tie is surfaced rather than papered over.
    pool = [...pool].sort(byRecordedThenId);
    decidedBy = 'DETERMINISTIC_TIEBREAK';
    reason =
      'Every selection criterion tied. Selected deterministically by most recent recorded_at, then ' +
      'by fact id, so the published value is reproducible. The tie is reported as an unresolved conflict.';
    steps.push({
      rule: 'DETERMINISTIC_TIEBREAK',
      applied: true,
      decided: true,
      survivors: ids(pool).slice(0, 1),
      detail: `${pool.length} claim(s) remained tied after every criterion.`,
    });
  }

  return finish(
    property,
    at,
    pool[0] as FactCandidate,
    decidedBy,
    reason,
    steps,
    considered,
    excluded,
    eligible,
    policy,
    correction,
    warnings,
  );
}

function describeWinner(
  candidate: FactCandidate,
  policy: FactSelectionPolicy,
  clause: string,
): string {
  const publishers = sourcesOf(candidate, policy)
    .map((source) => source.publisher)
    .join(', ');
  return `Selected the value claimed by ${publishers || 'an unnamed source'} because it ${clause}.`;
}

function finish(
  property: Identifier,
  at: IsoDateTime,
  selected: FactCandidate,
  rule: FactSelectionRule,
  reason: string,
  steps: readonly FactSelectionStep[],
  considered: readonly FactId[],
  excluded: readonly ExcludedCandidate[],
  eligible: readonly FactCandidate[],
  policy: FactSelectionPolicy,
  correction: EditorialCorrection | null,
  warnings: readonly SelectionWarning[] = [],
): FactSelection {
  const conflicts: RetainedConflict[] = [];
  for (const group of valueGroups(eligible)) {
    const head = group[0];
    if (head === undefined) continue;
    if (
      head.fact.value_type === selected.fact.value_type &&
      head.fact.unit === selected.fact.unit &&
      canonicalValuesEqual(head.fact.normalized_value, selected.fact.normalized_value)
    ) {
      continue;
    }
    const claimedBy = new Map<string, CandidateSourceInfo>();
    let lastObserved: IsoDateTime | null = null;
    for (const member of group) {
      for (const source of sourcesOf(member, policy)) claimedBy.set(source.source_id, source);
      const observed = latestObservedAt(member, policy);
      if (observed !== null && (lastObserved === null || epoch(observed) > epoch(lastObserved))) {
        lastObserved = observed;
      }
    }
    conflicts.push({
      value: head.fact.normalized_value,
      value_type: head.fact.value_type,
      unit: head.fact.unit,
      fact_ids: ids(group),
      claimed_by: [...claimedBy.values()],
      last_observed_at: lastObserved,
    });
  }

  return {
    property,
    at,
    selected,
    rule,
    reason,
    steps,
    considered,
    excluded,
    conflicts,
    unresolved_conflict: conflicts.length > 0,
    editorially_corrected: correction !== null,
    editorial_correction: correction,
    selection_warnings: warnings,
  };
}
