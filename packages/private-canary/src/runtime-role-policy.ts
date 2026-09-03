/**
 * Canonical least-privilege inventory shared by grant generation and every
 * private-canary/direct-role effective-privilege probe. It is intentionally
 * data-only so it can be bundled into Workers without a Node runtime.
 */
export const RUNTIME_ROLES = ['df_edge', 'df_web', 'df_mcp', 'df_usage', 'df_acquisition'] as const;
export type RuntimeRole = (typeof RUNTIME_ROLES)[number];

export const QUERY_ROLES = ['df_edge', 'df_web', 'df_mcp'] as const;
export const QUERY_CORE_RELATIONS = [
  'verticals',
  'entities',
  'current_entity_aliases',
  'entity_redirects',
  'facts',
  'fact_evidence',
  'relationships',
  'relationship_evidence',
  'fact_dependencies',
  'sources',
  'source_records',
  'source_artifacts',
  'source_record_reconciliations',
  'source_record_snapshot_retirements',
  'entity_evidence',
  'rights_publishers',
  'rights_decision_activation_events',
  'rights_terms_activation_events',
  'rights_cells',
  'rights_decisions',
  'rights_terms_versions',
  'rights_terms_cells',
  'rights_decision_conditions',
  'rights_deny_exceptions',
  'rights_field_group_members',
] as const;
export const RIGHTS_CONTEXT_RELATIONS = QUERY_CORE_RELATIONS.filter((relation) =>
  relation.startsWith('rights_'),
);
export const API_KEY_AUTH_COLUMNS = [
  'id',
  'tenant_id',
  'token_hash',
  'token_prefix',
  'vertical_id',
  'access_tier',
  'billing_source',
  'revoked_at',
  'expires_at',
] as const;
export const API_TENANT_AUTH_COLUMNS = ['id', 'status'] as const;
export const USAGE_INSERT_COLUMNS = [
  'id',
  'tenant_id',
  'api_key_id',
  'vertical_id',
  'occurred_at',
  'route_key',
  'method',
  'status',
  'rows_served',
  'duration_ms',
  'access_tier',
  'billing_source',
] as const;

/** Final function identities after migrations 0001..0028, from pg_proc. */
export const PRIVATE_FUNCTION_SIGNATURES = [
  'activate_rights_decision(uuid, text, text, text, timestamp with time zone)',
  'activate_rights_terms(uuid, text, text, text, timestamp with time zone)',
  'enforce_api_key_access_classification()',
  'entity_alias_claims_reject_mutation()',
  'entity_alias_claims_validate_insert()',
  'entity_aliases_enforce_authority_epoch()',
  'entity_evidence_validate_alias_claim()',
  'entity_evidence_validate_provenance()',
  'fact_dependencies_reject_cycle()',
  'fact_dependencies_require_open_classification()',
  'facts_reject_output_kind_mutation()',
  'facts_validate_output_contract()',
  'revoke_rights_terms(uuid, text, text, text, timestamp with time zone)',
  'rights_cell_requires_decision()',
  'rights_prepare_decision_activation()',
  'rights_prepare_terms_activation()',
  'rights_reject_history_mutation()',
  'rights_reject_referenced_field_group_expansion()',
  'rights_scope_is_strictly_narrower(uuid, uuid)',
  'rights_terms_cover_cell(uuid, uuid)',
  'rights_validate_cell_field_group()',
  'rights_validate_condition_insert()',
  'rights_validate_decision_insert()',
  'rights_validate_deny_exception()',
  'rights_validate_publisher_update()',
  'rights_validate_source_publisher_mapping()',
  'rights_validate_terms_version()',
  'scheduled_acquisition_claim_lease_guard()',
  'scheduled_acquisition_iso_utc_valid(text)',
  'scheduled_acquisition_origin_valid(text)',
  'scheduled_acquisition_receipt_contract_version_guard()',
  'scheduled_acquisition_receipt_provenance_valid(jsonb, uuid, text, text, text, text, text, boolean, timestamp with time zone)',
  'scheduled_acquisition_receipt_valid(jsonb)',
  'scheduled_acquisition_receipt_valid_for(jsonb, text, text, timestamp with time zone, timestamp with time zone)',
  'scheduled_acquisition_receipt_valid_for_contract(jsonb, text, text, timestamp with time zone, timestamp with time zone, smallint)',
  'scheduled_acquisition_result_url_allowed(text, text, jsonb, text, text)',
  'scheduled_acquisition_result_url_policy_valid(jsonb)',
  'scheduled_acquisition_retrieval_receipt_id(uuid, text, text)',
  'scheduled_acquisition_run_artifact_guard()',
  'scheduled_acquisition_run_artifact_immutable()',
  'scheduled_acquisition_run_insert_guard()',
  'scheduled_acquisition_run_terminal_guard()',
  'scheduled_acquisition_scope_digest(uuid, text, text, uuid, text, text, text, text, text, text, text, text, jsonb, timestamp with time zone, text)',
  'scheduled_acquisition_scope_frame(text)',
  'scheduled_acquisition_uuid_or_null_valid(jsonb)',
  'scheduled_acquisition_validators_valid(jsonb)',
  'source_artifacts_reject_scope_mutation()',
  'source_record_evidence_validate_provenance()',
  'source_record_reconciliations_reject_mutation()',
  'source_record_reconciliations_validate_insert()',
  'source_record_snapshot_retirements_reject_mutation()',
  'source_record_snapshot_retirements_validate()',
  'source_records_require_retirement_lineage()',
  'source_records_validate_revision_update()',
  'source_stream_snapshot_acceptance_artifacts_validate()',
  'source_stream_snapshot_acceptances_require_artifacts()',
  'source_stream_snapshot_evidence_reject_mutation()',
] as const;

export type RuntimeGrantScope = 'schema' | 'relation' | 'column' | 'function';
export interface RuntimeRoleExpectedGrant {
  readonly scope: RuntimeGrantScope;
  readonly objectName: string;
  readonly columnName: string;
  readonly role: RuntimeRole;
  readonly privilege: string;
  readonly isGrantable: false;
}

