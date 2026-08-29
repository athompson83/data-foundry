/**
 * When a source is next due, and — more importantly — when it is not.
 *
 * `refresh_cadence` has been declared on every source since the registry
 * existed, and until now nothing read it. Ingestion ran when a person typed
 * `pnpm ingest`. That is why this file exists: "stays up to date" is a claim
 * about a clock, and there was no clock.
 *
 * ## Why this lives in `acquisition`
 *
 * Because deciding *when* to fetch and deciding *whether we may* are the same
 * question asked twice, and answering them in different packages is how they
 * drift. A scheduler that kept its own list of acquirable statuses would
 * eventually schedule something `evaluateAcquisitionGate` refuses — and it would
 * do it unattended, on a timer, repeatedly, which is the worst place for a
 * rights bug to live. So this module does not restate the rule. It calls the
 * gate, and a source the gate refuses is never due.
 *
 * ## It decides, it does not act
 *
 * Nothing here fetches, writes or schedules anything. It is a pure function
 * from (sources, last acquisition, now) to an ordered list of decisions, so the
 * policy is testable without a database, a network or a fake timer — and so the
 * runner that eventually executes it has no policy of its own to get wrong.
 */
import type {
  AcquisitionMethod,
  RefreshCadence,
  RefreshPolicy,
  RightsAssetClass,
  RightsOutputClass,
} from '@data-foundry/canonical-schema';
import { compareCodeUnits } from '@data-foundry/canonical-schema';
import type { SourceRegistryEntry } from '@data-foundry/source-registry';
import { evaluateAcquisitionGate } from './rights-gate.js';

/**
 * Hours between acquisitions, per cadence.
 *
 * `MANUAL` and `EVENT_DRIVEN` are deliberately absent rather than mapped to a
 * large number. They do not mean "rarely"; they mean *a clock is not what
 * decides this*. MANUAL is a person's judgement and EVENT_DRIVEN is an external
 * trigger, so giving either an interval would quietly convert a declaration
 * into a timer — which is precisely the bug this module exists to avoid.
 *
 * Months and years are approximated in hours on purpose. This schedules
 * re-acquisition; it is not a calendar. A quarterly source fetched 91 days
 * later rather than on the quarter boundary is behaving correctly, and pulling
 * in date arithmetic to pretend otherwise would buy nothing.
 */
const CADENCE_HOURS: Partial<Record<RefreshCadence, number>> = {
  HOURLY: 1,
  DAILY: 24,
  WEEKLY: 24 * 7,
  MONTHLY: 24 * 30,
  QUARTERLY: 24 * 91,
  ANNUALLY: 24 * 365,
};

export const CLOCK_DRIVEN_CADENCES: readonly RefreshCadence[] = Object.keys(
  CADENCE_HOURS,
) as RefreshCadence[];

/** Is this cadence something a scheduler may act on at all? */
export function isClockDriven(cadence: RefreshCadence): boolean {
  return CADENCE_HOURS[cadence] !== undefined;
}

/**
 * How far in the future a recorded acquisition may sit before it is disbelieved.
 *
 * Small skew between a writer's clock and ours is ordinary and means the source
 * was just acquired. A timestamp hours ahead is not skew, it is corrupt data —
 * a timezone bug, a bad backfill — and believing it parks the source as
 * never-due forever, silently, which is the same stall the unparseable case
 * already guards against.
 */
const FUTURE_TOLERANCE_HOURS = 1;

export type RefreshSkipReason =
  /** MANUAL or EVENT_DRIVEN: a clock is not what decides this source. */
  | 'NOT_CLOCK_DRIVEN'
  /** The acquisition gate refuses it — rights, status, kill switch, robots. */
  | 'NOT_ACQUIRABLE'
  /** Exact ACQUIRE + STORE + CACHE admission is absent, incomplete, denied or for another scope. */
  | 'RIGHTS_MATRIX_REFUSED'
  /** Acquired recently enough that the cadence has not elapsed. */
  | 'NOT_YET_DUE';

export const REFRESH_ADMISSION_OPERATIONS = ['ACQUIRE', 'STORE', 'CACHE'] as const;
export type RefreshAdmissionOperation = (typeof REFRESH_ADMISSION_OPERATIONS)[number];

export interface RefreshAdmissionDecision {
  readonly permitted: boolean;
  readonly reasonCode: string;
}

/**
 * A trusted composition layer evaluates the rights matrix and binds its result
 * to the exact acquisition request before calling this pure planner.
 *
 * The common scope is repeated here deliberately. A valid grant evaluated for
 * a neighboring source, route, account/product plan, jurisdiction or target
 * must not be reusable merely because its three decisions happen to say ALLOW.
 */
