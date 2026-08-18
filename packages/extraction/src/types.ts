import type {
  ExtractionConfidence,
  ExtractorVersion,
  Identifier,
  JsonObject,
  SourceArtifact,
  SourceArtifactId,
  SourceId,
  SourceRecordKey,
} from '@data-foundry/canonical-schema';
import type { EvidenceLocator } from './locator.js';
import type { ExtractionSchema } from './schema.js';

/**
 * Extraction turns artifacts into **source-native** records.
 *
 * It does not create canonical entities, does not resolve identity, does not
 * decide which of two conflicting claims is true, and does not import
 * `canonical-store` or `entity-resolution`. A record produced here is a claim
 * with an address inside an artifact — nothing more.
 */
export const EXTRACTION_FORMATS = ['json', 'csv', 'html', 'pdf'] as const;
export type ExtractionFormat = (typeof EXTRACTION_FORMATS)[number];

/**
 * A `SourceArtifact` row plus the bytes it points at.
 *
 * `source_artifacts` stores an `r2_uri` and a hash, not a body (doc 02: "Postgres
 * should not store every raw HTML/PDF body"). Extraction cannot reach into R2 —
 * that is acquisition's job — so the caller hands it the retrieved body next to
 * the immutable metadata.
 */
export interface ExtractionArtifact {
  readonly artifact: SourceArtifact;
  readonly body: string | Uint8Array;
}

export const artifactText = (artifact: ExtractionArtifact): string =>
  typeof artifact.body === 'string' ? artifact.body : new TextDecoder('utf-8').decode(artifact.body);

export const artifactBytes = (artifact: ExtractionArtifact): Uint8Array =>
  typeof artifact.body === 'string' ? new TextEncoder().encode(artifact.body) : artifact.body;

/** One field read off an artifact, with the address it was read from. */
export interface ExtractedValue {
  /** Source-native field name, as declared by the extraction schema. */
  readonly field: Identifier;
  /** The value exactly as it appeared, pre-normalization. `null` when absent. */
  readonly raw: string | null;
  readonly locator: EvidenceLocator;
  /** True when the field selector matched more than one node/cell/line. */
  readonly ambiguous: boolean;
  readonly match_count: number;
}

export const EXTRACTION_ISSUE_CODES = [
  'REQUIRED_FIELD_MISSING',
  'FIELD_NOT_FOUND',
  'FIELD_PARSE_FAILURE',
  'AMBIGUOUS_MATCH',
  'MULTIPLE_MATCH_REJECTED',
  'UNKNOWN_COLUMN',
  'EMPTY_TEXT_LAYER',
  'RECORD_KEY_INCOMPLETE',
] as const;
export type ExtractionIssueCode = (typeof EXTRACTION_ISSUE_CODES)[number];

export interface ExtractionIssue {
  readonly code: ExtractionIssueCode;
  readonly field: Identifier | null;
  readonly message: string;
  readonly locator: EvidenceLocator;
}

/**
 * The real signals `extraction_confidence` is computed from. Kept on the record
 * so a low score can be explained rather than merely displayed.
 */
export interface ExtractionSignals {
  readonly fields_expected: number;
  readonly required_expected: number;
  readonly required_present: number;
  readonly optional_expected: number;
  readonly optional_present: number;
  readonly parse_failures: number;
  readonly ambiguous_fields: number;
}

export interface ExtractedRecord {
  readonly source_id: SourceId;
  readonly artifact_id: SourceArtifactId;
  readonly source_record_key: SourceRecordKey;
  readonly entity_type: Identifier;
  readonly values: readonly ExtractedValue[];
  /** Source-native payload: field name → raw string (or null). No canonical shapes. */
  readonly raw_payload: JsonObject;
  readonly extraction_confidence: ExtractionConfidence;
  readonly extractor_version: ExtractorVersion;
  /** Where the record itself lives inside the artifact. */
  readonly locator: EvidenceLocator;
  readonly issues: readonly ExtractionIssue[];
  readonly signals: ExtractionSignals;
  /** 0-based position of the record within the artifact. */
  readonly ordinal: number;
}

/**
 * Doc 02, "Provider abstraction":
 *
 * ```text
 * ExtractionProvider.extract(artifact, schema) -> ExtractedRecord[]
 * ```
 *
 * Four concrete providers (JSON, CSV, HTML, PDF) sit behind this one interface.
 * Adding a *source* of an existing format is a config change — a new
 * `ExtractionSchema` — never a new provider.
 */
export interface ExtractionProvider {
  readonly name: string;
  readonly format: ExtractionFormat;
  readonly version: ExtractorVersion;
  supports(schema: ExtractionSchema): boolean;
  extract(artifact: ExtractionArtifact, schema: ExtractionSchema): Promise<ExtractedRecord[]>;
}

/** Artifact-level failure: the bytes could not be parsed at all. */
export class ExtractionError extends Error {
  readonly artifact_id: SourceArtifactId | null;
  readonly schema_id: string | null;

  constructor(
    message: string,
    options: { artifactId?: SourceArtifactId; schemaId?: string; cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'ExtractionError';
    this.artifact_id = options.artifactId ?? null;
    this.schema_id = options.schemaId ?? null;
  }
}