/** The one generated runtime grant inventory, independent of SQL rendering. */
export function buildRuntimeRoleExpectedGrants(schema = 'data_foundry'): readonly RuntimeRoleExpectedGrant[] {
  const expected: RuntimeRoleExpectedGrant[] = [];
  const addSchema = (role: RuntimeRole) => {
    expected.push({ scope: 'schema', objectName: schema, columnName: '', role, privilege: 'USAGE', isGrantable: false });
  };
  const addRelation = (role: RuntimeRole, relation: string, privileges: readonly string[]) => {
    for (const privilege of privileges) {
      expected.push({ scope: 'relation', objectName: relation, columnName: '', role, privilege, isGrantable: false });
    }
  };
  const addColumns = (role: RuntimeRole, relation: string, privilege: string, columns: readonly string[]) => {
    for (const columnName of columns) {
      expected.push({ scope: 'column', objectName: relation, columnName, role, privilege, isGrantable: false });
    }
  };

  for (const role of RUNTIME_ROLES) addSchema(role);
  for (const role of QUERY_ROLES) {
    for (const relation of QUERY_CORE_RELATIONS) addRelation(role, relation, ['SELECT']);
  }
  for (const role of ['df_edge', 'df_mcp'] as const) {
    addColumns(role, 'api_keys', 'SELECT', API_KEY_AUTH_COLUMNS);
    addColumns(role, 'api_tenants', 'SELECT', API_TENANT_AUTH_COLUMNS);
  }
  addColumns('df_usage', 'api_usage_events', 'INSERT', USAGE_INSERT_COLUMNS);
  addColumns('df_usage', 'api_usage_events', 'SELECT', ['id']);
  addColumns('df_usage', 'api_keys', 'SELECT', ['id', 'access_tier', 'billing_source']);

  addRelation('df_acquisition', 'verticals', ['SELECT', 'INSERT']);
  addRelation('df_acquisition', 'sources', ['SELECT', 'INSERT']);
  addColumns('df_acquisition', 'sources', 'UPDATE', ['kill_switch_engaged']);
  addRelation('df_acquisition', 'source_artifacts', ['SELECT', 'INSERT']);
  addRelation('df_acquisition', 'scheduled_acquisition_runs', ['SELECT', 'INSERT', 'UPDATE']);
  for (const relation of ['acquisition_policy_snapshots', 'scheduled_acquisition_run_artifacts']) {
    addRelation('df_acquisition', relation, ['SELECT', 'INSERT']);
  }
  for (const relation of RIGHTS_CONTEXT_RELATIONS) addRelation('df_acquisition', relation, ['SELECT']);
  for (const signature of PRIVATE_FUNCTION_SIGNATURES) {
    expected.push({
      scope: 'function',
      objectName: signature,
      columnName: '',
      role: 'df_acquisition',
      privilege: 'EXECUTE',
      isGrantable: false,
    });
  }
  return expected;
}

function sqlLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

/**
 * The migration owner is a controlled direct login. It may be granted to an
 * administrative connector so that provider-managed packets can SET LOCAL
 * ROLE, but it must never be able to inherit or SET ROLE to another role.
 */
export function buildMigrationRoleUnsafePostureSql(
  migrationRole = 'df_migration',
): string {
  const migrationRoleLiteral = sqlLiteral(migrationRole);
  return `WITH migration_role AS (
  SELECT role.oid,
         role.rolcanlogin,
         role.rolinherit,
         role.rolsuper,
         role.rolcreatedb,
         role.rolcreaterole,
         role.rolreplication,
         role.rolbypassrls
    FROM pg_catalog.pg_roles role
   WHERE role.rolname = ${migrationRoleLiteral}
)
SELECT 'missing_migration_role'::text AS violation
 WHERE NOT EXISTS (SELECT 1 FROM migration_role)
UNION ALL
SELECT 'migration_role_is_not_login'::text
  FROM migration_role
 WHERE NOT rolcanlogin
UNION ALL
SELECT 'unsafe_migration_role_attribute'::text
  FROM migration_role
 WHERE rolinherit
    OR rolsuper
    OR rolcreatedb
    OR rolcreaterole
    OR rolreplication
    OR rolbypassrls
UNION ALL
SELECT 'outgoing_migration_role_membership'::text
  FROM migration_role
  JOIN pg_catalog.pg_auth_members membership
    ON membership.member = migration_role.oid`;
}

/** Session state that can bypass relational or large-object privilege checks. */
export function buildUnsafeMigrationSessionSql(): string {
  return `SELECT 'session_replication_role'::text AS violation
 WHERE pg_catalog.current_setting('session_replication_role') IS DISTINCT FROM 'origin'
UNION ALL
SELECT 'lo_compat_privileges'::text
 WHERE pg_catalog.current_setting('lo_compat_privileges') IS DISTINCT FROM 'off'`;
}

/**
 * Exact live namespace resolution required while migration SQL is executing.
 * Checking both the configured text and resolved schemas prevents a missing or
 * substituted schema from silently changing name resolution.
 */
export function buildUnsafeMigrationSearchPathSql(
  schema = 'data_foundry',
): string {
  const canonicalSearchPath = sqlLiteral(`${schema}, pg_catalog, extensions`);
  const schemaLiteral = sqlLiteral(schema);
  return `SELECT 'noncanonical_migration_search_path'::pg_catalog.text AS violation
 WHERE NOT (
       pg_catalog.current_setting('search_path'::pg_catalog.text) OPERATOR(pg_catalog.=) ${canonicalSearchPath}::pg_catalog.text
   AND pg_catalog.current_schemas(false) OPERATOR(pg_catalog.=) ARRAY[${schemaLiteral}, 'pg_catalog', 'extensions']::pg_catalog.name[]
 )`;
}

/**
 * Refuse every non-owner privilege in the migration owner's effective
 * function, table, or sequence defaults. PostgreSQL hard-wired defaults apply
 * when a global row is absent, while target-schema rows add privileges to the
 * global defaults. A missing owner is a violation rather than an empty result
 * so every caller retains fail-closed semantics. Type USAGE remains
 * deliberately accepted as an inert capability even when the role can use the
 * schema.
 */
export function buildMigrationRoleUnsafeDefaultAclSql(
  schema = 'data_foundry',
  migrationRole = 'df_migration',
): string {
  const schemaLiteral = sqlLiteral(schema);
  const migrationRoleLiteral = sqlLiteral(migrationRole);
  return `WITH migration_owner AS (
  SELECT role.oid
    FROM pg_catalog.pg_roles role
   WHERE role.rolname = ${migrationRoleLiteral}
), default_acl_object_types(catalog_object_type, default_object_type) AS (
  VALUES ('f'::"char", 'f'::"char"),
         ('r'::"char", 'r'::"char"),
         ('S'::"char", 's'::"char")
), effective_default_acls AS (
  SELECT 'global'::text AS default_scope,
         default_acl_type.catalog_object_type AS object_type,
         migration_owner.oid AS migration_owner_oid,
         COALESCE(
           (
             SELECT default_acl.defaclacl
               FROM pg_catalog.pg_default_acl default_acl
              WHERE default_acl.defaclrole = migration_owner.oid
                AND default_acl.defaclnamespace = 0
                AND default_acl.defaclobjtype = default_acl_type.catalog_object_type
           ),
           pg_catalog.acldefault(default_acl_type.default_object_type, migration_owner.oid)
         ) AS acl
    FROM migration_owner
    CROSS JOIN default_acl_object_types default_acl_type
  UNION ALL
  SELECT 'schema'::text,
         default_acl.defaclobjtype,
         migration_owner.oid,
         default_acl.defaclacl
    FROM migration_owner
    JOIN pg_catalog.pg_namespace namespace
      ON namespace.nspname = ${schemaLiteral}
    JOIN pg_catalog.pg_default_acl default_acl
      ON default_acl.defaclrole = migration_owner.oid
     AND default_acl.defaclnamespace = namespace.oid
     AND default_acl.defaclobjtype IN ('f', 'r', 'S')
)
SELECT 'missing_migration_role'::text AS violation
 WHERE NOT EXISTS (SELECT 1 FROM migration_owner)
UNION ALL
SELECT 'non_owner_default_privilege'::text
  FROM effective_default_acls source
  CROSS JOIN LATERAL pg_catalog.aclexplode(source.acl) acl
 WHERE acl.grantee <> source.migration_owner_oid`;
}

