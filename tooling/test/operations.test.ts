import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPgliteDriver, type SqlDriver } from '@data-foundry/canonical-store';
import { buildRuntimeRoleExpectedGrants } from '../../packages/private-canary/src/runtime-role-policy.js';
import { loadMigrations } from '../scripts/migrate.js';
import { applyOperatorAction, operationalStatus, parseOperationsArgs } from '../scripts/operations.js';

let db: SqlDriver;
const TENANT = '22222222-2222-4222-8222-222222222222';
const KEY = '33333333-3333-4333-8333-333333333333';
const VERTICAL = '11111111-1111-4111-8111-111111111111';
const intent = { requestId: '44444444-4444-4444-8444-444444444444', action: 'CLOSE_ACCOUNT',
  targetId: TENANT, actorRef: 'ops.owner', reasonCode: 'CUSTOMER_REQUEST' };
beforeAll(async () => {
  db = await createPgliteDriver({ trigram: false });
  for (const migration of await loadMigrations()) await db.exec(migration.sql);
  await db.query(`INSERT INTO verticals (id, slug, name, schema_version, status, default_refresh_policy)
    VALUES ($1, 'ops-fixture', 'Synthetic operators', '1.0.0', 'DRAFT', '{}'::jsonb)`, [VERTICAL]);
  await db.query(`INSERT INTO api_tenants (id, slug, name, contact_email)
    VALUES ($1, 'ops-fixture', 'Synthetic account', 'private@example.invalid')`, [TENANT]);
  await db.query(`INSERT INTO api_keys (id, tenant_id, token_hash, token_prefix, label, vertical_id, access_tier, billing_source)
    VALUES ($1, $2, $3, 'df_test_fixture', 'Synthetic key', $4, 'API_PAID', 'DIRECT')`, [KEY, TENANT, 'a'.repeat(64), VERTICAL]);
});
afterAll(async () => { await db?.close(); });

