-- Recoverable, fenced execution leases for durable scheduled acquisition claims.
--
-- A Cron invocation has a 15-minute Cloudflare wall-time ceiling. A 20-minute
-- lease therefore cannot expire beneath a healthy scheduled invocation, while
-- an abandoned CLAIMED row becomes recoverable without creating a second run
-- ledger row. The opaque token fences terminal writes after a reclaim.

ALTER TABLE scheduled_acquisition_runs
    ADD COLUMN IF NOT EXISTS claim_token UUID;
ALTER TABLE scheduled_acquisition_runs
    ADD COLUMN IF NOT EXISTS claim_lease_acquired_at TIMESTAMPTZ;
ALTER TABLE scheduled_acquisition_runs
    ADD COLUMN IF NOT EXISTS claim_lease_expires_at TIMESTAMPTZ;
ALTER TABLE scheduled_acquisition_runs
    ADD COLUMN IF NOT EXISTS claim_attempt INTEGER NOT NULL DEFAULT 1;
ALTER TABLE scheduled_acquisition_runs
    ADD COLUMN IF NOT EXISTS last_released_attempt INTEGER;
ALTER TABLE scheduled_acquisition_runs
    ADD COLUMN IF NOT EXISTS last_claim_release_reason TEXT;
ALTER TABLE scheduled_acquisition_runs
    ADD COLUMN IF NOT EXISTS last_claim_released_at TIMESTAMPTZ;

-- Migration 0017 rejects every CLAIMED-to-CLAIMED update. Remove its update
-- trigger before backfilling active rows; this migration is transactional, and
-- the replacement trigger is installed below before these changes commit.
DROP TRIGGER IF EXISTS scheduled_acquisition_runs_terminal_immutable
    ON scheduled_acquisition_runs;

UPDATE scheduled_acquisition_runs
   SET claim_token = COALESCE(claim_token, gen_random_uuid()),
       claim_lease_acquired_at = COALESCE(
           claim_lease_acquired_at,
           CASE
               WHEN status = 'CLAIMED'
                   THEN GREATEST(statement_timestamp(), claimed_at)
               ELSE claimed_at
           END
       )
 WHERE claim_token IS NULL OR claim_lease_acquired_at IS NULL;

UPDATE scheduled_acquisition_runs
   SET claim_lease_expires_at = claim_lease_acquired_at + INTERVAL '20 minutes'
 WHERE claim_lease_expires_at IS NULL;

ALTER TABLE scheduled_acquisition_runs
    ALTER COLUMN claim_token SET DEFAULT gen_random_uuid();
ALTER TABLE scheduled_acquisition_runs
    ALTER COLUMN claim_token SET NOT NULL;
ALTER TABLE scheduled_acquisition_runs
    ALTER COLUMN claim_lease_acquired_at SET DEFAULT statement_timestamp();
ALTER TABLE scheduled_acquisition_runs
    ALTER COLUMN claim_lease_acquired_at SET NOT NULL;
ALTER TABLE scheduled_acquisition_runs
    ALTER COLUMN claim_lease_expires_at SET DEFAULT
        (statement_timestamp() + INTERVAL '20 minutes');
ALTER TABLE scheduled_acquisition_runs
    ALTER COLUMN claim_lease_expires_at SET NOT NULL;

ALTER TABLE scheduled_acquisition_runs
    DROP CONSTRAINT IF EXISTS scheduled_acquisition_runs_claim_lease_shape;
ALTER TABLE scheduled_acquisition_runs
    ADD CONSTRAINT scheduled_acquisition_runs_claim_lease_shape CHECK (
        claim_attempt >= 1
        AND claim_lease_acquired_at >= claimed_at
        AND claim_lease_expires_at >= claim_lease_acquired_at
        AND (
            (last_released_attempt IS NULL
             AND last_claim_release_reason IS NULL
             AND last_claim_released_at IS NULL)
            OR
            (last_released_attempt BETWEEN 1 AND claim_attempt
             AND last_claim_release_reason IN ('UNEXPECTED_ERROR', 'LEASE_EXPIRED')
             AND last_claim_released_at IS NOT NULL
             AND last_claim_released_at >= claimed_at)
        )
    );

