-- 0024_source_record_snapshot_membership.sql
--
-- Absence is authority only when a stream explicitly declares that one
-- successful artifact set is complete. Persist the stream membership on every
-- new source-record revision and keep append-only artifact evidence whenever a
-- complete snapshot retires a record that is no longer present.

ALTER TABLE source_records
    ADD COLUMN IF NOT EXISTS source_stream TEXT NULL;

-- Pre-0024 rows do not prove which stream made them current. Do not infer that
-- membership: revoke their current authority and require an explicit reingest.
UPDATE source_records
   SET is_current = FALSE,
       updated_at = now()
 WHERE is_current
   AND source_stream IS NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conrelid = 'public.source_records'::regclass
           AND conname = 'source_records_stream_shape'
    ) THEN
        ALTER TABLE source_records
            ADD CONSTRAINT source_records_stream_shape CHECK (
                source_stream IS NULL OR source_stream ~ '^[a-z][a-z0-9_]*$'
            );
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conrelid = 'public.source_records'::regclass
           AND conname = 'source_records_current_requires_stream'
    ) THEN
        ALTER TABLE source_records
            ADD CONSTRAINT source_records_current_requires_stream CHECK (
                NOT is_current OR source_stream IS NOT NULL
            );
    END IF;
END;
$$;

-- A full snapshot is allowed to change canonical membership only after winning
-- a durable, per-stream total order. `observed_at` is the provider's fetch
-- instant; `snapshot_digest` is the deterministic tie-break for equal instants.
-- Existing source records cannot be converted into acceptances because neither
-- their complete stream nor their retrieval attempt is historical fact.
CREATE TABLE IF NOT EXISTS source_stream_snapshot_acceptances (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id           UUID        NOT NULL REFERENCES sources (id) ON DELETE RESTRICT,
    source_stream       TEXT        NOT NULL,
    observed_at         TIMESTAMPTZ NOT NULL,
    snapshot_digest     TEXT COLLATE "C" NOT NULL,
    artifact_set_digest TEXT        NOT NULL,
    mapping_digest      TEXT        NOT NULL,
    record_set_digest   TEXT        NOT NULL,
    retrieval_count     INTEGER     NOT NULL,
    accepted_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT source_stream_snapshot_acceptances_identity_uniq
        UNIQUE (source_id, source_stream, observed_at, snapshot_digest),
    CONSTRAINT source_stream_snapshot_acceptances_stream_shape
        CHECK (source_stream ~ '^[a-z][a-z0-9_]*$'),
    CONSTRAINT source_stream_snapshot_acceptances_snapshot_digest_sha256
        CHECK (snapshot_digest ~ '^[0-9a-f]{64}$'),
    CONSTRAINT source_stream_snapshot_acceptances_artifact_digest_sha256
        CHECK (artifact_set_digest ~ '^[0-9a-f]{64}$'),
    CONSTRAINT source_stream_snapshot_acceptances_mapping_digest_sha256
        CHECK (mapping_digest ~ '^[0-9a-f]{64}$'),
    CONSTRAINT source_stream_snapshot_acceptances_record_digest_sha256
        CHECK (record_set_digest ~ '^[0-9a-f]{64}$'),
    CONSTRAINT source_stream_snapshot_acceptances_retrieval_count_positive
        CHECK (retrieval_count > 0)
);

CREATE INDEX IF NOT EXISTS source_stream_snapshot_acceptances_latest_idx
    ON source_stream_snapshot_acceptances
       (source_id, source_stream, observed_at DESC, snapshot_digest COLLATE "C" DESC);

CREATE TABLE IF NOT EXISTS source_stream_snapshot_acceptance_artifacts (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    acceptance_id       UUID        NOT NULL
        REFERENCES source_stream_snapshot_acceptances (id) ON DELETE RESTRICT,
    artifact_id         UUID        NOT NULL REFERENCES source_artifacts (id) ON DELETE RESTRICT,
    retrieval_key       TEXT        NOT NULL,
    retrieval_receipt_id TEXT       NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT source_stream_snapshot_acceptance_artifacts_retrieval_uniq
        UNIQUE (acceptance_id, retrieval_key),
    CONSTRAINT source_stream_snapshot_acceptance_artifacts_receipt_uniq
        UNIQUE (acceptance_id, retrieval_receipt_id),
    CONSTRAINT source_stream_snapshot_acceptance_artifacts_retrieval_key_present
        CHECK (btrim(retrieval_key) <> ''),
    CONSTRAINT source_stream_snapshot_acceptance_artifacts_receipt_sha256
        CHECK (retrieval_receipt_id ~ '^[0-9a-f]{64}$')
);

