import { describe, expect, it } from 'vitest';
import {
  assertPrivateCanaryRuntimeBinding,
  createPrivateCanaryFixtureEnvelope,
  createPrivateCanaryReceipt,
  parsePrivateCanaryEnvelope,
  parsePrivateCanaryProbeResult,
  PRIVATE_CANARY_SERVICE_BINDING_MODE,
  PRIVATE_CANARY_RUNTIME_BINDING_SQL,
  buildMigrationRoleUnsafeDurableSettingSql,
  buildUnsafeMigrationSearchPathSql,
  resolvePrivateCanaryConnectionString,
  toPrivateCanaryProbeInput,
} from '../src/index.js';
import type { PrivateCanaryWorker } from '../src/index.js';

const envelope = {
  kind: 'data-foundry.private-canary.v1',
  run_id: '11111111-1111-4111-8111-111111111111',
  issued_at: '2026-09-01T12:00:00.000Z',
  tenant_id: 'd6508a79-7784-412c-8c75-88fc495fa5eb',
  vertical_id: '2cb20ae4-7f1e-4b3b-ab91-834789b5c6ce',
  edge_api_key_id: 'f5814ae3-3bf7-4336-968f-7e134bf5c41a',
  mcp_api_key_id: 'b16db7f9-d10e-427d-8ba4-bbc1b3d09f80',
  edge_event_id: '402f5082-db47-4ae5-819a-793085e6a38b',
  mcp_event_id: '5dd72cfd-42f4-491a-9573-79bf0a3d64a9',
} as const;

describe('private canary DLQ envelope', () => {
  it('accepts only fixed synthetic correlation fields and derives secret-free probe input', async () => {
    expect(await createPrivateCanaryFixtureEnvelope(envelope.run_id, envelope.issued_at)).toEqual(envelope);
    const parsed = await parsePrivateCanaryEnvelope(JSON.parse(JSON.stringify(envelope)) as unknown);

    expect(parsed).toEqual(envelope);
    if (parsed === null) throw new Error('the fixed private-canary envelope must parse');
    expect(toPrivateCanaryProbeInput(parsed)).toEqual({
      runId: '11111111-1111-4111-8111-111111111111',
      tenantId: 'd6508a79-7784-412c-8c75-88fc495fa5eb',
      verticalId: '2cb20ae4-7f1e-4b3b-ab91-834789b5c6ce',
      edgeApiKeyId: 'f5814ae3-3bf7-4336-968f-7e134bf5c41a',
      mcpApiKeyId: 'b16db7f9-d10e-427d-8ba4-bbc1b3d09f80',
      edgeEventId: '402f5082-db47-4ae5-819a-793085e6a38b',
      mcpEventId: '5dd72cfd-42f4-491a-9573-79bf0a3d64a9',
    });
  });

  it('refuses each structurally valid identifier when it was not derived from the fixture cycle', async () => {
    for (const identifier of [
      'tenant_id',
      'vertical_id',
      'edge_api_key_id',
      'mcp_api_key_id',
      'edge_event_id',
      'mcp_event_id',
    ] as const) {
      expect(await parsePrivateCanaryEnvelope({
        ...envelope,
        [identifier]: '88888888-8888-4888-8888-888888888888',
      })).toBeNull();
    }
  });

  it('refuses an unknown field so credentials, source content, and URLs cannot ride the DLQ control path', async () => {
    for (const field of ['authorization', 'source_url', 'raw_content', 'token'] as const) {
      expect(await parsePrivateCanaryEnvelope({ ...envelope, [field]: 'must-not-be-accepted' }), field).toBeNull();
    }
  });

  it('requires a canonical fixture timestamp rather than accepting arbitrary control metadata', async () => {
    expect(await parsePrivateCanaryEnvelope({ ...envelope, issued_at: '2026-09-01' })).toBeNull();
    expect(await parsePrivateCanaryEnvelope({ ...envelope, issued_at: 'not-a-time' })).toBeNull();
  });

  it('refuses malformed deterministic correlation ids', async () => {
    expect(await parsePrivateCanaryEnvelope({ ...envelope, run_id: 'not-a-uuid' })).toBeNull();
    expect(await parsePrivateCanaryEnvelope({ ...envelope, tenant_id: 'not-a-uuid' })).toBeNull();
  });

  it('requires a UUID v4 run id while retaining fixture-derived correlation identifiers', async () => {
    expect(await parsePrivateCanaryEnvelope({
      ...envelope,
      run_id: '11111111-1111-1111-8111-111111111111',
    })).toBeNull();
  });
});

