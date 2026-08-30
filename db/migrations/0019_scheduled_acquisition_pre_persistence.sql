-- Scheduled acquisition rights receipt contract v2.
--
-- Every row that predates this migration retains contract v1 and its three
-- successful checkpoints. The scheduler does not resume an existing duplicate
-- claim, so an in-flight v1 owner may finish under the contract it claimed.
-- Every row inserted after this migration is contract v2 and must prove a
-- fourth, post-transport PRE_PERSISTENCE authorization before either bytes or
-- NOT_MODIFIED freshness can be committed.

ALTER TABLE scheduled_acquisition_runs
    ADD COLUMN IF NOT EXISTS rights_receipt_contract_version SMALLINT NOT NULL DEFAULT 1;

ALTER TABLE scheduled_acquisition_runs
    ALTER COLUMN rights_receipt_contract_version SET DEFAULT 2;

CREATE OR REPLACE FUNCTION scheduled_acquisition_receipt_valid_for_contract(
    value JSONB,
    run_status TEXT,
    expected_scope_digest TEXT,
    claimed_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    contract_version SMALLINT
) RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
    checkpoint JSONB;
    normalized_checkpoint JSONB;
    checkpoint_index INTEGER := 0;
    checkpoint_count INTEGER;
    expected_stages TEXT[] := ARRAY[
        'INITIAL', 'PRE_PROVIDER', 'PRE_TRANSPORT', 'PRE_PERSISTENCE'
    ];
    evaluated_at TIMESTAMPTZ;
    previous_evaluated_at TIMESTAMPTZ := claimed_at;
    all_permitted BOOLEAN;
BEGIN
    IF contract_version = 1 THEN
        RETURN scheduled_acquisition_receipt_valid_for(
            value, run_status, expected_scope_digest, claimed_at, completed_at
        );
    END IF;
    IF contract_version IS DISTINCT FROM 2 OR jsonb_typeof(value) IS DISTINCT FROM 'array' THEN
        RETURN FALSE;
    END IF;

    checkpoint_count := jsonb_array_length(value);
    IF checkpoint_count > 4 THEN
        RETURN FALSE;
    END IF;
    IF run_status = 'CLAIMED' THEN
        RETURN checkpoint_count = 0;
    END IF;
    IF run_status NOT IN ('SUCCEEDED', 'SKIPPED', 'REFUSED', 'FAILED')
       OR completed_at IS NULL THEN
        RETURN FALSE;
    END IF;
    IF (run_status = 'SUCCEEDED' AND checkpoint_count <> 4)
       OR (run_status = 'SKIPPED' AND checkpoint_count <> 1)
       OR (run_status = 'REFUSED' AND checkpoint_count NOT BETWEEN 1 AND 4) THEN
        RETURN FALSE;
    END IF;

    FOR checkpoint IN SELECT item FROM jsonb_array_elements(value) item LOOP
        checkpoint_index := checkpoint_index + 1;
        -- Migration 0017's shape validator remains the v1 authority. Reuse its
        -- complete decision/provenance-shape checks for one checkpoint at a
        -- time, normalizing only the new stage name for that validation call.
        normalized_checkpoint := CASE
            WHEN checkpoint ->> 'stage' = 'PRE_PERSISTENCE'
              THEN jsonb_set(checkpoint, '{stage}', '"PRE_TRANSPORT"'::JSONB)
            ELSE checkpoint
        END;
        IF NOT scheduled_acquisition_receipt_valid(jsonb_build_array(normalized_checkpoint)) THEN
            RETURN FALSE;
        END IF;

        evaluated_at := (checkpoint ->> 'evaluatedAt')::TIMESTAMPTZ;
        SELECT bool_and((decision ->> 'permitted')::BOOLEAN)
          INTO all_permitted
          FROM jsonb_array_elements(checkpoint -> 'decisions') decision;
        IF checkpoint ->> 'stage' IS DISTINCT FROM expected_stages[checkpoint_index]
           OR checkpoint ->> 'scopeDigest' IS DISTINCT FROM expected_scope_digest
           OR evaluated_at < claimed_at
           OR evaluated_at > completed_at
           OR evaluated_at < previous_evaluated_at THEN
            RETURN FALSE;
        END IF;
        previous_evaluated_at := evaluated_at;

        IF run_status IN ('SUCCEEDED', 'FAILED') AND (
           checkpoint ->> 'basis' IS DISTINCT FROM 'ADMITTED' OR NOT all_permitted) THEN
            RETURN FALSE;
        ELSIF run_status = 'SKIPPED' AND (
           checkpoint ->> 'basis' IS DISTINCT FROM 'NOT_DUE' OR NOT all_permitted) THEN
            RETURN FALSE;
        ELSIF run_status = 'REFUSED' AND checkpoint_index < checkpoint_count AND (
           checkpoint ->> 'basis' IS DISTINCT FROM 'ADMITTED' OR NOT all_permitted) THEN
            RETURN FALSE;
        ELSIF run_status = 'REFUSED' AND checkpoint_index = checkpoint_count AND (
           checkpoint ->> 'basis' IS DISTINCT FROM 'RIGHTS_REFUSED' OR all_permitted) THEN
            RETURN FALSE;
        END IF;
    END LOOP;
    RETURN TRUE;
END;
$$;

ALTER TABLE scheduled_acquisition_runs
    DROP CONSTRAINT IF EXISTS scheduled_acquisition_runs_receipt_contract;

ALTER TABLE scheduled_acquisition_runs
    ADD CONSTRAINT scheduled_acquisition_runs_receipt_contract CHECK (
        scheduled_acquisition_receipt_valid_for_contract(
            rights_receipt,
            status,
            rights_scope_digest,
            claimed_at,
            completed_at,
            rights_receipt_contract_version
        )
    );

CREATE OR REPLACE FUNCTION scheduled_acquisition_receipt_contract_version_guard()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'INSERT' AND NEW.rights_receipt_contract_version IS DISTINCT FROM 2 THEN
        RAISE EXCEPTION 'new scheduled acquisition runs require rights receipt contract v2'
            USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'UPDATE'
       AND NEW.rights_receipt_contract_version IS DISTINCT FROM OLD.rights_receipt_contract_version THEN
        RAISE EXCEPTION 'scheduled acquisition rights receipt contract version is immutable'
            USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS scheduled_acquisition_receipt_contract_version_guard
    ON scheduled_acquisition_runs;
CREATE TRIGGER scheduled_acquisition_receipt_contract_version_guard
    BEFORE INSERT OR UPDATE ON scheduled_acquisition_runs
    FOR EACH ROW EXECUTE FUNCTION scheduled_acquisition_receipt_contract_version_guard();

COMMENT ON COLUMN scheduled_acquisition_runs.rights_receipt_contract_version IS
    'Immutable receipt contract: v1 pre-migration rows; v2 new four-checkpoint rows.';
