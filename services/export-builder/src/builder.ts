/**
 * `services/export-builder` — versioned dataset snapshots and bulk export.
 *
 * The shape of the thing, in one paragraph: read the canonical view through
 * `@data-foundry/query-model` (AGENTS.md rule 5 — no business SQL here, no
 * second fact-selection implementation), project each value through the shared
 * `toExportRow` serializer (ADR-0004), carry every value's evidence alongside
 * it (rule 10), refuse the whole export if any source behind a claim on an
 * exported property is not cleared to publish (rule 1), and write byte-identical
 * output for identical input so a published checksum means something.
 *
 * THE RIGHTS GATE READS WIDER THAN THE FILES. It audits every source behind a
 * stored CLAIM on an exported property; the manifest's per-source statistics
 * count only the SELECTED facts that were actually published. Those are two
 * different questions — may we build this at all, versus what is in the file —
 * and collapsing them is how a claim backed only by a blocked source became
 * invisible to the gate. See `audited` and `published` below.
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
 *
 * It bounds the WHOLE export, not each entity type in it. What is held in
 * memory is one merged set of entities with their facts, lineages and rows, so
 * a cap applied once per type would let an export naming three types hold three
 * times what this number says it can hold — and the message quoting the number
 * would be quoting something nobody had checked.
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
  compareKeys(
    [left.entity_type, left.canonical_slug, left.canonical_name, left.id],
    [right.entity_type, right.canonical_slug, right.canonical_name, right.id],
  );

/** One source's footprint in a set of facts: which facts, and how many links. */
interface SourceTally {
  readonly source: Source;
  readonly factIds: Set<string>;
  evidence: number;
}

/** Record one evidence link from `source` to `factId`. */
const tally = (into: Map<string, SourceTally>, source: Source, factId: string): void => {
  const existing = into.get(source.id);
  if (existing === undefined) {
    into.set(source.id, { source, factIds: new Set([factId]), evidence: 1 });
    return;
  }
  existing.factIds.add(factId);
  existing.evidence += 1;
};

/** One entity type's scope: the entities in it, and how many the layer reports. */
interface EntityScope {
  readonly entities: Entity[];
  readonly total: number;
}

/**
 * Enumerate the entities in scope for one entity type, through the query layer.
 *
 * A text-free `search` is the query layer's browse path; it applies the same
 * scope predicates a filtered search would, so this does not become a second
 * definition of "which entities exist". Its SQL orders by `canonical_name`
 * under the database's collation, so the result is re-sorted here on an
 * explicit, locale-independent, total key before anything is written.
 *
 * `claimed` is how many entities the types already enumerated put into the
 * export, so `MAX_EXPORT_ENTITIES` is checked against the merged total rather
 * than against this type alone. The check stays inside this loop, on the FIRST
 * page rather than on the assembled result, because the point of the bound is
 * to refuse before pulling ten thousand rows into memory — a limit enforced
 * after the enumeration it exists to prevent has already happened is a limit in
 * name only. Entity types partition the entities, so summing their reported
 * totals counts each entity once, which is why the caller deduplicates the type
 * list before it gets here.
 */