describe('private canary target runtime binding', () => {
  it('exports a schema-aware, fully catalog-qualified migration search-path probe', () => {
    const sql = buildUnsafeMigrationSearchPathSql('data_foundry');

    expect(sql).toContain(
      "pg_catalog.current_setting('search_path'::pg_catalog.text)",
    );
    expect(sql).toContain('OPERATOR(pg_catalog.=)');
    expect(sql).toContain(
      "pg_catalog.current_schemas(false) OPERATOR(pg_catalog.=) ARRAY['data_foundry', 'pg_catalog', 'extensions']::pg_catalog.name[]",
    );
  });

  it('exports an exact current-database durable-setting guard for the migration login', () => {
    const sql = buildMigrationRoleUnsafeDurableSettingSql('data_foundry', 'df_migration');

    expect(sql).toContain("runtime_role.rolname = 'df_migration'");
    expect(sql).toContain('setting.setdatabase = 0');
    expect(sql).toContain(
      "setting.setconfig = ARRAY['search_path=data_foundry, pg_catalog, extensions']::text[]",
    );
    expect(sql).toContain('WHERE true');
  });

  it('compares private effective privileges and direct external ACLs to the runtime grant matrix', () => {
    expect(PRIVATE_CANARY_RUNTIME_BINDING_SQL).toContain('expected_runtime_grants');
    expect(PRIVATE_CANARY_RUNTIME_BINDING_SQL).toContain('expected_external_runtime_acls');
    expect(PRIVATE_CANARY_RUNTIME_BINDING_SQL).toContain('effective_privilege_differences');
    expect(PRIVATE_CANARY_RUNTIME_BINDING_SQL).toContain('external_direct_acl_differences');
    expect(PRIVATE_CANARY_RUNTIME_BINDING_SQL).toContain('external_reachable_capabilities');
    expect(PRIVATE_CANARY_RUNTIME_BINDING_SQL).toContain('has_schema_privilege');
    expect(PRIVATE_CANARY_RUNTIME_BINDING_SQL).toContain('has_sequence_privilege');
    expect(PRIVATE_CANARY_RUNTIME_BINDING_SQL).toContain('has_parameter_privilege');
    expect(PRIVATE_CANARY_RUNTIME_BINDING_SQL).toContain(
      'pg_catalog.has_foreign_data_wrapper_privilege(',
    );
    expect(PRIVATE_CANARY_RUNTIME_BINDING_SQL).toContain(
      'pg_catalog.has_server_privilege(',
    );
    expect(PRIVATE_CANARY_RUNTIME_BINDING_SQL).toContain("('SET'::text), ('ALTER SYSTEM'::text)");
    expect(PRIVATE_CANARY_RUNTIME_BINDING_SQL).toContain('pg_catalog.pg_largeobject_metadata');
    expect(PRIVATE_CANARY_RUNTIME_BINDING_SQL).toContain('pg_catalog.aclexplode(large_object.lomacl)');
    expect(PRIVATE_CANARY_RUNTIME_BINDING_SQL).toContain('large_object.lomowner = runtime_role.oid');
    expect(PRIVATE_CANARY_RUNTIME_BINDING_SQL).toContain('acl.grantee = 0');
    expect(PRIVATE_CANARY_RUNTIME_BINDING_SQL).toContain("('SELECT'::text), ('UPDATE'::text)");
    expect(PRIVATE_CANARY_RUNTIME_BINDING_SQL).toContain("current_setting('lo_compat_privileges') = 'on'");
    expect(PRIVATE_CANARY_RUNTIME_BINDING_SQL).not.toContain('has_largeobject_privilege');
    expect(PRIVATE_CANARY_RUNTIME_BINDING_SQL).toContain(
      "pg_catalog.pg_has_role(runtime_role.oid, installed_extension.extowner, 'MEMBER')",
    );
    expect(PRIVATE_CANARY_RUNTIME_BINDING_SQL).toContain('CROSS JOIN pg_catalog.pg_depend extension_member');
    expect(PRIVATE_CANARY_RUNTIME_BINDING_SQL).toContain('JOIN pg_catalog.pg_shdepend ownership');
    expect(PRIVATE_CANARY_RUNTIME_BINDING_SQL).toContain(
      'ownership.classid = extension_member.classid',
    );
    expect(PRIVATE_CANARY_RUNTIME_BINDING_SQL).toContain(
      'ownership.objsubid = extension_member.objsubid',
    );
    expect(PRIVATE_CANARY_RUNTIME_BINDING_SQL).toContain(
      "ownership.refclassid = 'pg_catalog.pg_authid'::pg_catalog.regclass",
    );
    expect(PRIVATE_CANARY_RUNTIME_BINDING_SQL).toContain("ownership.deptype = 'o'");
    expect(PRIVATE_CANARY_RUNTIME_BINDING_SQL).toContain('extension_member.objsubid = 0');
    expect(PRIVATE_CANARY_RUNTIME_BINDING_SQL).toContain('extension_member.refobjsubid = 0');
    expect(PRIVATE_CANARY_RUNTIME_BINDING_SQL).toContain("extension_member.deptype = 'e'");
    expect(PRIVATE_CANARY_RUNTIME_BINDING_SQL).toContain(
      "pg_catalog.pg_has_role(runtime_role.oid, ownership.refobjid, 'MEMBER')",
    );
    expect(PRIVATE_CANARY_RUNTIME_BINDING_SQL).toContain('pg_catalog.pg_describe_object(');
    expect(PRIVATE_CANARY_RUNTIME_BINDING_SQL).toContain("'OWNER'::text");
    expect(PRIVATE_CANARY_RUNTIME_BINDING_SQL).toContain(
      'CROSS JOIN pg_catalog.pg_shdepend owned_object',
    );
    expect(PRIVATE_CANARY_RUNTIME_BINDING_SQL).toContain(
      "owned_object.dbid::text || ':' || owned_object.classid::text",
    );
    expect(PRIVATE_CANARY_RUNTIME_BINDING_SQL).toContain('owned_object.objsubid = 0');
    expect(PRIVATE_CANARY_RUNTIME_BINDING_SQL).toContain(
      "pg_catalog.pg_has_role(runtime_role.oid, owned_object.refobjid, 'MEMBER')",
    );
    expect(PRIVATE_CANARY_RUNTIME_BINDING_SQL).toContain('unsafe_migration_role_default_object_acl');
    expect(PRIVATE_CANARY_RUNTIME_BINDING_SQL).toContain('unsafe_migration_role_posture');
    expect(PRIVATE_CANARY_RUNTIME_BINDING_SQL).toContain('unsafe_migration_role_durable_settings');
    expect(PRIVATE_CANARY_RUNTIME_BINDING_SQL).toContain('unsafe_migration_role_external_capability');
    expect(PRIVATE_CANARY_RUNTIME_BINDING_SQL).toContain("owned_relation.relkind <> 'f'");
    expect(PRIVATE_CANARY_RUNTIME_BINDING_SQL).toContain(
      'NOT EXISTS (SELECT 1 FROM unsafe_migration_role_posture)',
    );
    expect(PRIVATE_CANARY_RUNTIME_BINDING_SQL).toContain(
      'NOT EXISTS (SELECT 1 FROM unsafe_migration_role_durable_settings)',
    );
    expect(PRIVATE_CANARY_RUNTIME_BINDING_SQL).toContain(
      'NOT EXISTS (SELECT 1 FROM unsafe_migration_role_external_capability)',
    );
    expect(PRIVATE_CANARY_RUNTIME_BINDING_SQL).toContain('unsafe_runtime_role_durable_settings');
    expect(PRIVATE_CANARY_RUNTIME_BINDING_SQL).toContain('pg_catalog.pg_db_role_setting');
    expect(PRIVATE_CANARY_RUNTIME_BINDING_SQL).toContain('setting.setdatabase = 0');
    expect(PRIVATE_CANARY_RUNTIME_BINDING_SQL).toContain(
      "setting.setconfig = ARRAY['search_path=data_foundry, pg_catalog, extensions']::text[]",
    );
    expect(PRIVATE_CANARY_RUNTIME_BINDING_SQL).toContain("current_setting('lo_compat_privileges') = 'off'");
    expect(PRIVATE_CANARY_RUNTIME_BINDING_SQL).toContain("current_setting('session_replication_role') = 'origin'");
    expect(PRIVATE_CANARY_RUNTIME_BINDING_SQL).toContain('NOT role.rolinherit');
    expect(PRIVATE_CANARY_RUNTIME_BINDING_SQL).toContain(
      'default_acl_object_types(catalog_object_type, default_object_type)',
    );
    expect(PRIVATE_CANARY_RUNTIME_BINDING_SQL).toContain(
      `('S'::"char", 's'::"char")`,
    );
    expect(PRIVATE_CANARY_RUNTIME_BINDING_SQL).toContain(
      'pg_catalog.acldefault(default_acl_type.default_object_type, migration_owner.oid)',
    );
    expect(PRIVATE_CANARY_RUNTIME_BINDING_SQL).toContain("default_acl.defaclobjtype IN ('f', 'r', 'S')");
    expect(PRIVATE_CANARY_RUNTIME_BINDING_SQL).toContain("'non_owner_default_privilege'::text");
    expect(PRIVATE_CANARY_RUNTIME_BINDING_SQL).toContain(
      'acl.grantee <> source.migration_owner_oid',
    );
    expect(PRIVATE_CANARY_RUNTIME_BINDING_SQL).not.toContain('has_type_privilege');
    expect(PRIVATE_CANARY_RUNTIME_BINDING_SQL).not.toContain("namespace.nspname <> 'extensions'");
    // Four access-exemption branches are present in both the bound runtime-role
    // scan and the independent migration-role confinement scan.
    expect(PRIVATE_CANARY_RUNTIME_BINDING_SQL.match(/dependency\.objsubid = 0/g)).toHaveLength(8);
    expect(PRIVATE_CANARY_RUNTIME_BINDING_SQL.match(/dependency\.refobjsubid = 0/g)).toHaveLength(8);
    expect(PRIVATE_CANARY_RUNTIME_BINDING_SQL).toContain(
      "routine.prorettype NOT IN ('pg_catalog.trigger'::pg_catalog.regtype, 'pg_catalog.event_trigger'::pg_catalog.regtype)",
    );
    expect(PRIVATE_CANARY_RUNTIME_BINDING_SQL).toContain('FROM pg_class');
    expect(PRIVATE_CANARY_RUNTIME_BINDING_SQL).toContain('FROM pg_database');
    expect(PRIVATE_CANARY_RUNTIME_BINDING_SQL).toContain(
      'CROSS JOIN pg_catalog.pg_database database',
    );
    expect(PRIVATE_CANARY_RUNTIME_BINDING_SQL).toContain(
      "pg_catalog.has_database_privilege(runtime_role.oid, database.oid, 'CREATE')",
    );
    expect(PRIVATE_CANARY_RUNTIME_BINDING_SQL).toContain(
      "pg_catalog.has_database_privilege(runtime_role.oid, database.oid, 'CONNECT')",
    );
    expect(PRIVATE_CANARY_RUNTIME_BINDING_SQL).toContain('database.datallowconn');
    expect(PRIVATE_CANARY_RUNTIME_BINDING_SQL).toContain('NOT database.datistemplate');
    expect(PRIVATE_CANARY_RUNTIME_BINDING_SQL).toContain('FULL OUTER JOIN');
    expect(PRIVATE_CANARY_RUNTIME_BINDING_SQL).not.toContain('CASE $1');
  });

  it('requires each target to prove its exact current and session role plus narrow private-schema capability', async () => {
    const expectedRoles: Readonly<Record<PrivateCanaryWorker, string>> = {
      edge: 'df_edge',
      web: 'df_web',
      'usage-consumer': 'df_usage',
      'acquisition-worker': 'df_acquisition',
      'mcp-worker': 'df_mcp',
    };

    for (const [worker, role] of Object.entries(expectedRoles) as [PrivateCanaryWorker, string][]) {
      const observedRoles: string[] = [];
      await expect(assertPrivateCanaryRuntimeBinding(worker, async (expectedRole) => {
        observedRoles.push(expectedRole);
        return [{
          current_user: expectedRole,
          session_user: expectedRole,
          role_is_login_nonprivileged: true,
          membership_is_empty: true,
          search_path_is_exact: true,
          lo_compat_privileges_is_off: true,
          session_replication_role_is_origin: true,
          private_schema_usage: true,
          private_schema_create: false,
          privilege_matrix_is_exact: true,
        }];
      })).resolves.toBeUndefined();
      expect(observedRoles).toEqual([role]);
    }
  });

  it('rejects a mismatched role or private-schema privilege before a target can report READY', async () => {
    await expect(assertPrivateCanaryRuntimeBinding('edge', async () => [{
      current_user: 'df_web',
      session_user: 'df_edge',
      role_is_login_nonprivileged: true,
      membership_is_empty: true,
      search_path_is_exact: true,
      lo_compat_privileges_is_off: true,
      session_replication_role_is_origin: true,
      private_schema_usage: true,
      private_schema_create: false,
      privilege_matrix_is_exact: true,
    }])).rejects.toThrow(/runtime binding/i);
    await expect(assertPrivateCanaryRuntimeBinding('edge', async () => [{
      current_user: 'df_edge',
      session_user: 'df_edge',
      role_is_login_nonprivileged: true,
      membership_is_empty: true,
      search_path_is_exact: true,
      lo_compat_privileges_is_off: true,
      session_replication_role_is_origin: true,
      private_schema_usage: false,
      private_schema_create: false,
      privilege_matrix_is_exact: true,
    }])).rejects.toThrow(/runtime binding/i);
  });

  it('rejects an otherwise expected role when its login attributes or membership are unsafe', async () => {
    await expect(assertPrivateCanaryRuntimeBinding('edge', async () => [{
      current_user: 'df_edge',
      session_user: 'df_edge',
      role_is_login_nonprivileged: false,
      membership_is_empty: true,
      search_path_is_exact: true,
      lo_compat_privileges_is_off: true,
      session_replication_role_is_origin: true,
      private_schema_usage: true,
      private_schema_create: false,
      privilege_matrix_is_exact: true,
    }])).rejects.toThrow(/runtime binding/i);
    await expect(assertPrivateCanaryRuntimeBinding('edge', async () => [{
      current_user: 'df_edge',
      session_user: 'df_edge',
      role_is_login_nonprivileged: true,
      membership_is_empty: false,
      search_path_is_exact: true,
      lo_compat_privileges_is_off: true,
      session_replication_role_is_origin: true,
      private_schema_usage: true,
      private_schema_create: false,
      privilege_matrix_is_exact: true,
    }])).rejects.toThrow(/runtime binding/i);
  });

  it.each([
    'search_path_is_exact',
    'lo_compat_privileges_is_off',
    'session_replication_role_is_origin',
  ] as const)('rejects an unsafe live-session result in %s', async (field) => {
    await expect(assertPrivateCanaryRuntimeBinding('edge', async () => [{
      current_user: 'df_edge',
      session_user: 'df_edge',
      role_is_login_nonprivileged: true,
      membership_is_empty: true,
      search_path_is_exact: true,
      lo_compat_privileges_is_off: true,
      session_replication_role_is_origin: true,
      private_schema_usage: true,
      private_schema_create: false,
      privilege_matrix_is_exact: true,
      [field]: false,
    }])).rejects.toThrow(/runtime binding/i);
  });

  it('accepts only an explicitly service-bound production Hyperdrive', () => {
    expect(resolvePrivateCanaryConnectionString({
      DEPLOYMENT_ENVIRONMENT: 'production',
      PRIVATE_CANARY_MODE: PRIVATE_CANARY_SERVICE_BINDING_MODE,
      HYPERDRIVE: { connectionString: 'postgres://hyperdrive.fixture/private-canary' },
    })).toBe('postgres://hyperdrive.fixture/private-canary');
  });

  it('refuses a missing service-binding mode or direct database fallback', () => {
    expect(() => resolvePrivateCanaryConnectionString({
      DEPLOYMENT_ENVIRONMENT: 'production',
      HYPERDRIVE: { connectionString: 'postgres://hyperdrive.fixture/private-canary' },
    })).toThrow('Private canary requires an explicit service-binding deployment.');
    expect(() => resolvePrivateCanaryConnectionString({
      DEPLOYMENT_ENVIRONMENT: 'production',
      PRIVATE_CANARY_MODE: PRIVATE_CANARY_SERVICE_BINDING_MODE,
      POSTGRES_URL: 'postgres://direct.fixture/must-not-be-used',
    })).toThrow('Private canary does not permit a direct database connection.');
  });
});

