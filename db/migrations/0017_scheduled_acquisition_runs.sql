-- 0017_scheduled_acquisition_runs.sql
--
-- Durable, idempotent scheduled acquisition claims. Freshness is published
-- only by a terminal success whose complete artifact set was linked in the
-- same transaction. Claimed, empty, refused, failed, and partial runs are never
-- evidence that a source is fresh.

CREATE OR REPLACE FUNCTION scheduled_acquisition_validators_valid(value JSONB)
RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
    IF jsonb_typeof(value) <> 'object'
       OR value - 'etag' - 'lastModified' - 'contentHash' <> '{}'::jsonb THEN
        RETURN FALSE;
    END IF;
    IF value ? 'etag' AND (
       jsonb_typeof(value -> 'etag') <> 'string'
       OR length(value ->> 'etag') NOT BETWEEN 1 AND 1024) THEN
        RETURN FALSE;
    END IF;
    IF value ? 'lastModified' AND (
       jsonb_typeof(value -> 'lastModified') <> 'string'
       OR length(value ->> 'lastModified') NOT BETWEEN 1 AND 128) THEN
        RETURN FALSE;
    END IF;
    IF value ? 'contentHash' AND (
       jsonb_typeof(value -> 'contentHash') <> 'string'
       OR (value ->> 'contentHash') !~ '^[0-9a-f]{64}$') THEN
        RETURN FALSE;
    END IF;
    RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION scheduled_acquisition_receipt_valid(value JSONB)
RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
    checkpoint JSONB;
    decision JSONB;
    operations TEXT[];
BEGIN
    IF jsonb_typeof(value) <> 'array' OR jsonb_array_length(value) > 3 THEN
        RETURN FALSE;
    END IF;
    FOR checkpoint IN SELECT item FROM jsonb_array_elements(value) item LOOP
        IF jsonb_typeof(checkpoint) <> 'object'
           OR NOT (checkpoint ?& ARRAY['stage', 'evaluatedAt', 'decisions'])
           OR checkpoint - 'stage' - 'evaluatedAt' - 'decisions' <> '{}'::jsonb
           OR checkpoint ->> 'stage' NOT IN ('INITIAL', 'PRE_PROVIDER', 'PRE_TRANSPORT')
           OR jsonb_typeof(checkpoint -> 'evaluatedAt') <> 'string'
           OR length(checkpoint ->> 'evaluatedAt') NOT BETWEEN 20 AND 40
           OR jsonb_typeof(checkpoint -> 'decisions') <> 'array'
           OR jsonb_array_length(checkpoint -> 'decisions') <> 3 THEN
            RETURN FALSE;
        END IF;
        operations := ARRAY[]::TEXT[];
        FOR decision IN SELECT item FROM jsonb_array_elements(checkpoint -> 'decisions') item LOOP
            IF jsonb_typeof(decision) <> 'object'
               OR NOT (decision ?& ARRAY[
                    'operation', 'permitted', 'state', 'reasonCode',
                    'cellId', 'decisionId', 'termsVersionId'
                  ])
               OR decision - 'operation' - 'permitted' - 'state' - 'reasonCode'
                           - 'cellId' - 'decisionId' - 'termsVersionId' <> '{}'::jsonb
               OR decision ->> 'operation' NOT IN ('ACQUIRE', 'STORE', 'CACHE')
               OR (decision ->> 'operation') = ANY(operations)
               OR jsonb_typeof(decision -> 'permitted') <> 'boolean'
               OR decision ->> 'state' NOT IN ('ALLOW', 'DENY', 'CONDITIONAL', 'UNKNOWN', 'NOT_APPLICABLE')
               OR (decision ->> 'reasonCode') !~ '^[A-Z][A-Z0-9_]{1,63}$' THEN
                RETURN FALSE;
            END IF;
            IF (decision -> 'cellId') <> 'null'::jsonb AND (
               jsonb_typeof(decision -> 'cellId') <> 'string'
               OR (decision ->> 'cellId') !~* '^[0-9a-f-]{36}$') THEN
                RETURN FALSE;
            END IF;
            IF (decision -> 'decisionId') <> 'null'::jsonb AND (
               jsonb_typeof(decision -> 'decisionId') <> 'string'
               OR (decision ->> 'decisionId') !~* '^[0-9a-f-]{36}$') THEN
                RETURN FALSE;
            END IF;
            IF (decision -> 'termsVersionId') <> 'null'::jsonb AND (
               jsonb_typeof(decision -> 'termsVersionId') <> 'string'
               OR (decision ->> 'termsVersionId') !~* '^[0-9a-f-]{36}$') THEN
                RETURN FALSE;
            END IF;
            operations := array_append(operations, decision ->> 'operation');
        END LOOP;
    END LOOP;
    RETURN TRUE;