export interface RefreshAdmission {
  readonly sourceId: string;
  readonly sourceKey: string;
  readonly targetId: string;
  readonly targetUrl: string;
  readonly acquisitionRoute: AcquisitionMethod;
  readonly accountOrProductPlan: string | null;
  readonly jurisdiction: string | null;
  readonly channel: 'INTERNAL_PROCESSING';
  readonly assetClass: RightsAssetClass;
  readonly outputClass: RightsOutputClass;
  readonly fieldKey: null;
  /** Must equal the schedule instant so an expired or future decision cannot be replayed. */
  readonly evaluatedAt: string;
  readonly decisions: Readonly<Record<RefreshAdmissionOperation, RefreshAdmissionDecision>>;
}

export interface RefreshCandidate {
  readonly entry: SourceRegistryEntry;
  /** Canonical source identity against which the rights admission was evaluated. */
  readonly sourceId: string;
  /** Stable identity for one target. A source may expose more than one target. */
  readonly targetId: string;
  /** The real request target. Never replace this with a synthesized origin root. */
  readonly targetUrl: string;
  readonly assetClass: RefreshAdmission['assetClass'];
  readonly outputClass: RefreshAdmission['outputClass'];
  /** Methods the selected provider actually implements. Empty fails closed. */
  readonly providerMethods: readonly AcquisitionMethod[];
  /** Missing or malformed admission is refusal, including for GREEN and AMBER. */
  readonly admission?: RefreshAdmission | null;
  /**
   * When this source last produced an artifact, or `null` if it never has.
   *
   * Null is "never acquired", which is due — but see `overdueHours`, which does
   * not report infinity for it.
   */
  readonly lastAcquiredAt: string | null;
}

export interface RefreshDecision {
  readonly sourceKey: string;
  readonly targetId: string;
  readonly due: boolean;
  readonly reason:
    | RefreshSkipReason
    | 'DUE'
    | 'NEVER_ACQUIRED'
    /** The recorded time is unparseable or implausibly ahead — refresh and replace it. */
    | 'UNTRUSTED_TIMESTAMP'
    | 'STALE';
  /**
   * How far past its cadence this source is, in hours. `0` when not due.
   *
   * Never negative and never infinite. A source that has never been acquired
   * reports `0` and is ranked by `STALE`/`NEVER_ACQUIRED` instead: ordering by
   * "most overdue" would otherwise put it at infinity and starve every source
   * that has a real, finite backlog.
   */
  readonly overdueHours: number;
  /**
   * Past the point the vertical's policy considers acceptable, not merely due.
   *
   * Cadence is the plan; `max_staleness_hours` is the alarm. They can disagree —
   * a DAILY source under a policy that tolerates 720 hours is due long before it
   * is stale — and conflating them would lose the distinction between "time to
   * refresh" and "this data should no longer be trusted".
   */
  readonly stale: boolean;
  readonly priority: number;
}

export interface RefreshScheduleInput {
  readonly candidates: readonly RefreshCandidate[];
  /** The vertical's default policy. Supplies staleness and priority. */
  readonly policy: RefreshPolicy;
  readonly now: string;
}

const MS_PER_HOUR = 3_600_000;

