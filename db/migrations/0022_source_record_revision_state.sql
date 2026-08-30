-- 0022_source_record_revision_state.sql
--
-- A NULL normalized_payload is not an auditable lifecycle state: historic
-- finalized source records can legitimately have no normalized payload. Keep
-- the one short-lived EXTRACTED -> NORMALIZED transition explicit, and make
-- every revision that can carry evidence immutable.

ALTER TABLE source_records
    ADD COLUMN IF NOT EXISTS revision_state TEXT NOT NULL DEFAULT 'FINALIZED';

ALTER TABLE source_records
    ADD COLUMN IF NOT EXISTS evidence_fingerprint TEXT NOT NULL DEFAULT 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'source_records_revision_state_allowed'
    ) THEN
        ALTER TABLE source_records
            ADD CONSTRAINT source_records_revision_state_allowed
            CHECK (revision_state IN ('PROVISIONAL', 'FINALIZED'));
    END IF;
END;
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'source_records_evidence_fingerprint_sha256'
    ) THEN
        ALTER TABLE source_records
            ADD CONSTRAINT source_records_evidence_fingerprint_sha256
            CHECK (evidence_fingerprint ~ '^[0-9a-f]{64}$');
    END IF;
END;
$$;

-- The former mutable upsert could have changed a source record after evidence
-- was written. Do not make that historic mismatch harder to find by merely
-- installing guards for future writes: fail this migration closed until an
-- operator can investigate the affected provenance without rewriting it.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
          FROM (
              SELECT record.artifact_id AS record_artifact_id,
                     record.source_id AS record_source_id,
                     artifact.source_id AS evidence_artifact_source_id,
                     evidence.artifact_id AS evidence_artifact_id
                FROM entity_evidence evidence
                JOIN source_records record ON record.id = evidence.source_record_id
                JOIN source_artifacts artifact ON artifact.id = evidence.artifact_id
              UNION ALL
              SELECT record.artifact_id, record.source_id, artifact.source_id, evidence.artifact_id
                FROM fact_evidence evidence
                JOIN source_records record ON record.id = evidence.source_record_id
                JOIN source_artifacts artifact ON artifact.id = evidence.artifact_id
              UNION ALL
              SELECT record.artifact_id, record.source_id, artifact.source_id, evidence.artifact_id
                FROM relationship_evidence evidence
                JOIN source_records record ON record.id = evidence.source_record_id
                JOIN source_artifacts artifact ON artifact.id = evidence.artifact_id
          ) evidence_provenance
         WHERE record_artifact_id IS DISTINCT FROM evidence_artifact_id
            OR record_source_id IS DISTINCT FROM evidence_artifact_source_id
    ) THEN
        RAISE EXCEPTION 'source-record evidence provenance mismatch exists; investigate before applying revision-state hardening'
            USING ERRCODE = '23514';
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION source_records_validate_revision_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF OLD.is_current = FALSE AND NEW.is_current = TRUE THEN
        RAISE EXCEPTION 'a superseded source-record revision cannot become current again'
            USING ERRCODE = '23514';
    END IF;

    IF OLD.revision_state = 'FINALIZED' AND (
        NEW.id IS DISTINCT FROM OLD.id OR
        NEW.source_id IS DISTINCT FROM OLD.source_id OR
        NEW.artifact_id IS DISTINCT FROM OLD.artifact_id OR
        NEW.source_record_key IS DISTINCT FROM OLD.source_record_key OR
        NEW.entity_type IS DISTINCT FROM OLD.entity_type OR
        NEW.raw_payload IS DISTINCT FROM OLD.raw_payload OR
        NEW.normalized_payload IS DISTINCT FROM OLD.normalized_payload OR
        NEW.extraction_confidence IS DISTINCT FROM OLD.extraction_confidence OR
        NEW.extractor_version IS DISTINCT FROM OLD.extractor_version OR
        NEW.evidence_fingerprint IS DISTINCT FROM OLD.evidence_fingerprint OR
        NEW.revision_state IS DISTINCT FROM OLD.revision_state OR
        NEW.created_at IS DISTINCT FROM OLD.created_at
    ) THEN
        RAISE EXCEPTION 'a finalized source-record revision is immutable'
            USING ERRCODE = '23514';
    END IF;

    IF OLD.revision_state = 'PROVISIONAL' AND NEW.revision_state = 'FINALIZED' AND (
        NEW.id IS DISTINCT FROM OLD.id OR
        NEW.source_id IS DISTINCT FROM OLD.source_id OR
        NEW.is_current IS DISTINCT FROM OLD.is_current OR
        NEW.artifact_id IS DISTINCT FROM OLD.artifact_id OR
        NEW.source_record_key IS DISTINCT FROM OLD.source_record_key OR
        NEW.entity_type IS DISTINCT FROM OLD.entity_type OR
        NEW.raw_payload IS DISTINCT FROM OLD.raw_payload OR
        NEW.extraction_confidence IS DISTINCT FROM OLD.extraction_confidence OR
        NEW.extractor_version IS DISTINCT FROM OLD.extractor_version OR
        NEW.created_at IS DISTINCT FROM OLD.created_at
    ) THEN
        RAISE EXCEPTION 'only a matching provisional source-record revision may be finalized in place'
            USING ERRCODE = '23514';
    END IF;

    IF OLD.revision_state = 'PROVISIONAL' AND NEW.revision_state = 'PROVISIONAL' AND (
        NEW.id IS DISTINCT FROM OLD.id OR
        NEW.source_id IS DISTINCT FROM OLD.source_id OR
        NEW.artifact_id IS DISTINCT FROM OLD.artifact_id OR
        NEW.source_record_key IS DISTINCT FROM OLD.source_record_key OR
        NEW.entity_type IS DISTINCT FROM OLD.entity_type OR
        NEW.raw_payload IS DISTINCT FROM OLD.raw_payload OR
        NEW.normalized_payload IS DISTINCT FROM OLD.normalized_payload OR
        NEW.extraction_confidence IS DISTINCT FROM OLD.extraction_confidence OR
        NEW.extractor_version IS DISTINCT FROM OLD.extractor_version OR
        NEW.evidence_fingerprint IS DISTINCT FROM OLD.evidence_fingerprint OR
        NEW.created_at IS DISTINCT FROM OLD.created_at
    ) THEN
        RAISE EXCEPTION 'a provisional source-record revision may not change extracted content'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS source_records_validate_revision_update ON source_records;
