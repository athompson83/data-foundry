/**
 * Field-level lineage.
 *
 * For any canonical fact, walk the full chain the platform is required to be
 * able to show:
 *
 * ```text
 * fact → fact_evidence → source_record → source_artifact → source
 * ```
 *
 * carrying the locator (which selector/page/pointer the value was read from)
 * and `retrieved_at` (when those exact bytes were captured) all the way out.
 * That chain is what makes AGENTS.md rule 2 auditable rather than aspirational,
 * and what lets a disputed value be re-checked without re-crawling (rule 10).
 */
import {
  ARTIFACT_COLUMNS,
  FACT_COLUMNS,
  FACT_EVIDENCE_COLUMNS,
  RELATIONSHIP_COLUMNS,
  RELATIONSHIP_EVIDENCE_COLUMNS,
  SOURCE_COLUMNS,
  SOURCE_RECORD_COLUMNS,
  mapFact,
  mapFactEvidence,
  mapRelationship,
  mapRelationshipEvidence,
  mapSource,
  mapSourceArtifact,
  mapSourceRecord,
  prefixColumns,
  unprefixRow,
  type SqlDriver,
} from '@data-foundry/canonical-store';
import {
  canPublish,
  type EntityId,
  type Fact,
  type FactEvidence,
  type FactId,
  type IsoDateTime,
  type LocatorType,
  type Relationship,
  type RelationshipEvidence,
  type RelationshipId,
  type RightsClassification,
  type Source,
  type SourceArtifact,
  type SourceRecord,
} from '@data-foundry/canonical-schema';

/** Where in an artifact a claim was read. */
export interface EvidenceLocator {
  readonly type: LocatorType;
  readonly value: string;
}

/** One complete hop from a claim back to the bytes that support it. */
export interface EvidenceChainLink {
  readonly evidence: FactEvidence | RelationshipEvidence;
  readonly source_record: SourceRecord;
  readonly artifact: SourceArtifact;
  readonly source: Source;
  readonly locator: EvidenceLocator;
  /** The value exactly as the source wrote it, before normalization. */
  readonly source_value: string;
  /** When the claim was read out of the artifact. */
  readonly observed_at: IsoDateTime;
  /** When those exact bytes were captured. */
  readonly retrieved_at: IsoDateTime;
  readonly rights: RightsClassification;
  /** May this link back a published value? (AGENTS.md rule 1) */
  readonly publishable: boolean;
}

export interface FactLineage {
  readonly fact: Fact;
  readonly chain: readonly EvidenceChainLink[];
  /** At least one complete chain back to a source. */
  readonly traceable: boolean;
  readonly distinct_sources: number;
  readonly publishable_sources: number;
}

export interface RelationshipLineage {
  readonly relationship: Relationship;
  readonly chain: readonly EvidenceChainLink[];
  readonly traceable: boolean;
  readonly distinct_sources: number;
  readonly publishable_sources: number;
}

const CHAIN_SELECT = (evidenceTable: string, evidenceColumns: string, key: string) =>
  `SELECT ${prefixColumns('fe', evidenceColumns, 'fe_')},
          ${prefixColumns('sr', SOURCE_RECORD_COLUMNS, 'sr_')},
          ${prefixColumns('sa', ARTIFACT_COLUMNS, 'sa_')},
          ${prefixColumns('s', SOURCE_COLUMNS, 's_')}
     FROM ${evidenceTable} fe
     JOIN source_records sr ON sr.id = fe.source_record_id
     JOIN source_artifacts sa ON sa.id = fe.artifact_id
     JOIN sources s ON s.id = sr.source_id
    WHERE fe.${key} = $1
    ORDER BY fe.observed_at, fe.id`;

function summarize(chain: readonly EvidenceChainLink[]): {
  traceable: boolean;
  distinct_sources: number;
  publishable_sources: number;
} {
  const all = new Set(chain.map((link) => link.source.id));
  const publishable = new Set(
    chain.filter((link) => link.publishable).map((link) => link.source.id),
  );
  return {
    traceable: chain.length > 0,
    distinct_sources: all.size,
    publishable_sources: publishable.size,
  };
}

