/**
 * Provenance coverage — the measurable gate.
 *
 * AGENTS.md's testing requirements say every change must preserve provenance
 * coverage. That is only enforceable if coverage is a number, computed the same
 * way every time, over the same denominator. This module is that number.
 *
 * "Traceable" means the *whole* chain resolves:
 * `fact → fact_evidence → source_record → source_artifact → source`. An
 * evidence row that cannot be followed back to a real source is not provenance,
 * so it does not count — which is why the query joins rather than merely
 * checking for the existence of a `fact_evidence` row.
 */
import type { SqlDriver, SqlParam } from '@data-foundry/canonical-store';
import type { EntityId, FactId, IsoDateTime, RelationshipId, VerticalId } from '@data-foundry/canonical-schema';

export interface CoverageTotals {
  readonly total: number;
  readonly traceable: number;
  /** `traceable / total`, or 1 when there is nothing to trace. */
  readonly coverage: number;
}

export interface VerticalCoverage extends CoverageTotals {
  readonly vertical_id: VerticalId;
  readonly vertical_slug: string;
}

export interface EntityCoverage extends CoverageTotals {
  readonly entity_id: EntityId;
  readonly canonical_slug: string;
  readonly entity_type: string;
  readonly vertical_id: VerticalId;
}

export interface ProvenanceCoverageOptions {
  readonly vertical_id?: VerticalId;
  readonly entity_id?: EntityId;
  /**
   * Count withdrawn claims too. Defaults to **true**: retracting a claim does
   * not retract the obligation to be able to explain why it was ever published
   * (AGENTS.md rule 10), so a RETRACTED fact with no evidence is still a
   * provenance failure.
   */
  readonly include_retracted?: boolean;
  /** Cap on the list of offending fact ids returned. Default 100. */
  readonly max_untraceable?: number;
}

export interface ProvenanceCoverageReport {
  readonly generated_at: IsoDateTime;
  readonly scope: {
    readonly vertical_id: VerticalId | null;
    readonly entity_id: EntityId | null;
    readonly include_retracted: boolean;
  };
  readonly facts: CoverageTotals;
  readonly relationships: CoverageTotals;
  readonly by_vertical: readonly VerticalCoverage[];
  readonly by_entity: readonly EntityCoverage[];
  /** The actionable list: claims that cannot be defended. */
  readonly untraceable_fact_ids: readonly FactId[];
  readonly untraceable_relationship_ids: readonly RelationshipId[];
}

const ratio = (traceable: number, total: number): number => (total === 0 ? 1 : traceable / total);

const num = (value: unknown): number => Number(value ?? 0);

/**
 * `facts` joined to a boolean saying whether its evidence chain fully resolves.
 * Kept as a subquery because an aggregate `FILTER` clause may not contain a
 * subquery in Postgres.
 */
const FACT_BASE = (where: string) => `
  SELECT e.vertical_id AS vertical_id,
         v.slug        AS vertical_slug,
         e.id          AS entity_id,
         e.canonical_slug AS canonical_slug,
         e.entity_type AS entity_type,
         f.id          AS fact_id,
         EXISTS (
           SELECT 1
             FROM fact_evidence fe
             JOIN source_records sr ON sr.id = fe.source_record_id
             JOIN source_artifacts sa ON sa.id = fe.artifact_id
             JOIN sources s ON s.id = sr.source_id
            WHERE fe.fact_id = f.id
         ) AS traceable
    FROM facts f
    JOIN entities e ON e.id = f.entity_id
    JOIN verticals v ON v.id = e.vertical_id
   WHERE ${where}`;

const RELATIONSHIP_BASE = (where: string) => `
  SELECT r.vertical_id AS vertical_id,
         r.id          AS relationship_id,
         EXISTS (
           SELECT 1
             FROM relationship_evidence re
             JOIN source_records sr ON sr.id = re.source_record_id
             JOIN source_artifacts sa ON sa.id = re.artifact_id
             JOIN sources s ON s.id = sr.source_id
            WHERE re.relationship_id = r.id
         ) AS traceable
    FROM relationships r
   WHERE ${where}`;

/**
 * Fraction of facts (and relationships) with a fully traceable evidence chain,
 * overall and broken down per entity and per vertical.
 */
