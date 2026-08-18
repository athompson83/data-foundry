/**
 * Wire projection for `CanonicalFactView`.
 *
 * AGENTS.md rule 5 says web, REST, MCP and exports must read from the same
 * canonical query layer. That is only true in practice if they also SERIALIZE
 * it the same way — an interface field that three hand-written serializers
 * silently drop is not "one source of truth", it is four.
 *
 * So the wire shape is defined ONCE, here, and every surface maps through it.
 *
 * SCOPE NOTE (honest): `apps/api`, `apps/mcp` and `services/export-builder` do
 * not exist yet — they are roadmap Phase 3/4. This module is deliberately
 * written first so those surfaces inherit the correction fields by
 * construction rather than each rediscovering them. It defines mapping and a
 * JSON Schema fragment; it does not define routing, auth, or transport.
 *
 * NAMING: the canonical internal representation is snake_case, matching every
 * other field on `CanonicalFactView` and the rest of the repo. The wire
 * boundary is camelCase. One representation internally, converted once here.
 *
 * PRIVACY: `editorialCorrectionReason` is customer-visible by contract — it is
 * the override's declared reason, authored in version-controlled vertical
 * config and reviewed in a pull request. The REVIEWER IDENTITY is never
 * projected onto any of these shapes; it stays in `explainFact` and the audit
 * record. `assertNoReviewerIdentity` below is the enforcement — it exists now,
 * having been named here as the enforcement while not existing, which made the
 * guarantee a comment rather than a control.
 */

import type { SelectionWarning } from '@data-foundry/canonical-store';
import type { CanonicalFactView } from './facts.js';

/** The three trust fields, in wire (camelCase) form. Shared by every surface. */
export interface WireCorrectionFields {
  readonly editoriallyCorrected: boolean;
  readonly editorialCorrectionReason: string | null;
  /**
   * Unknown codes MUST be ignored by consumers, never thrown on. The list is
   * designed to grow; an older reader seeing a code it does not know should
   * render nothing for it and continue.
   */
  readonly selectionWarnings: readonly SelectionWarning[];
}

export interface RestFact extends WireCorrectionFields {
  readonly property: string;
  readonly value: unknown;
  readonly valueType: string | null;
  readonly unit: string | null;
  readonly confidence: number | null;
  readonly factId: string | null;
  readonly rule: string;
  readonly reason: string;
  readonly sources: readonly string[];
  readonly unresolvedConflict: boolean;
  /** Source-verified badge state. Supplied by the caller from the provenance policy. */
  readonly verified?: boolean;
}

/** One flat row for CSV / JSONL / Parquet. Scalars only — no nested objects. */
export interface ExportFactRow {
  readonly property: string;
  readonly value: string | null;
  readonly value_type: string | null;
  readonly unit: string | null;
  readonly confidence: number | null;
  readonly fact_id: string | null;
  readonly rule: string;
  readonly sources: string;
  readonly unresolved_conflict: boolean;
  readonly editorially_corrected: boolean;
  readonly editorial_correction_reason: string | null;
  /** Pipe-joined so a single CSV cell survives without quoting games. */
  readonly selection_warnings: string;
}

/**
 * The one place the three fields cross from internal to wire form. Every
 * surface mapper below calls this, so none of them can forget a field.
 */
export function correctionFields(view: CanonicalFactView): WireCorrectionFields {
  return {
    editoriallyCorrected: view.editorially_corrected,
    editorialCorrectionReason: view.editorial_correction_reason,
    selectionWarnings: [...view.selection_warnings],
  };
}

export function toRestFact(
  view: CanonicalFactView,
  options: { readonly verified?: boolean } = {},
): RestFact {
  return {
    property: view.property,
    value: view.value,
    valueType: view.value_type,
    unit: view.unit,
    confidence: view.confidence,
    factId: view.fact_id,
    rule: view.rule,
    reason: view.reason,
    sources: [...view.sources],
    unresolvedConflict: view.unresolved_conflict,
    ...correctionFields(view),
    ...(options.verified === undefined ? {} : { verified: options.verified }),
  };
}

/**
 * MCP tool results are JSON payloads read by agents, so they carry the same
 * shape as REST rather than a prose rendering — an agent deciding whether to
 * trust a spec needs the correction state as data, not buried in a sentence.
 */
export function toMcpFact(
  view: CanonicalFactView,
  options: { readonly verified?: boolean } = {},
): RestFact {
  return toRestFact(view, options);
}

