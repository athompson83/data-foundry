/**
 * The dataset snapshot manifest.
 *
 * `dataset_snapshots` has existed in the schema since migration 0007 and
 * nothing has ever written or read it as a product. This is the shape that
 * does. Where the table already models something, the manifest uses the table's
 * field — `version`, `generated_at`, `record_counts`, `schema_version`,
 * `manifest_uri`, `checksums`, `status` — rather than inventing a parallel
 * vocabulary, and `toSnapshotInsert` projects the manifest back onto
 * `DatasetSnapshotInsertSchema` so a manifest that has drifted out of
 * conformance fails at build time instead of at INSERT time.
 *
 * What the manifest adds beyond the row is everything a *recipient* needs and a
 * database row does not carry:
 *
 *   - the SOURCES, with their rights classification, attribution obligation and
 *     licence terms. DATA_RIGHTS.md: the MIT licence covers the platform and
 *     not the data, and attribution obligations must be honoured on "pages, API
 *     responses, MCP results and bulk exports alike". A file of facts with no
 *     record of whose terms govern them is the exact confusion that document
 *     exists to prevent.
 *   - the SELECTION POLICY in force, so "why is this value the value" is
 *     answerable from the snapshot rather than from our config repository at
 *     some later date.
 *   - the FILES, each with its own sha256, so a recipient can verify what they
 *     received rather than trusting that they received it.
 *
 * The manifest's own digest is NOT in `checksums` — a document cannot contain
 * its own hash. It is returned alongside, from `buildDatasetExport`.
 */
import {
  DatasetSnapshotInsertSchema,
  type ContentHash,
  type DatasetSnapshotInsert,
  type Identifier,
  type IsoDateTime,
  type RecordCounts,
  type RightsClassification,
  type SchemaVersion,
  type Slug,
  type SnapshotChecksums,
  type SnapshotStatus,
  type SourceType,
  type StorageUri,
  type VerticalId,
} from '@data-foundry/canonical-schema';

/**
 * Version of the export ROW contract (the column set of `facts.jsonl` /
 * `facts.csv` / `evidence.jsonl`), distinct from the vertical's
 * `schema_version` and from the manifest's own version. A consumer pinning a
 * parser pins this.
 */
export const EXPORT_CONTRACT_VERSION = '1.0.0';

/** Version of the manifest document shape itself. */
export const MANIFEST_VERSION = '1';

export const EXPORT_FILE_FORMATS = ['jsonl', 'csv'] as const;
export type ExportFileFormat = (typeof EXPORT_FILE_FORMATS)[number];

export const EXPORT_FILE_CONTENTS = ['facts', 'evidence'] as const;
export type ExportFileContent = (typeof EXPORT_FILE_CONTENTS)[number];

export interface ManifestFile {
  /** Relative to the snapshot root; the key used in `checksums`. */
  readonly path: string;
  readonly format: ExportFileFormat;
  readonly content: ExportFileContent;
  /**
   * Records in THIS file. Not the same number as `record_counts.facts`: a
   * property whose every claim was excluded still gets a row, carrying a null
   * value and the `NO_ELIGIBLE_CANDIDATE` rule, so that "we have nothing to say
   * about this" is stated rather than silently absent. `record_counts` counts
   * canonical objects; this counts lines.
   */
  readonly rows: number;
  readonly bytes: number;
  readonly sha256: ContentHash;
  /** Published column order, so a headerless reader can still be built. */
  readonly columns: readonly string[];
}

/** Attribution and licence terms travel with the data. Per source, always. */
export interface ManifestSourceRights {
  readonly rights_classification: RightsClassification;
  /** AMBER publishes, but not silently: someone must have signed the terms off. */
  readonly requires_legal_review: boolean;
  readonly attribution_required: boolean;
  /** Exact credit line to render. Null only when attribution is not required. */
  readonly attribution_text: string | null;
  readonly attribution_url: string | null;
  /** SPDX identifier for the source's own terms, where one applies. */
  readonly license_id: string | null;
  /** SPDX identifier for the DATA, which is not the code licence (doc 13). */
  readonly data_license_id: string | null;
  readonly terms_url: string | null;
  readonly commercial_use_allowed: boolean;
  readonly redistribution_allowed: boolean;
  readonly derivative_normalization_allowed: boolean;
  readonly personal_data_present: boolean;
  /** Non-blocking gate findings, e.g. a rights review about to lapse. */
  readonly warnings: readonly string[];
}

export interface ManifestSource {
  /** Stable human-authored registry key. Survives a database rebuild. */
  readonly source_key: string;
  readonly source_id: string;
  readonly publisher: string;
  readonly domain: string;
  readonly source_type: SourceType;
  readonly authority_rank: number;
  readonly rights: ManifestSourceRights;
  /** Values in this snapshot whose evidence chain includes this source. */
  readonly fact_count: number;
  readonly evidence_count: number;
}