CREATE OR REPLACE FUNCTION source_stream_snapshot_acceptance_artifacts_validate()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    acceptance_source UUID;
    acceptance_observed_at TIMESTAMPTZ;
    acceptance_retrieval_count INTEGER;
    existing_retrieval_count INTEGER;
    artifact_source UUID;
    artifact_retrieved_at TIMESTAMPTZ;
BEGIN
    SELECT source_id, observed_at, retrieval_count
      INTO acceptance_source, acceptance_observed_at, acceptance_retrieval_count
      FROM source_stream_snapshot_acceptances
     WHERE id = NEW.acceptance_id
       FOR UPDATE;
    SELECT source_id, retrieved_at
      INTO artifact_source, artifact_retrieved_at
      FROM source_artifacts
     WHERE id = NEW.artifact_id;

    SELECT count(*)::integer
      INTO existing_retrieval_count
      FROM source_stream_snapshot_acceptance_artifacts
     WHERE acceptance_id = NEW.acceptance_id;

    IF acceptance_source IS NULL OR artifact_source IS NULL OR
       acceptance_source IS DISTINCT FROM artifact_source OR
       acceptance_observed_at < artifact_retrieved_at OR
       existing_retrieval_count >= acceptance_retrieval_count THEN
        RAISE EXCEPTION 'snapshot acceptance evidence must bind a same-source artifact retrieved no later than the observed snapshot'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER source_stream_snapshot_acceptance_artifacts_validate
    BEFORE INSERT ON source_stream_snapshot_acceptance_artifacts
    FOR EACH ROW EXECUTE FUNCTION source_stream_snapshot_acceptance_artifacts_validate();

CREATE OR REPLACE FUNCTION source_stream_snapshot_acceptances_require_artifacts()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    recorded_retrieval_count INTEGER;
BEGIN
    SELECT count(*)::integer
      INTO recorded_retrieval_count
      FROM source_stream_snapshot_acceptance_artifacts
     WHERE acceptance_id = NEW.id;
    IF recorded_retrieval_count IS DISTINCT FROM NEW.retrieval_count THEN
        RAISE EXCEPTION 'an accepted full snapshot requires its exact declared retrieval receipt set'
            USING ERRCODE = '23514';
    END IF;
    RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER source_stream_snapshot_acceptances_require_artifacts
    AFTER INSERT ON source_stream_snapshot_acceptances
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION source_stream_snapshot_acceptances_require_artifacts();

CREATE OR REPLACE FUNCTION source_stream_snapshot_evidence_reject_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'source-stream snapshot acceptance evidence is append-only'
        USING ERRCODE = '23514';
END;
$$;

CREATE TRIGGER source_stream_snapshot_acceptances_immutable
    BEFORE UPDATE OR DELETE OR TRUNCATE ON source_stream_snapshot_acceptances
    FOR EACH STATEMENT EXECUTE FUNCTION source_stream_snapshot_evidence_reject_mutation();
CREATE TRIGGER source_stream_snapshot_acceptance_artifacts_immutable
    BEFORE UPDATE OR DELETE OR TRUNCATE ON source_stream_snapshot_acceptance_artifacts
    FOR EACH STATEMENT EXECUTE FUNCTION source_stream_snapshot_evidence_reject_mutation();

CREATE TABLE IF NOT EXISTS source_record_snapshot_retirements (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_record_id       UUID        NOT NULL REFERENCES source_records (id) ON DELETE RESTRICT,
    snapshot_acceptance_id UUID        NOT NULL
        REFERENCES source_stream_snapshot_acceptances (id) ON DELETE RESTRICT,
    artifact_id            UUID        NOT NULL REFERENCES source_artifacts (id) ON DELETE RESTRICT,
    source_id              UUID        NOT NULL REFERENCES sources (id) ON DELETE RESTRICT,
    source_stream          TEXT        NOT NULL,
    reason                 TEXT        NOT NULL DEFAULT 'FULL_SNAPSHOT_OMISSION',
    retired_at             TIMESTAMPTZ NOT NULL,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT source_record_snapshot_retirements_record_artifact_uniq
        UNIQUE (source_record_id, artifact_id),
    CONSTRAINT source_record_snapshot_retirements_stream_shape
        CHECK (source_stream ~ '^[a-z][a-z0-9_]*$'),
    CONSTRAINT source_record_snapshot_retirements_reason_allowed
        CHECK (reason = 'FULL_SNAPSHOT_OMISSION')
);

