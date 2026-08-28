-- 0017_scheduled_acquisition_runs.sql
--
-- Durable, idempotent scheduled acquisition claims. Freshness is published
-- only by a terminal success whose complete artifact set was linked in the
-- same transaction. Claimed, empty, refused, failed, and partial runs are never
-- evidence that a source is fresh.

CREATE TABLE IF NOT EXISTS scheduled_acquisition_runs (
    id                         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    idempotency_key            TEXT        NOT NULL UNIQUE,
    vertical_slug              TEXT        NOT NULL,
    source_id                  UUID        NOT NULL REFERENCES sources (id) ON DELETE RESTRICT,
    source_key                 TEXT        NOT NULL,
    target_id                  TEXT        NOT NULL,
    target_url                 TEXT        NOT NULL,
    acquisition_route          TEXT        NOT NULL,
    account_or_product_plan    TEXT            NULL,
    acquisition_jurisdiction   TEXT            NULL,
    asset_class                TEXT        NOT NULL,
    output_class               TEXT        NOT NULL,
    scheduled_for              TIMESTAMPTZ NOT NULL,
    claimed_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at               TIMESTAMPTZ     NULL,
    fresh_at                   TIMESTAMPTZ     NULL,
    status                     TEXT        NOT NULL DEFAULT 'CLAIMED',
    outcome                    TEXT            NULL,
    failure_code               TEXT            NULL,
    rights_receipt             JSONB       NOT NULL DEFAULT '[]'::jsonb,
    provider                   TEXT            NULL,
    validators                 JSONB       NOT NULL DEFAULT '{}'::jsonb,
    expected_artifact_count    INTEGER     NOT NULL DEFAULT 0,
    artifact_count             INTEGER     NOT NULL DEFAULT 0,
    runtime_digest             TEXT        NOT NULL,
    created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT scheduled_acquisition_runs_idempotency_nonempty
        CHECK (btrim(idempotency_key) <> ''),
    CONSTRAINT scheduled_acquisition_runs_identity_nonempty
        CHECK (btrim(vertical_slug) <> '' AND btrim(source_key) <> '' AND btrim(target_id) <> ''),
    CONSTRAINT scheduled_acquisition_runs_target_url_absolute
        CHECK (target_url ~ '^https://'),
    CONSTRAINT scheduled_acquisition_runs_route_allowed
        CHECK (acquisition_route IN (
            'DIRECT_HTTP', 'BROWSER_RUN', 'CRAWL4AI', 'VENDOR_API',
            'SITEMAP', 'BULK_FILE', 'RSS', 'MANUAL_UPLOAD'
        )),
    CONSTRAINT scheduled_acquisition_runs_scope_allowed
        CHECK (asset_class IN ('DOCUMENT', 'DATA', 'IMAGE', 'MODEL_OUTPUT')
           AND output_class IN ('RAW_RECORD', 'NORMALIZED_FACT', 'DERIVED_METRIC')),
    CONSTRAINT scheduled_acquisition_runs_status_allowed
        CHECK (status IN ('CLAIMED', 'SUCCEEDED', 'REFUSED', 'FAILED')),
    CONSTRAINT scheduled_acquisition_runs_outcome_allowed
        CHECK (outcome IS NULL OR outcome IN ('FETCHED', 'NOT_MODIFIED', 'EMPTY')),
    CONSTRAINT scheduled_acquisition_runs_receipt_array
        CHECK (jsonb_typeof(rights_receipt) = 'array'),
    CONSTRAINT scheduled_acquisition_runs_validators_object
        CHECK (jsonb_typeof(validators) = 'object'),
    CONSTRAINT scheduled_acquisition_runs_artifact_counts
        CHECK (expected_artifact_count >= 0 AND artifact_count >= 0),
    CONSTRAINT scheduled_acquisition_runs_runtime_digest
        CHECK (runtime_digest ~ '^[0-9a-f]{64}$'),
    CONSTRAINT scheduled_acquisition_runs_terminal_shape CHECK (
        (status = 'CLAIMED'
          AND completed_at IS NULL AND fresh_at IS NULL AND outcome IS NULL
          AND failure_code IS NULL AND provider IS NULL
          AND expected_artifact_count = 0 AND artifact_count = 0)
        OR
        (status = 'SUCCEEDED'
          AND completed_at IS NOT NULL AND fresh_at IS NOT NULL
          AND outcome IN ('FETCHED', 'NOT_MODIFIED')
          AND failure_code IS NULL AND provider IS NOT NULL
          AND expected_artifact_count = artifact_count
          AND ((outcome = 'FETCHED' AND artifact_count > 0)
            OR (outcome = 'NOT_MODIFIED' AND artifact_count = 0)))
        OR
        (status = 'REFUSED'
          AND completed_at IS NOT NULL AND fresh_at IS NULL AND outcome IS NULL
          AND failure_code IS NOT NULL AND btrim(failure_code) <> ''
          AND provider IS NULL AND expected_artifact_count = 0 AND artifact_count = 0)
        OR
        (status = 'FAILED'
          AND completed_at IS NOT NULL AND fresh_at IS NULL
          AND (outcome IS NULL OR outcome = 'EMPTY')
          AND failure_code IS NOT NULL AND btrim(failure_code) <> ''
          AND expected_artifact_count = 0 AND artifact_count = 0)
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS scheduled_acquisition_runs_slot_key
    ON scheduled_acquisition_runs (vertical_slug, source_id, target_id, scheduled_for);
CREATE INDEX IF NOT EXISTS scheduled_acquisition_runs_latest_success_idx
    ON scheduled_acquisition_runs (source_id, target_id, fresh_at DESC)
    WHERE status = 'SUCCEEDED';
CREATE INDEX IF NOT EXISTS scheduled_acquisition_runs_status_idx
    ON scheduled_acquisition_runs (status, claimed_at);

CREATE TABLE IF NOT EXISTS scheduled_acquisition_run_artifacts (
    run_id       UUID        NOT NULL REFERENCES scheduled_acquisition_runs (id) ON DELETE RESTRICT,
    artifact_id  UUID        NOT NULL REFERENCES source_artifacts (id) ON DELETE RESTRICT,
    ordinal      INTEGER     NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (run_id, artifact_id),
    CONSTRAINT scheduled_acquisition_run_artifacts_ordinal_nonnegative CHECK (ordinal >= 0),
    CONSTRAINT scheduled_acquisition_run_artifacts_ordinal_unique UNIQUE (run_id, ordinal)
);

CREATE OR REPLACE FUNCTION scheduled_acquisition_run_artifact_guard()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
    run_status TEXT;
    run_source UUID;
    artifact_source UUID;
BEGIN
    SELECT status, source_id INTO run_status, run_source
      FROM scheduled_acquisition_runs WHERE id = NEW.run_id FOR UPDATE;
    SELECT source_id INTO artifact_source FROM source_artifacts WHERE id = NEW.artifact_id;

    IF run_status IS DISTINCT FROM 'CLAIMED' THEN
        RAISE EXCEPTION 'artifacts may be linked only while a scheduled acquisition run is CLAIMED'
            USING ERRCODE = '55000';
    END IF;
    IF artifact_source IS DISTINCT FROM run_source THEN
        RAISE EXCEPTION 'scheduled acquisition artifact source does not match the run source'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER scheduled_acquisition_run_artifact_insert_guard
    BEFORE INSERT ON scheduled_acquisition_run_artifacts
    FOR EACH ROW EXECUTE FUNCTION scheduled_acquisition_run_artifact_guard();

CREATE OR REPLACE FUNCTION scheduled_acquisition_run_terminal_guard()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
    linked_count INTEGER;
BEGIN
    IF TG_OP = 'DELETE' OR (TG_OP = 'UPDATE' AND OLD.status <> 'CLAIMED') THEN
        RAISE EXCEPTION 'terminal scheduled acquisition run is immutable'
            USING ERRCODE = '55000';
    END IF;

    IF TG_OP = 'UPDATE' AND NEW.status <> 'CLAIMED' THEN
        SELECT count(*)::integer INTO linked_count
          FROM scheduled_acquisition_run_artifacts WHERE run_id = OLD.id;
        IF linked_count <> NEW.artifact_count THEN
            RAISE EXCEPTION 'scheduled acquisition terminal artifact count does not match linked artifacts'
                USING ERRCODE = '23514';
        END IF;
    END IF;
    RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER scheduled_acquisition_runs_terminal_immutable
    BEFORE UPDATE OR DELETE ON scheduled_acquisition_runs
    FOR EACH ROW EXECUTE FUNCTION scheduled_acquisition_run_terminal_guard();

CREATE OR REPLACE FUNCTION scheduled_acquisition_run_artifact_immutable()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'scheduled acquisition artifact links are immutable'
        USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER scheduled_acquisition_run_artifacts_immutable
    BEFORE UPDATE OR DELETE OR TRUNCATE ON scheduled_acquisition_run_artifacts
    FOR EACH STATEMENT EXECUTE FUNCTION scheduled_acquisition_run_artifact_immutable();

COMMENT ON TABLE scheduled_acquisition_runs IS
    'Durable scheduler claim and terminal result ledger. Only SUCCEEDED FETCHED/NOT_MODIFIED rows carry freshness.';
COMMENT ON COLUMN scheduled_acquisition_runs.rights_receipt IS
    'Exact ACQUIRE/STORE/CACHE decision provenance evaluated for this target; never an inferred permission.';
COMMENT ON TABLE scheduled_acquisition_run_artifacts IS
    'Complete immutable artifact set atomically linked before a FETCHED run may become terminal.';
