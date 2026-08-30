/**
 * The flat row contracts an export publishes, and their total ordering.
 *
 * ADR-0004: *"Every REST, MCP, search-index and bulk-export handler MUST
 * produce its wire objects through the shared serializer in
 * `@data-foundry/query-model`. No surface may construct a fact wire object
 * independently."* This module is the first surface to land under that rule, so
 * it obeys it literally: the twelve fact columns come out of `toExportRow` and
 * nothing here writes a second serializer for them. What this module adds is
 * the five columns that say WHICH entity a row is about — `ExportFactRow` is
 * one entity's one property and carries no identity of its own, so a bulk file
 * of them would be unjoinable.
 *
 * `test/wire-serializer-boundary.test.ts` is the enforcement ADR-0004 deferred
 * until a surface existed.
 *
 * ORDERING. Both row sets carry an explicit, total sort key. Nothing here
 * depends on the order rows came back from Postgres, on `Map` iteration, or on
 * a collator: `compareCodeUnits` is the only comparator, per
 * `tests/contract/ordering-determinism`. Semantic fields lead every key;
 * database-minted UUIDs appear only as final tie-breakers so the order remains
 * total without letting random ids reorder distinguishable public rows.
 */
import { compareKeys, type Entity, type Slug } from '@data-foundry/canonical-schema';
import { toExportRow, type CanonicalFactView, type ExportFactRow } from '@data-foundry/query-model';
import type { EvidenceChainLink } from '@data-foundry/provenance';

/* ------------------------------------------------------------------ *
 * Fact rows
 * ------------------------------------------------------------------ */

/** Which entity a fact row is about. Added here; never re-derived per format. */
export interface ExportEntityColumns {
  readonly vertical_slug: string;
  readonly entity_id: string;
  readonly entity_type: string;
  readonly entity_slug: string;
  readonly entity_name: string;
}

/** One flat, scalar-only row: the entity it describes plus the shared fact projection. */
export interface ExportRow extends ExportEntityColumns, ExportFactRow {}

export const EXPORT_ENTITY_COLUMNS = [
  'vertical_slug',
  'entity_id',
  'entity_type',
  'entity_slug',
  'entity_name',
] as const satisfies readonly (keyof ExportEntityColumns)[];

/**
 * The twelve columns of `ExportFactRow`, in published order.
 *
 * Declared rather than derived from `Object.keys` so the file's column order is
 * a contract rather than a side effect of how the serializer happens to build
 * its object literal. The two type assertions below make a field added to
 * `ExportFactRow` upstream a COMPILE error here, not a column that silently
 * disappears from every export.
 */
export const EXPORT_FACT_COLUMNS = [
  'property',
  'value',
  'value_type',
  'unit',
  'confidence',
  'fact_id',
  'rule',
  'sources',
  'unresolved_conflict',
  'editorially_corrected',
  'editorial_correction_reason',
  'selection_warnings',
] as const satisfies readonly (keyof ExportFactRow)[];

type Assert<T extends true> = T;
/** Every `ExportFactRow` field is published. Adding one upstream breaks this. */
export type EveryFactFieldIsPublished = Assert<
  [keyof ExportFactRow] extends [(typeof EXPORT_FACT_COLUMNS)[number]] ? true : false
>;
export type EveryEntityFieldIsPublished = Assert<
  [keyof ExportEntityColumns] extends [(typeof EXPORT_ENTITY_COLUMNS)[number]] ? true : false
>;

export const EXPORT_ROW_COLUMNS: readonly string[] = [
  ...EXPORT_ENTITY_COLUMNS,
  ...EXPORT_FACT_COLUMNS,
];

/** Compose the shared fact projection with the entity identity columns. */
export function exportRow(
  verticalSlug: Slug,
  entity: Entity,
  view: CanonicalFactView,
): ExportRow {
  return {
    vertical_slug: verticalSlug,
    entity_id: entity.id,
    entity_type: entity.entity_type,
    entity_slug: entity.canonical_slug,
    entity_name: entity.canonical_name,
    // ADR-0004: the fact half of the row has exactly one producer.
    ...toExportRow(view),
  };
}

export function compareExportRows(left: ExportRow, right: ExportRow): number {
  return compareKeys(
    [left.entity_type, left.entity_slug, left.property, left.entity_id],
    [right.entity_type, right.entity_slug, right.property, right.entity_id],
  );
}