END;
$$;

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
        CHECK (status IN ('CLAIMED', 'SUCCEEDED', 'SKIPPED', 'REFUSED', 'FAILED')),
    CONSTRAINT scheduled_acquisition_runs_outcome_allowed
        CHECK (outcome IS NULL OR outcome IN ('FETCHED', 'NOT_MODIFIED', 'EMPTY')),
    CONSTRAINT scheduled_acquisition_runs_receipt_shape
        CHECK (scheduled_acquisition_receipt_valid(rights_receipt)),
    CONSTRAINT scheduled_acquisition_runs_validators_shape
        CHECK (scheduled_acquisition_validators_valid(validators)),
    CONSTRAINT scheduled_acquisition_runs_provider_allowed
        CHECK (provider IS NULL OR provider IN ('http', 'browser-run', 'crawl4ai', 'fixture')),
    CONSTRAINT scheduled_acquisition_runs_failure_code_allowed CHECK (
        failure_code IS NULL OR failure_code IN (
            'NOT_DUE', 'RIGHTS_REFUSED', 'EMPTY_RESPONSE', 'PROVIDER_UNAVAILABLE',
            'PROVIDER_CONFIGURATION', 'TRANSPORT_FAILED', 'PERSISTENCE_FAILED',
            'RUNTIME_CONFIGURATION', 'INTERNAL_ERROR'
        )
    ),
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
          AND jsonb_array_length(rights_receipt) > 0
          AND expected_artifact_count = artifact_count
          AND ((outcome = 'FETCHED' AND artifact_count > 0)
            OR (outcome = 'NOT_MODIFIED' AND artifact_count = 0 AND validators <> '{}'::jsonb)))
        OR
        (status = 'SKIPPED'
          AND completed_at IS NOT NULL AND fresh_at IS NULL AND outcome IS NULL
          AND failure_code = 'NOT_DUE' AND provider IS NULL
          AND jsonb_array_length(rights_receipt) > 0
          AND expected_artifact_count = 0 AND artifact_count = 0)
        OR
        (status = 'REFUSED'
          AND completed_at IS NOT NULL AND fresh_at IS NULL AND outcome IS NULL
          AND failure_code = 'RIGHTS_REFUSED'
          AND jsonb_array_length(rights_receipt) > 0
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
    run_target_url TEXT;
    run_route TEXT;
    run_plan TEXT;
    run_jurisdiction TEXT;
    artifact_source UUID;
    artifact_url TEXT;
    artifact_route TEXT;
    artifact_plan TEXT;
    artifact_jurisdiction TEXT;
BEGIN
    SELECT status, source_id, target_url, acquisition_route,
           account_or_product_plan, acquisition_jurisdiction
      INTO run_status, run_source, run_target_url, run_route,
           run_plan, run_jurisdiction
      FROM scheduled_acquisition_runs WHERE id = NEW.run_id FOR UPDATE;
    SELECT source_id, url, acquisition_route,
           account_or_product_plan, acquisition_jurisdiction
      INTO artifact_source, artifact_url, artifact_route,
           artifact_plan, artifact_jurisdiction
      FROM source_artifacts WHERE id = NEW.artifact_id;

    IF run_status IS DISTINCT FROM 'CLAIMED' THEN
        RAISE EXCEPTION 'artifacts may be linked only while a scheduled acquisition run is CLAIMED'
            USING ERRCODE = '55000';
    END IF;
    IF artifact_source IS DISTINCT FROM run_source THEN
        RAISE EXCEPTION 'scheduled acquisition artifact source does not match the run source'
            USING ERRCODE = '23514';
    END IF;
    IF artifact_url IS DISTINCT FROM run_target_url
       OR artifact_route IS DISTINCT FROM run_route
       OR artifact_plan IS DISTINCT FROM run_plan
       OR artifact_jurisdiction IS DISTINCT FROM run_jurisdiction THEN
        RAISE EXCEPTION 'scheduled acquisition artifact target or acquisition scope does not match the run'
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
    wrong_provider_count INTEGER;
    prior_fetched_count INTEGER;
BEGIN
    IF TG_OP = 'DELETE' OR (TG_OP = 'UPDATE' AND OLD.status <> 'CLAIMED') THEN
        RAISE EXCEPTION 'terminal scheduled acquisition run is immutable'
            USING ERRCODE = '55000';
    END IF;

    IF TG_OP = 'UPDATE' AND (
       NEW.id IS DISTINCT FROM OLD.id
       OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
       OR NEW.vertical_slug IS DISTINCT FROM OLD.vertical_slug
       OR NEW.source_id IS DISTINCT FROM OLD.source_id
       OR NEW.source_key IS DISTINCT FROM OLD.source_key
       OR NEW.target_id IS DISTINCT FROM OLD.target_id
       OR NEW.target_url IS DISTINCT FROM OLD.target_url
       OR NEW.acquisition_route IS DISTINCT FROM OLD.acquisition_route
       OR NEW.account_or_product_plan IS DISTINCT FROM OLD.account_or_product_plan
       OR NEW.acquisition_jurisdiction IS DISTINCT FROM OLD.acquisition_jurisdiction
       OR NEW.asset_class IS DISTINCT FROM OLD.asset_class
       OR NEW.output_class IS DISTINCT FROM OLD.output_class
       OR NEW.scheduled_for IS DISTINCT FROM OLD.scheduled_for
       OR NEW.claimed_at IS DISTINCT FROM OLD.claimed_at
       OR NEW.runtime_digest IS DISTINCT FROM OLD.runtime_digest
       OR NEW.created_at IS DISTINCT FROM OLD.created_at
    ) THEN
        RAISE EXCEPTION 'scheduled acquisition claim identity and scope are immutable'
            USING ERRCODE = '55000';
    END IF;

    IF TG_OP = 'UPDATE' AND NEW.status = 'CLAIMED' THEN
        RAISE EXCEPTION 'a scheduled acquisition claim may only transition to a terminal state'
            USING ERRCODE = '55000';
    END IF;

    IF TG_OP = 'UPDATE' AND NEW.status <> 'CLAIMED' THEN
        SELECT count(*)::integer,
               count(*) FILTER (
                 WHERE artifact.acquisition_provider IS DISTINCT FROM NEW.provider
               )::integer
          INTO linked_count, wrong_provider_count
          FROM scheduled_acquisition_run_artifacts link
          JOIN source_artifacts artifact ON artifact.id = link.artifact_id
         WHERE link.run_id = OLD.id;
        IF linked_count <> NEW.artifact_count THEN
            RAISE EXCEPTION 'scheduled acquisition terminal artifact count does not match linked artifacts'
                USING ERRCODE = '23514';
        END IF;
        IF NEW.status = 'SUCCEEDED' AND wrong_provider_count <> 0 THEN
            RAISE EXCEPTION 'scheduled acquisition artifact provider does not match the completion provider'
                USING ERRCODE = '23514';
        END IF;
        IF NEW.status = 'SUCCEEDED' AND NEW.outcome = 'NOT_MODIFIED' THEN
            SELECT count(*)::integer INTO prior_fetched_count
              FROM scheduled_acquisition_runs prior
             WHERE prior.id <> OLD.id
               AND prior.source_id = OLD.source_id
               AND prior.target_id = OLD.target_id
               AND prior.target_url = OLD.target_url
               AND prior.acquisition_route = OLD.acquisition_route
               AND prior.account_or_product_plan IS NOT DISTINCT FROM OLD.account_or_product_plan
               AND prior.acquisition_jurisdiction IS NOT DISTINCT FROM OLD.acquisition_jurisdiction
               AND prior.asset_class = OLD.asset_class
               AND prior.output_class = OLD.output_class
               AND prior.runtime_digest = OLD.runtime_digest
               AND prior.status = 'SUCCEEDED'
               AND prior.outcome = 'FETCHED'
               AND prior.artifact_count > 0
               AND EXISTS (
                 SELECT 1 FROM scheduled_acquisition_run_artifacts link
                  WHERE link.run_id = prior.id
               );
            IF prior_fetched_count = 0 THEN
                RAISE EXCEPTION 'NOT_MODIFIED requires a prior artifact-backed FETCHED success for the exact scope and runtime'
                    USING ERRCODE = '23514';
            END IF;
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
