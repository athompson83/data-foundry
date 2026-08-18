import type { Identifier, SourceRecordInsert } from '@data-foundry/canonical-schema';
import type { EvidenceLocator } from './locator.js';
import type { ExtractedRecord } from './types.js';

/**
 * Projects an extracted record onto the `source_records` insert shape.
 *
 * `normalized_payload` is deliberately `null`: filling it is the normalization
 * stage's job, and an extractor that pre-populated it would have quietly crossed
 * an architecture boundary.
 */
export const toSourceRecordInsert = (record: ExtractedRecord): SourceRecordInsert => ({
  source_id: record.source_id,
  artifact_id: record.artifact_id,
  source_record_key: record.source_record_key,
  entity_type: record.entity_type,
  raw_payload: record.raw_payload,
  normalized_payload: null,
  extraction_confidence: record.extraction_confidence,
  extractor_version: record.extractor_version,
});

/**
 * The evidence half of a `fact_evidence` row for one extracted field.
 *
 * Extraction does not write evidence — it has no fact to attach one to yet — but
 * it must hand the provenance layer everything a row needs. If this projection
 * cannot be produced, the value lost its locator somewhere upstream and rule 2
 * has already been broken.
 */
export interface ExtractedEvidence {
  readonly source_value: string;
  readonly locator_type: EvidenceLocator['type'];
  readonly locator_value: string;
}

export const toExtractedEvidence = (
  record: ExtractedRecord,
  field: Identifier,
): ExtractedEvidence | null => {
  const value = record.values.find((candidate) => candidate.field === field);
  if (value === undefined || value.raw === null) return null;
  return {
    source_value: value.raw,
    locator_type: value.locator.type,
    locator_value: value.locator.value,
  };
};

/** Every non-null extracted value, projected as evidence. */
export const toAllExtractedEvidence = (record: ExtractedRecord): readonly ExtractedEvidence[] =>
  record.values
    .filter((value) => value.raw !== null)
    .map((value) => ({
      source_value: value.raw ?? '',
      locator_type: value.locator.type,
      locator_value: value.locator.value,
    }));