/**
 * Inventory durable settings that can change a runtime role's database session
 * before application SQL runs. A role-global row is always forbidden. A row
 * for the current database is either absent during NOLOGIN staging or exactly
 * the canonical search path; live checks require that exact row. Database-wide
 * settings are shared by every runtime login, so the two privilege-sensitive
 * values are rejected independently of per-role rows.
 */
export function buildRuntimeRoleUnsafeDurableSettingSql(
  schema: string,
  roleFilterSql: string,
  requireCanonicalCurrentDatabaseRow: boolean,
): string {
  const canonicalSearchPath = sqlLiteral(`search_path=${schema}, pg_catalog, extensions`);
  return `WITH selected_runtime_roles AS (
  SELECT runtime_role.oid, runtime_role.rolname
    FROM pg_catalog.pg_roles runtime_role
   WHERE ${roleFilterSql}
), current_database_identity AS (
  SELECT database.oid
    FROM pg_catalog.pg_database database
   WHERE database.datname = current_database()
)
SELECT 'role_global_setting'::text AS violation,
       runtime_role.rolname::text AS role_name,
       COALESCE(pg_catalog.array_to_string(setting.setconfig, ','), '<null>')::text AS setting_item
  FROM selected_runtime_roles runtime_role
  JOIN pg_catalog.pg_db_role_setting setting
    ON setting.setrole = runtime_role.oid
   AND setting.setdatabase = 0
UNION ALL
SELECT 'noncanonical_current_database_role_setting'::text,
       runtime_role.rolname::text,
       COALESCE(pg_catalog.array_to_string(setting.setconfig, ','), '<null>')::text
  FROM selected_runtime_roles runtime_role
  CROSS JOIN current_database_identity database
  JOIN pg_catalog.pg_db_role_setting setting
    ON setting.setrole = runtime_role.oid
   AND setting.setdatabase = database.oid
 WHERE setting.setconfig IS DISTINCT FROM ARRAY[${canonicalSearchPath}]::text[]
UNION ALL
SELECT 'missing_current_database_role_setting'::text,
       runtime_role.rolname::text,
       ''::text
  FROM selected_runtime_roles runtime_role
  CROSS JOIN current_database_identity database
 WHERE ${requireCanonicalCurrentDatabaseRow}
   AND (
     SELECT count(*)
       FROM pg_catalog.pg_db_role_setting setting
      WHERE setting.setrole = runtime_role.oid
        AND setting.setdatabase = database.oid
        AND setting.setconfig = ARRAY[${canonicalSearchPath}]::text[]
   ) <> 1
UNION ALL
SELECT 'unsafe_current_database_setting'::text,
       runtime_role.rolname::text,
       setting_item.item::text
  FROM selected_runtime_roles runtime_role
  CROSS JOIN current_database_identity database
  JOIN pg_catalog.pg_db_role_setting setting
    ON setting.setrole = 0
   AND setting.setdatabase IN (0, database.oid)
  CROSS JOIN LATERAL pg_catalog.unnest(setting.setconfig) setting_item(item)
 WHERE (
         pg_catalog.lower(pg_catalog.split_part(setting_item.item, '=', 1)) = 'lo_compat_privileges'
         AND pg_catalog.lower(pg_catalog.split_part(setting_item.item, '=', 2)) IN ('on', 'true', 'yes', '1')
       )
    OR (
         pg_catalog.lower(pg_catalog.split_part(setting_item.item, '=', 1)) = 'session_replication_role'
         AND pg_catalog.lower(pg_catalog.split_part(setting_item.item, '=', 2)) <> 'origin'
       )`;
}

/** Exact durable session defaults required for the controlled migration login. */
export function buildMigrationRoleUnsafeDurableSettingSql(
  schema = 'data_foundry',
  migrationRole = 'df_migration',
): string {
  return buildRuntimeRoleUnsafeDurableSettingSql(
    schema,
    `runtime_role.rolname = ${sqlLiteral(migrationRole)}`,
    true,
  );
}

/**
 * The only direct runtime-role ACLs permitted outside the private schema.
 * PostgreSQL grants inherited from PUBLIC are deliberately not represented:
 * the deployment contract treats those separately from named role ACLs.
 */
export function buildRuntimeRoleExpectedExternalAclValuesSql(): string {
  return RUNTIME_ROLES.flatMap((role) => [
    `    ('schema', 'extensions', '', ${sqlLiteral(role)}, 'USAGE', false)`,
    `    ('database', current_database()::text, '', ${sqlLiteral(role)}, 'CONNECT', false)`,
  ]).join(',\n');
}

/**
 * The migration owner has the same external direct-ACL envelope as a runtime
 * role: current-database CONNECT plus extensions-schema USAGE. It additionally
 * must not be able to reach external data, executable code, object creation,
 * parameter control, large objects, or extension ownership through effective
 * privileges.
 */