CREATE INDEX IF NOT EXISTS source_record_snapshot_retirements_scope_idx
    ON source_record_snapshot_retirements (source_id, source_stream, retired_at DESC);

CREATE OR REPLACE FUNCTION source_record_snapshot_retirements_validate()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    record_source UUID;
    record_stream TEXT;
    record_current BOOLEAN;
    acceptance_source UUID;
    acceptance_stream TEXT;
    acceptance_observed_at TIMESTAMPTZ;
    acceptance_snapshot_digest TEXT;
    existing_acceptance UUID;
    existing_retired_at TIMESTAMPTZ;
BEGIN
    SELECT source_id, source_stream, is_current
      INTO record_source, record_stream, record_current
      FROM source_records
     WHERE id = NEW.source_record_id;
    SELECT source_id, source_stream, observed_at, snapshot_digest
      INTO acceptance_source, acceptance_stream, acceptance_observed_at,
           acceptance_snapshot_digest
      FROM source_stream_snapshot_acceptances
     WHERE id = NEW.snapshot_acceptance_id;
    SELECT snapshot_acceptance_id, retired_at
      INTO existing_acceptance, existing_retired_at
      FROM source_record_snapshot_retirements
     WHERE source_record_id = NEW.source_record_id
     LIMIT 1;

    IF record_source IS NULL OR acceptance_source IS NULL OR
       record_current IS DISTINCT FROM FALSE OR
       NEW.source_id IS DISTINCT FROM record_source OR
       NEW.source_id IS DISTINCT FROM acceptance_source OR
       NEW.source_stream IS DISTINCT FROM record_stream OR
       NEW.source_stream IS DISTINCT FROM acceptance_stream OR
       NEW.retired_at IS DISTINCT FROM acceptance_observed_at OR
       NOT EXISTS (
           SELECT 1 FROM source_stream_snapshot_acceptance_artifacts
            WHERE acceptance_id = NEW.snapshot_acceptance_id
              AND artifact_id = NEW.artifact_id
       ) OR EXISTS (
           SELECT 1 FROM source_stream_snapshot_acceptances later
            WHERE later.source_id = acceptance_source
              AND later.source_stream = acceptance_stream
              AND (
                  later.observed_at > acceptance_observed_at OR
                  (later.observed_at = acceptance_observed_at AND
                   later.snapshot_digest COLLATE "C" > acceptance_snapshot_digest COLLATE "C")
              )
       ) OR EXISTS (
           SELECT 1 FROM source_record_reconciliations
            WHERE superseded_source_record_id = NEW.source_record_id
       ) OR (existing_acceptance IS NOT NULL AND (
           existing_acceptance IS DISTINCT FROM NEW.snapshot_acceptance_id OR
           existing_retired_at IS DISTINCT FROM NEW.retired_at
       )) THEN
        RAISE EXCEPTION 'snapshot retirement evidence must bind one retired record exclusively to the latest same-stream accepted snapshot and one effective time'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER source_record_snapshot_retirements_validate
    BEFORE INSERT ON source_record_snapshot_retirements
    FOR EACH ROW EXECUTE FUNCTION source_record_snapshot_retirements_validate();

CREATE OR REPLACE FUNCTION source_record_snapshot_retirements_reject_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'source-record snapshot retirement evidence is append-only'
        USING ERRCODE = '23514';
END;
$$;

CREATE TRIGGER source_record_snapshot_retirements_immutable
    BEFORE UPDATE OR DELETE OR TRUNCATE ON source_record_snapshot_retirements
    FOR EACH STATEMENT EXECUTE FUNCTION source_record_snapshot_retirements_reject_mutation();

-- Replacement and omission are distinct terminal events. A revision may have
-- exactly one of them, never both, and replacement time cannot predate the
-- retrieval of the artifact that actually backs the replacement.
CREATE OR REPLACE FUNCTION source_record_reconciliations_validate_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    superseded_source UUID;
    superseded_stream TEXT;
    superseded_key TEXT;
    superseded_current BOOLEAN;
    replacement_source UUID;
    replacement_stream TEXT;
    replacement_key TEXT;
    replacement_current BOOLEAN;
    replacement_state TEXT;
    replacement_retrieved_at TIMESTAMPTZ;