describe('private canary RPC receipts', () => {
  const edgeProbe = {
    worker: 'edge',
    runId: '11111111-1111-4111-8111-111111111111',
    readiness: 'READY',
    metering: 'QUEUED',
  } as const;
  const probes = [
    edgeProbe,
    {
      worker: 'web',
      runId: envelope.run_id,
      readiness: 'READY',
      metering: 'NOT_APPLICABLE',
    },
    {
      worker: 'usage-consumer',
      runId: envelope.run_id,
      readiness: 'READY',
      metering: 'NOT_APPLICABLE',
    },
    {
      worker: 'acquisition-worker',
      runId: envelope.run_id,
      readiness: 'READY',
      metering: 'NOT_APPLICABLE',
    },
    {
      worker: 'mcp-worker',
      runId: envelope.run_id,
      readiness: 'READY',
      metering: 'QUEUED',
    },
  ] as const;

  it('keeps only fixed worker/readiness/metering values in the durable receipt', () => {
    const probe = parsePrivateCanaryProbeResult(JSON.parse(JSON.stringify(edgeProbe)) as unknown);

    expect(probe).toEqual(edgeProbe);
    if (probe === null) throw new Error('the fixed edge probe result must parse');
    expect(createPrivateCanaryReceipt({
      runId: envelope.run_id,
      issuedAt: envelope.issued_at,
      completedAt: '2026-09-01T12:01:00.000Z',
      probes,
    })).toEqual({
      kind: 'data-foundry.private-canary-receipt.v1',
      run_id: '11111111-1111-4111-8111-111111111111',
      issued_at: '2026-09-01T12:00:00.000Z',
      completed_at: '2026-09-01T12:01:00.000Z',
      probes,
    });
  });

  it('refuses arbitrary diagnostic content from an RPC result before it can reach R2', () => {
    expect(parsePrivateCanaryProbeResult({
      ...edgeProbe,
      error: 'https://commercial-source.example/private-record',
    })).toBeNull();
    expect(parsePrivateCanaryProbeResult({
      ...edgeProbe,
      detail: 'Bearer must-not-persist',
    })).toBeNull();
  });

  it('refuses UUID versions other than v4 for result and receipt run identifiers', () => {
    const nonV4RunId = '11111111-1111-1111-8111-111111111111';
    expect(parsePrivateCanaryProbeResult({ ...edgeProbe, runId: nonV4RunId })).toBeNull();
    expect(() => createPrivateCanaryReceipt({
      runId: nonV4RunId,
      issuedAt: envelope.issued_at,
      completedAt: '2026-09-01T12:01:00.000Z',
      probes: probes.map((probe) => ({ ...probe, runId: nonV4RunId })),
    })).toThrow(TypeError);
  });

  it('refuses a noncanonical cycle timestamp before it can become durable canary evidence', () => {
    expect(() => createPrivateCanaryReceipt({
      runId: envelope.run_id,
      issuedAt: '2026-09-01',
      completedAt: '2026-09-01T12:01:00.000Z',
      probes,
    })).toThrow(TypeError);
  });

  it('refuses an incomplete or mismatched probe set rather than recording partial canary success', () => {
    expect(() => createPrivateCanaryReceipt({
      runId: envelope.run_id,
      issuedAt: envelope.issued_at,
      completedAt: '2026-09-01T12:01:00.000Z',
      probes: probes.slice(0, 4),
    })).toThrow(TypeError);
    expect(() => createPrivateCanaryReceipt({
      runId: envelope.run_id,
      issuedAt: envelope.issued_at,
      completedAt: '2026-09-01T12:01:00.000Z',
      probes: [{ ...edgeProbe, runId: '88888888-8888-4888-8888-888888888888' }, ...probes.slice(1)],
    })).toThrow(TypeError);
  });
});
