import { describe, expect, it } from 'vitest';
import { checkRuntimeRoleConnectionsPostgres } from '../scripts/check-runtime-role-connections-postgres.js';

const roles = ['df_edge', 'df_web', 'df_mcp', 'df_usage', 'df_acquisition'] as const;

describe('real PostgreSQL runtime-role connection check', () => {
  it('opens one direct credential connection per LOGIN role and validates its server-side identity and grants', async () => {
    const opened: string[] = [];
    const probes: string[] = [];
    const env: Record<string, string> = { DATA_FOUNDRY_RUNTIME_ROLE_CONNECTION_TEST: '1' };
    for (const role of roles) env[`DATA_FOUNDRY_${role.slice(3).toUpperCase()}_POSTGRES_URL`] = `postgres://${role}:secret@db.invalid/data`;

    await checkRuntimeRoleConnectionsPostgres(env, async (connectionString, role) => {
      opened.push(`${role}:${connectionString}`);
      return {
        async connect() {},
        async query(sql) {
          probes.push(sql);
          return { rows: [{ direct_login: true, role_is_login_nonprivileged: true, membership_is_empty: true, search_path_is_exact: true, lo_compat_privileges_is_off: true, session_replication_role_is_origin: true, durable_search_path_is_exact: true, privilege_matrix_is_exact: true }] };
        },
        async end() {},
      };
    });

    expect(opened.map((entry) => entry.split(':', 1)[0])).toEqual(roles);
    expect(probes).toHaveLength(roles.length);
    expect(
      probes.every((sql) =>
        sql.includes(
          'AND NOT EXISTS (SELECT 1 FROM unsafe_migration_role_default_object_acl)',
        ),
      ),
    ).toBe(true);
    expect(
      probes.every((sql) =>
        sql.includes('AND NOT EXISTS (SELECT 1 FROM unsafe_migration_role_posture)'),
      ),
    ).toBe(true);
    expect(
      probes.every((sql) =>
        sql.includes('AND NOT EXISTS (SELECT 1 FROM unsafe_migration_role_durable_settings)'),
      ),
    ).toBe(true);
    expect(
      probes.every((sql) =>
        sql.includes(
          'AND NOT EXISTS (SELECT 1 FROM unsafe_migration_role_external_capability)',
        ),
      ),
    ).toBe(true);
    expect(probes.every((sql) => sql.includes('unsafe_runtime_role_durable_settings'))).toBe(true);
    expect(probes.every((sql) => sql.includes('setting.setdatabase = 0'))).toBe(true);
    expect(probes.every((sql) => sql.includes('CROSS JOIN pg_catalog.pg_database database'))).toBe(true);
    expect(probes.every((sql) =>
      sql.includes("pg_catalog.has_database_privilege(runtime_role.oid, database.oid, 'CONNECT')")
    )).toBe(true);
    expect(probes.every((sql) => sql.includes("current_setting('lo_compat_privileges') = 'off'"))).toBe(true);
    expect(probes.every((sql) => sql.includes("current_setting('session_replication_role') = 'origin'"))).toBe(true);
    expect(probes.every((sql) => sql.includes('NOT r.rolinherit'))).toBe(true);
  });

  it('rejects a direct role whose effective session search path is not exact', async () => {
    const env: Record<string, string> = { DATA_FOUNDRY_RUNTIME_ROLE_CONNECTION_TEST: '1' };
    for (const role of roles) env[`DATA_FOUNDRY_${role.slice(3).toUpperCase()}_POSTGRES_URL`] = 'postgres://secret@db.invalid/data';
    await expect(
      checkRuntimeRoleConnectionsPostgres(env, async () => ({
        async connect() {},
        async query() {
          return { rows: [{ direct_login: true, role_is_login_nonprivileged: true, membership_is_empty: true, search_path_is_exact: false, lo_compat_privileges_is_off: true, session_replication_role_is_origin: true, durable_search_path_is_exact: true, privilege_matrix_is_exact: true }] };
        },
        async end() {},
      })),
    ).rejects.toThrow(/runtime-role connection verification failed/i);
  });

  it('rejects a direct role whose durable database search path is not exact', async () => {
    const env: Record<string, string> = { DATA_FOUNDRY_RUNTIME_ROLE_CONNECTION_TEST: '1' };
    for (const role of roles) env[`DATA_FOUNDRY_${role.slice(3).toUpperCase()}_POSTGRES_URL`] = 'postgres://secret@db.invalid/data';
    await expect(
      checkRuntimeRoleConnectionsPostgres(env, async () => ({
        async connect() {},
        async query() {
          return { rows: [{ direct_login: true, role_is_login_nonprivileged: true, membership_is_empty: true, search_path_is_exact: true, lo_compat_privileges_is_off: true, session_replication_role_is_origin: true, durable_search_path_is_exact: false, privilege_matrix_is_exact: true }] };
        },
        async end() {},
      })),
    ).rejects.toThrow(/runtime-role connection verification failed/i);
  });

  it.each([
    'lo_compat_privileges_is_off',
    'session_replication_role_is_origin',
  ] as const)('rejects a direct role whose live %s result is unsafe', async (field) => {
    const env: Record<string, string> = { DATA_FOUNDRY_RUNTIME_ROLE_CONNECTION_TEST: '1' };
    for (const role of roles) env[`DATA_FOUNDRY_${role.slice(3).toUpperCase()}_POSTGRES_URL`] = 'postgres://secret@db.invalid/data';
    await expect(
      checkRuntimeRoleConnectionsPostgres(env, async () => ({
        async connect() {},
        async query() {
          return { rows: [{
            direct_login: true,
            role_is_login_nonprivileged: true,
            membership_is_empty: true,
            search_path_is_exact: true,
            lo_compat_privileges_is_off: true,
            session_replication_role_is_origin: true,
            durable_search_path_is_exact: true,
            privilege_matrix_is_exact: true,
            [field]: false,
          }] };
        },
        async end() {},
      })),
    ).rejects.toThrow(/runtime-role connection verification failed/i);
  });

  it.each([
    '?sslmode=disable',
    '?SSLMode=disable',
    '?ssl=no-verify',
    '?sslmode=verify-full',
    '?host=%2Ftmp',
    '?options=-csearch_path%3Dpublic',
  ])('rejects the direct URL override %s before opening a runtime-role credential', async (query) => {
    const env: Record<string, string> = { DATA_FOUNDRY_RUNTIME_ROLE_CONNECTION_TEST: '1' };
    for (const role of roles) env[`DATA_FOUNDRY_${role.slice(3).toUpperCase()}_POSTGRES_URL`] = 'postgres://secret@db.invalid/data';
    env['DATA_FOUNDRY_EDGE_POSTGRES_URL'] = `postgres://secret@db.invalid/data${query}`;
    const attemptedRoles: string[] = [];

    await expect(
      checkRuntimeRoleConnectionsPostgres(env, async (_connectionString, role) => {
        attemptedRoles.push(role);
        throw new Error('must not connect');
      }),
    ).rejects.toThrow(/TLS.*query|query.*TLS/i);

    expect(attemptedRoles).toEqual([]);
  });

  it('rejects a non-PostgreSQL role URL before opening a runtime-role credential', async () => {
    const env: Record<string, string> = { DATA_FOUNDRY_RUNTIME_ROLE_CONNECTION_TEST: '1' };
    for (const role of roles) env[`DATA_FOUNDRY_${role.slice(3).toUpperCase()}_POSTGRES_URL`] = 'postgres://secret@db.invalid/data';
    env['DATA_FOUNDRY_EDGE_POSTGRES_URL'] = 'mysql://secret@db.invalid/data';
    const attemptedRoles: string[] = [];

    await expect(
      checkRuntimeRoleConnectionsPostgres(env, async (_connectionString, role) => {
        attemptedRoles.push(role);
        throw new Error('must not connect');
      }),
    ).rejects.toThrow(/TLS/i);

    expect(attemptedRoles).toEqual([]);
  });

  it('preflights every runtime-role URL before opening a credential for an earlier role', async () => {
    const env: Record<string, string> = { DATA_FOUNDRY_RUNTIME_ROLE_CONNECTION_TEST: '1' };
    for (const role of roles) env[`DATA_FOUNDRY_${role.slice(3).toUpperCase()}_POSTGRES_URL`] = 'postgres://secret@db.invalid/data';
    env['DATA_FOUNDRY_WEB_POSTGRES_URL'] = 'postgres://secret@db.invalid/data?sslmode=disable';
    const attemptedRoles: string[] = [];

    await expect(
      checkRuntimeRoleConnectionsPostgres(env, async (_connectionString, role) => {
        attemptedRoles.push(role);
        throw new Error('must not connect');
      }),
    ).rejects.toThrow(/TLS.*query|query.*TLS/i);

    expect(attemptedRoles).toEqual([]);
  });

  it('rejects ambient PGOPTIONS before opening a socket', async () => {
    const env: Record<string, string> = {
      DATA_FOUNDRY_RUNTIME_ROLE_CONNECTION_TEST: '1',
      PGOPTIONS: '-csearch_path=data_foundry,pg_catalog,extensions',
    };
    for (const role of roles) env[`DATA_FOUNDRY_${role.slice(3).toUpperCase()}_POSTGRES_URL`] = 'postgres://secret@db.invalid/data';
    let connected = false;
    await expect(
      checkRuntimeRoleConnectionsPostgres(env, async () => {
        connected = true;
        throw new Error('must not connect');
      }),
    ).rejects.toThrow(/PGOPTIONS/i);
    expect(connected).toBe(false);
  });

  it('requires the dedicated-database acknowledgement before opening a credential', async () => {
    await expect(
      checkRuntimeRoleConnectionsPostgres({}, async () => {
        throw new Error('must not connect');
      }),
    ).rejects.toThrow(/DATA_FOUNDRY_RUNTIME_ROLE_CONNECTION_TEST=1/);
  });
});