export function buildMigrationRoleUnsafeExternalCapabilitySql(
  schema = 'data_foundry',
  migrationRole = 'df_migration',
): string {
  const migrationRoleLiteral = sqlLiteral(migrationRole);
  return `WITH expected_external_role_acls(scope, object_name, column_name, role_name, privilege, is_grantable) AS (VALUES
  ('schema'::text, 'extensions'::text, ''::text, ${migrationRoleLiteral}::text, 'USAGE'::text, false),
  ('database'::text, current_database()::text, ''::text, ${migrationRoleLiteral}::text, 'CONNECT'::text, false)
), actual_external_role_acls AS (
${buildRuntimeRoleExternalDirectAclSql(
    schema,
    `grantee.rolname = ${migrationRoleLiteral}`,
    true,
  )}
), external_direct_acl_differences AS (
  SELECT COALESCE(expected.scope, actual.scope) AS scope
    FROM expected_external_role_acls expected
    FULL OUTER JOIN actual_external_role_acls actual
      USING (scope, object_name, column_name, role_name, privilege, is_grantable)
   WHERE expected.scope IS NULL OR actual.scope IS NULL
), migration_role AS (
  SELECT role.oid
    FROM pg_catalog.pg_roles role
   WHERE role.rolname = ${migrationRoleLiteral}
), current_database_identity AS (
  SELECT database.oid
    FROM pg_catalog.pg_database database
   WHERE database.datname = current_database()
), unsafe_owned_objects AS (
  SELECT ownership.dbid::text || ':' || ownership.classid::text || ':' ||
           ownership.objid::text || ':' || ownership.objsubid::text AS object_name
    FROM migration_role
    CROSS JOIN pg_catalog.pg_shdepend ownership
    CROSS JOIN current_database_identity database
   WHERE ownership.objsubid = 0
     AND ownership.refclassid = 'pg_catalog.pg_authid'::pg_catalog.regclass
     AND ownership.deptype = 'o'
     AND pg_catalog.pg_has_role(migration_role.oid, ownership.refobjid, 'MEMBER')
     AND NOT (
       ownership.dbid = database.oid
       AND (
         (
           ownership.classid = 'pg_catalog.pg_default_acl'::pg_catalog.regclass
           AND EXISTS (
             SELECT 1
               FROM pg_catalog.pg_default_acl owned_default_acl
              WHERE owned_default_acl.oid = ownership.objid
                AND (
                  owned_default_acl.defaclnamespace = 0
                  OR owned_default_acl.defaclnamespace = (
                    SELECT oid FROM pg_catalog.pg_namespace WHERE nspname = ${sqlLiteral(schema)}
                  )
                )
           )
         )
         OR (
           ownership.classid = 'pg_catalog.pg_namespace'::pg_catalog.regclass
           AND ownership.objid = (SELECT oid FROM pg_catalog.pg_namespace WHERE nspname = ${sqlLiteral(schema)})
         )
         OR (
           ownership.classid = 'pg_catalog.pg_class'::pg_catalog.regclass
           AND EXISTS (
             SELECT 1 FROM pg_catalog.pg_class owned_relation
             JOIN pg_catalog.pg_namespace owned_namespace ON owned_namespace.oid = owned_relation.relnamespace
             WHERE owned_relation.oid = ownership.objid
               AND owned_namespace.nspname = ${sqlLiteral(schema)}
               AND owned_relation.relkind <> 'f'
           )
         )
         OR (
           ownership.classid = 'pg_catalog.pg_proc'::pg_catalog.regclass
           AND EXISTS (
             SELECT 1 FROM pg_catalog.pg_proc owned_routine
             JOIN pg_catalog.pg_namespace owned_namespace ON owned_namespace.oid = owned_routine.pronamespace
             WHERE owned_routine.oid = ownership.objid AND owned_namespace.nspname = ${sqlLiteral(schema)}
           )
         )
         OR (
           ownership.classid = 'pg_catalog.pg_type'::pg_catalog.regclass
           AND EXISTS (
             SELECT 1 FROM pg_catalog.pg_type owned_type
             JOIN pg_catalog.pg_namespace owned_namespace ON owned_namespace.oid = owned_type.typnamespace
             WHERE owned_type.oid = ownership.objid AND owned_namespace.nspname = ${sqlLiteral(schema)}
           )
         )
       )
     )
)
SELECT 'external_direct_acl'::text AS violation
  FROM external_direct_acl_differences
UNION ALL
SELECT 'external_reachable_capability'::text
  FROM (
${buildRuntimeRoleReachableExternalCapabilitySql(
    schema,
    `runtime_role.rolname = ${migrationRoleLiteral}`,
    false,
  )}
  ) reachable_external_capability
UNION ALL
SELECT 'external_owned_object'::text
  FROM unsafe_owned_objects`;
}

/**
 * Inventory every named runtime-role ACL outside the private schema. The
 * caller supplies the trusted SQL predicate for the joined `grantee` row so
 * the migration verifier can inspect all runtime roles and a canary probe can
 * inspect its one bound role with the same inventory.
 */
export function buildRuntimeRoleExternalDirectAclSql(
  schema: string,
  roleFilterSql: string,
  excludeOwnerSelfDefaultAcls = false,
): string {
  const schemaLiteral = sqlLiteral(schema);
  const defaultAclOwnerPredicate = excludeOwnerSelfDefaultAcls
    ? ' AND owner.oid <> grantee.oid'
    : '';
  return `SELECT 'schema'::text AS scope, n.nspname::text AS object_name, ''::text AS column_name,
           grantee.rolname::text AS role_name, acl.privilege_type::text AS privilege, acl.is_grantable
      FROM pg_namespace n CROSS JOIN LATERAL aclexplode(n.nspacl) acl
      JOIN pg_roles grantee ON grantee.oid = acl.grantee
     WHERE n.nspname <> ${schemaLiteral} AND ${roleFilterSql}
    UNION ALL
    SELECT 'relation', n.nspname || '.' || c.relname, '', grantee.rolname::text, acl.privilege_type::text, acl.is_grantable
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      CROSS JOIN LATERAL aclexplode(c.relacl) acl JOIN pg_roles grantee ON grantee.oid = acl.grantee
     WHERE n.nspname <> ${schemaLiteral} AND c.relkind IN ('r','p','v','m','S','f') AND ${roleFilterSql}
    UNION ALL
    SELECT 'column', n.nspname || '.' || c.relname, a.attname::text, grantee.rolname::text, acl.privilege_type::text, acl.is_grantable
      FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
      CROSS JOIN LATERAL aclexplode(a.attacl) acl JOIN pg_roles grantee ON grantee.oid = acl.grantee
     WHERE n.nspname <> ${schemaLiteral} AND a.attnum > 0 AND NOT a.attisdropped AND ${roleFilterSql}
    UNION ALL
    SELECT 'function', n.nspname || '.' || p.proname || '(' || oidvectortypes(p.proargtypes) || ')', '',
           grantee.rolname::text, acl.privilege_type::text, acl.is_grantable
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      CROSS JOIN LATERAL aclexplode(p.proacl) acl JOIN pg_roles grantee ON grantee.oid = acl.grantee
     WHERE n.nspname <> ${schemaLiteral} AND p.prokind IN ('f','p','a','w') AND ${roleFilterSql}
    UNION ALL
    SELECT 'type', n.nspname || '.' || t.typname, '', grantee.rolname::text, acl.privilege_type::text, acl.is_grantable
      FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
      CROSS JOIN LATERAL aclexplode(t.typacl) acl JOIN pg_roles grantee ON grantee.oid = acl.grantee
     WHERE n.nspname <> ${schemaLiteral} AND ${roleFilterSql}
    UNION ALL
    SELECT 'database', d.datname::text, '', grantee.rolname::text, acl.privilege_type::text, acl.is_grantable
      FROM pg_database d CROSS JOIN LATERAL aclexplode(d.datacl) acl
      JOIN pg_roles grantee ON grantee.oid = acl.grantee WHERE ${roleFilterSql}
    UNION ALL
    SELECT 'foreign_server', s.srvname::text, '', grantee.rolname::text,
           acl.privilege_type::text, acl.is_grantable
      FROM pg_foreign_server s CROSS JOIN LATERAL aclexplode(s.srvacl) acl
      JOIN pg_roles grantee ON grantee.oid = acl.grantee WHERE ${roleFilterSql}
    UNION ALL
    SELECT 'foreign_data_wrapper', w.fdwname::text, '', grantee.rolname::text,
           acl.privilege_type::text, acl.is_grantable
      FROM pg_foreign_data_wrapper w CROSS JOIN LATERAL aclexplode(w.fdwacl) acl
      JOIN pg_roles grantee ON grantee.oid = acl.grantee WHERE ${roleFilterSql}
    UNION ALL
    SELECT 'language', l.lanname::text, '', grantee.rolname::text,
           acl.privilege_type::text, acl.is_grantable
      FROM pg_language l CROSS JOIN LATERAL aclexplode(l.lanacl) acl
      JOIN pg_roles grantee ON grantee.oid = acl.grantee WHERE ${roleFilterSql}
    UNION ALL
    SELECT 'tablespace', t.spcname::text, '', grantee.rolname::text,
           acl.privilege_type::text, acl.is_grantable
      FROM pg_tablespace t CROSS JOIN LATERAL aclexplode(t.spcacl) acl
      JOIN pg_roles grantee ON grantee.oid = acl.grantee WHERE ${roleFilterSql}
    UNION ALL
    SELECT 'large_object', l.oid::text, '', grantee.rolname::text,
           acl.privilege_type::text, acl.is_grantable
      FROM pg_largeobject_metadata l CROSS JOIN LATERAL aclexplode(l.lomacl) acl
      JOIN pg_roles grantee ON grantee.oid = acl.grantee WHERE ${roleFilterSql}
    UNION ALL
    SELECT 'parameter', p.parname::text, '', grantee.rolname::text,
           acl.privilege_type::text, acl.is_grantable
      FROM pg_parameter_acl p CROSS JOIN LATERAL aclexplode(p.paracl) acl
      JOIN pg_roles grantee ON grantee.oid = acl.grantee WHERE ${roleFilterSql}
    UNION ALL
    SELECT 'default_acl', owner.rolname || ':' || COALESCE(n.nspname, '') || ':' || d.defaclobjtype::text,
           '', grantee.rolname::text, acl.privilege_type::text, acl.is_grantable
      FROM pg_default_acl d
      JOIN pg_roles owner ON owner.oid = d.defaclrole
      LEFT JOIN pg_namespace n ON n.oid = d.defaclnamespace
      CROSS JOIN LATERAL aclexplode(d.defaclacl) acl
       JOIN pg_roles grantee ON grantee.oid = acl.grantee WHERE ${roleFilterSql}${defaultAclOwnerPredicate}`;
}