/**
 * A declared editorial correction, as a recipient may see it.
 *
 * `reason` is customer-visible by contract (ADR-0002: authored in
 * version-controlled config and reviewed in a pull request). `reviewer` is not,
 * and is absent from this type rather than nulled out, so there is no field for
 * it to be filled into later by accident.
 */
export interface ManifestEditorialOverride {
  readonly source: string;
  readonly properties: readonly string[] | null;
  readonly reason: string;
}

export interface ManifestSelectionPolicy {
  /** The instant the canonical view was taken at. */
  readonly at: IsoDateTime;
  readonly require_publishable_rights: boolean;
  readonly authoritative_source_types: readonly SourceType[];
  readonly authoritative_sources_by_property: Readonly<Record<string, readonly string[]>>;
  readonly field_reliability: Readonly<Record<string, Readonly<Record<string, number>>>>;
  /** Ids of the deterministic consistency checks that were applied. */
  readonly consistency_checks: readonly string[];
  readonly editorial_overrides: readonly ManifestEditorialOverride[];
  readonly entity_types: readonly string[] | null;
  readonly entity_statuses: readonly string[];
  readonly properties: ManifestPropertyPolicy;
  /** The explicit total sort key each file is written in. */
  readonly ordering: Readonly<Record<ExportFileContent, readonly string[]>>;
}

/**
 * Which properties may be exported.
 *
 * Required, with no default, because "everything in the database" is not a safe
 * answer for a publication surface: an internal-only property is one config
 * omission away from shipping. `allowlist` is the mode to prefer; `all` exists
 * for verticals whose whole property set is public and still forces the caller
 * to write down what it is excluding.
 */
export type PropertyPolicy =
  | { readonly mode: 'allowlist'; readonly include: readonly Identifier[] }
  | { readonly mode: 'all'; readonly exclude: readonly Identifier[] };

export type ManifestPropertyPolicy =
  | { readonly mode: 'allowlist'; readonly include: readonly string[] }
  | { readonly mode: 'all'; readonly exclude: readonly string[] };

export function propertyIsExportable(policy: PropertyPolicy, property: string): boolean {
  return policy.mode === 'allowlist'
    ? (policy.include as readonly string[]).includes(property)
    : !(policy.exclude as readonly string[]).includes(property);
}

/**
 * The manifest.
 *
 * `snapshot_id` is absent: an id is minted by `dataset_snapshots` when the
 * snapshot is recorded, and the manifest is written before that happens. The
 * identity a consumer quotes is `(vertical_slug, version)`, which is also the
 * table's unique key.
 */
export interface DatasetExportManifest {
  readonly manifest_version: string;
  readonly contract_version: string;

  readonly vertical_id: VerticalId;
  readonly vertical_slug: Slug;
  readonly version: string;
  readonly generated_at: IsoDateTime;
  readonly schema_version: SchemaVersion;
  readonly status: SnapshotStatus;
  readonly manifest_uri: StorageUri;

  readonly record_counts: RecordCounts;
  readonly checksums: SnapshotChecksums;
  readonly files: readonly ManifestFile[];

  readonly sources: readonly ManifestSource[];
  readonly selection_policy: ManifestSelectionPolicy;

  /** Plain-language statement of what this file is and is not licensed under. */
  readonly rights_notice: string;
}

/**
 * The notice every snapshot carries.
 *
 * DATA_RIGHTS.md exists because "a repository that ships an MIT LICENSE and a
 * pile of acquired data implies that both are MIT, and that implication is
 * false in a way that is expensive for whoever believes it". A bulk export is
 * that implication in its most portable form — a file that will outlive the
 * conversation it came from — so the correction travels inside it.
 */
export const RIGHTS_NOTICE =
  'This dataset is not MIT-licensed. The MIT licence in the Data Foundry repository covers the ' +
  'platform code and cannot license data. Each contributing source below carries its own rights ' +
  'classification, attribution obligation and licence terms; honour them on every surface that ' +
  'displays or redistributes these rows. Attribution lines marked required must be rendered.';

/**
 * Project the manifest onto the `dataset_snapshots` insert it becomes.
 *
 * Parsed, not cast. If the manifest ever stops conforming to the table the
 * repository already ships, the build fails here with a Zod error rather than
 * succeeding and failing later at the INSERT — or, worse, succeeding at the
 * INSERT with a shape nothing else can read.
 */
export function toSnapshotInsert(
  manifest: DatasetExportManifest,
  status: SnapshotStatus = manifest.status,
): DatasetSnapshotInsert {
  return DatasetSnapshotInsertSchema.parse({
    vertical_id: manifest.vertical_id,
    version: manifest.version,
    generated_at: manifest.generated_at,
    record_counts: manifest.record_counts,
    schema_version: manifest.schema_version,
    manifest_uri: manifest.manifest_uri,
    checksums: manifest.checksums,
    status,
  });
}
