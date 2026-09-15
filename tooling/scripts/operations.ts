/** A bounded, auditable operator CLI. Connections are accepted through one env
 * variable only; customer data and arbitrary driver errors are never printed. */
import { createPostgresDriver, enqueueIngestionDelivery, type SqlDriver, type SqlExecutor } from '@data-foundry/canonical-store';
import { z } from 'zod';
import { isMain } from '../lib/cli-entry.js';

// PostgreSQL UUID text is lowercase; lock identity and replay comparison must agree.
const operatorUuid = z.uuid().transform((value) => value.toLowerCase());

export const OperatorActionSchema = z.object({
  requestId: operatorUuid,
  action: z.enum(['PAUSE_SOURCE', 'RESUME_SOURCE', 'REPLAY_DELIVERY', 'RETIRE_DELIVERY', 'BACKFILL_RUN', 'RETRACT_FACT', 'REVOKE_KEY', 'CLOSE_ACCOUNT']),
  targetId: operatorUuid,
  actorRef: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,63}$/),
  reasonCode: z.enum(['INCIDENT', 'RECOVERY', 'CORRECTION', 'CUSTOMER_REQUEST', 'PLANNED_MAINTENANCE']),
  replacementDeliveryId: operatorUuid.optional(),
  runtimeDigest: z.string().regex(/^[0-9a-f]{64}$/).optional(),
}).strict().refine(x => (x.action === 'BACKFILL_RUN') === (x.runtimeDigest !== undefined), 'Only backfill requires a runtime digest')
  .refine(x => (x.action === 'RETIRE_DELIVERY') === (x.replacementDeliveryId !== undefined), 'Only retirement requires a replacement delivery');
export type OperatorAction = z.infer<typeof OperatorActionSchema>;

/** Metrics distinguish acquisition success from successful canonical publication.
 * Failed work cannot advance the displayed canonical verification clock. */
export async function operationalStatus(db: SqlExecutor) {
  const [sources, backlog, failed, conflicts, incidents, alertDeliveryCounts, alertDeliveries] = await Promise.all([
    db.query(`SELECT s.id, s.status, s.kill_switch_engaged,
      max(r.fresh_at) FILTER (WHERE r.status = 'SUCCEEDED') AS last_acquisition_verified_at,
      max(d.verified_at) FILTER (WHERE d.status = 'PUBLISHED') AS last_canonical_verified_at,
      max(d.published_at) FILTER (WHERE d.status = 'PUBLISHED') AS last_published_at
      FROM sources s LEFT JOIN scheduled_acquisition_runs r ON r.source_id = s.id
      LEFT JOIN ingestion_deliveries d ON d.acquisition_run_id = r.id
      GROUP BY s.id ORDER BY s.id LIMIT 101`),
    db.query(`SELECT status, count(*)::integer AS jobs,
      extract(epoch FROM (clock_timestamp() - min(created_at)))::integer AS oldest_age_seconds
      FROM ingestion_deliveries WHERE status IN ('QUEUED', 'PROCESSING', 'FAILED', 'REFUSED') GROUP BY status ORDER BY status`),
    db.query(`SELECT id, status, failure_code, attempt, created_at, completed_at FROM ingestion_deliveries
      WHERE status IN ('FAILED', 'REFUSED') ORDER BY created_at DESC, id LIMIT 101`),
    db.query(`SELECT id, decision FROM resolution_candidates WHERE decision IN ('PENDING', 'NEEDS_REVIEW') ORDER BY id LIMIT 101`),
    db.query(`SELECT vertical_slug, code, active, generation, observed_count, observed_at
      FROM operation_incidents ORDER BY active DESC, observed_at DESC, vertical_slug, code LIMIT 101`),
    db.query(`SELECT status, count(*)::integer AS deliveries
      FROM operation_alert_deliveries GROUP BY status ORDER BY status`),
    db.query(`SELECT vertical_slug, code, generation, transition, observed_count, observed_at, status
      FROM operation_alert_deliveries ORDER BY created_at DESC, id DESC LIMIT 101`),
  ]);
  return { sources: sources.slice(0, 100), sourcesTruncated: sources.length > 100,
    backlog, failedJobs: failed.slice(0, 100), failedJobsTruncated: failed.length > 100,
    resolutionCandidates: conflicts.slice(0, 100), resolutionCandidatesTruncated: conflicts.length > 100,
    incidents: incidents.slice(0, 100), incidentsTruncated: incidents.length > 100,
    alertDeliveryCounts, alertDeliveries: alertDeliveries.slice(0, 100), alertDeliveriesTruncated: alertDeliveries.length > 100 };
}