/**
 * Inventory direct data access, schema mutation, custom-routine execution,
 * parameter control, and large-object access a runtime role can reach outside
 * the private schema. Inert schema
 * USAGE and table-composite type USAGE expose neither rows nor executable code
 * and are intentionally ignored. Trigger and event-trigger functions are not
 * directly callable. Other routines and relation-like objects are ignored
 * only when PostgreSQL catalogs attest that the object is an extension member.
 * CREATE on any database and external-schema CREATE are independently
 * reachable and therefore always appear. Database TEMP remains allowed: it
 * cannot create a durable schema and is commonly inherited from PUBLIC. No
 * selected runtime role may own any whole object in any database or shared
 * catalog; numeric catalog addresses keep that cluster-wide scan safe when an
 * object belongs to another database and cannot be described in this one.
 */
export function buildRuntimeRoleReachableExternalCapabilitySql(
  schema: string,
  roleFilterSql: string,
  rejectAllObjectOwnership = true,
): string {
  const schemaLiteral = sqlLiteral(schema);
  const externalSchemaPredicate = `namespace.nspname <> ${schemaLiteral}
       AND namespace.nspname <> 'information_schema'
       AND namespace.nspname !~ '^pg_'`;
  return `SELECT 'database'::text AS scope, database.datname::text AS object_name,
           runtime_role.rolname::text AS role_name, 'CREATE'::text AS privilege
      FROM pg_catalog.pg_roles runtime_role
      CROSS JOIN pg_catalog.pg_database database
     WHERE ${roleFilterSql}
       AND pg_catalog.has_database_privilege(runtime_role.oid, database.oid, 'CREATE')
    UNION ALL
    SELECT 'database_connect'::text AS scope, database.oid::text AS object_name,
           runtime_role.rolname::text AS role_name, 'CONNECT'::text AS privilege
      FROM pg_catalog.pg_roles runtime_role
      CROSS JOIN pg_catalog.pg_database database
     WHERE ${roleFilterSql}
       AND database.datallowconn
       AND NOT database.datistemplate
       AND database.oid OPERATOR(pg_catalog.<>) (
         SELECT current_database_identity.oid
           FROM pg_catalog.pg_database current_database_identity
          WHERE current_database_identity.datname OPERATOR(pg_catalog.=) pg_catalog.current_database()
       )
       AND pg_catalog.has_database_privilege(runtime_role.oid, database.oid, 'CONNECT')
    UNION ALL
    SELECT 'schema'::text AS scope, namespace.nspname::text AS object_name,
           runtime_role.rolname::text AS role_name, 'CREATE'::text AS privilege
      FROM pg_roles runtime_role CROSS JOIN pg_namespace namespace
     WHERE ${roleFilterSql} AND ${externalSchemaPredicate}
       AND has_schema_privilege(runtime_role.rolname, namespace.oid, 'CREATE')
    UNION ALL
    SELECT 'foreign_data_wrapper'::text AS scope,
           wrapper.fdwname::text AS object_name,
           runtime_role.rolname::text AS role_name,
           'USAGE'::text AS privilege
      FROM pg_catalog.pg_roles runtime_role
      CROSS JOIN pg_catalog.pg_foreign_data_wrapper wrapper
     WHERE ${roleFilterSql}
       AND pg_catalog.has_foreign_data_wrapper_privilege(
         runtime_role.oid,
         wrapper.oid,
         'USAGE'
       )
    UNION ALL
    SELECT 'foreign_server'::text AS scope,
           foreign_server.srvname::text AS object_name,
           runtime_role.rolname::text AS role_name,
           'USAGE'::text AS privilege
      FROM pg_catalog.pg_roles runtime_role
      CROSS JOIN pg_catalog.pg_foreign_server foreign_server
     WHERE ${roleFilterSql}
       AND pg_catalog.has_server_privilege(
         runtime_role.oid,
         foreign_server.oid,
         'USAGE'
       )
    UNION ALL
    SELECT 'extension'::text AS scope, installed_extension.extname::text AS object_name,
           runtime_role.rolname::text AS role_name, 'OWNER'::text AS privilege
      FROM pg_roles runtime_role
      CROSS JOIN pg_catalog.pg_extension installed_extension
     WHERE ${roleFilterSql}
       AND pg_catalog.pg_has_role(runtime_role.oid, installed_extension.extowner, 'MEMBER')
    UNION ALL
    SELECT 'extension_member'::text,
           pg_catalog.pg_describe_object(
             extension_member.classid,
             extension_member.objid,
             extension_member.objsubid
           )::text,
           runtime_role.rolname::text, 'OWNER'::text
      FROM pg_roles runtime_role
      CROSS JOIN pg_catalog.pg_depend extension_member
      JOIN pg_catalog.pg_extension installed_extension
        ON installed_extension.oid = extension_member.refobjid
      JOIN pg_catalog.pg_shdepend ownership
        ON ownership.dbid = (
             SELECT database.oid
               FROM pg_catalog.pg_database database
              WHERE database.datname = current_database()
           )
       AND ownership.classid = extension_member.classid
       AND ownership.objid = extension_member.objid
       AND ownership.objsubid = extension_member.objsubid
       AND ownership.refclassid = 'pg_catalog.pg_authid'::pg_catalog.regclass
       AND ownership.deptype = 'o'
     WHERE ${roleFilterSql}
       AND extension_member.refclassid = 'pg_catalog.pg_extension'::pg_catalog.regclass
       AND extension_member.objsubid = 0
       AND extension_member.refobjsubid = 0
       AND extension_member.deptype = 'e'
        AND pg_catalog.pg_has_role(runtime_role.oid, ownership.refobjid, 'MEMBER')
${rejectAllObjectOwnership ? `    UNION ALL
    SELECT 'owned_object'::text,
           owned_object.dbid::text || ':' || owned_object.classid::text || ':' ||
             owned_object.objid::text || ':' || owned_object.objsubid::text,
           runtime_role.rolname::text, 'OWNER'::text
      FROM pg_roles runtime_role
      CROSS JOIN pg_catalog.pg_shdepend owned_object
     WHERE ${roleFilterSql}
       AND owned_object.objsubid = 0
       AND owned_object.refclassid = 'pg_catalog.pg_authid'::pg_catalog.regclass
       AND owned_object.deptype = 'o'
       AND pg_catalog.pg_has_role(runtime_role.oid, owned_object.refobjid, 'MEMBER')
` : ''}    UNION ALL
    SELECT 'relation', namespace.nspname || '.' || relation.relname,
           runtime_role.rolname::text, candidate.privilege::text
      FROM pg_roles runtime_role CROSS JOIN pg_class relation
      JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
      CROSS JOIN (VALUES ('SELECT'::text), ('INSERT'::text), ('UPDATE'::text),
                         ('DELETE'::text), ('TRUNCATE'::text), ('REFERENCES'::text),
                         ('TRIGGER'::text)) AS candidate(privilege)
     WHERE ${roleFilterSql} AND ${externalSchemaPredicate}
       AND relation.relkind IN ('r', 'p', 'v', 'm', 'f')
       AND has_schema_privilege(runtime_role.rolname, namespace.oid, 'USAGE')
       AND has_table_privilege(runtime_role.rolname, relation.oid, candidate.privilege)
       AND NOT EXISTS (
         SELECT 1
           FROM pg_catalog.pg_depend dependency
           JOIN pg_catalog.pg_extension installed_extension
             ON installed_extension.oid = dependency.refobjid
          WHERE dependency.classid = 'pg_catalog.pg_class'::pg_catalog.regclass
            AND dependency.objid = relation.oid
            AND dependency.objsubid = 0
            AND dependency.refclassid = 'pg_catalog.pg_extension'::pg_catalog.regclass
            AND dependency.refobjsubid = 0
            AND dependency.deptype = 'e'
       )
    UNION ALL
    SELECT 'column', namespace.nspname || '.' || relation.relname,
           runtime_role.rolname::text, candidate.privilege::text
      FROM pg_roles runtime_role CROSS JOIN pg_class relation
      JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
      CROSS JOIN (VALUES ('SELECT'::text), ('INSERT'::text), ('UPDATE'::text),
                         ('REFERENCES'::text)) AS candidate(privilege)
     WHERE ${roleFilterSql} AND ${externalSchemaPredicate}
       AND relation.relkind IN ('r', 'p', 'v', 'm', 'f')
       AND has_schema_privilege(runtime_role.rolname, namespace.oid, 'USAGE')
       AND has_any_column_privilege(runtime_role.rolname, relation.oid, candidate.privilege)
       AND NOT EXISTS (
         SELECT 1
           FROM pg_catalog.pg_depend dependency
           JOIN pg_catalog.pg_extension installed_extension
             ON installed_extension.oid = dependency.refobjid
          WHERE dependency.classid = 'pg_catalog.pg_class'::pg_catalog.regclass
            AND dependency.objid = relation.oid
            AND dependency.objsubid = 0
            AND dependency.refclassid = 'pg_catalog.pg_extension'::pg_catalog.regclass
            AND dependency.refobjsubid = 0
            AND dependency.deptype = 'e'
       )
    UNION ALL
    SELECT 'sequence', namespace.nspname || '.' || relation.relname,
           runtime_role.rolname::text, candidate.privilege::text
      FROM pg_roles runtime_role CROSS JOIN pg_class relation
      JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
      CROSS JOIN (VALUES ('SELECT'::text), ('USAGE'::text), ('UPDATE'::text)) AS candidate(privilege)
     WHERE ${roleFilterSql} AND ${externalSchemaPredicate}
       AND relation.relkind = 'S'
       AND has_schema_privilege(runtime_role.rolname, namespace.oid, 'USAGE')
       AND has_sequence_privilege(runtime_role.rolname, relation.oid, candidate.privilege)
       AND NOT EXISTS (
         SELECT 1
           FROM pg_catalog.pg_depend dependency
           JOIN pg_catalog.pg_extension installed_extension
             ON installed_extension.oid = dependency.refobjid
          WHERE dependency.classid = 'pg_catalog.pg_class'::pg_catalog.regclass
            AND dependency.objid = relation.oid
            AND dependency.objsubid = 0
            AND dependency.refclassid = 'pg_catalog.pg_extension'::pg_catalog.regclass
            AND dependency.refobjsubid = 0
            AND dependency.deptype = 'e'
       )
    UNION ALL
    SELECT 'function', namespace.nspname || '.' || routine.proname ||
           '(' || oidvectortypes(routine.proargtypes) || ')',
           runtime_role.rolname::text, 'EXECUTE'::text
      FROM pg_roles runtime_role CROSS JOIN pg_proc routine
      JOIN pg_namespace namespace ON namespace.oid = routine.pronamespace
     WHERE ${roleFilterSql} AND ${externalSchemaPredicate}
       AND routine.prokind IN ('f', 'p', 'a', 'w')
       AND routine.prorettype NOT IN ('pg_catalog.trigger'::pg_catalog.regtype, 'pg_catalog.event_trigger'::pg_catalog.regtype)
       AND has_schema_privilege(runtime_role.rolname, namespace.oid, 'USAGE')
       AND has_function_privilege(runtime_role.rolname, routine.oid, 'EXECUTE')
       AND NOT EXISTS (
         SELECT 1
           FROM pg_catalog.pg_depend dependency
           JOIN pg_catalog.pg_extension installed_extension
             ON installed_extension.oid = dependency.refobjid
          WHERE dependency.classid = 'pg_catalog.pg_proc'::pg_catalog.regclass
            AND dependency.objid = routine.oid
            AND dependency.objsubid = 0
            AND dependency.refclassid = 'pg_catalog.pg_extension'::pg_catalog.regclass
            AND dependency.refobjsubid = 0
            AND dependency.deptype = 'e'
       )
    UNION ALL
    SELECT 'large_object', large_object.oid::text,
           runtime_role.rolname::text, candidate.privilege::text
      FROM pg_roles runtime_role
      CROSS JOIN pg_catalog.pg_largeobject_metadata large_object
      CROSS JOIN (VALUES ('SELECT'::text), ('UPDATE'::text)) AS candidate(privilege)
     WHERE ${roleFilterSql}
       AND (
         large_object.lomowner = runtime_role.oid
         OR pg_catalog.pg_has_role(runtime_role.oid, large_object.lomowner, 'USAGE')
         OR EXISTS (
           SELECT 1
             FROM pg_catalog.aclexplode(large_object.lomacl) acl
            WHERE acl.privilege_type = candidate.privilege
              AND CASE
                WHEN acl.grantee = 0 THEN true
                ELSE pg_catalog.pg_has_role(runtime_role.oid, acl.grantee, 'USAGE')
              END
         )
       )
    UNION ALL
    SELECT 'setting', 'lo_compat_privileges',
           runtime_role.rolname::text, 'ON'::text
      FROM pg_roles runtime_role
     WHERE ${roleFilterSql}
       AND current_setting('lo_compat_privileges') = 'on'
    UNION ALL
    SELECT 'parameter', parameter_acl.parname::text,
           runtime_role.rolname::text, candidate.privilege::text
      FROM pg_roles runtime_role
      CROSS JOIN pg_catalog.pg_parameter_acl parameter_acl
      CROSS JOIN (VALUES ('SET'::text), ('ALTER SYSTEM'::text)) AS candidate(privilege)
     WHERE ${roleFilterSql}
       AND pg_catalog.has_parameter_privilege(
         runtime_role.rolname,
         parameter_acl.parname,
         candidate.privilege
       )`;
}

