import { publishDecision, RightsViolationError } from '@data-foundry/canonical-schema';
import {
  decideHost,
  evaluateSourceActivationGate,
  type AcquisitionMethod,
  type SourceRegistryEntry,
} from '@data-foundry/source-registry';
import { AcquisitionRefusedError, RobotsDisallowedError } from '../errors.js';
import {
  isRightsBlocker,
  type AcquisitionGateFinding,
  type AcquisitionGateResult,
} from './gate-types.js';
import { evaluateRobots, type RobotsDecision } from './robots.js';

/**
 * The rule-1 acquisition gate.
 *
 * AGENTS.md rule 1: *"No source without rights metadata. Unreviewed/RED sources
 * must not publish."* Publication is the last line of defence, not the first —
 * a RED source that is never fetched cannot leak, cannot sit in R2 waiting to be
 * subpoenaed, and cannot be accidentally re-enabled by a downstream bug. So this
 * gate runs **before the transport is touched at all**.
 *
 * It also carries the politeness half of doc 05: robots evaluation happens here,
 * for the same reason — the cheapest disallowed request is the one never sent.
 *
 * The gate fails closed and reports every blocker rather than the first.
 */

/** Only these lifecycle states may be fetched from at all. */
const ACQUIRABLE_STATUSES = new Set(['APPROVED', 'ACTIVE']);

export interface AcquisitionGateInput {
  readonly entry: SourceRegistryEntry;
  readonly url: string;
  readonly asOf: string;
  /** Methods the calling provider actually implements; the policy must name one of them. */
  readonly providerMethods?: readonly AcquisitionMethod[] | undefined;
}

function hostIsInScope(sourceDomain: string, url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  const domain = sourceDomain.trim().toLowerCase().replace(/^\.+/, '');
  if (domain === '') return false;
  return host === domain || host.endsWith(`.${domain}`);
}

export function evaluateAcquisitionGate(input: AcquisitionGateInput): AcquisitionGateResult {
  const { entry, url, asOf } = input;
  const blockers: AcquisitionGateFinding[] = [];
  const warnings: AcquisitionGateFinding[] = [];

  // 1. Rights classification. RED and UNREVIEWED never reach the network.
  const decision = publishDecision(entry.rights_classification);
  if (!decision.allowed) {
    blockers.push({ code: 'RIGHTS_BLOCKED', message: decision.reason });
  } else if (decision.requiresReview) {
    warnings.push({
      code: 'RIGHTS_BLOCKED',
      message:
        'AMBER: acquisition is permitted, but redistribution scope still needs legal sign-off ' +
        'before anything derived from these artifacts is published.',
    });
  }

  // 2. Operator kill switch overrides everything else (doc 13, takedown).
  if (entry.kill_switch_engaged) {
    blockers.push({
      code: 'KILL_SWITCH_ENGAGED',
      message: 'Source kill switch is engaged; acquisition is suspended.',
    });
  }

  // 3. Lifecycle.
  if (!ACQUIRABLE_STATUSES.has(entry.status)) {
    blockers.push({
      code: 'SOURCE_NOT_ACQUIRABLE',
      message: `Source status is ${entry.status}; only APPROVED and ACTIVE sources may be fetched.`,
    });
  }

  // 4. The source must satisfy its own activation checklist. A source that claims
  //    to be ACTIVE while failing the checklist is a configuration bug, and
  //    crawling it would be acquiring without complete rights metadata.
  for (const blocker of evaluateSourceActivationGate(entry, asOf).blockers) {
    blockers.push(blocker);
  }

  // 5. Acquisition method: approved, and actually the one this provider implements.
  if (input.providerMethods !== undefined && !input.providerMethods.includes(entry.acquisition_policy.method)) {
    blockers.push({
      code: 'ACQUISITION_METHOD_MISMATCH',
      message:
        `Source policy requires acquisition method ${entry.acquisition_policy.method}, ` +
        `but this provider implements [${input.providerMethods.join(', ')}].`,
    });
  }

  // 6a. The URL being fetched, checked against the prohibition on its own terms.
  //     Step 4 already covers the DECLARED domain via the activation gate, and
  //     step 6 requires the URL to sit under it — so in a correct declaration
  //     this is redundant. It is here for the case where one of those is wrong:
  //     the request that actually leaves this process is the one that matters,
  //     and it should be checked, not inferred. Same policy, second input.
  const urlHost = decideHost(url);
  if (urlHost.kind === 'PROHIBITED') {
    blockers.push({
      code: 'SOURCE_PROHIBITED',
      message:
        `URL host "${urlHost.host}" belongs to ${urlHost.prohibition.publisher}, which is ` +
        `prohibited in platform code: ${urlHost.prohibition.reason}`,
    });
  } else if (urlHost.kind === 'UNDECIDABLE') {
    blockers.push({ code: 'SOURCE_DOMAIN_UNDECIDABLE', message: urlHost.reason });
  }

  // 6. The URL must belong to the source we hold rights metadata for. Without this,
  //    a GREEN source's rights record would launder a request to any host at all.
  if (!hostIsInScope(entry.domain, url)) {
    blockers.push({
      code: 'URL_NOT_IN_SOURCE_SCOPE',
      message: `URL ${url} is not under the declared source domain "${entry.domain}".`,
    });
  }

  // 7. Politeness: robots.
  const robots: RobotsDecision = evaluateRobots(entry.robots_policy, url);
  if (!robots.allowed) {
    blockers.push({ code: 'ROBOTS_DISALLOWED', message: robots.reason });
  }
  if (!robots.respected) {
    warnings.push({
      code: 'ROBOTS_DISALLOWED',
      message: 'robots directives are being bypassed for this source by explicit policy.',
    });
  }

  return {
    sourceKey: entry.key,
    url,
    allowed: blockers.length === 0,
    blockers,
    warnings,
    robots,
  };
}