/** Safe mutations and audit insertion commit together. Replaying a request ID
 * with different intent is refused; successful replay does not repeat writes. */
export async function applyOperatorAction(driver: SqlDriver, value: unknown) {
  const input = OperatorActionSchema.parse(value);
  return driver.transaction(async tx => {
    await tx.query(`SELECT pg_advisory_xact_lock(hashtext('operator-action'), hashtext($1))`, [input.requestId]);
    const previous = await tx.query(`SELECT action, target_id, actor_ref, reason_code, runtime_digest, affected_rows, result_id
      FROM operator_actions WHERE request_id = $1`, [input.requestId]);
    const row = previous[0];
    if (row) {
      if (row['action'] !== input.action || row['target_id'] !== input.targetId || row['actor_ref'] !== input.actorRef ||
          row['reason_code'] !== input.reasonCode || row['runtime_digest'] !== (input.runtimeDigest ?? null) ||
          (input.action === 'RETIRE_DELIVERY' && row['result_id'] !== input.replacementDeliveryId)) throw new Error('OPERATOR_REQUEST_CONFLICT');
      return { applied: false, affectedRows: Number(row['affected_rows']), resultId: row['result_id'] };
    }
    let rows: Record<string, unknown>[] = [];
    let resultId: string | null = null;
    switch (input.action) {
      case 'PAUSE_SOURCE': case 'RESUME_SOURCE':
        rows = await tx.query(`UPDATE sources SET kill_switch_engaged = $2 WHERE id = $1
          AND ($2 = true OR status = 'ACTIVE') RETURNING id`, [input.targetId, input.action === 'PAUSE_SOURCE']);
        break;
      case 'REPLAY_DELIVERY':
        rows = await tx.query(`UPDATE ingestion_deliveries SET status = 'QUEUED', attempt = 0,
          failure_code = NULL, dispatched_at = NULL, completed_at = NULL, lease_token = NULL, lease_expires_at = NULL
          WHERE id = $1 AND status IN ('FAILED', 'REFUSED') RETURNING id`, [input.targetId]);
        break;
      case 'RETIRE_DELIVERY':
        // Lock first, then evaluate lease expiry on the database wall clock.
        // The claimant cannot renew/reclaim while this retirement is decided.
        await tx.query('SELECT id FROM ingestion_deliveries WHERE id=$1 FOR UPDATE', [input.targetId]);
        rows = await tx.query(`UPDATE ingestion_deliveries original SET status='REFUSED',
          failure_code='RUNTIME_MISMATCH', completed_at=clock_timestamp(), lease_token=NULL, lease_expires_at=NULL
          WHERE original.id=$1 AND (original.status='QUEUED' OR
            (original.status='PROCESSING' AND original.lease_expires_at <= clock_timestamp()))
            AND EXISTS (
              SELECT 1 FROM ingestion_deliveries replacement
              JOIN scheduled_acquisition_runs newer ON newer.id=replacement.acquisition_run_id
              JOIN scheduled_acquisition_runs prior ON prior.id=original.acquisition_run_id
              WHERE replacement.id=$2 AND replacement.status='PUBLISHED'
                AND replacement.runtime_digest <> original.runtime_digest
                AND newer.source_id=prior.source_id AND newer.target_id=prior.target_id
                AND newer.fresh_at > prior.fresh_at
            ) RETURNING original.id`, [input.targetId, input.replacementDeliveryId!]);
        resultId = input.replacementDeliveryId!;
        break;
      case 'BACKFILL_RUN': {
        const runs = await tx.query(`SELECT id FROM scheduled_acquisition_runs
          WHERE id = $1 AND status = 'SUCCEEDED' AND outcome = 'FETCHED'`, [input.targetId]);
        if (!runs.length) throw new Error('OPERATOR_TARGET_NOT_ELIGIBLE');
        resultId = await enqueueIngestionDelivery(tx, { acquisitionRunId: input.targetId, artifactRunId: input.targetId,
          runtimeDigest: input.runtimeDigest!, workKind: 'PROCESS_ARTIFACTS' });
        rows = [{ id: resultId }];
        break;
      }
      case 'RETRACT_FACT':
        rows = await tx.query(`UPDATE facts SET status = 'RETRACTED', valid_to = clock_timestamp()
          WHERE id = $1 AND valid_to IS NULL RETURNING id`, [input.targetId]);
        break;
      case 'REVOKE_KEY':
        rows = await tx.query(`UPDATE api_keys SET revoked_at = clock_timestamp()
          WHERE id = $1 AND revoked_at IS NULL RETURNING id`, [input.targetId]);
        break;
      case 'CLOSE_ACCOUNT':
        rows = await tx.query(`UPDATE api_tenants SET status = 'CLOSED', updated_at = clock_timestamp()
          WHERE id = $1 AND status <> 'CLOSED' RETURNING id`, [input.targetId]);
        if (rows.length) await tx.query(`UPDATE api_keys SET revoked_at = clock_timestamp()
          WHERE tenant_id = $1 AND revoked_at IS NULL`, [input.targetId]);
        break;
    }
    if (!rows.length) throw new Error('OPERATOR_TARGET_NOT_ELIGIBLE');
    await tx.query(`INSERT INTO operator_actions
      (request_id, action, target_id, actor_ref, reason_code, runtime_digest, affected_rows, result_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, [input.requestId, input.action, input.targetId,
      input.actorRef, input.reasonCode, input.runtimeDigest ?? null, rows.length, resultId]);
    return { applied: true, affectedRows: rows.length, resultId };
  });
}

export function parseOperationsArgs(args: readonly string[]) {
  if (args.length === 1 && args[0] === 'status') return { kind: 'status' as const };
  const command = args[0];
  if (command !== 'action') throw new Error('OPERATOR_ARGUMENTS_INVALID');
  const fields: Record<string, string> = {};
  let apply = false;
  const allowed = new Map([['--action', 'action'], ['--target-id', 'targetId'], ['--request-id', 'requestId'],
    ['--actor-ref', 'actorRef'], ['--reason-code', 'reasonCode'], ['--runtime-digest', 'runtimeDigest'], ['--replacement-delivery-id', 'replacementDeliveryId']]);
  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--apply' && !apply) { apply = true; continue; }
    const key = allowed.get(args[i]!);
    const next = args[++i];
    if (!key || fields[key] !== undefined || !next || next.startsWith('--')) throw new Error('OPERATOR_ARGUMENTS_INVALID');
    fields[key] = next;
  }
  return { kind: 'action' as const, apply, input: OperatorActionSchema.parse(fields) };
}

async function main() {
  const args = parseOperationsArgs(process.argv.slice(2));
  if (args.kind === 'action' && !args.apply) {
    process.stdout.write(JSON.stringify({ dryRun: true, validatedIntent: args.input, targetEligibilityChecked: false }) + '\n');
    return;
  }
  const connection = process.env['DATA_FOUNDRY_OPERATOR_DATABASE_URL'];
  if (!connection) throw new Error('OPERATOR_CONNECTION_REQUIRED');
  if ((process.env['PGOPTIONS'] ?? '').trim()) throw new Error('OPERATOR_AMBIENT_OPTIONS_REFUSED');
  const driver = await createPostgresDriver(connection, { schema: 'data_foundry' });
  try {
    // This control-plane command is deliberately unavailable to runtime roles.
    const identity = await driver.query(`SELECT current_user AS role, session_user AS login`);
    if (identity[0]?.['role'] !== 'df_migration' || identity[0]?.['login'] !== 'df_migration') throw new Error('OPERATOR_IDENTITY_REFUSED');
    const result = args.kind === 'status' ? await operationalStatus(driver) : await applyOperatorAction(driver, args.input);
    process.stdout.write(JSON.stringify(result) + '\n');
  } finally { await driver.close(); }
}
if (isMain(import.meta.url)) main().catch(() => {
  process.stderr.write('OPERATOR_COMMAND_FAILED: check the reviewed intent, target state and approved operator connection.\n');
  process.exitCode = 1;
});
