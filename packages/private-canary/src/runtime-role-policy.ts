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

/** Final function identities after migrations 0001..0026, from pg_proc. */
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
  for (const relation of ['sources', 'source_artifacts', 'scheduled_acquisition_runs']) {
    addRelation('df_acquisition', relation, ['SELECT', 'INSERT', 'UPDATE']);
  }
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
 * Build CTEs that compare all effective relation, column, function, and schema
 * privileges (including grantability) in the private schema to the same
 * inventory used to issue grants.
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
  const schemaLiteral = sqlLiteral(schema);
  return `expected_runtime_grants(scope, object_name, column_name, role_name, privilege, is_grantable) AS (VALUES
${expectedValues}
), expected_role_grants(scope, object_name, column_name, privilege, is_grantable) AS (
  SELECT scope, object_name, column_name, privilege, is_grantable
    FROM expected_runtime_grants
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
)`;
}
