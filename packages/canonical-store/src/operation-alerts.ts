import type { SqlDriver, SqlExecutor } from './sql-driver.js';
import { toIso } from './rows.js';

export const OPERATION_ALERT_CODES = [
  'ACQUISITION_FAILURE', 'OUTBOX_AGE', 'PUBLICATION_LAG', 'FAILED_JOBS', 'RIGHTS_EXPIRY',
] as const;
export type OperationAlertCode = (typeof OPERATION_ALERT_CODES)[number];
export type OperationAlertCounts = Readonly<Record<OperationAlertCode, number>>;
export interface OperationAlertClaim {
  readonly id: string;
  readonly token: string;
  readonly code: OperationAlertCode;
  readonly transition: 'FAILURE' | 'RECOVERY';
  readonly count: number;
  readonly observedAt: string;
}
export type OperationAlertOutcome = 'ACCEPTED' | 'FAILED' | 'UNKNOWN';
const COUNT_LIMIT = 1_000_000;

function assertScope(verticalSlug: string): void {
  if (!/^[a-z][a-z0-9-]{0,62}$/.test(verticalSlug)) throw new Error('OPERATION_SCOPE_INVALID');
}
function assertCounts(counts: OperationAlertCounts): void {
  if (Object.keys(counts).length !== OPERATION_ALERT_CODES.length
    || OPERATION_ALERT_CODES.some(code => !Number.isInteger(counts[code]) || counts[code] < 0 || counts[code] > COUNT_LIMIT)) {
    throw new Error('OPERATION_COUNTS_INVALID');
  }
}

