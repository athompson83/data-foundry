-- 0027_runtime_security_hardening.sql
--
-- Close the runtime-role write surface and pin every existing private
-- function to the migration-prepared search path. Function names remain
-- unqualified deliberately: the same bytes run with either public or
-- data_foundry first in the trusted migration search path.

DO $runtime_acquisition_acl_upgrade$
DECLARE
    relation_update_acls TEXT[];
    column_update_acls TEXT[];
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'df_acquisition') THEN
        RETURN;
    END IF;

    SELECT COALESCE(
               array_agg(DISTINCT c.relname::TEXT ORDER BY c.relname::TEXT),
               ARRAY[]::TEXT[]
           )
      INTO relation_update_acls
      FROM pg_class AS c
      JOIN pg_namespace AS n ON n.oid = c.relnamespace
      CROSS JOIN LATERAL aclexplode(c.relacl) AS acl
     WHERE n.nspname = current_schema()
       AND c.relname IN ('sources', 'source_artifacts')
       AND acl.grantee = (SELECT oid FROM pg_roles WHERE rolname = 'df_acquisition')
       AND acl.privilege_type = 'UPDATE';

    SELECT COALESCE(
               array_agg(
                   DISTINCT (c.relname || '.' || a.attname)::TEXT
                   ORDER BY (c.relname || '.' || a.attname)::TEXT
               ),
               ARRAY[]::TEXT[]
           )
      INTO column_update_acls
      FROM pg_attribute AS a
      JOIN pg_class AS c ON c.oid = a.attrelid
      JOIN pg_namespace AS n ON n.oid = c.relnamespace
      CROSS JOIN LATERAL aclexplode(a.attacl) AS acl
     WHERE n.nspname = current_schema()
       AND c.relname IN ('sources', 'source_artifacts')
       AND a.attnum > 0
       AND NOT a.attisdropped
       AND acl.grantee = (SELECT oid FROM pg_roles WHERE rolname = 'df_acquisition')
       AND acl.privilege_type = 'UPDATE';

    IF relation_update_acls = ARRAY[]::TEXT[] AND
       column_update_acls = ARRAY[]::TEXT[] THEN
        -- A fresh install has not provisioned runtime ACLs yet.
        RETURN;
    ELSIF relation_update_acls = ARRAY['source_artifacts', 'sources']::TEXT[] AND
          column_update_acls = ARRAY[]::TEXT[] THEN
        -- Upgrade only the exact 0001..0026 runtime grant shape observed in Alpha Lab.
        REVOKE UPDATE ON sources FROM df_acquisition;
        REVOKE UPDATE ON source_artifacts FROM df_acquisition;
        GRANT UPDATE (kill_switch_engaged) ON sources TO df_acquisition;
        RETURN;
    ELSIF relation_update_acls = ARRAY[]::TEXT[] AND
          column_update_acls = ARRAY['sources.kill_switch_engaged']::TEXT[] THEN
        -- The least-privilege 0027 shape is already present.
        RETURN;
    END IF;

    RAISE EXCEPTION
        'unexpected acquisition UPDATE ACL state: relations=%, columns=%',
        relation_update_acls,
        column_update_acls
        USING ERRCODE = '55000';
END;
$runtime_acquisition_acl_upgrade$;

CREATE OR REPLACE FUNCTION source_artifacts_reject_scope_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW IS DISTINCT FROM OLD THEN
        RAISE EXCEPTION 'source artifact evidence is immutable'
            USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION rights_validate_source_publisher_mapping()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    publisher_status TEXT;