ALTER TABLE scheduled_acquisition_runs
    DROP CONSTRAINT IF EXISTS scheduled_acquisition_runs_time_order;
ALTER TABLE scheduled_acquisition_runs
    ADD CONSTRAINT scheduled_acquisition_runs_time_order CHECK (
        (completed_at IS NULL OR completed_at >= claim_lease_acquired_at)
        AND (fresh_at IS NULL OR (
            completed_at IS NOT NULL
            AND fresh_at >= claim_lease_acquired_at
            AND fresh_at <= completed_at
        ))
    );

-- A reclaimed attempt must collect fresh checkpoints. Historical terminal
-- rows keep lease_acquired_at = claimed_at, preserving their v1/v2 receipts.
ALTER TABLE scheduled_acquisition_runs
    DROP CONSTRAINT IF EXISTS scheduled_acquisition_runs_receipt_contract;
ALTER TABLE scheduled_acquisition_runs
    ADD CONSTRAINT scheduled_acquisition_runs_receipt_contract CHECK (
        scheduled_acquisition_receipt_valid_for_contract(
            rights_receipt,
            status,
            rights_scope_digest,
            claim_lease_acquired_at,
            completed_at,
            rights_receipt_contract_version
        )
    );

CREATE INDEX IF NOT EXISTS scheduled_acquisition_runs_expired_claim_idx
    ON scheduled_acquisition_runs (claim_lease_expires_at, id)
    WHERE status = 'CLAIMED';

CREATE OR REPLACE FUNCTION scheduled_acquisition_run_insert_guard()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.status IS DISTINCT FROM 'CLAIMED'
       OR NEW.completed_at IS NOT NULL
       OR NEW.fresh_at IS NOT NULL
       OR NEW.outcome IS NOT NULL
       OR NEW.failure_code IS NOT NULL
       OR NEW.provider IS NOT NULL
       OR NEW.rights_receipt IS DISTINCT FROM '[]'::JSONB
       OR NEW.validators IS DISTINCT FROM '{}'::JSONB
       OR NEW.expected_artifact_count IS DISTINCT FROM 0
       OR NEW.artifact_count IS DISTINCT FROM 0
       OR NEW.claim_token IS NULL
       OR NEW.claim_attempt IS DISTINCT FROM 1
       OR NEW.claim_lease_acquired_at IS DISTINCT FROM NEW.claimed_at
       OR NEW.claim_lease_expires_at IS DISTINCT FROM
            NEW.claimed_at + INTERVAL '20 minutes'
       OR NEW.last_released_attempt IS NOT NULL
       OR NEW.last_claim_release_reason IS NOT NULL
       OR NEW.last_claim_released_at IS NOT NULL THEN
        RAISE EXCEPTION 'scheduled acquisition runs must be inserted as one exact empty leased CLAIMED attempt'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION scheduled_acquisition_claim_lease_guard()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
    release_transition BOOLEAN;
    reclaim_transition BOOLEAN;