/** One read-only SQL snapshot; only bounded integers leave the database. */
export async function readOperationHealth(tx: SqlExecutor, verticalSlug: string, observedAt: string): Promise<OperationAlertCounts> {
  assertScope(verticalSlug);
  const rows = await tx.query(`WITH monitored_sources AS MATERIALIZED (
    SELECT source.id,source.rights_publisher_id FROM sources source
    JOIN verticals vertical ON vertical.id=source.vertical_id
    WHERE vertical.slug=$1 AND source.status='ACTIVE' AND NOT source.kill_switch_engaged
  ), latest_runs AS MATERIALIZED (
    SELECT DISTINCT ON (run.source_id,run.target_id) run.id,run.status,run.claimed_at,run.fresh_at,run.source_id,run.target_id
    FROM scheduled_acquisition_runs run JOIN monitored_sources source ON source.id=run.source_id
    WHERE run.vertical_slug=$1 AND run.status<>'SKIPPED' AND run.claimed_at <= $2::timestamptz
      AND (run.status<>'CLAIMED' OR run.claimed_at < $2::timestamptz - interval '30 minutes')
    ORDER BY run.source_id,run.target_id,run.scheduled_for DESC,run.created_at DESC
  ), latest_success AS MATERIALIZED (
    SELECT DISTINCT ON (run.source_id,run.target_id) run.id,run.fresh_at
    FROM scheduled_acquisition_runs run JOIN monitored_sources source ON source.id=run.source_id
    WHERE run.vertical_slug=$1 AND run.status='SUCCEEDED' AND run.fresh_at <= $2::timestamptz
    ORDER BY run.source_id,run.target_id,run.fresh_at DESC,run.created_at DESC
  ), current_decisions AS MATERIALIZED (
    SELECT DISTINCT ON (event.cell_id) event.cell_id,event.decision_id
    FROM rights_decision_activation_events event WHERE event.occurred_at <= $2::timestamptz
    ORDER BY event.cell_id,event.sequence_no DESC
  ), current_terms AS MATERIALIZED (
    SELECT DISTINCT ON (event.terms_cell_id) event.terms_cell_id,event.terms_version_id,event.state
    FROM rights_terms_activation_events event WHERE event.occurred_at <= $2::timestamptz
    ORDER BY event.terms_cell_id,event.sequence_no DESC
  ), counts AS (
    SELECT 'ACQUISITION_FAILURE' AS code,count(*) AS amount FROM latest_runs
      WHERE status IN ('FAILED','REFUSED') OR (status='CLAIMED' AND claimed_at < $2::timestamptz - interval '30 minutes')
    UNION ALL
    SELECT 'OUTBOX_AGE',count(*) FROM ingestion_deliveries delivery
      JOIN scheduled_acquisition_runs run ON run.id=delivery.acquisition_run_id
      JOIN monitored_sources source ON source.id=run.source_id
      WHERE delivery.status IN ('QUEUED','PROCESSING') AND delivery.created_at < $2::timestamptz - interval '30 minutes'
    UNION ALL
    SELECT 'PUBLICATION_LAG',count(*) FROM latest_success run
      WHERE run.fresh_at < $2::timestamptz - interval '30 minutes'
        AND NOT EXISTS (SELECT 1 FROM ingestion_deliveries delivery WHERE delivery.acquisition_run_id=run.id AND delivery.status='PUBLISHED')
    UNION ALL
    SELECT 'FAILED_JOBS',count(*) FROM (
      SELECT delivery.id FROM ingestion_deliveries delivery
        JOIN scheduled_acquisition_runs run ON run.id=delivery.acquisition_run_id
        JOIN monitored_sources source ON source.id=run.source_id WHERE delivery.status IN ('FAILED','REFUSED')
        AND NOT EXISTS (SELECT 1 FROM ingestion_deliveries accepted
          JOIN scheduled_acquisition_runs successor ON successor.id=accepted.acquisition_run_id
          WHERE accepted.status='PUBLISHED' AND successor.source_id=run.source_id AND successor.target_id=run.target_id
            AND (successor.fresh_at>run.fresh_at OR (successor.fresh_at=run.fresh_at AND accepted.created_at>delivery.created_at)))
      UNION ALL
      SELECT job.id FROM ingestion_jobs job JOIN monitored_sources source ON source.id=job.source_id WHERE job.state='FAILED'
        AND NOT EXISTS (SELECT 1 FROM ingestion_jobs successor
          WHERE successor.source_id=job.source_id AND successor.job_type=job.job_type AND successor.state='PUBLISHED'
            AND successor.updated_at>job.updated_at
            AND ((job.job_type='ARTIFACT_FETCH' AND NULLIF(job.payload->>'url','') IS NOT NULL
              AND NULLIF(job.payload->>'source_key','') IS NOT NULL
              AND successor.payload->>'url'=job.payload->>'url' AND successor.payload->>'source_key'=job.payload->>'source_key')
              OR (job.source_record_id IS NOT NULL AND successor.source_record_id=job.source_record_id)))
    ) failed
    UNION ALL
    SELECT 'RIGHTS_EXPIRY',count(*) FROM current_decisions active
      JOIN rights_cells cell ON cell.id=active.cell_id
      JOIN rights_decisions decision ON decision.id=active.decision_id
      LEFT JOIN rights_terms_versions terms ON terms.id=decision.controlling_terms_version_id
      LEFT JOIN current_terms ON current_terms.terms_cell_id=terms.terms_cell_id
      WHERE decision.state='ALLOW'
        AND EXISTS (SELECT 1 FROM monitored_sources source WHERE source.id=cell.source_id OR source.rights_publisher_id=cell.publisher_id)
        AND (decision.recheck_at IS NULL OR decision.recheck_at <= $2::timestamptz + interval '72 hours'
          OR decision.effective_until <= $2::timestamptz + interval '72 hours'
          OR terms.id IS NULL OR current_terms.state IS DISTINCT FROM 'ACTIVE'
          OR current_terms.terms_version_id IS DISTINCT FROM terms.id
          OR terms.recheck_at <= $2::timestamptz + interval '72 hours'
          OR terms.effective_until <= $2::timestamptz + interval '72 hours')
  ) SELECT code,LEAST(amount,1000000)::integer AS amount FROM counts`, [verticalSlug, observedAt]);
  const counts = Object.fromEntries(rows.map(row => [String(row['code']), Number(row['amount'])])) as OperationAlertCounts;
  assertCounts(counts);
  return counts;
}