BEGIN
    SELECT source_id, source_stream, source_record_key, is_current
      INTO superseded_source, superseded_stream, superseded_key, superseded_current
      FROM source_records WHERE id = NEW.superseded_source_record_id;
    SELECT replacement.source_id, replacement.source_stream,
           replacement.source_record_key, replacement.is_current,
           replacement.revision_state, artifact.retrieved_at
      INTO replacement_source, replacement_stream, replacement_key,
           replacement_current, replacement_state, replacement_retrieved_at
      FROM source_records replacement
      JOIN source_artifacts artifact ON artifact.id = replacement.artifact_id
     WHERE replacement.id = NEW.replacement_source_record_id;
    IF superseded_source IS DISTINCT FROM replacement_source OR
       superseded_stream IS DISTINCT FROM replacement_stream OR
       superseded_key IS DISTINCT FROM replacement_key OR
       superseded_current IS DISTINCT FROM FALSE OR
       replacement_current IS DISTINCT FROM TRUE OR
       replacement_state IS DISTINCT FROM 'FINALIZED' OR
       replacement_retrieved_at IS NULL OR
       NEW.reconciled_at < replacement_retrieved_at OR
       EXISTS (
           SELECT 1 FROM source_record_snapshot_retirements
            WHERE source_record_id = NEW.superseded_source_record_id
       ) THEN
        RAISE EXCEPTION 'source-record reconciliation must exclusively link a noncurrent revision to its current finalized same-stream replacement at or after artifact retrieval'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS source_record_reconciliations_validate_insert ON source_record_reconciliations;
CREATE TRIGGER source_record_reconciliations_validate_insert
    BEFORE INSERT ON source_record_reconciliations
    FOR EACH ROW EXECUTE FUNCTION source_record_reconciliations_validate_insert();

-- Reinstall the revision guard with source_stream included in every immutable
-- comparison. `is_current` and `updated_at` remain the only allowed changes to
-- a finalized revision, and a separate deferred guard below requires lineage.
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
        NEW.source_stream IS DISTINCT FROM OLD.source_stream OR
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
        NEW.source_stream IS DISTINCT FROM OLD.source_stream OR
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
        NEW.source_stream IS DISTINCT FROM OLD.source_stream OR
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

CREATE OR REPLACE FUNCTION source_records_require_retirement_lineage()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    reconciliation_count INTEGER;
    has_snapshot_retirement INTEGER;
BEGIN
    IF OLD.is_current AND NOT NEW.is_current THEN
        SELECT count(*)::integer
          INTO reconciliation_count
          FROM source_record_reconciliations
         WHERE superseded_source_record_id = NEW.id;
        SELECT CASE WHEN EXISTS (
            SELECT 1 FROM source_record_snapshot_retirements
             WHERE source_record_id = NEW.id
        ) THEN 1 ELSE 0 END
          INTO has_snapshot_retirement;

        IF reconciliation_count + has_snapshot_retirement <> 1 THEN
            RAISE EXCEPTION 'a retired source-record revision requires exactly one terminal mechanism: replacement or complete-snapshot omission'
            USING ERRCODE = '23514';
        END IF;
    END IF;
    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS source_records_require_retirement_lineage ON source_records;
CREATE CONSTRAINT TRIGGER source_records_require_retirement_lineage
    AFTER UPDATE OF is_current ON source_records
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION source_records_require_retirement_lineage();

COMMENT ON COLUMN source_records.source_stream IS
    'Explicit source-mapping stream membership. NULL is historical-only and can never be current.';
COMMENT ON TABLE source_stream_snapshot_acceptances IS
    'Append-only winners of the per-source, per-stream full-snapshot order; absence of a row grants no membership authority.';
COMMENT ON COLUMN source_stream_snapshot_acceptances.observed_at IS
    'Provider fetch instant. Snapshot order compares this first and snapshot_digest under C collation second.';
COMMENT ON COLUMN source_stream_snapshot_acceptances.retrieval_count IS
    'Exact immutable number of run-scoped artifact retrieval receipts required for this acceptance.';
COMMENT ON TABLE source_stream_snapshot_acceptance_artifacts IS
    'Append-only binding from an accepted snapshot to its exact run-scoped retrieval receipts and deduplicated artifacts.';
COMMENT ON TABLE source_record_snapshot_retirements IS
    'Append-only artifact evidence that the latest accepted complete stream omitted and retired a prior current record.';
COMMENT ON COLUMN source_record_snapshot_retirements.retired_at IS
    'Effective half-open end of the source record authority interval; distinct from ledger insertion time.';
COMMENT ON COLUMN source_records.is_current IS
    'At most one current revision exists for a logical source record; complete-snapshot omission may leave none.';
