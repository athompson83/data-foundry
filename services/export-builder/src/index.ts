/**
 * `@data-foundry/export-builder`
 *
 * Versioned dataset snapshots and bulk export. The fourth consumer of the
 * canonical query layer, after web, REST and MCP — and the one where AGENTS.md
 * rule 1 bites hardest, because an export is the most portable form of
 * publication there is. A page can be taken down; a JSONL file a customer
 * downloaded cannot.
 *
 * What it will not do:
 *
 *   * It will not re-implement fact selection or write business SQL. Everything
 *     it reads comes through `createQueryModel` (rule 5).
 *   * It will not write a second row serializer. The fact columns come from
 *     `toExportRow` in `@data-foundry/query-model` (ADR-0004).
 *   * It will not drop a row it cannot publish. An unpublishable source refuses
 *     the whole export, by name, with nothing written (rule 1).
 *   * It will not publish a value it cannot explain. Every exported fact ships
 *     with its evidence chain (rule 10).
 *   * It will not publish a reviewer's identity or a source's internal notes,
 *     and it checks the serialized bytes rather than trusting the projection.
 *
 * There is no Parquet writer here and no upload path, deliberately: both are
 * named in the module headers that own them.
 */

export {
  EVIDENCE_JSONL,
  FACTS_CSV,
  FACTS_JSONL,
  MANIFEST_JSON,
  MAX_EXPORT_ENTITIES,
  buildDatasetExport,
  type DatasetExportOptions,
  type DatasetExportResult,
} from './builder.js';

export {
  EXPORT_CONTRACT_VERSION,
  EXPORT_FILE_CONTENTS,
  EXPORT_FILE_FORMATS,
  MANIFEST_VERSION,
  RIGHTS_NOTICE,
  propertyIsExportable,
  toSnapshotInsert,
  type DatasetExportManifest,
  type ExportFileContent,
  type ExportFileFormat,
  type ManifestEditorialOverride,
  type ManifestFile,
  type ManifestPropertyPolicy,
  type ManifestSelectionPolicy,
  type ManifestSource,
  type ManifestSourceRights,
  type PropertyPolicy,
} from './manifest.js';

export {
  EXPORT_ENTITY_COLUMNS,
  EXPORT_EVIDENCE_COLUMNS,
  EXPORT_FACT_COLUMNS,
  EXPORT_ROW_COLUMNS,
  compareEvidenceRows,
  compareExportRows,
  exportEvidenceRow,
  exportRow,
  type ExportEntityColumns,
  type ExportEvidenceRow,
  type ExportRow,
} from './rows.js';

export {
  EXPORT_REFUSAL_CODES,
  ExportRefusedError,
  InternalTextLeak,
  type ExportRefusal,
  type ExportRefusalCode,
} from './errors.js';

export {
  auditContributingSources,
  type ClearedSource,
  type ContributingSource,
  type RightsAudit,
} from './rights.js';

export {
  assertArtifactCarriesNoReviewerIdentity,
  assertNoInternalText,
  assertRowsCarryNoReviewerIdentity,
  declaredReviewers,
  internalOnlyText,
} from './privacy.js';

export {
  CSV_DELIMITER,
  CSV_RECORD_SEPARATOR,
  csvDocument,
  csvField,
  csvRecord,
  type CsvValue,
} from './csv.js';

export { jsonlDocument, jsonlRecord, type JsonlValue } from './jsonl.js';

export { fromUtf8, sha256, stableJson, utf8 } from './bytes.js';

export {
  createDirectorySink,
  createMemorySink,
  type ExportSink,
  type MemorySink,
} from './sink.js';

export { recordDatasetSnapshot } from './snapshot.js';