/** The full lineage of one canonical fact. Returns `null` if the fact is gone. */
export async function factLineage(driver: SqlDriver, factId: FactId): Promise<FactLineage | null> {
  const factRows = await driver.query(`SELECT ${FACT_COLUMNS} FROM facts WHERE id = $1`, [factId]);
  const factRow = factRows[0];
  if (factRow === undefined) return null;
  const fact = mapFact(factRow);

  const rows = await driver.query(CHAIN_SELECT('fact_evidence', FACT_EVIDENCE_COLUMNS, 'fact_id'), [
    factId,
  ]);
  const chain = rows.map((row) => {
    const evidence = mapFactEvidence(unprefixRow(row, 'fe_'));
    return link(
      evidence,
      evidence.locator_type,
      evidence.locator_value,
      evidence.source_value,
      evidence.observed_at,
      row,
    );
  });

  return { fact, chain, ...summarize(chain) };
}

/** The full lineage of one canonical relationship. */
export async function relationshipLineage(
  driver: SqlDriver,
  relationshipId: RelationshipId,
): Promise<RelationshipLineage | null> {
  const rows = await driver.query(
    `SELECT ${RELATIONSHIP_COLUMNS} FROM relationships WHERE id = $1`,
    [relationshipId],
  );
  const row = rows[0];
  if (row === undefined) return null;
  const relationship = mapRelationship(row);

  const chainRows = await driver.query(
    CHAIN_SELECT('relationship_evidence', RELATIONSHIP_EVIDENCE_COLUMNS, 'relationship_id'),
    [relationshipId],
  );
  const chain = chainRows.map((chainRow) => {
    const evidence = mapRelationshipEvidence(unprefixRow(chainRow, 'fe_'));
    return link(
      evidence,
      evidence.locator_type,
      evidence.locator_value,
      evidence.source_value,
      evidence.observed_at,
      chainRow,
    );
  });

  return { relationship, chain, ...summarize(chain) };
}

/** Lineage for every fact of one entity, keyed by fact id. */
export async function entityLineage(
  driver: SqlDriver,
  entityId: EntityId,
  options: { readonly include_history?: boolean } = {},
): Promise<Map<FactId, FactLineage>> {
  const rows = await driver.query<{ id: string }>(
    `SELECT id FROM facts WHERE entity_id = $1
       ${options.include_history === true ? '' : `AND status <> 'RETRACTED' AND valid_to IS NULL`}
      ORDER BY property, valid_from`,
    [entityId],
  );
  const lineages = new Map<FactId, FactLineage>();
  for (const { id } of rows) {
    const lineage = await factLineage(driver, id as FactId);
    if (lineage !== null) lineages.set(lineage.fact.id, lineage);
  }
  return lineages;
}

function link(
  evidence: FactEvidence | RelationshipEvidence,
  locatorType: LocatorType,
  locatorValue: string,
  sourceValue: string,
  observedAt: IsoDateTime,
  row: Record<string, unknown>,
): EvidenceChainLink {
  const source = mapSource(unprefixRow(row, 's_'));
  const artifact = mapSourceArtifact(unprefixRow(row, 'sa_'));
  return {
    evidence,
    source_record: mapSourceRecord(unprefixRow(row, 'sr_')),
    artifact,
    source,
    locator: { type: locatorType, value: locatorValue },
    source_value: sourceValue,
    observed_at: observedAt,
    retrieved_at: artifact.retrieved_at,
    rights: source.rights_classification,
    publishable: canPublish(source.rights_classification),
  };
}

/** One-line citation for a link, for logs, exports and `llms.txt`-style output. */
export function citation(link: EvidenceChainLink): string {
  const locator =
    link.locator.type === 'WHOLE_DOCUMENT' ? 'whole document' : `${link.locator.type} ${link.locator.value}`;
  return (
    `${link.source.publisher} (${link.source.domain}) — "${link.source_value}" ` +
    `at ${locator}; artifact ${link.artifact.url} retrieved ${link.retrieved_at}`
  );
}