export async function provenanceCoverage(
  driver: SqlDriver,
  options: ProvenanceCoverageOptions = {},
): Promise<ProvenanceCoverageReport> {
  const includeRetracted = options.include_retracted ?? true;
  const maxUntraceable = options.max_untraceable ?? 100;

  const factParams: SqlParam[] = [];
  const factClauses: string[] = ['TRUE'];
  const relParams: SqlParam[] = [];
  const relClauses: string[] = ['TRUE'];

  if (options.vertical_id !== undefined) {
    factParams.push(options.vertical_id);
    factClauses.push(`e.vertical_id = $${factParams.length}`);
    relParams.push(options.vertical_id);
    relClauses.push(`r.vertical_id = $${relParams.length}`);
  }
  if (options.entity_id !== undefined) {
    factParams.push(options.entity_id);
    factClauses.push(`f.entity_id = $${factParams.length}`);
    relParams.push(options.entity_id);
    relClauses.push(
      `(r.subject_entity_id = $${relParams.length} OR r.object_entity_id = $${relParams.length})`,
    );
  }
  if (!includeRetracted) {
    factClauses.push(`f.status <> 'RETRACTED'`);
    relClauses.push(`r.status <> 'RETRACTED'`);
  }

  const factBase = FACT_BASE(factClauses.join(' AND '));
  const relBase = RELATIONSHIP_BASE(relClauses.join(' AND '));

  const byEntityRows = await driver.query(
    `SELECT vertical_id, vertical_slug, entity_id, canonical_slug, entity_type,
            count(*)::text AS total,
            count(*) FILTER (WHERE traceable)::text AS traceable
       FROM (${factBase}) base
      GROUP BY vertical_id, vertical_slug, entity_id, canonical_slug, entity_type
      ORDER BY canonical_slug`,
    factParams,
  );

  const byEntity: EntityCoverage[] = byEntityRows.map((row) => {
    const total = num(row['total']);
    const traceable = num(row['traceable']);
    return {
      vertical_id: String(row['vertical_id']) as VerticalId,
      entity_id: String(row['entity_id']) as EntityId,
      canonical_slug: String(row['canonical_slug']),
      entity_type: String(row['entity_type']),
      total,
      traceable,
      coverage: ratio(traceable, total),
    };
  });

  const byVerticalRows = await driver.query(
    `SELECT vertical_id, vertical_slug,
            count(*)::text AS total,
            count(*) FILTER (WHERE traceable)::text AS traceable
       FROM (${factBase}) base
      GROUP BY vertical_id, vertical_slug
      ORDER BY vertical_slug`,
    factParams,
  );

  const byVertical: VerticalCoverage[] = byVerticalRows.map((row) => {
    const total = num(row['total']);
    const traceable = num(row['traceable']);
    return {
      vertical_id: String(row['vertical_id']) as VerticalId,
      vertical_slug: String(row['vertical_slug']),
      total,
      traceable,
      coverage: ratio(traceable, total),
    };
  });

  const untraceableFactRows = await driver.query(
    `SELECT fact_id FROM (${factBase}) base WHERE NOT traceable ORDER BY fact_id LIMIT ${Number(maxUntraceable)}`,
    factParams,
  );

  const relRows = await driver.query(
    `SELECT count(*)::text AS total, count(*) FILTER (WHERE traceable)::text AS traceable
       FROM (${relBase}) base`,
    relParams,
  );
  const untraceableRelRows = await driver.query(
    `SELECT relationship_id FROM (${relBase}) base WHERE NOT traceable ORDER BY relationship_id
      LIMIT ${Number(maxUntraceable)}`,
    relParams,
  );

  const factTotal = byEntity.reduce((sum, cell) => sum + cell.total, 0);
  const factTraceable = byEntity.reduce((sum, cell) => sum + cell.traceable, 0);
  const relTotal = num(relRows[0]?.['total']);
  const relTraceable = num(relRows[0]?.['traceable']);

  return {
    generated_at: new Date().toISOString() as IsoDateTime,
    scope: {
      vertical_id: options.vertical_id ?? null,
      entity_id: options.entity_id ?? null,
      include_retracted: includeRetracted,
    },
    facts: { total: factTotal, traceable: factTraceable, coverage: ratio(factTraceable, factTotal) },
    relationships: {
      total: relTotal,
      traceable: relTraceable,
      coverage: ratio(relTraceable, relTotal),
    },
    by_vertical: byVertical,
    by_entity: byEntity,
    untraceable_fact_ids: untraceableFactRows.map((row) => String(row['fact_id']) as FactId),
    untraceable_relationship_ids: untraceableRelRows.map(
      (row) => String(row['relationship_id']) as RelationshipId,
    ),
  };
}

export class ProvenanceCoverageError extends Error {
  override readonly name = 'ProvenanceCoverageError';
  readonly report: ProvenanceCoverageReport;

  constructor(message: string, report: ProvenanceCoverageReport) {
    super(message);
    this.report = report;
  }
}

/**
 * CI gate. `threshold` defaults to 1: on a store whose only write path is
 * `appendFactWithEvidence`, anything below total coverage means something
 * bypassed the canonical store.
 */
export function assertProvenanceCoverage(
  report: ProvenanceCoverageReport,
  threshold = 1,
): void {
  if (report.facts.coverage < threshold) {
    throw new ProvenanceCoverageError(
      `Fact provenance coverage ${(report.facts.coverage * 100).toFixed(2)}% is below the required ` +
        `${(threshold * 100).toFixed(2)}%. Untraceable facts: ${report.untraceable_fact_ids.join(', ') || '(none listed)'}`,
      report,
    );
  }
  if (report.relationships.coverage < threshold) {
    throw new ProvenanceCoverageError(
      `Relationship provenance coverage ${(report.relationships.coverage * 100).toFixed(2)}% is below ` +
        `the required ${(threshold * 100).toFixed(2)}%.`,
      report,
    );
  }
}
