import type { SourceGateCode } from '@data-foundry/source-registry';
import type { RobotsDecision } from './robots.js';

/**
 * Gate vocabulary, split into its own module so {@link ../errors.js} can type its
 * payload without importing the evaluator (and the evaluator can throw those
 * errors) without a runtime cycle.
 */

/** Codes that only exist at acquisition time; the rest are reused from the source registry. */
export const ACQUISITION_ONLY_GATE_CODES = [
  'SOURCE_NOT_DECLARED',
  'SOURCE_NOT_ACQUIRABLE',
  'ACQUISITION_METHOD_MISMATCH',
  'ROBOTS_DISALLOWED',
  'URL_NOT_IN_SOURCE_SCOPE',
] as const;
export type AcquisitionOnlyGateCode = (typeof ACQUISITION_ONLY_GATE_CODES)[number];

export type AcquisitionGateCode = SourceGateCode | AcquisitionOnlyGateCode;

export interface AcquisitionGateFinding {
  readonly code: AcquisitionGateCode;
  readonly message: string;
}

export interface AcquisitionGateResult {
  readonly sourceKey: string;
  readonly url: string;
  readonly allowed: boolean;
  /** Every reason the fetch is refused, not just the first. */
  readonly blockers: readonly AcquisitionGateFinding[];
  readonly warnings: readonly AcquisitionGateFinding[];
  readonly robots: RobotsDecision;
}

/** Codes that mean "the rights record forbids this", as opposed to "we are being polite". */
export const RIGHTS_GATE_CODES: readonly AcquisitionGateCode[] = [
  'SOURCE_PROHIBITED',
  'SOURCE_DOMAIN_UNDECIDABLE',
  'RIGHTS_BLOCKED',
  'KILL_SWITCH_ENGAGED',
  'RIGHTS_REVIEW_MISSING_OR_LAPSED',
  'SOURCE_NOT_DECLARED',
];

export function isRightsBlocker(finding: AcquisitionGateFinding): boolean {
  return RIGHTS_GATE_CODES.includes(finding.code);
}
