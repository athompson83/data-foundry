/**
 * The rule-1 gate, applied to an export.
 *
 * AGENTS.md rule 1: *"No source without rights metadata. Unreviewed/RED sources
 * must not publish."* DATA_RIGHTS.md is explicit that a bulk export is one of
 * the surfaces that counts, and that attribution obligations must be honoured
 * on "pages, API responses, MCP results and bulk exports alike".
 *
 * This module invents no rights logic. It calls the two gates that already
 * exist and routes their answers into a refusal:
 *
 *   - `canPublish` / `publishDecision` (`@data-foundry/canonical-schema`) —
 *     the classification predicate, applied to the `sources` ROW that actually
 *     backs the evidence.
 *   - `evaluateSourcePublishGate` (`@data-foundry/source-registry`) — the full
 *     doc-13 gate, applied to the source's DECLARATION.
 *
 * Both, because they answer different questions and the export is the surface
 * where the gap between them matters. Fact selection already refuses to build a
 * canonical value on RED/UNREVIEWED evidence, so the classification check is
 * partly belt-and-braces. The registry gate is not: a source can be `GREEN` and
 * `ACTIVE` in Postgres while its declaration says `redistribution_allowed:
 * false`, or its rights review has lapsed, or an operator has thrown the kill
 * switch. None of that is visible to the database, and every one of them is a
 * reason a dataset must not ship.
 *
 * WHY A REGISTRY IS REQUIRED. A contributing source with no declaration is
 * refused rather than assumed fine. That is the same reading of "absence of a
 * decision is not permission" that makes `UNREVIEWED` unpublishable; making the
 * registry optional would reintroduce exactly the hole rule 1 closes, since the
 * easiest way to pass a gate is to not supply the thing it inspects.
 */
import {
  canPublish,
  publishDecision,
  requiresLegalReview,
  type Source,
} from '@data-foundry/canonical-schema';
import {
  evaluateSourcePublishGate,
  type SourceGateFinding,
  type SourceRegistryEntry,
} from '@data-foundry/source-registry';
import type { ExportRefusal } from './errors.js';

/** A source that actually backs at least one exported value. */
export interface ContributingSource {
  readonly source: Source;
  /** Facts in the export whose evidence chain includes this source. */
  readonly fact_ids: ReadonlySet<string>;
  /** Evidence rows in the export attributable to this source. */
  readonly evidence_count: number;
}

/** A contributing source that passed every gate, with its declaration attached. */
export interface ClearedSource extends ContributingSource {
  readonly entry: SourceRegistryEntry;
  readonly warnings: readonly SourceGateFinding[];
  /** AMBER: publishable, but not silently. */
  readonly requires_legal_review: boolean;
}

export interface RightsAudit {
  readonly cleared: readonly ClearedSource[];
  readonly refusals: readonly ExportRefusal[];
}

/** How a source is named in a refusal an operator has to act on. */
const describe = (source: Source): string => `${source.publisher} (${source.domain})`;

/**
 * Check every contributing source against both gates.
 *
 * Collects all findings instead of throwing on the first, for the same reason
 * `evaluateSourcePublishGate` collects blockers: an operator fixing a dataset
 * should see the whole list rather than rebuild once per problem.
 */
export function auditContributingSources(
  contributors: readonly ContributingSource[],
  registry: readonly SourceRegistryEntry[],
  verticalSlug: string,
  asOf: string,
): RightsAudit {
  const scoped = registry.filter((entry) => entry.vertical_slug === verticalSlug);
  const byDomain = new Map<string, SourceRegistryEntry[]>();
  for (const entry of scoped) {
    const bucket = byDomain.get(entry.domain);
    if (bucket === undefined) byDomain.set(entry.domain, [entry]);
    else bucket.push(entry);
  }

  const cleared: ClearedSource[] = [];
  const refusals: ExportRefusal[] = [];

  for (const contributor of contributors) {
    const { source } = contributor;
    const subject = describe(source);
    let blocked = false;

    // (1) Classification, on the row that backs the evidence.
    const decision = publishDecision(source.rights_classification);
    if (!decision.allowed) {
      blocked = true;
      refusals.push({
        code: 'SOURCE_RIGHTS_BLOCKED',
        subject,
        message:
          `${decision.reason} It backs ${contributor.fact_ids.size} value(s) in this export, ` +
          'so the export cannot be published without it and must not be published with it.',
      });
    }

    // (2) Declaration.
    const candidates = byDomain.get(source.domain) ?? [];
    if (candidates.length === 0) {
      refusals.push({
        code: 'SOURCE_NOT_REGISTERED',
        subject,
        message:
          `No source registry entry declares domain "${source.domain}" for vertical ` +
          `"${verticalSlug}". A source with no rights declaration is not cleared to publish; ` +
          'absence of a decision is not permission (AGENTS.md rule 1).',
      });
      continue;
    }
    if (candidates.length > 1) {
      refusals.push({
        code: 'SOURCE_REGISTRY_AMBIGUOUS',
        subject,
        message:
          `${candidates.length} registry entries (${candidates.map((e) => e.key).join(', ')}) ` +
          `declare domain "${source.domain}". Which terms govern this data is undecidable, so ` +
          'no terms can be carried into the manifest.',
      });
      continue;
    }
    const entry = candidates[0] as SourceRegistryEntry;

    if (entry.rights_classification !== source.rights_classification) {
      blocked = true;
      refusals.push({
        code: 'RIGHTS_CLASSIFICATION_MISMATCH',
        subject,
        message:
          `The stored source row is ${source.rights_classification} but registry entry ` +
          `"${entry.key}" declares ${entry.rights_classification}. The database and the ` +
          'declaration disagree about what may be published; neither answer can be trusted ' +
          'until a human reconciles them.',
      });
    }

    const gate = evaluateSourcePublishGate(entry, asOf);
    if (!gate.allowed) {
      blocked = true;
      refusals.push({
        code: 'SOURCE_PUBLISH_GATE_BLOCKED',
        subject: `${subject} [${entry.key}]`,
        message: gate.blockers.map((blocker) => `${blocker.code}: ${blocker.message}`).join(' ; '),
      });
    }

    if (!blocked && canPublish(source.rights_classification)) {
      cleared.push({
        ...contributor,
        entry,
        warnings: gate.warnings,
        requires_legal_review: requiresLegalReview(entry.rights_classification),
      });
    }
  }

  return { cleared, refusals };
}