describe('audited operational actions', () => {
  it('closes access and revokes keys atomically while preserving accounting identity and excluding contact data from audit', async () => {
    expect(await applyOperatorAction(db, intent)).toMatchObject({ applied: true, affectedRows: 1 });
    expect((await db.query('SELECT status, contact_email FROM api_tenants WHERE id = $1', [TENANT]))[0])
      .toEqual({ status: 'CLOSED', contact_email: 'private@example.invalid' });
    expect((await db.query('SELECT revoked_at FROM api_keys WHERE id = $1', [KEY]))[0]?.['revoked_at']).not.toBeNull();
    expect(JSON.stringify(await db.query('SELECT * FROM operator_actions'))).not.toContain('private@example.invalid');
    expect(await applyOperatorAction(db, intent)).toMatchObject({ applied: false, affectedRows: 1 });
    expect(await db.query('SELECT request_id FROM operator_actions')).toHaveLength(1);
  });
  it('refuses changed intent under an existing request identity', async () => {
    await expect(applyOperatorAction(db, { ...intent, action: 'REVOKE_KEY', targetId: KEY })).rejects.toThrow('OPERATOR_REQUEST_CONFLICT');
  });
  it('keeps audit history immutable and does not write an audit success for an ineligible target', async () => {
    await expect(db.query('DELETE FROM operator_actions')).rejects.toThrow('immutable');
    await expect(db.exec('TRUNCATE operator_actions')).rejects.toThrow('immutable');
    await expect(applyOperatorAction(db, { ...intent, requestId: '55555555-5555-4555-8555-555555555555', action: 'REPLAY_DELIVERY', targetId: KEY }))
      .rejects.toThrow('OPERATOR_TARGET_NOT_ELIGIBLE');
    expect(await db.query('SELECT request_id FROM operator_actions')).toHaveLength(1);
  });
  it('returns bounded non-personal status and keeps every runtime unable to edit the operator audit', async () => {
    const status = await operationalStatus(db);
    expect(status).toMatchObject({ sources: [], backlog: [], failedJobs: [], resolutionCandidates: [] });
    expect(JSON.stringify(status)).not.toContain('private@example.invalid');
    expect(buildRuntimeRoleExpectedGrants().filter(g => g.objectName === 'operator_actions')).toEqual([]);
  });
  it('gives acquisition dispatch-only outbox writes and ingestion no source approval, rights, account or billing writes', () => {
    const grants = buildRuntimeRoleExpectedGrants();
    const writes = grants.filter(g => g.role === 'df_acquisition' && g.objectName === 'ingestion_deliveries' && g.privilege === 'UPDATE');
    expect(writes.map(g => g.columnName).sort()).toEqual(['dispatch_attempt', 'dispatched_at']);
    expect(writes.every(g => g.scope === 'column')).toBe(true);
    const ingestion = grants.filter(g => g.role === 'df_ingestion');
    expect(ingestion.filter(g => /^(sources|verticals|rights_|api_|operator_actions)/.test(g.objectName) && g.privilege !== 'SELECT')).toEqual([]);
    expect(ingestion.filter(g => g.scope === 'function')).toEqual([]);
    expect(ingestion.some(g => g.objectName === 'facts' && g.privilege === 'INSERT')).toBe(true);
  });
  it('rolls back account closure if its audit insertion fails', async () => {
    const other = '66666666-6666-4666-8666-666666666666';
    await db.query(`INSERT INTO api_tenants (id, slug, name) VALUES ($1, 'rollback-fixture', 'Rollback fixture')`, [other]);
    await db.exec(`CREATE FUNCTION test_refuse_operator_insert() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic audit failure'; END; $$;
      CREATE TRIGGER test_refuse_operator_insert BEFORE INSERT ON operator_actions FOR EACH ROW EXECUTE FUNCTION test_refuse_operator_insert();`);
    try {
      await expect(applyOperatorAction(db, { ...intent, requestId: other, targetId: other })).rejects.toThrow('synthetic audit failure');
      expect((await db.query('SELECT status FROM api_tenants WHERE id = $1', [other]))[0]?.['status']).toBe('ACTIVE');
    } finally {
      await db.exec('DROP TRIGGER test_refuse_operator_insert ON operator_actions; DROP FUNCTION test_refuse_operator_insert();');
    }
  });
  it('pauses acquisition immediately and cannot use resume to approve a proposed source', async () => {
    const source = '77777777-7777-4777-8777-777777777777';
    await db.query(`INSERT INTO sources (id, vertical_id, publisher, domain, source_type, authority_rank,
      attribution_requirement, robots_policy, refresh_cadence, status)
      VALUES ($1, $2, 'Synthetic ops', 'ops.example.invalid', 'OTHER', 1, '{}'::jsonb, '{}'::jsonb, 'MANUAL', 'PROPOSED')`, [source, VERTICAL]);
    await applyOperatorAction(db, { ...intent, requestId: source, action: 'PAUSE_SOURCE', targetId: source, reasonCode: 'INCIDENT' });
    expect((await db.query('SELECT kill_switch_engaged FROM sources WHERE id = $1', [source]))[0]?.['kill_switch_engaged']).toBe(true);
    await expect(applyOperatorAction(db, { ...intent, requestId: '88888888-8888-4888-8888-888888888888', action: 'RESUME_SOURCE', targetId: source, reasonCode: 'RECOVERY' }))
      .rejects.toThrow('OPERATOR_TARGET_NOT_ELIGIBLE');
    expect((await db.query('SELECT status, kill_switch_engaged FROM sources WHERE id = $1', [source]))[0])
      .toEqual({ status: 'PROPOSED', kill_switch_engaged: true });
  });
  it('treats UUID casing as the same action identity and target during replay', async () => {
    const source = 'abcdefab-abcd-4abc-8abc-abcdefabcdef';
    await db.query(`INSERT INTO sources (id, vertical_id, publisher, domain, source_type, authority_rank,
      attribution_requirement, robots_policy, refresh_cadence, status)
      VALUES ($1, $2, 'Synthetic UUID case', 'case.example.invalid', 'OTHER', 1, '{}'::jsonb, '{}'::jsonb, 'MANUAL', 'PROPOSED')`, [source, VERTICAL]);
    const uppercase = { ...intent, requestId: source.toUpperCase(), targetId: source.toUpperCase(), action: 'PAUSE_SOURCE' };
    expect(await applyOperatorAction(db, uppercase)).toMatchObject({ applied: true });
    expect(await applyOperatorAction(db, uppercase)).toMatchObject({ applied: false });
    expect(await applyOperatorAction(db, { ...uppercase, requestId: source, targetId: source })).toMatchObject({ applied: false });
    expect(await db.query('SELECT request_id FROM operator_actions WHERE request_id = $1', [source])).toHaveLength(1);
  });

  it('shows bounded incident and alert outcomes without provider or contact metadata', async () => {
    await db.query(`INSERT INTO operation_incidents (vertical_slug,code,active,generation,observed_count,observed_at)
      VALUES ('ops-fixture','FAILED_JOBS',true,4,1,clock_timestamp())`);
    for (const [index, status] of ['PENDING', 'UNKNOWN', 'FAILED', 'ACCEPTED'].entries()) {
      await db.query(`INSERT INTO operation_alert_deliveries
        (vertical_slug,code,generation,transition,observed_count,observed_at,status,attempted_at,accepted_at,failure_code)
        VALUES ('ops-fixture','FAILED_JOBS',$1,'FAILURE',1,clock_timestamp(),$2,
          CASE WHEN $2 = 'PENDING' THEN NULL ELSE clock_timestamp() END,
          CASE WHEN $2 = 'ACCEPTED' THEN clock_timestamp() ELSE NULL END,
          CASE WHEN $2 = 'UNKNOWN' THEN 'PROVIDER_OUTCOME_UNKNOWN' WHEN $2 = 'FAILED' THEN 'PROVIDER_REFUSED' ELSE NULL END)`, [index + 1, status]);
    }
    const status = await operationalStatus(db);
    expect(status.incidents).toEqual([expect.objectContaining({ vertical_slug: 'ops-fixture', code: 'FAILED_JOBS', observed_count: 1 })]);
    expect(status.alertDeliveryCounts).toEqual(expect.arrayContaining(['PENDING', 'UNKNOWN', 'FAILED', 'ACCEPTED'].map(status => ({ status, deliveries: 1 }))));
    expect(status.alertDeliveries).toHaveLength(4);
    expect(status.alertDeliveriesTruncated).toBe(false);
    expect(JSON.stringify(status)).not.toMatch(/provider_id|recipient|claim_token|contact_email/);
  });

  it('defaults mutations to validated dry-run intent and rejects credential argv and arbitrary context', () => {
    const args = ['action', '--action', 'CLOSE_ACCOUNT', '--target-id', TENANT, '--request-id', intent.requestId,
      '--actor-ref', 'ops.owner', '--reason-code', 'CUSTOMER_REQUEST'];
    expect(parseOperationsArgs(args)).toMatchObject({ kind: 'action', apply: false });
    expect(parseOperationsArgs([...args, '--apply'])).toMatchObject({ apply: true });
    expect(() => parseOperationsArgs([...args, '--database-url', 'postgres://do-not-print'])).toThrow();
    expect(() => parseOperationsArgs([...args, '--reason-code', 'arbitrary-exception'])).toThrow();
  });
  it('renews an allowance into the next consecutive period once, cancels it, and cannot act on an ineligible one', async () => {
    const TENANT2 = 'e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1';
    await db.query(`INSERT INTO api_tenants (id, slug, name) VALUES ($1, 'ops-entitled', 'Entitled account')`, [TENANT2]);
    const [period] = await db.query<{ id: string }>(`INSERT INTO api_entitlements
      (tenant_id, vertical_id, plan_code, included_requests, period_start, period_end)
      VALUES ($1, $2, 'developer', 5000, '2026-09-01T00:00:00Z', '2026-10-01T00:00:00Z') RETURNING id`, [TENANT2, VERTICAL]);
    const renew = { requestId: 'e2e2e2e2-e2e2-4e2e-8e2e-e2e2e2e2e2e2', action: 'RENEW_ENTITLEMENT',
      targetId: period!.id, actorRef: 'billing.webhook', reasonCode: 'CUSTOMER_REQUEST' };
    const renewed = await applyOperatorAction(db, renew);
    expect(renewed).toMatchObject({ applied: true, affectedRows: 1 });
    expect(renewed.resultId).not.toBeNull();
    const rows = await db.query(`SELECT plan_code, included_requests, period_start, period_end, status
      FROM api_entitlements WHERE tenant_id = $1 ORDER BY period_start`, [TENANT2]);
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ plan_code: 'developer', included_requests: 5000, status: 'ACTIVE' });
    expect(new Date(String(rows[1]!['period_start'])).toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(new Date(String(rows[1]!['period_end'])).toISOString()).toBe('2026-10-31T00:00:00.000Z');
    // Replay is a no-op; a second renewal of the same period is refused because a later period exists.
    expect(await applyOperatorAction(db, renew)).toMatchObject({ applied: false, affectedRows: 1, resultId: renewed.resultId });
    await expect(applyOperatorAction(db, { ...renew, requestId: 'e3e3e3e3-e3e3-4e3e-8e3e-e3e3e3e3e3e3' }))
      .rejects.toThrow('OPERATOR_TARGET_NOT_ELIGIBLE');
    const renewedId = String(renewed.resultId);
    const cancel = { requestId: 'e4e4e4e4-e4e4-4e4e-8e4e-e4e4e4e4e4e4', action: 'CANCEL_ENTITLEMENT',
      targetId: renewedId, actorRef: 'ops.owner', reasonCode: 'CUSTOMER_REQUEST' };
    expect(await applyOperatorAction(db, cancel)).toMatchObject({ applied: true, affectedRows: 1 });
    const [cancelled] = await db.query(`SELECT status, cancelled_at FROM api_entitlements WHERE id = $1`, [renewedId]);
    expect(cancelled?.['status']).toBe('CANCELLED');
    expect(cancelled?.['cancelled_at']).not.toBeNull();
    await expect(applyOperatorAction(db, { ...cancel, requestId: 'e5e5e5e5-e5e5-4e5e-8e5e-e5e5e5e5e5e5' }))
      .rejects.toThrow('OPERATOR_TARGET_NOT_ELIGIBLE');
    // Closing the account cancels its remaining active periods too.
    await applyOperatorAction(db, { requestId: 'e6e6e6e6-e6e6-4e6e-8e6e-e6e6e6e6e6e6', action: 'CLOSE_ACCOUNT',
      targetId: TENANT2, actorRef: 'ops.owner', reasonCode: 'CUSTOMER_REQUEST' });
    expect(await db.query(`SELECT count(*)::int AS active FROM api_entitlements WHERE tenant_id = $1 AND status = 'ACTIVE'`, [TENANT2]))
      .toEqual([{ active: 0 }]);
  });
});