const renderValue = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.join(', ');
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
};

export function toExportRow(view: CanonicalFactView): ExportFactRow {
  return {
    property: view.property,
    value: renderValue(view.value),
    value_type: view.value_type,
    unit: view.unit,
    confidence: view.confidence,
    fact_id: view.fact_id,
    rule: view.rule,
    sources: [...view.sources].join('|'),
    unresolved_conflict: view.unresolved_conflict,
    editorially_corrected: view.editorially_corrected,
    editorial_correction_reason: view.editorial_correction_reason,
    selection_warnings: [...view.selection_warnings].join('|'),
  };
}

/**
 * JSON Schema fragment for the trust fields, so a generated OpenAPI document
 * and an MCP tool output schema describe them identically instead of drifting.
 * `selectionWarnings` is an open string array on purpose: a schema that
 * enumerated today's codes would reject tomorrow's payloads at the client.
 */
export const CORRECTION_FIELDS_JSON_SCHEMA = {
  type: 'object',
  required: ['editoriallyCorrected', 'editorialCorrectionReason', 'selectionWarnings'],
  properties: {
    editoriallyCorrected: {
      type: 'boolean',
      description:
        'True when a reviewed editorial correction replaced the source-selected value.',
    },
    editorialCorrectionReason: {
      type: ['string', 'null'],
      description:
        'Customer-visible explanation of the correction. Non-empty when editoriallyCorrected is true, null otherwise. Never contains reviewer identity.',
    },
    selectionWarnings: {
      type: 'array',
      items: { type: 'string' },
      description:
        'Machine-readable trust warnings about how the value was selected. Consumers must ignore unrecognised codes rather than failing.',
    },
  },
} as const;

/**
 * A wire projection was about to carry a staff reviewer's identity.
 *
 * Deliberately does not repeat the identity in its message: an error string
 * ends up in logs, in exception trackers and occasionally in an HTTP response
 * body, and a privacy guard that leaks the thing it is guarding is worse than
 * none.
 */
export class ReviewerIdentityLeak extends Error {
  override readonly name = 'ReviewerIdentityLeak';
  /** The wire field that would have carried it. */
  readonly field: string;

  constructor(field: string) {
    super(
      `${field} would expose a staff reviewer's identity to a customer surface. The declared ` +
        'reason is customer-visible by contract; the reviewer is not. Rewrite the override reason ' +
        "in the vertical's fact-selection config so it explains the correction without naming who " +
        'made it.',
    );
    this.field = field;
  }
}

/**
 * Refuse to project a correction reason that names a reviewer.
 *
 * This module has documented since it was written that "the REVIEWER IDENTITY
 * is never projected onto any of these shapes" and named this function as the
 * enforcement. The function did not exist — the guarantee was a comment, and a
 * vertical whose override reason read "corrected by j.okafor after a supplier
 * call" would have published exactly what the comment promised it would not.
 *
 * `reviewers` comes from the compiled fact-selection policy, which is where
 * both the reason and the reviewer are declared. Blank entries are skipped:
 * the empty string is a substring of everything, so treating it as a match
 * would refuse to publish any correction at all.
 *
 * The complementary half is at configuration load: an override whose reason
 * contains its own reviewer is rejected before a run can publish it. That gate
 * is unconditional; this one guards the boundary for surfaces that assemble a
 * payload from anywhere else.
 */
export function assertNoReviewerIdentity(
  fields: WireCorrectionFields,
  reviewers: Iterable<string>,
): void {
  const reason = fields.editorialCorrectionReason;
  if (reason === null || reason.trim() === '') return;

  const haystack = reason.toLowerCase();
  for (const reviewer of reviewers) {
    const needle = reviewer.trim().toLowerCase();
    if (needle === '') continue;
    if (haystack.includes(needle)) throw new ReviewerIdentityLeak('editorialCorrectionReason');
  }
}

/** The invariant, checkable at a boundary. Returns the offending reason, or null. */
export function correctionInvariantViolation(fields: WireCorrectionFields): string | null {
  if (fields.editoriallyCorrected) {
    if (fields.editorialCorrectionReason === null) return 'corrected but reason is null';
    if (fields.editorialCorrectionReason.trim().length === 0) return 'corrected but reason is blank';
    return null;
  }
  return fields.editorialCorrectionReason === null
    ? null
    : 'not corrected but a reason is present';
}