function hoursBetween(fromIso: string, toIso: string): number | null {
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  if (Number.isNaN(from) || Number.isNaN(to)) return null;
  return (to - from) / MS_PER_HOUR;
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

function admissionAllows(
  candidate: RefreshCandidate,
  input: RefreshScheduleInput,
): boolean {
  const admission: unknown = candidate.admission;
  if (!isRecord(admission) || candidate.sourceId.trim() === '') return false;
  if (
    admission['sourceId'] !== candidate.sourceId ||
    admission['sourceKey'] !== candidate.entry.key ||
    admission['targetId'] !== candidate.targetId ||
    admission['targetUrl'] !== candidate.targetUrl ||
    admission['acquisitionRoute'] !== candidate.entry.acquisition_policy.method ||
    admission['accountOrProductPlan'] !==
      candidate.entry.acquisition_policy.account_or_product_plan ||
    admission['jurisdiction'] !== candidate.entry.acquisition_policy.jurisdiction ||
    admission['channel'] !== 'INTERNAL_PROCESSING' ||
    admission['assetClass'] !== candidate.assetClass ||
    admission['outputClass'] !== candidate.outputClass ||
    admission['fieldKey'] !== null ||
    admission['evaluatedAt'] !== input.now
  ) {
    return false;
  }

  const decisions = admission['decisions'];
  if (!isRecord(decisions)) return false;
  return REFRESH_ADMISSION_OPERATIONS.every((operation) => {
    const decision = decisions[operation];
    return (
      isRecord(decision) &&
      decision['permitted'] === true &&
      (decision['reasonCode'] === 'ALLOW' || decision['reasonCode'] === 'CONDITIONAL_ALLOW')
    );
  });
}

/**
 * Decide every candidate. Pure; the caller acts on the result or does not.
 *
 * Returned in the order they should run: stale first, then most overdue, then
 * higher priority, then by key. That last tiebreak is not cosmetic — a
 * scheduler whose order varies between identical runs makes an incident
 * impossible to reproduce.
 */
export function planRefresh(input: RefreshScheduleInput): RefreshDecision[] {
  const decisions = input.candidates.map((candidate) => decide(candidate, input));

  return [...decisions].sort((a, b) => {
    if (a.due !== b.due) return a.due ? -1 : 1;
    if (a.stale !== b.stale) return a.stale ? -1 : 1;
    if (a.reason !== b.reason) {
      // A source never acquired outranks one merely overdue: it has no data at
      // all, so every downstream question about it is unanswerable.
      const rank = (reason: RefreshDecision['reason']): number =>
        reason === 'NEVER_ACQUIRED' ? 0 : 1;
      const difference = rank(a.reason) - rank(b.reason);
      if (difference !== 0) return difference;
    }
    if (a.overdueHours !== b.overdueHours) return b.overdueHours - a.overdueHours;
    if (a.priority !== b.priority) return b.priority - a.priority;
    const sourceOrder = compareCodeUnits(a.sourceKey, b.sourceKey);
    return sourceOrder === 0 ? compareCodeUnits(a.targetId, b.targetId) : sourceOrder;
  });
}

function decide(candidate: RefreshCandidate, input: RefreshScheduleInput): RefreshDecision {
  const { entry } = candidate;
  const base = {
    sourceKey: entry.key as string,
    targetId: candidate.targetId,
    overdueHours: 0,
    stale: false,
    priority: input.policy.priority,
  };

  // 1. A cadence that is not a clock is not this module's business.
  if (!isClockDriven(entry.refresh_cadence)) {
    return { ...base, due: false, reason: 'NOT_CLOCK_DRIVEN' };
  }

  // 2. The gate decides acquirability, not a second copy of its rules here.
  //    A source it refuses is never due, however overdue the clock says it is:
  //    an unattended timer is the last place rule 1 should be re-litigated.
  const gate = evaluateAcquisitionGate({
    entry,
    url: candidate.targetUrl,
    asOf: input.now,
    providerMethods: Array.isArray(candidate.providerMethods) ? candidate.providerMethods : [],
  });
  if (!gate.allowed) {
    return { ...base, due: false, reason: 'NOT_ACQUIRABLE' };
  }

  // 3. Classification is only a coarse stop. Exact matrix admission is the
  //    permission, and ACQUIRE, STORE and CACHE are independent requirements.
  if (!admissionAllows(candidate, input)) {
    return { ...base, due: false, reason: 'RIGHTS_MATRIX_REFUSED' };
  }

  // 4. Never acquired is due, and is ranked ahead of a finite backlog.
  if (candidate.lastAcquiredAt === null) {
    return { ...base, due: true, reason: 'NEVER_ACQUIRED', stale: true };
  }

  const elapsed = hoursBetween(candidate.lastAcquiredAt, input.now);

  // A recorded time we cannot trust is not evidence of freshness, and there are
  // two ways to get one. Unparseable is the obvious one. The other is a
  // timestamp implausibly in the FUTURE, which is worse precisely because it
  // parses: every comparison below then says "not yet due", forever, and
  // nothing reports that the source stopped refreshing. Mutation testing found
  // this — clamping a negative age to zero changed no outcome, because a
  // negative age was already never due.
  if (elapsed === null || elapsed < -FUTURE_TOLERANCE_HOURS) {
    return { ...base, due: true, reason: 'UNTRUSTED_TIMESTAMP', stale: true };
  }

  // Within tolerance, a future timestamp is ordinary clock skew: the source was
  // just acquired. Clamp so it reads as an age of zero rather than a negative.
  const age = Math.max(0, elapsed);
  const interval = CADENCE_HOURS[entry.refresh_cadence] as number;
  const stale = age >= input.policy.max_staleness_hours;

  if (age < interval && !stale) {
    return { ...base, due: false, reason: 'NOT_YET_DUE' };
  }

  return {
    ...base,
    due: true,
    reason: stale ? 'STALE' : 'DUE',
    overdueHours: Math.max(0, age - interval),
    stale,
  };
}

/** The sources to run, in order. Sugar over `planRefresh` for a caller that only wants those. */
export function dueSources(input: RefreshScheduleInput): RefreshDecision[] {
  return planRefresh(input).filter((decision) => decision.due);
}