/**
 * Raise the right error for a refused gate result.
 *
 * Rights refusals surface as the canonical {@link RightsViolationError} so that
 * rule-1 violations are one catchable type across every package; politeness
 * refusals surface as {@link RobotsDisallowedError}; everything else as
 * {@link AcquisitionRefusedError}.
 */
export function throwGateRefusal(
  entry: SourceRegistryEntry,
  result: AcquisitionGateResult,
): never {
  const reason = result.blockers
    .map((blocker) => `${blocker.code}: ${blocker.message}`)
    .join(' | ');

  if (result.blockers.some(isRightsBlocker)) {
    throw new RightsViolationError(
      entry.rights_classification,
      `source "${entry.key}" (${result.url})`,
      reason,
    );
  }
  if (result.blockers.some((blocker) => blocker.code === 'ROBOTS_DISALLOWED')) {
    throw new RobotsDisallowedError({
      sourceKey: result.sourceKey,
      url: result.url,
      blockers: result.blockers,
    });
  }
  throw new AcquisitionRefusedError({
    sourceKey: result.sourceKey,
    url: result.url,
    blockers: result.blockers,
  });
}

/** Evaluate and refuse in one call. */
export function assertAcquisitionAllowed(input: AcquisitionGateInput): AcquisitionGateResult {
  const result = evaluateAcquisitionGate(input);
  if (result.allowed) return result;
  throwGateRefusal(input.entry, result);
}

/**
 * Proof that the gate ran and allowed the fetch.
 *
 * **What this does guarantee.** The brand is a `unique symbol` declared and
 * never exported, so the type cannot be *constructed* — no object literal, no
 * spread, no structural match produces one. `TransportContext` requires it, so
 * removing `requireAcquisitionAllowed` from `BaseAcquisitionProvider.fetch`
 * fails the build rather than silently opening a hole. That is the failure this
 * was built for: the invariant used to rest on one hand-written line, deleting
 * it compiled cleanly, and the fetch proceeded.
 *
 * **What it does not guarantee.** It is not unforgeable. The type is exported,
 * so any TypeScript caller can write `result as AllowedAcquisition`, and a
 * caller willing to also cast past `protected` could hand that to `transport`.
 * A type assertion is not something a type system can prevent — claiming
 * otherwise would be overstating the control, which is worse than a weaker
 * control honestly described.
 *
 * What closes that gap inside this repository is a scan, not a type:
 * `packages/acquisition/test/boundary.test.ts` permits the
 * `as AllowedAcquisition` assertion in exactly one place — the function below.
 */
declare const ACQUISITION_ALLOWED: unique symbol;
export type AllowedAcquisition = AcquisitionGateResult & {
  readonly [ACQUISITION_ALLOWED]: true;
};

/**
 * Refuse unless the gate allowed the fetch, returning the proof if it did.
 *
 * The cast is the one place in the codebase where the brand is applied, and it
 * is unreachable unless `result.allowed` is true — `throwGateRefusal` returns
 * `never`.
 */
export function requireAcquisitionAllowed(
  entry: SourceRegistryEntry,
  result: AcquisitionGateResult,
): AllowedAcquisition {
  if (!result.allowed) throwGateRefusal(entry, result);
  return result as AllowedAcquisition;
}

