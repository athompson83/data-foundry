/**
 * Why an export was refused.
 *
 * An export is publication (DATA_RIGHTS.md: "Exports, dataset snapshots and API
 * responses" are governed by the terms of the offering, not by MIT). AGENTS.md
 * rule 1 therefore applies to it in full, and the only safe failure mode is a
 * refusal that names the problem.
 *
 * The alternative — dropping the offending rows and shipping the rest — is
 * worse than useless. A customer receives a file that looks complete, a
 * publisher's data is either present or silently missing with nothing saying
 * which, and nobody finds out until someone diffs two snapshots. So the builder
 * refuses the WHOLE export and says which source caused it.
 *
 * Refusals are collected, not thrown on first sight, for the same reason
 * `evaluateSourcePublishGate` collects blockers: an operator fixing a dataset
 * should see the whole list rather than play whack-a-mole across ten builds.
 */
import type { RightsClassification } from '@data-foundry/canonical-schema';

export const EXPORT_REFUSAL_CODES = [
  /** The `sources` row for a contributing source is RED or UNREVIEWED. */
  'SOURCE_RIGHTS_BLOCKED',
  /** A contributing source has no entry in the supplied source registry. */
  'SOURCE_NOT_REGISTERED',
  /** Two registry entries claim the same domain; which one governs is undecidable. */
  'SOURCE_REGISTRY_AMBIGUOUS',
  /** `evaluateSourcePublishGate` reported blockers for a contributing source. */
  'SOURCE_PUBLISH_GATE_BLOCKED',
  /** The caller asked the selection layer to stop enforcing rule 1. */
  'SELECTION_POLICY_DISABLES_RIGHTS_GATE',
  /** A property the export policy excluded reached the row set anyway. */
  'EXCLUDED_PROPERTY_PRESENT',
  /** A selected value has no evidence chain back to a source artifact (rule 10). */
  'FACT_WITHOUT_TRACEABLE_EVIDENCE',
  /** The database row and the registry entry disagree about a source's rights. */
  'RIGHTS_CLASSIFICATION_MISMATCH',
] as const;
export type ExportRefusalCode = (typeof EXPORT_REFUSAL_CODES)[number];

export interface ExportRefusal {
  readonly code: ExportRefusalCode;
  /**
   * The source this refusal is about, named the way a human can act on it:
   * the registry key when there is one, otherwise `publisher (domain)`.
   * `null` only for refusals that are not about a source.
   */
  readonly subject: string | null;
  readonly message: string;
}

/**
 * The whole export was refused. Nothing was written to the sink.
 *
 * The message names every offending subject on the first line so a CI log or a
 * pager alert is actionable without expanding the structured payload.
 */
export class ExportRefusedError extends Error {
  override readonly name = 'ExportRefusedError';
  readonly refusals: readonly ExportRefusal[];
  /** Convenience for callers that only want to know what to go and fix. */
  readonly subjects: readonly string[];

  constructor(refusals: readonly ExportRefusal[]) {
    const subjects = [...new Set(refusals.map((r) => r.subject).filter((s): s is string => s !== null))];
    super(
      `Refusing to build this export: ${refusals.length} blocker(s)` +
        (subjects.length === 0 ? '' : ` from ${subjects.join(', ')}`) +
        `. ${refusals.map((r) => `[${r.code}] ${r.subject ?? 'export'}: ${r.message}`).join(' | ')} ` +
        'No file was written. An export is publication (AGENTS.md rule 1, DATA_RIGHTS.md); ' +
        'dropping the offending rows and shipping the rest would hide the problem in a file ' +
        'that looks complete.',
    );
    this.refusals = refusals;
    this.subjects = subjects;
  }
}

/** A source's rights classification blocks it, with the classification attached. */
export interface BlockedSourceDetail {
  readonly subject: string;
  readonly rights: RightsClassification;
  readonly reason: string;
}

/**
 * An internal note from a source declaration reached a customer artifact.
 *
 * Like `ReviewerIdentityLeak`, this deliberately does not quote the offending
 * text. An error message ends up in logs and exception trackers, and a guard
 * that reprints the thing it is guarding has published it a second time.
 */
export class InternalTextLeak extends Error {
  override readonly name = 'InternalTextLeak';
  /** The artifact that would have carried it. */
  readonly artifact: string;

  constructor(artifact: string) {
    super(
      `${artifact} would publish text from a source declaration that is written for us and not ` +
        'for a customer (registry notes, geographic notes, acquisition notes, licence-text ' +
        'references). The manifest copies declaration fields onto an allow-list; something ' +
        'outside that allow-list reached the bytes. Add the field to the manifest projection ' +
        'deliberately, or stop copying it.',
    );
    this.artifact = artifact;
  }
}