BEGIN
    -- Terminalization must retain the exact owner metadata that it locked.
    IF OLD.status = 'CLAIMED' AND NEW.status <> 'CLAIMED' THEN
        IF NEW.claim_token IS DISTINCT FROM OLD.claim_token
           OR NEW.claim_lease_acquired_at IS DISTINCT FROM OLD.claim_lease_acquired_at
           OR NEW.claim_lease_expires_at IS DISTINCT FROM OLD.claim_lease_expires_at
           OR NEW.claim_attempt IS DISTINCT FROM OLD.claim_attempt
           OR NEW.last_released_attempt IS DISTINCT FROM OLD.last_released_attempt
           OR NEW.last_claim_release_reason IS DISTINCT FROM OLD.last_claim_release_reason
           OR NEW.last_claim_released_at IS DISTINCT FROM OLD.last_claim_released_at THEN
            RAISE EXCEPTION 'scheduled acquisition terminal write cannot change claim ownership'
                USING ERRCODE = '55000';
        END IF;
        IF NEW.completed_at IS NULL
           OR NEW.completed_at < OLD.claim_lease_acquired_at
           OR NEW.completed_at >= OLD.claim_lease_expires_at
           OR statement_timestamp() < OLD.claim_lease_acquired_at
           OR statement_timestamp() >= OLD.claim_lease_expires_at THEN
            RAISE EXCEPTION 'scheduled acquisition terminal write requires an unexpired claim lease'
                USING ERRCODE = '55000';
        END IF;
        RETURN NEW;
    END IF;

    IF OLD.status <> 'CLAIMED' OR NEW.status <> 'CLAIMED' THEN
        RETURN NEW;
    END IF;

    -- A CLAIMED-to-CLAIMED update may change only the lease metadata and, for
    -- a stale legacy owner, upgrade its still-empty receipt contract to v2.
    IF (
        to_jsonb(NEW)
          - 'claim_token'
          - 'claim_lease_acquired_at'
          - 'claim_lease_expires_at'
          - 'claim_attempt'
          - 'last_released_attempt'
          - 'last_claim_release_reason'
          - 'last_claim_released_at'
          - 'rights_receipt_contract_version'
          - 'rights_scope_digest'
       ) IS DISTINCT FROM (
        to_jsonb(OLD)
          - 'claim_token'
          - 'claim_lease_acquired_at'
          - 'claim_lease_expires_at'
          - 'claim_attempt'
          - 'last_released_attempt'
          - 'last_claim_release_reason'
          - 'last_claim_released_at'
          - 'rights_receipt_contract_version'
          - 'rights_scope_digest'
       ) THEN
        RAISE EXCEPTION 'scheduled acquisition claim identity and state are immutable'
            USING ERRCODE = '55000';
    END IF;

    release_transition :=
        NEW.claim_token IS NOT DISTINCT FROM OLD.claim_token
        AND NEW.claim_lease_acquired_at IS NOT DISTINCT FROM OLD.claim_lease_acquired_at
        AND NEW.claim_attempt IS NOT DISTINCT FROM OLD.claim_attempt
        AND NEW.claim_lease_expires_at = NEW.last_claim_released_at
        AND NEW.claim_lease_expires_at = statement_timestamp()
        AND NEW.claim_lease_expires_at >= OLD.claim_lease_acquired_at
        AND NEW.claim_lease_expires_at <= OLD.claim_lease_expires_at
        AND NEW.last_released_attempt = OLD.claim_attempt
        AND NEW.last_claim_release_reason = 'UNEXPECTED_ERROR'
        AND OLD.last_released_attempt IS DISTINCT FROM OLD.claim_attempt
        AND NEW.rights_receipt_contract_version IS NOT DISTINCT FROM
            OLD.rights_receipt_contract_version;

    reclaim_transition :=
        NEW.claim_token IS DISTINCT FROM OLD.claim_token
        AND NEW.claim_attempt = OLD.claim_attempt + 1
        AND OLD.claim_lease_expires_at <= statement_timestamp()
        AND NEW.claim_lease_acquired_at = statement_timestamp()
        AND NEW.claim_lease_acquired_at >= OLD.claim_lease_expires_at
        AND NEW.claim_lease_expires_at =
            NEW.claim_lease_acquired_at + INTERVAL '20 minutes'
        AND NEW.last_released_attempt = OLD.claim_attempt
        AND (
            (OLD.last_released_attempt = OLD.claim_attempt
             AND NEW.last_claim_release_reason IS NOT DISTINCT FROM
                 OLD.last_claim_release_reason
             AND NEW.last_claim_released_at IS NOT DISTINCT FROM
                 OLD.last_claim_released_at)
            OR
            (OLD.last_released_attempt IS DISTINCT FROM OLD.claim_attempt
             AND NEW.last_claim_release_reason = 'LEASE_EXPIRED'
             AND NEW.last_claim_released_at = OLD.claim_lease_expires_at)
        )
        AND (
            NEW.rights_receipt_contract_version IS NOT DISTINCT FROM
                OLD.rights_receipt_contract_version
            OR (
                OLD.rights_receipt_contract_version = 1
                AND NEW.rights_receipt_contract_version = 2
                AND OLD.rights_receipt = '[]'::JSONB
            )
        );

    IF NOT release_transition AND NOT reclaim_transition THEN
        RAISE EXCEPTION 'scheduled acquisition CLAIMED row requires a valid release or expired-lease reclaim'
            USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS scheduled_acquisition_claim_lease_guard
    ON scheduled_acquisition_runs;