/**
 * Build CTEs that compare all effective relation, column, function, and schema
 * privileges (including grantability), while rejecting direct PUBLIC access in
 * the private schema, against the same inventory used to issue grants.
 */
export function buildRuntimeRoleEffectivePrivilegeMatrixCtes(
  schema = 'data_foundry',
  roleReference = '$1',
): string {
  const expectedValues = buildRuntimeRoleExpectedGrants(schema)
    .map((grant) =>
      `    (${sqlLiteral(grant.scope)}, ${sqlLiteral(grant.objectName)}, ${sqlLiteral(grant.columnName)}, ${sqlLiteral(grant.role)}, ${sqlLiteral(grant.privilege)}, ${grant.isGrantable})`,
    )
    .join(',\n');
  const externalExpectedValues = buildRuntimeRoleExpectedExternalAclValuesSql();
  const schemaLiteral = sqlLiteral(schema);
  return `expected_runtime_grants(scope, object_name, column_name, role_name, privilege, is_grantable) AS (VALUES
${expectedValues}
), expected_external_runtime_acls(scope, object_name, column_name, role_name, privilege, is_grantable) AS (VALUES
${externalExpectedValues}
), expected_role_grants(scope, object_name, column_name, privilege, is_grantable) AS (
  SELECT scope, object_name, column_name, privilege, is_grantable
    FROM expected_runtime_grants
   WHERE role_name = ${roleReference}
), expected_external_role_acls(scope, object_name, column_name, privilege, is_grantable) AS (
  SELECT scope, object_name, column_name, privilege, is_grantable
    FROM expected_external_runtime_acls
   WHERE role_name = ${roleReference}
), expected_effective_privileges(scope, object_name, column_name, privilege, is_grantable) AS (
  SELECT scope, object_name, column_name, privilege, is_grantable FROM expected_role_grants
  UNION
  SELECT 'column', relation.relname::text, attribute.attname::text, expected.privilege, expected.is_grantable
    FROM expected_role_grants expected
    JOIN pg_namespace namespace ON namespace.nspname = ${schemaLiteral}
    JOIN pg_class relation
      ON relation.relnamespace = namespace.oid AND relation.relname = expected.object_name
    JOIN pg_attribute attribute
      ON attribute.attrelid = relation.oid AND attribute.attnum > 0 AND NOT attribute.attisdropped
   WHERE expected.scope = 'relation'
     AND expected.privilege IN ('SELECT', 'INSERT', 'UPDATE', 'REFERENCES')
), effective_privilege_candidates(scope, object_name, column_name, privilege, is_grantable, relation_oid, function_oid, relation_is_sequence) AS (
  SELECT 'schema'::text, namespace.nspname::text, ''::text, candidate.privilege::text, grantability.is_grantable,
         NULL::oid, NULL::oid, false
    FROM pg_namespace namespace
    CROSS JOIN (VALUES ('USAGE'::text), ('CREATE'::text)) AS candidate(privilege)
    CROSS JOIN (VALUES (false), (true)) AS grantability(is_grantable)
   WHERE namespace.nspname = ${schemaLiteral}
  UNION ALL
  SELECT 'relation', relation.relname::text, '', candidate.privilege, grantability.is_grantable, relation.oid, NULL::oid, false
    FROM pg_class relation
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    CROSS JOIN (VALUES ('SELECT'::text), ('INSERT'::text), ('UPDATE'::text), ('DELETE'::text),
                ('TRUNCATE'::text), ('REFERENCES'::text), ('TRIGGER'::text)) AS candidate(privilege)
    CROSS JOIN (VALUES (false), (true)) AS grantability(is_grantable)
   WHERE namespace.nspname = ${schemaLiteral} AND relation.relkind IN ('r', 'p', 'v', 'm', 'f')
  UNION ALL
  SELECT 'relation', relation.relname::text, '', candidate.privilege, grantability.is_grantable, relation.oid, NULL::oid, true
    FROM pg_class relation
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    CROSS JOIN (VALUES ('SELECT'::text), ('USAGE'::text), ('UPDATE'::text)) AS candidate(privilege)
    CROSS JOIN (VALUES (false), (true)) AS grantability(is_grantable)
   WHERE namespace.nspname = ${schemaLiteral} AND relation.relkind = 'S'
  UNION ALL
  SELECT 'column', relation.relname::text, attribute.attname::text, candidate.privilege, grantability.is_grantable, relation.oid, NULL::oid, false
    FROM pg_attribute attribute
    JOIN pg_class relation ON relation.oid = attribute.attrelid
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    CROSS JOIN (VALUES ('SELECT'::text), ('INSERT'::text), ('UPDATE'::text), ('REFERENCES'::text)) AS candidate(privilege)
    CROSS JOIN (VALUES (false), (true)) AS grantability(is_grantable)
   WHERE namespace.nspname = ${schemaLiteral}
     AND relation.relkind IN ('r', 'p', 'v', 'm', 'f')
     AND attribute.attnum > 0 AND NOT attribute.attisdropped
  UNION ALL
  SELECT 'function', (routine.proname || '(' || oidvectortypes(routine.proargtypes) || ')')::text,
         '', 'EXECUTE', grantability.is_grantable, NULL::oid, routine.oid, false
    FROM pg_proc routine
    JOIN pg_namespace namespace ON namespace.oid = routine.pronamespace
    CROSS JOIN (VALUES (false), (true)) AS grantability(is_grantable)
   WHERE namespace.nspname = ${schemaLiteral} AND routine.prokind IN ('f', 'p', 'a', 'w')
), actual_effective_privileges(scope, object_name, column_name, privilege, is_grantable) AS (
  SELECT candidate.scope, candidate.object_name, candidate.column_name, candidate.privilege, candidate.is_grantable
    FROM effective_privilege_candidates candidate
   WHERE CASE
     WHEN candidate.scope = 'schema' THEN has_schema_privilege(${roleReference}, candidate.object_name, candidate.privilege || CASE WHEN candidate.is_grantable THEN ' WITH GRANT OPTION' ELSE '' END)
     WHEN candidate.scope = 'relation' AND candidate.relation_is_sequence
       THEN has_sequence_privilege(${roleReference}, candidate.relation_oid, candidate.privilege || CASE WHEN candidate.is_grantable THEN ' WITH GRANT OPTION' ELSE '' END)
     WHEN candidate.scope = 'relation' THEN has_table_privilege(${roleReference}, candidate.relation_oid, candidate.privilege || CASE WHEN candidate.is_grantable THEN ' WITH GRANT OPTION' ELSE '' END)
     WHEN candidate.scope = 'column'
       THEN has_column_privilege(${roleReference}, candidate.relation_oid, candidate.column_name, candidate.privilege || CASE WHEN candidate.is_grantable THEN ' WITH GRANT OPTION' ELSE '' END)
     WHEN candidate.scope = 'function' THEN has_function_privilege(${roleReference}, candidate.function_oid, candidate.privilege || CASE WHEN candidate.is_grantable THEN ' WITH GRANT OPTION' ELSE '' END)
     ELSE false
   END
), effective_privilege_differences AS (
  SELECT COALESCE(expected.scope, actual.scope) AS scope,
         COALESCE(expected.object_name, actual.object_name) AS object_name,
         COALESCE(expected.column_name, actual.column_name) AS column_name,
         COALESCE(expected.privilege, actual.privilege) AS privilege,
         COALESCE(expected.is_grantable, actual.is_grantable) AS is_grantable
    FROM expected_effective_privileges expected
    FULL OUTER JOIN actual_effective_privileges actual
      USING (scope, object_name, column_name, privilege, is_grantable)
   WHERE expected.scope IS NULL OR actual.scope IS NULL
), actual_external_role_acls(scope, object_name, column_name, privilege, is_grantable) AS (
  SELECT scope, object_name, column_name, privilege, is_grantable
    FROM (
${buildRuntimeRoleExternalDirectAclSql(schema, `grantee.rolname = ${roleReference}`)}
    ) external_acl
), external_direct_acl_differences AS (
  SELECT COALESCE(expected.scope, actual.scope) AS scope,
         COALESCE(expected.object_name, actual.object_name) AS object_name,
         COALESCE(expected.column_name, actual.column_name) AS column_name,
         COALESCE(expected.privilege, actual.privilege) AS privilege,
         COALESCE(expected.is_grantable, actual.is_grantable) AS is_grantable
    FROM expected_external_role_acls expected
    FULL OUTER JOIN actual_external_role_acls actual
      USING (scope, object_name, column_name, privilege, is_grantable)
   WHERE expected.scope IS NULL OR actual.scope IS NULL
), external_reachable_capabilities AS (
${buildRuntimeRoleReachableExternalCapabilitySql(schema, `runtime_role.rolname = ${roleReference}`)}
), unsafe_migration_role_posture AS (
${buildMigrationRoleUnsafePostureSql()}
), unsafe_migration_role_durable_settings AS (
${buildMigrationRoleUnsafeDurableSettingSql(schema)}
), unsafe_migration_role_external_capability AS (
${buildMigrationRoleUnsafeExternalCapabilitySql(schema)}
), unsafe_migration_role_default_object_acl AS (
${buildMigrationRoleUnsafeDefaultAclSql(schema)}
), unsafe_runtime_role_durable_settings AS (
${buildRuntimeRoleUnsafeDurableSettingSql(
    schema,
    `runtime_role.rolname = ${roleReference}`,
    true,
  )}
), public_private_acl_entries AS (
  SELECT 1 AS found
    FROM pg_namespace namespace
    CROSS JOIN LATERAL aclexplode(namespace.nspacl) acl
   WHERE namespace.nspname = ${schemaLiteral} AND acl.grantee = 0
  UNION ALL
  SELECT 1
    FROM pg_class relation
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    CROSS JOIN LATERAL aclexplode(relation.relacl) acl
   WHERE namespace.nspname = ${schemaLiteral}
     AND relation.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
     AND acl.grantee = 0
  UNION ALL
  SELECT 1
    FROM pg_attribute attribute
    JOIN pg_class relation ON relation.oid = attribute.attrelid
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    CROSS JOIN LATERAL aclexplode(attribute.attacl) acl
   WHERE namespace.nspname = ${schemaLiteral}
     AND attribute.attnum > 0 AND NOT attribute.attisdropped
     AND acl.grantee = 0
  UNION ALL
  SELECT 1
    FROM pg_proc routine
    JOIN pg_namespace namespace ON namespace.oid = routine.pronamespace
    CROSS JOIN LATERAL aclexplode(routine.proacl) acl
   WHERE namespace.nspname = ${schemaLiteral}
     AND routine.prokind IN ('f', 'p', 'a', 'w')
     AND acl.grantee = 0
  UNION ALL
  SELECT 1
    FROM pg_proc routine
    JOIN pg_namespace namespace ON namespace.oid = routine.pronamespace
   WHERE namespace.nspname = ${schemaLiteral}
     AND routine.prokind IN ('f', 'p', 'a', 'w')
     AND routine.proacl IS NULL
)`;
}
