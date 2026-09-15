-- Audit control-plane interventions without retaining arbitrary exception text,
-- customer lookup targets, credentials, or copies of customer contact details.
CREATE TABLE IF NOT EXISTS operator_actions (
    request_id uuid PRIMARY KEY,
    action text NOT NULL CHECK (action IN ('PAUSE_SOURCE', 'RESUME_SOURCE', 'REPLAY_DELIVERY', 'RETIRE_DELIVERY', 'BACKFILL_RUN', 'RETRACT_FACT', 'REVOKE_KEY', 'CLOSE_ACCOUNT')),
    target_id uuid NOT NULL,
    actor_ref text NOT NULL CHECK (actor_ref ~ '^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,63}$'),
    reason_code text NOT NULL CHECK (reason_code IN ('INCIDENT', 'RECOVERY', 'CORRECTION', 'CUSTOMER_REQUEST', 'PLANNED_MAINTENANCE')),
    runtime_digest text CHECK (runtime_digest ~ '^[0-9a-f]{64}$'),
    occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    affected_rows integer NOT NULL CHECK (affected_rows >= 0),
    result_id uuid,
    CHECK ((action = 'BACKFILL_RUN') = (runtime_digest IS NOT NULL)),
    CHECK (action <> 'RETIRE_DELIVERY' OR (result_id IS NOT NULL AND result_id <> target_id))
);
CREATE INDEX IF NOT EXISTS operator_actions_target_idx ON operator_actions (target_id, occurred_at);

CREATE OR REPLACE FUNCTION operator_actions_reject_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'operator action history is immutable';
END;
$$;
ALTER FUNCTION operator_actions_reject_mutation() SET search_path FROM CURRENT;
DROP TRIGGER IF EXISTS operator_actions_immutable ON operator_actions;
CREATE TRIGGER operator_actions_immutable BEFORE UPDATE OR DELETE ON operator_actions
    FOR EACH ROW EXECUTE FUNCTION operator_actions_reject_mutation();

-- TRUNCATE does not invoke row triggers; protect history from bulk erasure too.
DROP TRIGGER IF EXISTS operator_actions_immutable_truncate ON operator_actions;
CREATE TRIGGER operator_actions_immutable_truncate BEFORE TRUNCATE ON operator_actions
    FOR EACH STATEMENT EXECUTE FUNCTION operator_actions_reject_mutation();