CREATE TRIGGER scheduled_acquisition_claim_lease_guard
    BEFORE UPDATE ON scheduled_acquisition_runs
    FOR EACH ROW EXECUTE FUNCTION scheduled_acquisition_claim_lease_guard();

-- Migration 0017 rejected every CLAIMED-to-CLAIMED update. Retain that guard
-- for terminal transitions and terminal immutability; lease-only transitions
-- are now governed by the stricter lease trigger above.
CREATE TRIGGER scheduled_acquisition_runs_terminal_immutable
    BEFORE UPDATE ON scheduled_acquisition_runs
    FOR EACH ROW
    WHEN (NOT (OLD.status = 'CLAIMED' AND NEW.status = 'CLAIMED'))
    EXECUTE FUNCTION scheduled_acquisition_run_terminal_guard();

DROP TRIGGER IF EXISTS scheduled_acquisition_runs_delete_immutable
    ON scheduled_acquisition_runs;
CREATE TRIGGER scheduled_acquisition_runs_delete_immutable
    BEFORE DELETE ON scheduled_acquisition_runs
    FOR EACH ROW EXECUTE FUNCTION scheduled_acquisition_run_terminal_guard();

CREATE OR REPLACE FUNCTION scheduled_acquisition_receipt_contract_version_guard()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'INSERT' AND NEW.rights_receipt_contract_version IS DISTINCT FROM 2 THEN
        RAISE EXCEPTION 'new scheduled acquisition runs require rights receipt contract v2'
            USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'UPDATE'
       AND NEW.rights_receipt_contract_version IS DISTINCT FROM OLD.rights_receipt_contract_version
       AND NOT (
           OLD.status = 'CLAIMED'
           AND NEW.status = 'CLAIMED'
           AND OLD.rights_receipt_contract_version = 1
           AND NEW.rights_receipt_contract_version = 2
           AND OLD.rights_receipt = '[]'::JSONB
           AND NEW.claim_token IS DISTINCT FROM OLD.claim_token
           AND NEW.claim_attempt = OLD.claim_attempt + 1
           AND NEW.claim_lease_acquired_at >= OLD.claim_lease_expires_at
       ) THEN
        RAISE EXCEPTION 'scheduled acquisition rights receipt contract version is immutable'
            USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
END;
$$;

COMMENT ON COLUMN scheduled_acquisition_runs.claim_token IS
    'Opaque fencing token for the one execution attempt currently allowed to terminalize this run.';
COMMENT ON COLUMN scheduled_acquisition_runs.claim_lease_expires_at IS
    'Recovery deadline, 20 minutes after acquisition: longer than the 15-minute Cron wall-time ceiling.';
COMMENT ON COLUMN scheduled_acquisition_runs.claim_attempt IS
    'Monotone execution-attempt counter on the one logical slot audit row.';
