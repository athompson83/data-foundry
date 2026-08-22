/**
 * `services/export-builder` — versioned dataset snapshots and bulk export.
 *
 * The shape of the thing, in one paragraph: read the canonical view through
 * `@data-foundry/query-model` (AGENTS.md rule 5 — no business SQL here, no
 * second fact-selection implementation), project each value through the shared
 * `toExportRow` serializer (ADR-0004), carry every value's evidence alongside
 * it (rule 10), refuse the whole export if any contributing source is not
 * cleared to publish (rule 1), and write byte-identical output for identical
 * input so a published checksum means something.
 *
 * ORDER OF OPERATIONS IS PART OF THE DESIGN. Every gate runs before the first
 * byte reaches the sink. A builder that streams rows and discovers a RED source
 * halfway through has already published it; the refusal has to happen while
 * everything is still in memory. That costs the ability to stream very large
 * datasets, which is a real cost, taken deliberately — see `MAX_EXPORT_ENTITIES`
 * for the honest limit that follows from it.
 *
 * NOT IN SCOPE, DELIBERATELY:
 *   - Parquet. AGENTS.md wants it for analytical output; it needs a columnar
 *     encoder and this service adds no dependencies. JSONL and CSV ship.
 *   - Uploading anywhere. No R2 bucket is configured and nothing here makes a
 *     network call; `ExportSink` is the seam a bucket plugs into later.
 *   - Writing `dataset_snapshots`. That needs a `CanonicalStore`, which the
 *     query model deliberately does not expose (its driver-boundary test exists
 *     to keep it that way). `snapshot.ts` takes an injected store instead, the
 *     way the ingest worker receives one at its composition root.
 */
import {
  compareKeys,
  type Entity,
  type EntityStatus,
  type Identifier,
  type IsoDateTime,
  type SchemaVersion,
  type Slug,
  type SnapshotStatus,
  type Source,
  type VerticalId,
} from '@data-foundry/canonical-schema';
import { resolveFactSelectionPolicy, type FactSelectionPolicy } from '@data-foundry/canonical-store';
import type { FactLineage } from '@data-foundry/provenance';
import type { CanonicalFactView, QueryModel } from '@data-foundry/query-model';
import type { SourceRegistryEntry } from '@data-foundry/source-registry';
import { sha256, stableJson, utf8 } from './bytes.js';
import { csvDocument, type CsvValue } from './csv.js';
import { ExportRefusedError, type ExportRefusal } from './errors.js';
import { jsonlDocument, type JsonlValue } from './jsonl.js';
import {
  EXPORT_CONTRACT_VERSION,
  MANIFEST_VERSION,
  RIGHTS_NOTICE,
  propertyIsExportable,
  toSnapshotInsert,
  type DatasetExportManifest,
  type ExportFileContent,
  type ExportFileFormat,
  type ManifestFile,
  type ManifestSource,
  type PropertyPolicy,
} from './manifest.js';
import {
  assertArtifactCarriesNoReviewerIdentity,
  assertNoInternalText,
  assertRowsCarryNoReviewerIdentity,
  declaredReviewers,
  internalOnlyText,
} from './privacy.js';
import { auditContributingSources, type ContributingSource } from './rights.js';
import {
  EXPORT_EVIDENCE_COLUMNS,
  EXPORT_ROW_COLUMNS,
  compareEvidenceRows,
  compareExportRows,
  exportEvidenceRow,
  exportRow,
  type ExportEvidenceRow,
  type ExportRow,
} from './rows.js';
import type { ExportSink } from './sink.js';

export const FACTS_JSONL = 'facts.jsonl';
export const FACTS_CSV = 'facts.csv';
export const EVIDENCE_JSONL = 'evidence.jsonl';
export const MANIFEST_JSON = 'manifest.json';

/** The largest page `searchEntities` will accept. */
const SEARCH_PAGE = 200;

/**
 * The point at which "hold the whole export in memory and gate it before
 * writing" stops being reasonable.
 *
 * It is also where the query layer's own `offset` clamp (10 000) starts
 * silently truncating a paged enumeration, and a truncated export that reports
 * success is precisely the silent-drop failure this service exists to refuse.
 * So it throws instead. Exporting a larger vertical needs a streaming design
 * with a rights pre-pass, which is a different piece of work.
 */