BEGIN
    IF TG_OP = 'UPDATE' AND current_user = 'df_acquisition' THEN
        IF OLD.kill_switch_engaged IS TRUE AND
           NEW.kill_switch_engaged IS DISTINCT FROM TRUE THEN
            RAISE EXCEPTION 'the acquisition runtime cannot clear an engaged source kill switch'
                USING ERRCODE = '55000';
        END IF;
    END IF;
    IF TG_OP = 'UPDATE' AND
       NEW.kill_switch_engaged IS DISTINCT FROM OLD.kill_switch_engaged THEN
        NEW.updated_at := clock_timestamp();
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.rights_publisher_id IS NOT NULL AND (
        NEW.rights_publisher_id IS DISTINCT FROM OLD.rights_publisher_id OR
        NEW.rights_publisher_mapping_evidence_artifact_id IS DISTINCT FROM
            OLD.rights_publisher_mapping_evidence_artifact_id OR
        NEW.rights_publisher_mapping_reviewer_type IS DISTINCT FROM
            OLD.rights_publisher_mapping_reviewer_type OR
        NEW.rights_publisher_mapping_reviewed_by IS DISTINCT FROM
            OLD.rights_publisher_mapping_reviewed_by OR
        NEW.rights_publisher_mapping_reviewed_at IS DISTINCT FROM
            OLD.rights_publisher_mapping_reviewed_at
    ) THEN
        RAISE EXCEPTION 'an evidenced source-to-publisher rights mapping is immutable'
            USING ERRCODE = '55000';
    END IF;
    IF NEW.rights_publisher_id IS NOT NULL THEN
        SELECT status INTO publisher_status
          FROM rights_publishers WHERE id = NEW.rights_publisher_id;
        IF publisher_status IS DISTINCT FROM 'ACTIVE' THEN
            RAISE EXCEPTION 'a source may map only to an ACTIVE rights publisher'
                USING ERRCODE = '23514';
        END IF;
        IF NEW.rights_publisher_mapping_reviewed_at > clock_timestamp() THEN
            RAISE EXCEPTION 'publisher mapping review cannot be future-dated'
                USING ERRCODE = '23514';
        END IF;
        IF TG_OP = 'UPDATE' AND OLD.rights_publisher_id IS NULL AND (
            EXISTS (SELECT 1 FROM rights_cells WHERE source_id = NEW.id) OR
            EXISTS (SELECT 1 FROM rights_terms_cells WHERE source_id = NEW.id)
        ) THEN
            RAISE EXCEPTION 'publisher mapping must be established before source rights history'
                USING ERRCODE = '23514';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