async function recordObservations(tx: SqlExecutor, verticalSlug: string, counts: OperationAlertCounts, observedAt: string): Promise<number> {
  let transitions = 0;
  for (const code of OPERATION_ALERT_CODES) {
    await tx.query(`INSERT INTO operation_incidents (vertical_slug,code,active,generation,observed_count,observed_at)
      VALUES ($1,$2,FALSE,0,0,$3) ON CONFLICT DO NOTHING`, [verticalSlug, code, observedAt]);
    const [prior] = await tx.query('SELECT active,generation,observed_at FROM operation_incidents WHERE vertical_slug=$1 AND code=$2 FOR UPDATE', [verticalSlug, code]);
    if (!prior || toIso(prior['observed_at']) > observedAt) continue;
    const active = counts[code] > 0;
    const changed = prior['active'] !== active;
    const generation = Number(prior['generation']) + Number(changed);
    await tx.query(`UPDATE operation_incidents SET active=$3,generation=$4,observed_count=$5,observed_at=$6
      WHERE vertical_slug=$1 AND code=$2`, [verticalSlug, code, active, generation, counts[code], observedAt]);
    if (!changed) continue;
    // Never send an obsolete phase that was superseded before its first attempt.
    await tx.query(`UPDATE operation_alert_deliveries SET status='CANCELLED'
      WHERE vertical_slug=$1 AND code=$2 AND status='PENDING'`, [verticalSlug, code]);
    await tx.query(`INSERT INTO operation_alert_deliveries (vertical_slug,code,generation,transition,observed_count,observed_at)
      VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
      [verticalSlug, code, generation, active ? 'FAILURE' : 'RECOVERY', counts[code], observedAt]);
    transitions++;
  }
  return transitions;
}

export class OperationAlertStore {
  constructor(private readonly driver: SqlDriver) {}

  /** Source health, incident transition, and durable delivery commit together. */
  async observe(verticalSlug: string): Promise<{ readonly transitions: number; readonly counts: OperationAlertCounts }> {
    assertScope(verticalSlug);
    return this.driver.transaction(async tx => {
      await tx.query(`SELECT pg_advisory_xact_lock(hashtext('operation-alerts'),hashtext($1))`, [verticalSlug]);
      const [clock] = await tx.query('SELECT clock_timestamp() AS at');
      const observedAt = toIso(clock!['at']);
      const counts = await readOperationHealth(tx, verticalSlug, observedAt);
      const transitions = await recordObservations(tx, verticalSlug, counts, observedAt);
      return { transitions, counts };
    });
  }

  /** Local deterministic verification seam; production uses observe's SQL clock. */
  async record(verticalSlug: string, counts: OperationAlertCounts, observedAt: string): Promise<number> {
    assertScope(verticalSlug); assertCounts(counts);
    if (!Number.isFinite(Date.parse(observedAt))) throw new Error('OPERATION_TIME_INVALID');
    const canonicalAt = new Date(observedAt).toISOString();
    return this.driver.transaction(async tx => {
      await tx.query(`SELECT pg_advisory_xact_lock(hashtext('operation-alerts'),hashtext($1))`, [verticalSlug]);
      return recordObservations(tx, verticalSlug, counts, canonicalAt);
    });
  }

  async claim(verticalSlug: string): Promise<OperationAlertClaim | null> {
    assertScope(verticalSlug);
    return this.driver.transaction(async tx => {
      // Email has no provider idempotency key. An isolate crash may happen after
      // acceptance: an expired attempt is unknown, never safe to send again.
      await tx.query(`UPDATE operation_alert_deliveries SET status='UNKNOWN',claim_token=NULL,failure_code='PROVIDER_OUTCOME_UNKNOWN'
        WHERE vertical_slug=$1 AND status='SENDING' AND attempted_at < clock_timestamp() - interval '10 minutes'`, [verticalSlug]);
      const [row] = await tx.query(`SELECT id,code,transition,observed_count,observed_at FROM operation_alert_deliveries
        WHERE vertical_slug=$1 AND status='PENDING' ORDER BY created_at,id LIMIT 1 FOR UPDATE SKIP LOCKED`, [verticalSlug]);
      if (!row) return null;
      const token = crypto.randomUUID();
      await tx.query(`UPDATE operation_alert_deliveries SET status='SENDING',claim_token=$2,attempted_at=clock_timestamp() WHERE id=$1`, [String(row['id']), token]);
      return { id: String(row['id']), token, code: String(row['code']) as OperationAlertCode,
        transition: String(row['transition']) as OperationAlertClaim['transition'], count: Number(row['observed_count']), observedAt: toIso(row['observed_at']) };
    });
  }

  async finish(claim: OperationAlertClaim, outcome: OperationAlertOutcome): Promise<boolean> {
    const rows = await this.driver.query(`UPDATE operation_alert_deliveries SET status=$3,claim_token=NULL,
      accepted_at=CASE WHEN $3='ACCEPTED' THEN clock_timestamp() ELSE NULL END,
      failure_code=CASE WHEN $3='FAILED' THEN 'PROVIDER_REFUSED' WHEN $3='UNKNOWN' THEN 'PROVIDER_OUTCOME_UNKNOWN' ELSE NULL END
      WHERE id=$1 AND claim_token=$2 AND status='SENDING' RETURNING id`, [claim.id, claim.token, outcome]);
    return rows.length === 1;
  }
}
