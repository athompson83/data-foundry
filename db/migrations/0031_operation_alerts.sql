-- Closed operational counts only. Recipient/sender configuration, provider
-- response text, source payloads, and customer identifiers never enter these rows.
CREATE TABLE IF NOT EXISTS operation_incidents (
    vertical_slug text NOT NULL REFERENCES verticals (slug) ON DELETE RESTRICT,
    code text NOT NULL CHECK (code IN (
        'ACQUISITION_FAILURE', 'OUTBOX_AGE', 'PUBLICATION_LAG', 'FAILED_JOBS', 'RIGHTS_EXPIRY'
    )),
    active boolean NOT NULL,
    generation integer NOT NULL DEFAULT 0 CHECK (generation >= 0),
    observed_count integer NOT NULL CHECK (observed_count BETWEEN 0 AND 1000000),
    observed_at timestamptz NOT NULL,
    PRIMARY KEY (vertical_slug, code),
    CHECK (active = (observed_count > 0))
);

CREATE TABLE IF NOT EXISTS operation_alert_deliveries (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    vertical_slug text NOT NULL,
    code text NOT NULL,
    generation integer NOT NULL CHECK (generation > 0),
    transition text NOT NULL CHECK (transition IN ('FAILURE', 'RECOVERY')),
    observed_count integer NOT NULL CHECK (observed_count BETWEEN 0 AND 1000000),
    observed_at timestamptz NOT NULL,
    status text NOT NULL DEFAULT 'PENDING' CHECK (status IN (
        'PENDING', 'SENDING', 'ACCEPTED', 'FAILED', 'UNKNOWN', 'CANCELLED'
    )),
    claim_token uuid,
    attempted_at timestamptz,
    accepted_at timestamptz,
    failure_code text CHECK (failure_code IN ('PROVIDER_REFUSED', 'PROVIDER_OUTCOME_UNKNOWN')),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (vertical_slug, code) REFERENCES operation_incidents (vertical_slug, code) ON DELETE RESTRICT,
    UNIQUE (vertical_slug, code, generation),
    CHECK ((transition = 'FAILURE') = (observed_count > 0)),
    CHECK ((status IN ('SENDING', 'ACCEPTED', 'FAILED', 'UNKNOWN')) = (attempted_at IS NOT NULL)),
    CHECK ((status = 'SENDING') = (claim_token IS NOT NULL)),
    CHECK ((status = 'ACCEPTED') = (accepted_at IS NOT NULL)),
    CHECK ((status IN ('FAILED', 'UNKNOWN')) = (failure_code IS NOT NULL)),
    CHECK (accepted_at IS NULL OR accepted_at >= attempted_at)
);
CREATE INDEX IF NOT EXISTS operation_alert_deliveries_pending_idx
    ON operation_alert_deliveries (vertical_slug, created_at) WHERE status = 'PENDING';
CREATE INDEX IF NOT EXISTS operation_alert_deliveries_sending_idx
    ON operation_alert_deliveries (vertical_slug, attempted_at) WHERE status = 'SENDING';

-- The health snapshot examines the newest substantive acquisition for each
-- registered target; polling schedules which merely say NOT_DUE are excluded.
CREATE INDEX IF NOT EXISTS scheduled_acquisition_runs_operations_latest_idx
    ON scheduled_acquisition_runs (vertical_slug, source_id, target_id, scheduled_for DESC, created_at DESC)
    WHERE status <> 'SKIPPED';
