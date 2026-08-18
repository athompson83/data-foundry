-- 0008_ingestion_jobs.sql
--
-- The durable, resumable ingestion job and its append-only transition log.
--
-- FAILED is a side state carrying retry metadata, never a delete: a job that
-- fails at EXTRACTED keeps its artifact, its failed_from stage and its attempt
-- budget, and resumes exactly there.

CREATE TABLE IF NOT EXISTS ingestion_jobs (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vertical_id      UUID        NOT NULL REFERENCES verticals (id) ON DELETE RESTRICT,
    source_id        UUID        NOT NULL REFERENCES sources (id) ON DELETE RESTRICT,
    job_type         TEXT        NOT NULL,
    idempotency_key  TEXT        NOT NULL,
    state            TEXT        NOT NULL DEFAULT 'DISCOVERED',
    state_entered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    failed_from      TEXT            NULL,
    retry            JSONB           NULL,
    artifact_id      UUID            NULL REFERENCES source_artifacts (id) ON DELETE SET NULL,
    source_record_id UUID            NULL REFERENCES source_records (id) ON DELETE SET NULL,
    payload          JSONB       NOT NULL DEFAULT '{}'::jsonb,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT ingestion_jobs_job_type_allowed CHECK (job_type IN (
        'SOURCE_DISCOVERY', 'ARTIFACT_FETCH', 'ARTIFACT_EXTRACT', 'RECORD_NORMALIZE',
        'ENTITY_RESOLVE', 'FACT_VALIDATE', 'SNAPSHOT_PUBLISH'
    )),
    CONSTRAINT ingestion_jobs_state_allowed CHECK (state IN (
        'DISCOVERED', 'FETCH_QUEUED', 'FETCHED', 'EXTRACTED', 'NORMALIZED',
        'RESOLUTION_PENDING', 'RESOLVED', 'VALIDATED', 'PUBLISHED', 'FAILED'
    )),
    CONSTRAINT ingestion_jobs_failed_from_allowed CHECK (failed_from IS NULL OR failed_from IN (
        'DISCOVERED', 'FETCH_QUEUED', 'FETCHED', 'EXTRACTED', 'NORMALIZED',
        'RESOLUTION_PENDING', 'RESOLVED', 'VALIDATED', 'PUBLISHED'
    )),
    -- FAILED carries retry metadata and the stage that failed; no other state does.
    CONSTRAINT ingestion_jobs_failed_shape CHECK (
        (state = 'FAILED' AND failed_from IS NOT NULL AND retry IS NOT NULL)
        OR (state <> 'FAILED' AND failed_from IS NULL AND retry IS NULL)
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS ingestion_jobs_idempotency_key
    ON ingestion_jobs (source_id, job_type, idempotency_key);
CREATE INDEX IF NOT EXISTS ingestion_jobs_queue_idx ON ingestion_jobs (state, updated_at);
CREATE INDEX IF NOT EXISTS ingestion_jobs_vertical_idx ON ingestion_jobs (vertical_id, state);
CREATE INDEX IF NOT EXISTS ingestion_jobs_source_idx ON ingestion_jobs (source_id, state);
CREATE INDEX IF NOT EXISTS ingestion_jobs_retry_due_idx
    ON ingestion_jobs ((retry ->> 'next_retry_at')) WHERE state = 'FAILED';

COMMENT ON TABLE ingestion_jobs IS
    'Durable, idempotent, resumable pipeline work. (source_id, job_type, idempotency_key) is the '
    'identity, so a retry after a crash rejoins the existing row instead of duplicating artifacts.';

CREATE TABLE IF NOT EXISTS ingestion_job_transitions (
    id          BIGSERIAL PRIMARY KEY,
    job_id      UUID        NOT NULL REFERENCES ingestion_jobs (id) ON DELETE CASCADE,
    from_state  TEXT            NULL,
    to_state    TEXT        NOT NULL,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    reason      TEXT            NULL,
    actor       TEXT            NULL,

    CONSTRAINT ingestion_job_transitions_from_allowed CHECK (from_state IS NULL OR from_state IN (
        'DISCOVERED', 'FETCH_QUEUED', 'FETCHED', 'EXTRACTED', 'NORMALIZED',
        'RESOLUTION_PENDING', 'RESOLVED', 'VALIDATED', 'PUBLISHED', 'FAILED'
    )),
    CONSTRAINT ingestion_job_transitions_to_allowed CHECK (to_state IN (
        'DISCOVERED', 'FETCH_QUEUED', 'FETCHED', 'EXTRACTED', 'NORMALIZED',
        'RESOLUTION_PENDING', 'RESOLVED', 'VALIDATED', 'PUBLISHED', 'FAILED'
    ))
);

CREATE INDEX IF NOT EXISTS ingestion_job_transitions_job_idx
    ON ingestion_job_transitions (job_id, occurred_at);

COMMENT ON TABLE ingestion_job_transitions IS
    'Append-only audit of every job state change. Failure is recorded, never silently dropped.';
