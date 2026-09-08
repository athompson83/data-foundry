-- 0033_not_modified_claim_boundary.sql
--
-- A delayed conditional response is evidence only for the artifact baseline
-- that existed when its leased acquisition began. Reassert that invariant at
-- the database terminal boundary as well as in the application completion path.

CREATE OR REPLACE FUNCTION scheduled_acquisition_run_terminal_guard()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
    linked_count INTEGER;
    wrong_provider_count INTEGER;
    invalid_target_count INTEGER;
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
       OR NEW.result_url_policy IS DISTINCT FROM OLD.result_url_policy
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
        IF NOT scheduled_acquisition_receipt_provenance_valid(
            NEW.rights_receipt,
            OLD.source_id,
            OLD.acquisition_route,
            OLD.account_or_product_plan,
            OLD.acquisition_jurisdiction,
            OLD.asset_class,
            OLD.output_class,
            NEW.status = 'SUCCEEDED',
            NEW.completed_at
        ) THEN
            RAISE EXCEPTION 'scheduled acquisition affirmative receipt provenance is not current and exact'
                USING ERRCODE = '23514';
        END IF;
        SELECT count(*)::integer,
               count(*) FILTER (
                 WHERE link.acquisition_provider IS DISTINCT FROM NEW.provider
               )::integer,
               count(*) FILTER (
                 WHERE artifact.source_id IS DISTINCT FROM OLD.source_id
                    OR artifact.acquisition_route IS DISTINCT FROM OLD.acquisition_route
                    OR artifact.account_or_product_plan IS DISTINCT FROM OLD.account_or_product_plan
                    OR artifact.acquisition_jurisdiction IS DISTINCT FROM OLD.acquisition_jurisdiction
                    OR link.target_url IS DISTINCT FROM OLD.target_url
                    OR link.result_url IS DISTINCT FROM artifact.url
                    OR NOT scheduled_acquisition_result_url_allowed(
                        OLD.target_url, OLD.acquisition_route, OLD.result_url_policy,
                        link.result_url, link.result_relation
                    )
               )::integer
          INTO linked_count, wrong_provider_count, invalid_target_count
          FROM scheduled_acquisition_run_artifacts link
          JOIN source_artifacts artifact ON artifact.id = link.artifact_id
         WHERE link.run_id = OLD.id;
        IF linked_count <> NEW.artifact_count THEN
            RAISE EXCEPTION 'scheduled acquisition terminal artifact count does not match linked artifacts'
                USING ERRCODE = '23514';
        END IF;
        IF NEW.status = 'SUCCEEDED' AND wrong_provider_count <> 0 THEN
            RAISE EXCEPTION 'scheduled acquisition retrieval provider does not match the completion provider'
                USING ERRCODE = '23514';
        END IF;
        IF NEW.status = 'SUCCEEDED' AND invalid_target_count <> 0 THEN
            RAISE EXCEPTION 'scheduled acquisition terminal artifact scope or target policy is invalid'
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
               AND prior.result_url_policy = OLD.result_url_policy
               AND prior.status = 'SUCCEEDED'
               AND prior.outcome = 'FETCHED'
               AND prior.completed_at <= OLD.claim_lease_acquired_at
               AND prior.fresh_at <= OLD.claim_lease_acquired_at
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

ALTER FUNCTION scheduled_acquisition_run_terminal_guard() SET search_path FROM CURRENT;

COMMENT ON FUNCTION scheduled_acquisition_run_terminal_guard() IS
    'Makes terminal acquisition state immutable and permits NOT_MODIFIED only when an exact artifact-backed FETCHED baseline completed and became fresh before the claim began.';