CREATE TRIGGER source_records_validate_revision_update
    BEFORE UPDATE ON source_records
    FOR EACH ROW EXECUTE FUNCTION source_records_validate_revision_update();

CREATE OR REPLACE FUNCTION source_record_evidence_validate_provenance()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    record_artifact UUID;
    record_source UUID;
    record_state TEXT;
    artifact_source UUID;
BEGIN
    SELECT artifact_id, source_id, revision_state
      INTO record_artifact, record_source, record_state
      FROM source_records WHERE id = NEW.source_record_id;
    SELECT source_id INTO artifact_source
      FROM source_artifacts WHERE id = NEW.artifact_id;
    IF record_state IS DISTINCT FROM 'FINALIZED' THEN
        RAISE EXCEPTION 'evidence may cite only a finalized source-record revision'
            USING ERRCODE = '23514';
    END IF;
    IF record_artifact IS DISTINCT FROM NEW.artifact_id OR
       record_source IS DISTINCT FROM artifact_source THEN
        RAISE EXCEPTION 'evidence artifact must be the source record''s exact artifact'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS entity_evidence_validate_provenance_insert ON entity_evidence;
CREATE TRIGGER entity_evidence_validate_provenance_insert
    BEFORE INSERT ON entity_evidence
    FOR EACH ROW EXECUTE FUNCTION source_record_evidence_validate_provenance();

DROP TRIGGER IF EXISTS fact_evidence_validate_provenance_insert ON fact_evidence;
CREATE TRIGGER fact_evidence_validate_provenance_insert
    BEFORE INSERT ON fact_evidence
    FOR EACH ROW EXECUTE FUNCTION source_record_evidence_validate_provenance();

DROP TRIGGER IF EXISTS relationship_evidence_validate_provenance_insert ON relationship_evidence;
CREATE TRIGGER relationship_evidence_validate_provenance_insert
    BEFORE INSERT ON relationship_evidence
    FOR EACH ROW EXECUTE FUNCTION source_record_evidence_validate_provenance();

CREATE OR REPLACE FUNCTION source_record_reconciliations_validate_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    superseded_source UUID;
    superseded_key TEXT;
    superseded_current BOOLEAN;
    replacement_source UUID;
    replacement_key TEXT;
    replacement_current BOOLEAN;
    replacement_state TEXT;
BEGIN
    SELECT source_id, source_record_key, is_current
      INTO superseded_source, superseded_key, superseded_current
      FROM source_records WHERE id = NEW.superseded_source_record_id;
    SELECT source_id, source_record_key, is_current, revision_state
      INTO replacement_source, replacement_key, replacement_current, replacement_state
      FROM source_records WHERE id = NEW.replacement_source_record_id;
    IF superseded_source IS DISTINCT FROM replacement_source OR
       superseded_key IS DISTINCT FROM replacement_key OR
       superseded_current IS DISTINCT FROM FALSE OR
       replacement_current IS DISTINCT FROM TRUE OR
       replacement_state IS DISTINCT FROM 'FINALIZED' THEN
        RAISE EXCEPTION 'source-record reconciliation must link a noncurrent revision to its current finalized replacement for the same source record key'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS source_record_reconciliations_validate_insert ON source_record_reconciliations;
CREATE TRIGGER source_record_reconciliations_validate_insert
    BEFORE INSERT ON source_record_reconciliations
    FOR EACH ROW EXECUTE FUNCTION source_record_reconciliations_validate_insert();

CREATE OR REPLACE FUNCTION source_record_reconciliations_reject_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'source-record reconciliation history is append-only'
        USING ERRCODE = '55000';
END;
$$;

DROP TRIGGER IF EXISTS source_record_reconciliations_immutable ON source_record_reconciliations;
CREATE TRIGGER source_record_reconciliations_immutable
    BEFORE UPDATE OR DELETE OR TRUNCATE ON source_record_reconciliations
    FOR EACH STATEMENT EXECUTE FUNCTION source_record_reconciliations_reject_mutation();

COMMENT ON COLUMN source_records.revision_state IS
    'PROVISIONAL only between extraction and normalization; FINALIZED revisions may carry evidence and are immutable.';
COMMENT ON COLUMN source_records.evidence_fingerprint IS
    'Hash of the validated alias claims, locators, and evidence semantics that a finalized revision may safely reuse.';