/* ------------------------------------------------------------------ *
 * Evidence rows (AGENTS.md rule 10)
 * ------------------------------------------------------------------ */

/**
 * One hop from a published value back to the bytes that support it.
 *
 * Rule 10 says raw evidence required to explain a canonical fact must be
 * preserved. An export that ships values without this file preserves the
 * evidence in *our* database and publishes an unexplainable number, which is
 * the half of the rule that matters to whoever receives the file: they get
 * `seer2_rating = 16` and no way to ask where it came from.
 *
 * `artifact_content_hash` addresses the exact bytes; `artifact_url` and
 * `artifact_retrieved_at` say what was fetched and when. The artifact's
 * `r2_uri` is deliberately NOT published — it is the layout of our private
 * object store, and the content hash identifies the bytes without it.
 */
export interface ExportEvidenceRow {
  readonly entity_id: string;
  readonly entity_slug: string;
  readonly property: string;
  readonly fact_id: string;
  readonly evidence_id: string;
  readonly source_key: string;
  readonly source_publisher: string;
  readonly source_domain: string;
  readonly source_type: string;
  readonly rights_classification: string;
  readonly artifact_id: string;
  readonly artifact_url: string;
  readonly artifact_content_hash: string;
  readonly artifact_retrieved_at: string;
  readonly source_record_id: string;
  readonly locator_type: string;
  readonly locator_value: string;
  /**
   * Publisher verbatim text, when a future export contract independently
   * authorizes quotation. Normalized bulk grants alone leave this null.
   */
  readonly source_value: string | null;
  readonly observed_at: string;
}

export const EXPORT_EVIDENCE_COLUMNS = [
  'entity_id',
  'entity_slug',
  'property',
  'fact_id',
  'evidence_id',
  'source_key',
  'source_publisher',
  'source_domain',
  'source_type',
  'rights_classification',
  'artifact_id',
  'artifact_url',
  'artifact_content_hash',
  'artifact_retrieved_at',
  'source_record_id',
  'locator_type',
  'locator_value',
  'source_value',
  'observed_at',
] as const satisfies readonly (keyof ExportEvidenceRow)[];

export type EveryEvidenceFieldIsPublished = Assert<
  [keyof ExportEvidenceRow] extends [(typeof EXPORT_EVIDENCE_COLUMNS)[number]] ? true : false
>;

export function exportEvidenceRow(
  entity: Entity,
  property: string,
  factId: string,
  sourceKey: string,
  link: EvidenceChainLink,
): ExportEvidenceRow {
  return {
    entity_id: entity.id,
    entity_slug: entity.canonical_slug,
    property,
    fact_id: factId,
    evidence_id: link.evidence.id,
    source_key: sourceKey,
    source_publisher: link.source.publisher,
    source_domain: link.source.domain,
    source_type: link.source.source_type,
    rights_classification: link.source.rights_classification,
    artifact_id: link.artifact.id,
    artifact_url: link.artifact.url,
    artifact_content_hash: link.artifact.content_hash,
    artifact_retrieved_at: link.retrieved_at,
    source_record_id: link.source_record.id,
    locator_type: link.locator.type,
    locator_value: link.locator.value,
    // `BULK_EXPORT` authorizes normalized redistribution, not quotation. Keep
    // the stable column in the evidence contract without leaking the excerpt.
    source_value: null,
    observed_at: link.observed_at,
  };
}

export function compareEvidenceRows(left: ExportEvidenceRow, right: ExportEvidenceRow): number {
  return compareKeys(
    [
      left.entity_slug,
      left.property,
      left.source_key,
      left.source_publisher,
      left.source_domain,
      left.artifact_content_hash,
      left.artifact_url,
      left.artifact_retrieved_at,
      left.locator_type,
      left.locator_value,
      left.source_value ?? '',
      left.observed_at,
      left.entity_id,
      left.fact_id,
      left.evidence_id,
    ],
    [
      right.entity_slug,
      right.property,
      right.source_key,
      right.source_publisher,
      right.source_domain,
      right.artifact_content_hash,
      right.artifact_url,
      right.artifact_retrieved_at,
      right.locator_type,
      right.locator_value,
      right.source_value ?? '',
      right.observed_at,
      right.entity_id,
      right.fact_id,
      right.evidence_id,
    ],
  );
}
