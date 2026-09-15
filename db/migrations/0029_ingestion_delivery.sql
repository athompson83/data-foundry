-- Durable acquisition-to-canonical outbox. No source approval or rights grant.
CREATE TABLE ingestion_deliveries (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    acquisition_run_id uuid NOT NULL REFERENCES scheduled_acquisition_runs(id),
    artifact_run_id uuid NOT NULL REFERENCES scheduled_acquisition_runs(id),
    runtime_digest text NOT NULL CHECK (runtime_digest ~ '^[0-9a-f]{64}$'),
    work_kind text NOT NULL CHECK (work_kind IN ('PROCESS_ARTIFACTS', 'VERIFY_UNCHANGED')),
    status text NOT NULL DEFAULT 'QUEUED'
        CHECK (status IN ('QUEUED', 'PROCESSING', 'PUBLISHED', 'REFUSED', 'FAILED')),
    created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
    dispatched_at timestamptz,
    dispatch_attempt integer NOT NULL DEFAULT 0 CHECK (dispatch_attempt >= 0),
    attempt integer NOT NULL DEFAULT 0 CHECK (attempt >= 0),
    lease_token uuid,
    lease_expires_at timestamptz,
    completed_at timestamptz,
    processed_at timestamptz,
    published_at timestamptz,
    verified_at timestamptz,
    failure_code text CHECK (failure_code IN ('INPUT_REFUSED', 'RIGHTS_REFUSED', 'RUNTIME_MISMATCH', 'RETRY_EXHAUSTED', 'PROCESSING_ERROR')),
    UNIQUE (acquisition_run_id, runtime_digest, work_kind),
    CHECK ((status = 'PROCESSING') = (lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)),
    CHECK (status <> 'PUBLISHED' OR (published_at IS NOT NULL AND verified_at IS NOT NULL))
);
CREATE INDEX ingestion_deliveries_dispatch_idx ON ingestion_deliveries (created_at, id)
    WHERE status IN ('QUEUED', 'PROCESSING');
CREATE INDEX ingestion_deliveries_artifact_run_idx ON ingestion_deliveries (artifact_run_id, runtime_digest)
    WHERE status = 'PUBLISHED';

-- One durable bounded receipt-verification checkpoint per immutable artifact.
-- Canonical full-snapshot acceptance waits for the complete manifest.
CREATE TABLE ingestion_delivery_parts (
    delivery_id uuid NOT NULL REFERENCES ingestion_deliveries(id),
    ordinal integer NOT NULL CHECK (ordinal >= 0 AND ordinal < 32),
    artifact_id uuid NOT NULL REFERENCES source_artifacts(id),
    content_hash text NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
    byte_size bigint NOT NULL CHECK (byte_size >= 0 AND byte_size <= 8388608),
    verified_at timestamptz NOT NULL DEFAULT statement_timestamp(),
    PRIMARY KEY (delivery_id, ordinal)
);

CREATE FUNCTION guard_ingestion_delivery_identity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    acquisition scheduled_acquisition_runs%ROWTYPE;
    artifact_run scheduled_acquisition_runs%ROWTYPE;
BEGIN
    IF TG_OP = 'INSERT' THEN
        SELECT * INTO acquisition FROM scheduled_acquisition_runs WHERE id=NEW.acquisition_run_id;
        SELECT * INTO artifact_run FROM scheduled_acquisition_runs WHERE id=NEW.artifact_run_id;
        IF acquisition.id IS NULL OR artifact_run.id IS NULL OR
           acquisition.status <> 'SUCCEEDED' OR artifact_run.status <> 'SUCCEEDED' OR
           artifact_run.outcome <> 'FETCHED' OR artifact_run.artifact_count < 1 OR
           (acquisition.outcome = 'FETCHED' AND acquisition.id <> artifact_run.id) OR
           (NEW.work_kind = 'VERIFY_UNCHANGED' AND acquisition.outcome <> 'NOT_MODIFIED') OR
           acquisition.source_id IS DISTINCT FROM artifact_run.source_id OR
           acquisition.target_id IS DISTINCT FROM artifact_run.target_id OR
           acquisition.target_url IS DISTINCT FROM artifact_run.target_url OR
           acquisition.acquisition_route IS DISTINCT FROM artifact_run.acquisition_route OR
           acquisition.account_or_product_plan IS DISTINCT FROM artifact_run.account_or_product_plan OR
           acquisition.acquisition_jurisdiction IS DISTINCT FROM artifact_run.acquisition_jurisdiction OR
           acquisition.asset_class IS DISTINCT FROM artifact_run.asset_class OR
           acquisition.output_class IS DISTINCT FROM artifact_run.output_class OR
           acquisition.result_url_policy IS DISTINCT FROM artifact_run.result_url_policy OR
           acquisition.runtime_digest IS DISTINCT FROM artifact_run.runtime_digest THEN
            RAISE EXCEPTION 'ingestion delivery requires an exact successful acquisition artifact scope';
        END IF;
        RETURN NEW;
    END IF;
    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.acquisition_run_id IS DISTINCT FROM OLD.acquisition_run_id
       OR NEW.artifact_run_id IS DISTINCT FROM OLD.artifact_run_id
       OR NEW.runtime_digest IS DISTINCT FROM OLD.runtime_digest
       OR NEW.work_kind IS DISTINCT FROM OLD.work_kind
       OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION 'ingestion delivery identity is immutable';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER ingestion_delivery_identity_guard BEFORE INSERT OR UPDATE ON ingestion_deliveries
    FOR EACH ROW EXECUTE FUNCTION guard_ingestion_delivery_identity();
ALTER FUNCTION guard_ingestion_delivery_identity() SET search_path FROM CURRENT;

-- Explicit retained-byte runtime replay has a separate processing generation.
-- Provider observation time remains unchanged and dominates every generation.
ALTER TABLE source_stream_snapshot_acceptances
    ADD COLUMN processing_runtime_digest text CHECK (processing_runtime_digest ~ '^[0-9a-f]{64}$'),
    ADD COLUMN processing_generation integer NOT NULL DEFAULT 0 CHECK (processing_generation >= 0);
CREATE INDEX source_stream_snapshot_processing_order_idx ON source_stream_snapshot_acceptances
    (source_id, source_stream, observed_at DESC, processing_generation DESC, snapshot_digest COLLATE "C" DESC);
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
    acceptance_generation INTEGER;
    existing_acceptance UUID;
    existing_retired_at TIMESTAMPTZ;
BEGIN
    SELECT source_id, source_stream, is_current
      INTO record_source, record_stream, record_current
      FROM source_records
     WHERE id = NEW.source_record_id;
    SELECT source_id, source_stream, observed_at, snapshot_digest, processing_generation
      INTO acceptance_source, acceptance_stream, acceptance_observed_at,
           acceptance_snapshot_digest, acceptance_generation
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
                   (later.processing_generation > acceptance_generation OR
                    (later.processing_generation = acceptance_generation AND
                     later.snapshot_digest COLLATE "C" > acceptance_snapshot_digest COLLATE "C")))
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

ALTER FUNCTION source_record_snapshot_retirements_validate() SET search_path FROM CURRENT;