export const MAX_EXPORT_ENTITIES = 10_000;

export interface DatasetExportOptions {
  /** The canonical query layer. The only read path (rule 5). */
  readonly queryModel: QueryModel;
  readonly vertical: {
    readonly id: VerticalId;
    readonly slug: Slug;
    readonly schema_version: SchemaVersion;
  };
  /** Monotonic, human-quotable, e.g. `2026-08-14.1`. Unique per vertical. */
  readonly version: string;
  /**
   * Required, not defaulted to `Date.now()`. A snapshot whose timestamp comes
   * from the wall clock cannot be rebuilt byte-for-byte, which makes its
   * checksum unverifiable — and an unverifiable checksum is decoration.
   */
  readonly generatedAt: IsoDateTime;
  readonly sink: ExportSink;
  /**
   * The rights declarations for the vertical's sources. Required: a
   * contributing source with no declaration is refused, because the easiest way
   * to pass a gate is to not supply the thing it inspects.
   */
  readonly sourceRegistry: readonly SourceRegistryEntry[];
  /** Which properties may be published. No default; see `PropertyPolicy`. */
  readonly properties: PropertyPolicy;
  /** Fact-selection policy. `at` defaults to `generatedAt`. */
  readonly selection?: Partial<FactSelectionPolicy>;
  readonly entityTypes?: readonly Identifier[];
  readonly entityStatuses?: readonly EntityStatus[];
  /** Snapshot lifecycle state recorded in the manifest. Default `PUBLISHED`. */
  readonly status?: SnapshotStatus;
}

export interface DatasetExportResult {
  readonly manifest: DatasetExportManifest;
  /** Digest of `manifest.json` itself, which cannot appear inside it. */
  readonly manifestSha256: string;
  readonly rows: readonly ExportRow[];
  readonly evidence: readonly ExportEvidenceRow[];
  /** Exactly what was handed to the sink, path → bytes. */
  readonly artifacts: ReadonlyMap<string, Uint8Array>;
}

interface EntityExport {
  readonly entity: Entity;
  readonly views: readonly CanonicalFactView[];
  readonly lineages: ReadonlyMap<string, FactLineage>;
}

interface PendingFile {
  readonly path: string;
  readonly text: string;
  readonly format: ExportFileFormat;
  readonly content: ExportFileContent;
  readonly rows: number;
  readonly columns: readonly string[];
}

const pick = (row: object, columns: readonly string[]): readonly CsvValue[] =>
  columns.map((column) => (row as Record<string, unknown>)[column] as CsvValue);

const asJsonlRecord = (row: object, columns: readonly string[]): Record<string, JsonlValue> => {
  const out: Record<string, JsonlValue> = {};
  for (const column of columns) out[column] = (row as Record<string, unknown>)[column] as JsonlValue;
  return out;
};

const byEntityOrder = (left: Entity, right: Entity): number =>
  compareKeys([left.canonical_slug, left.id], [right.canonical_slug, right.id]);

/**
 * Enumerate the entities in scope, through the query layer.
 *
 * A text-free `search` is the query layer's browse path; it applies the same
 * scope predicates a filtered search would, so this does not become a second
 * definition of "which entities exist". Its SQL orders by `canonical_name`
 * under the database's collation, so the result is re-sorted here on an
 * explicit, locale-independent, total key before anything is written.
 */
async function listEntities(
  qm: QueryModel,
  verticalId: VerticalId,
  entityType: Identifier | undefined,
  statuses: readonly EntityStatus[],
): Promise<Entity[]> {
  const found = new Map<string, Entity>();
  let offset = 0;

  for (;;) {
    const page = await qm.search({
      vertical_id: verticalId,
      statuses,
      limit: SEARCH_PAGE,
      offset,
      ...(entityType === undefined ? {} : { entity_type: entityType }),
    });
    if (page.total > MAX_EXPORT_ENTITIES) {
      throw new RangeError(
        `This vertical has ${page.total} entities in scope, above the ${MAX_EXPORT_ENTITIES} this ` +
          'builder can gate in memory before writing. Refusing rather than exporting a silently ' +
          'truncated dataset.',
      );
    }
    if (page.hits.length === 0) break;

    const before = found.size;
    for (const hit of page.hits) found.set(hit.entity.id, hit.entity);
    offset += page.hits.length;
    if (offset >= page.total) break;
    // Defensive: a page that adds nothing new means paging is not advancing,
    // and looping forever is worse than stopping with what we have.
    if (found.size === before) break;
  }

  return [...found.values()].sort(byEntityOrder);
}