ALTER FUNCTION activate_rights_decision(uuid, text, text, text, timestamp with time zone) SET search_path FROM CURRENT;
ALTER FUNCTION activate_rights_terms(uuid, text, text, text, timestamp with time zone) SET search_path FROM CURRENT;
ALTER FUNCTION enforce_api_key_access_classification() SET search_path FROM CURRENT;
ALTER FUNCTION entity_alias_claims_reject_mutation() SET search_path FROM CURRENT;
ALTER FUNCTION entity_alias_claims_validate_insert() SET search_path FROM CURRENT;
ALTER FUNCTION entity_aliases_enforce_authority_epoch() SET search_path FROM CURRENT;
ALTER FUNCTION entity_evidence_validate_alias_claim() SET search_path FROM CURRENT;
ALTER FUNCTION entity_evidence_validate_provenance() SET search_path FROM CURRENT;
ALTER FUNCTION fact_dependencies_reject_cycle() SET search_path FROM CURRENT;
ALTER FUNCTION fact_dependencies_require_open_classification() SET search_path FROM CURRENT;
ALTER FUNCTION facts_reject_output_kind_mutation() SET search_path FROM CURRENT;
ALTER FUNCTION facts_validate_output_contract() SET search_path FROM CURRENT;
ALTER FUNCTION revoke_rights_terms(uuid, text, text, text, timestamp with time zone) SET search_path FROM CURRENT;
ALTER FUNCTION rights_cell_requires_decision() SET search_path FROM CURRENT;
ALTER FUNCTION rights_prepare_decision_activation() SET search_path FROM CURRENT;
ALTER FUNCTION rights_prepare_terms_activation() SET search_path FROM CURRENT;
ALTER FUNCTION rights_reject_history_mutation() SET search_path FROM CURRENT;
ALTER FUNCTION rights_reject_referenced_field_group_expansion() SET search_path FROM CURRENT;
ALTER FUNCTION rights_scope_is_strictly_narrower(uuid, uuid) SET search_path FROM CURRENT;
ALTER FUNCTION rights_terms_cover_cell(uuid, uuid) SET search_path FROM CURRENT;
ALTER FUNCTION rights_validate_cell_field_group() SET search_path FROM CURRENT;
ALTER FUNCTION rights_validate_condition_insert() SET search_path FROM CURRENT;
ALTER FUNCTION rights_validate_decision_insert() SET search_path FROM CURRENT;
ALTER FUNCTION rights_validate_deny_exception() SET search_path FROM CURRENT;
ALTER FUNCTION rights_validate_publisher_update() SET search_path FROM CURRENT;
ALTER FUNCTION rights_validate_source_publisher_mapping() SET search_path FROM CURRENT;
ALTER FUNCTION rights_validate_terms_version() SET search_path FROM CURRENT;
ALTER FUNCTION scheduled_acquisition_claim_lease_guard() SET search_path FROM CURRENT;
ALTER FUNCTION scheduled_acquisition_iso_utc_valid(text) SET search_path FROM CURRENT;
ALTER FUNCTION scheduled_acquisition_origin_valid(text) SET search_path FROM CURRENT;
ALTER FUNCTION scheduled_acquisition_receipt_contract_version_guard() SET search_path FROM CURRENT;
ALTER FUNCTION scheduled_acquisition_receipt_provenance_valid(jsonb, uuid, text, text, text, text, text, boolean, timestamp with time zone) SET search_path FROM CURRENT;
ALTER FUNCTION scheduled_acquisition_receipt_valid(jsonb) SET search_path FROM CURRENT;
ALTER FUNCTION scheduled_acquisition_receipt_valid_for(jsonb, text, text, timestamp with time zone, timestamp with time zone) SET search_path FROM CURRENT;
ALTER FUNCTION scheduled_acquisition_receipt_valid_for_contract(jsonb, text, text, timestamp with time zone, timestamp with time zone, smallint) SET search_path FROM CURRENT;
ALTER FUNCTION scheduled_acquisition_result_url_allowed(text, text, jsonb, text, text) SET search_path FROM CURRENT;
ALTER FUNCTION scheduled_acquisition_result_url_policy_valid(jsonb) SET search_path FROM CURRENT;
ALTER FUNCTION scheduled_acquisition_retrieval_receipt_id(uuid, text, text) SET search_path FROM CURRENT;
ALTER FUNCTION scheduled_acquisition_run_artifact_guard() SET search_path FROM CURRENT;
ALTER FUNCTION scheduled_acquisition_run_artifact_immutable() SET search_path FROM CURRENT;
ALTER FUNCTION scheduled_acquisition_run_insert_guard() SET search_path FROM CURRENT;
ALTER FUNCTION scheduled_acquisition_run_terminal_guard() SET search_path FROM CURRENT;
ALTER FUNCTION scheduled_acquisition_scope_digest(uuid, text, text, uuid, text, text, text, text, text, text, text, text, jsonb, timestamp with time zone, text) SET search_path FROM CURRENT;
ALTER FUNCTION scheduled_acquisition_scope_frame(text) SET search_path FROM CURRENT;
ALTER FUNCTION scheduled_acquisition_uuid_or_null_valid(jsonb) SET search_path FROM CURRENT;
ALTER FUNCTION scheduled_acquisition_validators_valid(jsonb) SET search_path FROM CURRENT;
ALTER FUNCTION source_artifacts_reject_scope_mutation() SET search_path FROM CURRENT;
ALTER FUNCTION source_record_evidence_validate_provenance() SET search_path FROM CURRENT;
ALTER FUNCTION source_record_reconciliations_reject_mutation() SET search_path FROM CURRENT;
ALTER FUNCTION source_record_reconciliations_validate_insert() SET search_path FROM CURRENT;
ALTER FUNCTION source_record_snapshot_retirements_reject_mutation() SET search_path FROM CURRENT;
ALTER FUNCTION source_record_snapshot_retirements_validate() SET search_path FROM CURRENT;
ALTER FUNCTION source_records_require_retirement_lineage() SET search_path FROM CURRENT;
ALTER FUNCTION source_records_validate_revision_update() SET search_path FROM CURRENT;
ALTER FUNCTION source_stream_snapshot_acceptance_artifacts_validate() SET search_path FROM CURRENT;
ALTER FUNCTION source_stream_snapshot_acceptances_require_artifacts() SET search_path FROM CURRENT;
ALTER FUNCTION source_stream_snapshot_evidence_reject_mutation() SET search_path FROM CURRENT;