async function listEntities(
  qm: QueryModel,
  verticalId: VerticalId,
  entityType: Identifier | undefined,
  statuses: readonly EntityStatus[],
  claimed: number,
): Promise<EntityScope> {
  const found = new Map<string, Entity>();
  let offset = 0;
  let total: number | null = null;

  for (;;) {
    const page = await qm.search({
      vertical_id: verticalId,
      statuses,
      limit: SEARCH_PAGE,
      offset,
      ...(entityType === undefined ? {} : { entity_type: entityType }),
    });
    if (total === null) total = page.total;
    else if (page.total !== total) {
      throw new RangeError(
        `Export pagination total changed from ${total} to ${page.total} at offset ${offset}; ` +
          'refusing an apparently complete partial artifact.',
      );
    }
    if (claimed + page.total > MAX_EXPORT_ENTITIES) {
      throw new RangeError(
        `This export has ${claimed + page.total} entities in scope, above the ` +
          `${MAX_EXPORT_ENTITIES} this builder can gate in memory before writing. Refusing rather ` +
          'than exporting a silently truncated dataset.',
      );
    }
    if (page.hits.length === 0) {
      if (found.size !== total) {
        throw new RangeError(
          `Export pagination returned an empty page at offset ${offset} after ${found.size} of ` +
            `${total} claimed entities; refusing a partial artifact.`,
        );
      }
      break;
    }

    const before = found.size;
    for (const hit of page.hits) found.set(hit.entity.id, hit.entity);
    offset += page.hits.length;
    if (found.size === before) {
      throw new RangeError(
        `Export pagination made no unique progress at offset ${offset - page.hits.length}; ` +
          'refusing a partial artifact.',
      );
    }
    if (offset >= total) {
      if (found.size !== total) {
        throw new RangeError(
          `Export pagination reported ${total} entities but yielded ${found.size} unique rows; ` +
            'refusing a total-mismatch partial artifact.',
        );
      }
      break;
    }
  }

  return { entities: [...found.values()].sort(byEntityOrder), total: total ?? 0 };
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
  // The builder receives the internal model because its pre-write audit must
  // inspect claims that will NOT be published. All customer-bound selection is
  // nevertheless performed through the exact BULK_EXPORT surface. Keeping the
  // two handles visibly separate prevents an audit read from becoming a wire
  // read and prevents web/API grants from being mistaken for export rights.
  // Rights are judged when the snapshot is produced, even when the caller asks
  // for a historical fact view. Using `selection.at` here would resurrect a
  // grant that has since expired or been revoked.
  const bulk = qm.forSurface('BULK_EXPORT', { asOf: options.generatedAt });
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
  // Deduplicated, because each type's scope is counted towards
  // `MAX_EXPORT_ENTITIES` and the same type named twice is one scope, not two.
  // The caller's literal list still reaches the manifest: what they asked for is
  // part of what this snapshot is, and this is only how it is enumerated.
  const entityTypes: readonly (Identifier | undefined)[] =
    options.entityTypes === undefined ? [undefined] : [...new Set(options.entityTypes)];
  // Keyed by id, not accumulated into a list: a caller that names the same
  // entity type twice would otherwise publish every one of its rows twice, and
  // a duplicated row in a bulk file is the kind of defect a consumer discovers
  // by getting the wrong answer out of a GROUP BY.
  const byId = new Map<string, Entity>();
  let claimed = 0;
  for (const entityType of entityTypes) {
    const scope = await listEntities(qm, vertical.id, entityType, statuses, claimed);
    claimed += scope.total;
    for (const entity of scope.entities) byId.set(entity.id, entity);
  }
  const entities = [...byId.values()].sort(byEntityOrder);

  const exports: EntityExport[] = [];
  /**
   * Sources behind the values this export actually PUBLISHES — the evidence
   * chains of the selected facts. This is a statistic about the dataset, and it
   * is the only thing that reaches the manifest's per-source counts.
   */
  const published = new Map<string, SourceTally>();
  /**
   * Sources behind EVERY stored claim on a property this export includes,
   * whether or not selection picked that claim. This is what the rule-1 gate
   * audits, and it is deliberately wider than `published`.
   *
   * WHY WIDER. A claim whose only evidence comes from a RED or UNREVIEWED
   * source is excluded by the selection layer's rights filter, so it is never
   * selected and its canonical view carries `fact_id === null`. Reading the
   * gate's input off the selected facts alone therefore made exactly the source
   * rule 1 exists to stop invisible to it, and the export completed — the
   * control failed open on its own headline case. It also left the gate's
   * guarantee entirely derivative of the selection layer's rights filter, which
   * only sees `sources.rights_classification`; the declaration-level blockers
   * this service exists to catch (kill switch, lapsed review, redistribution
   * forbidden) are invisible to the database and so cannot be filtered there.
   *
   * WHY NOT WIDER STILL. Scoped to `propertyIsExportable`: a source that only
   * backs a property this export excludes publishes nothing here and must not
   * be able to refuse the build.
   */
  const audited = new Map<string, SourceTally>();

  for (const entity of entities) {
    // Read every stored claim, not only a selected one. This is the internal
    // audit pre-pass; none of these objects crosses the export boundary.
    const storedFacts = (await qm.facts({ entity_id: entity.id, at })).filter((stored) =>
      propertyIsExportable(properties, stored.fact.property),
    );
    for (const stored of storedFacts) {
      if (stored.lineage === null) continue;
      for (const link of stored.lineage.chain) tally(audited, link.source, stored.fact.id);
    }

    // Entity existence is an independently evidenced claim. A source with a
    // fact grant cannot manufacture permission to put the containing entity in
    // a downloadable dataset. This check deliberately precedes the no-facts
    // shortcut: a factless entity is still entity evidence on the bulk surface.
    if (await bulk.getEntity(entity.id) === null) {
      refusals.push({
        code: 'ENTITY_RIGHTS_MATRIX_REFUSED',
        // The surface-safe model deliberately does not disclose which
        // contribution failed. Keep the structured subject empty rather than
        // guessing and accusing an otherwise-cleared source.
        subject: null,
        message:
          `Entity ${entity.canonical_slug} existence provenance does not satisfy the exact ` +
          'BULK_EXPORT rights ' +
          'bundle. Public web, API, MCP and neighboring grants do not imply bulk permission.',
      });
      continue;
    }

    if (storedFacts.length === 0) continue;

    // The surface explanation returns only already-authorized candidate IDs
    // and no blocked-candidate oracle. Comparing that internal allow-set with
    // the wider audit read lets this builder retain its deliberate all-or-
    // nothing rule: a blocked rival claim on an exported property refuses the
    // snapshot instead of being silently omitted from a file that looks whole.
    const authorizedFactIds = new Set<string>();
    const exportedProperties = [...new Set(storedFacts.map((stored) => stored.fact.property))];
    for (const property of exportedProperties) {
      const explanation = await bulk.explainFact(entity.id, property, policy);
      for (const claim of explanation?.claims ?? []) authorizedFactIds.add(claim.fact_id);
    }
    for (const stored of storedFacts) {
      if (!authorizedFactIds.has(stored.fact.id)) {
        refusals.push({
          code: 'FACT_RIGHTS_MATRIX_REFUSED',
          subject: null,
          message:
            `${entity.canonical_slug}.${stored.fact.property} (stored fact ${stored.fact.id}) ` +
            'does not satisfy the exact BULK_EXPORT rights ' +
            'bundle. No neighboring surface grant can authorize this snapshot.',
        });
      }
    }

    const views = (await bulk.canonicalFacts(entity.id, policy)).filter((view) =>
      propertyIsExportable(properties, view.property),
    );
    const selectedIds = new Set<string>(
      views.map((view) => view.fact_id).filter((id): id is NonNullable<typeof id> => id !== null),
    );
    const lineages = new Map<string, FactLineage>();
    for (const stored of storedFacts) {
      if (stored.lineage !== null && selectedIds.has(stored.fact.id)) {
        lineages.set(stored.fact.id, stored.lineage);
      }
    }

    for (const view of views) {
      if (view.fact_id === null) continue;
      const lineage = lineages.get(view.fact_id);
      // Rule 2 makes an unevidenced fact unwritable and rule 10 makes an
      // unexplainable published value unacceptable. Either way, a selected
      // value we cannot trace is not something to ship quietly.
      //
      // This one stays scoped to SELECTED values on purpose. Rule 10 is about
      // explaining what an export publishes; an unselected claim publishes no
      // value, so there is nothing for it to owe an explanation for. The
      // rights gate above is the opposite kind of question — permission, not
      // explanation — which is why only that one was widened.
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
      for (const link of lineage.chain) tally(published, link.source, view.fact_id);
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

  // ---- gate 1: every source this export draws on is cleared to publish ----
  const contributing: ContributingSource[] = [...audited.values()]
    .map((entry) => ({
      source: entry.source,
      fact_ids: entry.factIds,
      evidence_count: entry.evidence,
    }))
    .sort((left, right) =>
      compareKeys(
        [left.source.domain, left.source.publisher, left.source.source_type, left.source.id],
        [right.source.domain, right.source.publisher, right.source.source_type, right.source.id],
      ),
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
  // MANIFEST STATISTICS DESCRIBE WHAT WAS PUBLISHED, NOT WHAT WAS AUDITED.
  //
  // `audit.cleared` is now the wider, gate-shaped set: it includes sources that
  // merely have a claim on an exported property. The manifest is a rights
  // document about the bytes in this snapshot — it is where a recipient reads
  // which credit lines they owe — so listing a source that contributed no
  // published value would overstate the dataset's provenance and demand
  // attribution for data that is not in the file. `fact_count` and
  // `evidence_count` therefore keep counting SELECTED facts, exactly as before
  // this gate was widened, and a cleared source with nothing published is
  // dropped from the list rather than reported with zeroes.
  const manifestSources: ManifestSource[] = audit.cleared
    .flatMap<ManifestSource>((cleared) => {
      const stats = published.get(cleared.source.id);
      if (stats === undefined) return [];
      return [
        {
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
          fact_count: stats.factIds.size,
          evidence_count: stats.evidence,
        },
      ];
    })
    .sort((left, right) => compareKeys([left.source_key], [right.source_key]));

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
      sources: manifestSources.length,
    },
    checksums,
    files,
    sources: manifestSources,
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
        facts: ['entity_type', 'entity_slug', 'property', 'entity_id'],
        evidence: [
          'entity_slug',
          'property',
          'source_key',
          'source_publisher',
          'source_domain',
          'artifact_content_hash',
          'artifact_url',
          'artifact_retrieved_at',
          'locator_type',
          'locator_value',
          'source_value',
          'observed_at',
          'entity_id',
          'fact_id',
          'evidence_id',
        ],
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