/**
 * Build a dataset snapshot: gate it, serialize it, then write it.
 *
 * Throws `ExportRefusedError` (nothing written), `ReviewerIdentityLeak`,
 * `InternalTextLeak` or a Zod error from the `dataset_snapshots` projection
 * before any byte reaches the sink.
 */
export async function buildDatasetExport(
  options: DatasetExportOptions,
): Promise<DatasetExportResult> {
  const { queryModel: qm, vertical, sink, properties } = options;
  const at = options.selection?.at ?? options.generatedAt;
  const policy = resolveFactSelectionPolicy({ ...(options.selection ?? {}), at });
  const statuses: readonly EntityStatus[] = options.entityStatuses ?? ['ACTIVE'];
  const refusals: ExportRefusal[] = [];

  // ---- gate 0: the caller may not switch rule 1 off ----------------------
  // `requirePublishableRights: false` is a legitimate setting for an internal
  // analysis read. It is not a legitimate setting for a publication surface,
  // and an export builder that honoured it would launder RED evidence into a
  // customer file with the selection layer's blessing.
  if (policy.requirePublishableRights !== true) {
    refusals.push({
      code: 'SELECTION_POLICY_DISABLES_RIGHTS_GATE',
      subject: null,
      message:
        'The fact-selection policy sets requirePublishableRights=false, which lets RED and ' +
        'UNREVIEWED evidence back a selected value. That is available for internal analysis; ' +
        'it is not available for an export, which is publication (AGENTS.md rule 1).',
    });
  }

  // ---- read the canonical view through the query layer --------------------
  const entityTypes: readonly (Identifier | undefined)[] = options.entityTypes ?? [undefined];
  const entities: Entity[] = [];
  for (const entityType of entityTypes) {
    entities.push(...(await listEntities(qm, vertical.id, entityType, statuses)));
  }
  entities.sort(byEntityOrder);

  const exports: EntityExport[] = [];
  const contributors = new Map<string, { source: Source; factIds: Set<string>; evidence: number }>();

  for (const entity of entities) {
    const all = await qm.canonicalFacts(entity.id, policy);
    const views = all.filter((view) => propertyIsExportable(properties, view.property));
    if (views.length === 0) continue;

    const selectedIds = new Set<string>(
      views.map((view) => view.fact_id).filter((id): id is NonNullable<typeof id> => id !== null),
    );
    const lineages = new Map<string, FactLineage>();
    if (selectedIds.size > 0) {
      for (const withEvidence of await qm.facts({ entity_id: entity.id, at })) {
        if (selectedIds.has(withEvidence.fact.id) && withEvidence.lineage !== null) {
          lineages.set(withEvidence.fact.id, withEvidence.lineage);
        }
      }
    }

    for (const view of views) {
      if (view.fact_id === null) continue;
      const lineage = lineages.get(view.fact_id);
      // Rule 2 makes an unevidenced fact unwritable and rule 10 makes an
      // unexplainable published value unacceptable. Either way, a selected
      // value we cannot trace is not something to ship quietly.
      if (lineage === undefined || lineage.chain.length === 0) {
        refusals.push({
          code: 'FACT_WITHOUT_TRACEABLE_EVIDENCE',
          subject: null,
          message:
            `${entity.canonical_slug}.${view.property} was selected as the canonical value but no ` +
            'evidence chain leads back to a source artifact. An export must be able to explain ' +
            'every value it publishes (AGENTS.md rule 10).',
        });
        continue;
      }
      for (const link of lineage.chain) {
        const existing = contributors.get(link.source.id);
        if (existing === undefined) {
          contributors.set(link.source.id, {
            source: link.source,
            factIds: new Set([view.fact_id as string]),
            evidence: 1,
          });
        } else {
          existing.factIds.add(view.fact_id);
          existing.evidence += 1;
        }
      }
    }

    exports.push({ entity, views, lineages });
  }

  // Fact rows are materialized before the gates so the gates can inspect what
  // will actually be published rather than the intermediate it came from.
  const rows: ExportRow[] = [];
  for (const entry of exports) {
    for (const view of entry.views) rows.push(exportRow(vertical.slug, entry.entity, view));
  }
  rows.sort(compareExportRows);

  // ---- gate 1: every contributing source is cleared to publish -----------
  const contributing: ContributingSource[] = [...contributors.values()]
    .map((entry) => ({
      source: entry.source,
      fact_ids: entry.factIds,
      evidence_count: entry.evidence,
    }))
    .sort((left, right) =>
      compareKeys([left.source.domain, left.source.id], [right.source.domain, right.source.id]),
    );

  const audit = auditContributingSources(
    contributing,
    options.sourceRegistry,
    vertical.slug,
    options.generatedAt,
  );
  refusals.push(...audit.refusals);

  // ---- gate 2: no excluded property reached the published rows -----------
  for (const row of rows) {
    if (!propertyIsExportable(properties, row.property)) {
      refusals.push({
        code: 'EXCLUDED_PROPERTY_PRESENT',
        subject: null,
        message:
          `Property "${row.property}" is excluded by the export policy but reached the published ` +
          `row set (entity ${row.entity_slug}).`,
      });
    }
  }

  if (refusals.length > 0) throw new ExportRefusedError(refusals);

  // ---- privacy controls, before serialization ----------------------------
  const reviewers = declaredReviewers(policy.editorialOverrides, options.sourceRegistry);
  assertRowsCarryNoReviewerIdentity(
    exports.flatMap((entry) => [...entry.views]),
    reviewers,
  );

  // ---- evidence rows (rule 10) ------------------------------------------
  const sourceKeyById = new Map(
    audit.cleared.map((cleared) => [cleared.source.id as string, cleared.entry.key] as const),
  );
  const evidence: ExportEvidenceRow[] = [];
  for (const entry of exports) {
    for (const view of entry.views) {
      if (view.fact_id === null) continue;
      const lineage = entry.lineages.get(view.fact_id);
      if (lineage === undefined) continue;
      for (const link of lineage.chain) {
        evidence.push(
          exportEvidenceRow(
            entry.entity,
            view.property,
            view.fact_id,
            sourceKeyById.get(link.source.id) ?? link.source.domain,
            link,
          ),
        );
      }
    }
  }
  evidence.sort(compareEvidenceRows);

  // ---- serialize --------------------------------------------------------
  const pending: readonly PendingFile[] = [
    {
      path: FACTS_JSONL,
      text: jsonlDocument(
        EXPORT_ROW_COLUMNS,
        rows.map((row) => asJsonlRecord(row, EXPORT_ROW_COLUMNS)),
      ),
      format: 'jsonl',
      content: 'facts',
      rows: rows.length,
      columns: EXPORT_ROW_COLUMNS,
    },
    {
      path: FACTS_CSV,
      text: csvDocument(
        EXPORT_ROW_COLUMNS,
        rows.map((row) => pick(row, EXPORT_ROW_COLUMNS)),
      ),
      format: 'csv',
      content: 'facts',
      rows: rows.length,
      columns: EXPORT_ROW_COLUMNS,
    },
    {
      path: EVIDENCE_JSONL,
      text: jsonlDocument(
        EXPORT_EVIDENCE_COLUMNS,
        evidence.map((row) => asJsonlRecord(row, EXPORT_EVIDENCE_COLUMNS)),
      ),
      format: 'jsonl',
      content: 'evidence',
      rows: evidence.length,
      columns: EXPORT_EVIDENCE_COLUMNS,
    },
  ];

  const internal = internalOnlyText(options.sourceRegistry);
  const artifacts = new Map<string, Uint8Array>();
  const files: ManifestFile[] = [];
  const checksums: Record<string, string> = {};

  for (const file of pending) {
    assertArtifactCarriesNoReviewerIdentity(file.path, file.text, reviewers);
    assertNoInternalText(file.path, file.text, internal);
    const bytes = utf8(file.text);
    const digest = sha256(bytes);
    artifacts.set(file.path, bytes);
    checksums[file.path] = digest;
    files.push({
      path: file.path,
      format: file.format,
      content: file.content,
      rows: file.rows,
      bytes: bytes.byteLength,
      sha256: digest,
      columns: file.columns,
    });
  }

  // ---- manifest ---------------------------------------------------------
  const manifest: DatasetExportManifest = {
    manifest_version: MANIFEST_VERSION,
    contract_version: EXPORT_CONTRACT_VERSION,
    vertical_id: vertical.id,
    vertical_slug: vertical.slug,
    version: options.version,
    generated_at: options.generatedAt,
    schema_version: vertical.schema_version,
    status: options.status ?? 'PUBLISHED',
    manifest_uri: sink.uriFor(MANIFEST_JSON),
    record_counts: {
      entities: exports.length,
      facts: rows.filter((row) => row.fact_id !== null).length,
      fact_evidence: evidence.length,
      sources: audit.cleared.length,
    },
    checksums,
    files,
    sources: audit.cleared
      .map<ManifestSource>((cleared) => ({
        source_key: cleared.entry.key,
        source_id: cleared.source.id,
        publisher: cleared.source.publisher,
        domain: cleared.source.domain,
        source_type: cleared.source.source_type,
        authority_rank: cleared.source.authority_rank,
        rights: {
          rights_classification: cleared.source.rights_classification,
          requires_legal_review: cleared.requires_legal_review,
          // The obligation as the DATABASE records it: that row is what the
          // published values were actually selected under.
          attribution_required: cleared.source.attribution_requirement.required,
          attribution_text: cleared.source.attribution_requirement.text,
          attribution_url: cleared.source.attribution_requirement.url,
          license_id: cleared.entry.rights_policy.license_id,
          data_license_id: cleared.entry.license_split.data_license_id,
          terms_url: cleared.entry.rights_policy.terms_url,
          commercial_use_allowed: cleared.entry.rights_policy.commercial_use_allowed,
          redistribution_allowed: cleared.entry.rights_policy.redistribution_allowed,
          derivative_normalization_allowed:
            cleared.entry.rights_policy.derivative_normalization_allowed,
          personal_data_present: cleared.entry.rights_policy.personal_data_present,
          warnings: cleared.warnings.map((warning) => `${warning.code}: ${warning.message}`),
        },
        fact_count: cleared.fact_ids.size,
        evidence_count: cleared.evidence_count,
      }))
      .sort((left, right) => compareKeys([left.source_key], [right.source_key])),
    selection_policy: {
      at: policy.at,
      require_publishable_rights: policy.requirePublishableRights,
      authoritative_source_types: [...policy.authoritativeSourceTypes],
      authoritative_sources_by_property: policy.authoritativeSourcesByProperty,
      field_reliability: policy.fieldReliability,
      consistency_checks: policy.consistencyChecks
        .map((check) => check.id)
        .sort((left, right) => compareKeys([left], [right])),
      // Reason travels; reviewer does not, and there is no field for it here.
      editorial_overrides: policy.editorialOverrides.map((override) => ({
        source: override.source,
        properties: override.properties === undefined ? null : [...override.properties],
        reason: override.reason,
      })),
      entity_types: options.entityTypes === undefined ? null : [...options.entityTypes],
      entity_statuses: [...statuses],
      properties,
      ordering: {
        facts: ['entity_slug', 'entity_id', 'property'],
        evidence: ['entity_slug', 'entity_id', 'property', 'fact_id', 'source_key', 'evidence_id'],
      },
    },
    rights_notice: RIGHTS_NOTICE,
  };

  // Conformance with the table the repository already ships. Parsed, not cast:
  // a manifest that has drifted fails here, not at INSERT time.
  toSnapshotInsert(manifest);

  const manifestJson = `${stableJson(manifest)}\n`;
  assertArtifactCarriesNoReviewerIdentity(MANIFEST_JSON, manifestJson, reviewers);
  assertNoInternalText(MANIFEST_JSON, manifestJson, internal);
  const manifestBytes = utf8(manifestJson);
  artifacts.set(MANIFEST_JSON, manifestBytes);

  // ---- write. Everything above this line can still refuse. ---------------
  for (const [path, bytes] of artifacts) {
    await sink.write(path, bytes);
  }

  return {
    manifest,
    manifestSha256: sha256(manifestBytes),
    rows,
    evidence,
    artifacts,
  };
}
