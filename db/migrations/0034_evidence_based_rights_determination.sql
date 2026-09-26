-- 0034_evidence_based_rights_determination.sql
--
-- ADR-0013: a committed, evidence-based rights determination may approve and
-- activate rights decisions and controlling terms, alongside HUMAN and COUNSEL
-- review. AUTOMATED assessments still cannot activate ALLOW/CONDITIONAL, and
-- deny exceptions (the only path that can narrow a sticky DENY) stay limited
-- to HUMAN and COUNSEL.
--
-- The three functions below are the 0014/0017 bodies with only the accepted
-- reviewer set widened. Each is re-pinned to the canonical search_path exactly
-- as 0027 did, because CREATE OR REPLACE clears function-level settings.

ALTER TABLE rights_terms_activation_events
    DROP CONSTRAINT IF EXISTS rights_terms_activation_actor_type_allowed;
ALTER TABLE rights_terms_activation_events
    ADD CONSTRAINT rights_terms_activation_actor_type_allowed
    CHECK (actor_type IN ('AUTOMATED', 'HUMAN', 'COUNSEL', 'DETERMINATION'));

ALTER TABLE rights_decisions
    DROP CONSTRAINT IF EXISTS rights_decisions_reviewer_type_allowed;
ALTER TABLE rights_decisions
    ADD CONSTRAINT rights_decisions_reviewer_type_allowed
    CHECK (reviewer_type IN ('AUTOMATED', 'HUMAN', 'COUNSEL', 'DETERMINATION'));

ALTER TABLE rights_decision_activation_events
    DROP CONSTRAINT IF EXISTS rights_decision_activation_actor_type_allowed;
ALTER TABLE rights_decision_activation_events
    ADD CONSTRAINT rights_decision_activation_actor_type_allowed
    CHECK (actor_type IN ('AUTOMATED', 'HUMAN', 'COUNSEL', 'DETERMINATION'));

ALTER TABLE sources
    DROP CONSTRAINT IF EXISTS sources_rights_publisher_mapping_complete;
ALTER TABLE sources
    ADD CONSTRAINT sources_rights_publisher_mapping_complete CHECK (
        (rights_publisher_id IS NULL AND
         rights_publisher_mapping_evidence_artifact_id IS NULL AND
         rights_publisher_mapping_reviewer_type IS NULL AND
         rights_publisher_mapping_reviewed_by IS NULL AND
         rights_publisher_mapping_reviewed_at IS NULL)
        OR
        (rights_publisher_id IS NOT NULL AND
         rights_publisher_mapping_evidence_artifact_id IS NOT NULL AND
         rights_publisher_mapping_reviewer_type IN ('HUMAN', 'COUNSEL', 'DETERMINATION') AND
         rights_publisher_mapping_reviewed_by IS NOT NULL AND
         btrim(rights_publisher_mapping_reviewed_by) <> '' AND
         rights_publisher_mapping_reviewed_at IS NOT NULL)
    );

CREATE OR REPLACE FUNCTION rights_prepare_terms_activation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    selected_version rights_terms_versions%ROWTYPE;
    prior_event rights_terms_activation_events%ROWTYPE;
BEGIN
    SELECT * INTO selected_version
      FROM rights_terms_versions WHERE id = NEW.terms_version_id;
    IF selected_version.id IS NULL OR selected_version.terms_cell_id IS DISTINCT FROM NEW.terms_cell_id THEN
        RAISE EXCEPTION 'terms activation must name the version''s exact cell'
            USING ERRCODE = '23514';
    END IF;
    PERFORM id FROM rights_terms_cells WHERE id = NEW.terms_cell_id FOR UPDATE;
    IF NEW.occurred_at > clock_timestamp() THEN
        RAISE EXCEPTION 'rights terms activation cannot be future-dated'
            USING ERRCODE = '23514';
    END IF;
    SELECT * INTO prior_event
      FROM rights_terms_activation_events
     WHERE terms_cell_id = NEW.terms_cell_id
     ORDER BY sequence_no DESC LIMIT 1;
    IF prior_event.id IS NOT NULL AND NEW.occurred_at <= prior_event.occurred_at THEN
        RAISE EXCEPTION 'rights terms activation history must move forward in time'
            USING ERRCODE = '23514';
    END IF;
    IF NEW.state = 'ACTIVE' THEN
        IF NEW.actor_type NOT IN ('HUMAN', 'COUNSEL', 'DETERMINATION') THEN
            RAISE EXCEPTION 'only a human, counsel or evidence-based determination may activate controlling terms'
                USING ERRCODE = '23514';
        END IF;
        IF EXISTS (
            SELECT 1 FROM rights_terms_activation_events
             WHERE terms_version_id = NEW.terms_version_id
        ) THEN
            RAISE EXCEPTION 'a terms version is activated at most once; revocation is terminal'
                USING ERRCODE = '23514';
        END IF;
        IF prior_event.id IS NULL THEN
            IF selected_version.supersedes_terms_version_id IS NOT NULL THEN
                RAISE EXCEPTION 'the first active terms version cannot supersede an absent current version'
                    USING ERRCODE = '23514';
            END IF;
        ELSIF selected_version.supersedes_terms_version_id IS DISTINCT FROM prior_event.terms_version_id THEN
            RAISE EXCEPTION 'new active terms must explicitly supersede the prior current version'
                USING ERRCODE = '23514';
        END IF;
    ELSE
        IF prior_event.id IS NULL OR prior_event.state <> 'ACTIVE' OR
           prior_event.terms_version_id IS DISTINCT FROM NEW.terms_version_id THEN
            RAISE EXCEPTION 'revocation must target the exact current active terms version'
                USING ERRCODE = '23514';
        END IF;
    END IF;
    SELECT COALESCE(max(sequence_no), 0) + 1 INTO NEW.sequence_no
      FROM rights_terms_activation_events WHERE terms_cell_id = NEW.terms_cell_id;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION rights_prepare_decision_activation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    selected_decision rights_decisions%ROWTYPE;
    selected_terms rights_terms_versions%ROWTYPE;
    current_terms_record RECORD;
    prior_event rights_decision_activation_events%ROWTYPE;
    condition_count BIGINT;
BEGIN
    SELECT * INTO selected_decision FROM rights_decisions WHERE id = NEW.decision_id;
    IF selected_decision.id IS NULL OR selected_decision.cell_id IS DISTINCT FROM NEW.cell_id THEN
        RAISE EXCEPTION 'decision activation must name the decision''s exact cell'
            USING ERRCODE = '23514';
    END IF;

    PERFORM id FROM rights_cells WHERE id = NEW.cell_id FOR UPDATE;
    IF NEW.occurred_at > clock_timestamp() THEN
        RAISE EXCEPTION 'rights decision activation cannot be future-dated'
            USING ERRCODE = '23514';
    END IF;
    IF EXISTS (
        SELECT 1 FROM rights_decision_activation_events
         WHERE decision_id = NEW.decision_id
    ) THEN
        RAISE EXCEPTION 'a rights decision version may be activated only once'
            USING ERRCODE = '23514';
    END IF;
    SELECT * INTO prior_event
      FROM rights_decision_activation_events
     WHERE cell_id = NEW.cell_id ORDER BY sequence_no DESC LIMIT 1;
    IF prior_event.id IS NOT NULL AND NEW.occurred_at <= prior_event.occurred_at THEN
        RAISE EXCEPTION 'rights decision activation history must move forward in time'
            USING ERRCODE = '23514';
    END IF;
    IF prior_event.id IS NULL THEN
        IF selected_decision.supersedes_decision_id IS NOT NULL THEN
            RAISE EXCEPTION 'the first active decision in a cell cannot supersede an absent current decision'
                USING ERRCODE = '23514';
        END IF;
    ELSIF selected_decision.supersedes_decision_id IS DISTINCT FROM prior_event.decision_id THEN
        RAISE EXCEPTION 'new current decision must explicitly supersede the prior current decision'
            USING ERRCODE = '23514';
    END IF;

    IF selected_decision.state IN ('ALLOW', 'CONDITIONAL') THEN
        IF NEW.actor_type NOT IN ('HUMAN', 'COUNSEL', 'DETERMINATION') OR
           selected_decision.reviewer_type NOT IN ('HUMAN', 'COUNSEL', 'DETERMINATION') OR
           NEW.actor_type IS DISTINCT FROM selected_decision.reviewer_type OR
           NEW.actor IS DISTINCT FROM selected_decision.reviewed_by OR
           selected_decision.review_status <> 'APPROVED' OR
           selected_decision.reviewed_at > NEW.occurred_at OR
           selected_decision.effective_from IS NULL OR
           selected_decision.effective_from > NEW.occurred_at OR
           (selected_decision.effective_until IS NOT NULL AND
            selected_decision.effective_until <= NEW.occurred_at) OR
           selected_decision.recheck_at IS NULL OR
           selected_decision.recheck_at <= NEW.occurred_at THEN
            RAISE EXCEPTION 'ALLOW/CONDITIONAL requires current approved review (human, counsel or evidence-based determination) and review dates'
                USING ERRCODE = '23514';
        END IF;

        SELECT * INTO selected_terms
          FROM rights_terms_versions WHERE id = selected_decision.controlling_terms_version_id;
        SELECT * INTO current_terms_record
          FROM current_rights_terms WHERE terms_cell_id = selected_terms.terms_cell_id;
        IF selected_terms.id IS NULL OR
           current_terms_record.terms_version_id IS DISTINCT FROM selected_terms.id OR
           current_terms_record.state IS DISTINCT FROM 'ACTIVE' OR
           selected_terms.effective_from > NEW.occurred_at OR
           (selected_terms.effective_until IS NOT NULL AND
            selected_terms.effective_until <= NEW.occurred_at) OR
           selected_terms.recheck_at <= NEW.occurred_at OR
           NOT rights_terms_cover_cell(selected_terms.id, NEW.cell_id) THEN
            RAISE EXCEPTION 'permission is not bound to the exact current effective terms scope'
                USING ERRCODE = '23514';
        END IF;

        SELECT count(*) INTO condition_count
          FROM rights_decision_conditions WHERE decision_id = selected_decision.id;
        IF selected_decision.state = 'CONDITIONAL' AND condition_count = 0 THEN
            RAISE EXCEPTION 'CONDITIONAL cannot activate without structured conditions'
                USING ERRCODE = '23514';
        END IF;
    END IF;

    SELECT COALESCE(max(sequence_no), 0) + 1 INTO NEW.sequence_no
      FROM rights_decision_activation_events WHERE cell_id = NEW.cell_id;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION scheduled_acquisition_receipt_provenance_valid(
    value JSONB,
    run_source_id UUID,
    run_acquisition_route TEXT,
    run_account_or_product_plan TEXT,
    run_jurisdiction TEXT,
    run_asset_class TEXT,
    run_output_class TEXT,
    require_current_permission BOOLEAN,
    terminal_at TIMESTAMPTZ
) RETURNS BOOLEAN LANGUAGE plpgsql AS $$
DECLARE
    checkpoint JSONB;
    decision_receipt JSONB;
    evaluated_at TIMESTAMPTZ;
    provenance_valid BOOLEAN;
BEGIN
    IF require_current_permission AND NOT EXISTS (
        SELECT 1
          FROM sources source
          JOIN rights_publishers publisher ON publisher.id = source.rights_publisher_id
         WHERE source.id = run_source_id
           AND source.status = 'ACTIVE'
           AND source.kill_switch_engaged IS FALSE
           AND source.rights_classification NOT IN ('RED', 'UNREVIEWED')
           AND publisher.status NOT IN ('PROHIBITED', 'RETIRED')
    ) THEN
        RETURN FALSE;
    END IF;
    FOR checkpoint IN SELECT item FROM jsonb_array_elements(value) item LOOP
        evaluated_at := (checkpoint ->> 'evaluatedAt')::TIMESTAMPTZ;
        FOR decision_receipt IN
            SELECT item FROM jsonb_array_elements(checkpoint -> 'decisions') item
        LOOP
            IF (decision_receipt ->> 'permitted')::BOOLEAN THEN
                -- Current scheduler admission supplies no durable condition
                -- receipts, so CONDITIONAL_ALLOW cannot be audited and fails closed.
                IF decision_receipt ->> 'state' IS DISTINCT FROM 'ALLOW'
                   OR decision_receipt ->> 'reasonCode' IS DISTINCT FROM 'ALLOW' THEN
                    RETURN FALSE;
                END IF;
                SELECT EXISTS (
                    SELECT 1
                      FROM rights_cells cell
                      JOIN rights_decisions rights_decision
                        ON rights_decision.id = (decision_receipt ->> 'decisionId')::UUID
                       AND rights_decision.cell_id = cell.id
                      JOIN rights_terms_versions terms
                        ON terms.id = (decision_receipt ->> 'termsVersionId')::UUID
                       AND rights_decision.controlling_terms_version_id = terms.id
                     WHERE cell.id = (decision_receipt ->> 'cellId')::UUID
                       AND cell.source_id = run_source_id
                       AND cell.publisher_id IS NULL
                       AND cell.acquisition_route IS NOT DISTINCT FROM run_acquisition_route
                       AND cell.account_or_product_plan IS NOT DISTINCT FROM run_account_or_product_plan
                       AND cell.jurisdiction IS NOT DISTINCT FROM run_jurisdiction
                       AND cell.asset_class IS NOT DISTINCT FROM run_asset_class
                       AND cell.output_class IS NOT DISTINCT FROM run_output_class
                       AND cell.field_key IS NULL
                       AND cell.field_group_id IS NULL
                       AND cell.operation IS NOT DISTINCT FROM decision_receipt ->> 'operation'
                       AND cell.channel = 'INTERNAL_PROCESSING'
                       AND rights_decision.state = 'ALLOW'
                       AND rights_decision.review_status = 'APPROVED'
                       AND rights_decision.reviewer_type IN ('HUMAN', 'COUNSEL', 'DETERMINATION')
                       AND rights_decision.reviewed_by IS NOT NULL
                       AND rights_decision.reviewed_at <= evaluated_at
                       AND rights_decision.effective_from <= evaluated_at
                       AND (rights_decision.effective_until IS NULL
                            OR rights_decision.effective_until > evaluated_at)
                       AND rights_decision.recheck_at > evaluated_at
                       AND NOT EXISTS (
                           SELECT 1 FROM rights_decision_conditions condition
                            WHERE condition.decision_id = rights_decision.id
                       )
                       AND EXISTS (
                           SELECT 1
                             FROM rights_decision_activation_events activation
                            WHERE activation.cell_id = cell.id
                              AND activation.decision_id = rights_decision.id
                              AND activation.occurred_at <= evaluated_at
                              AND activation.actor_type = rights_decision.reviewer_type
                              AND activation.actor = rights_decision.reviewed_by
                              AND NOT EXISTS (
                                  SELECT 1 FROM rights_decision_activation_events later
                                   WHERE later.cell_id = activation.cell_id
                                     AND later.occurred_at <= evaluated_at
                                     AND later.sequence_no > activation.sequence_no
                              )
                       )
                       AND (
                           NOT require_current_permission OR EXISTS (
                               SELECT 1
                                 FROM rights_decision_activation_events activation
                                WHERE activation.cell_id = cell.id
                                  AND activation.decision_id = rights_decision.id
                                  AND activation.occurred_at <= terminal_at
                                  AND NOT EXISTS (
                                      SELECT 1 FROM rights_decision_activation_events later
                                       WHERE later.cell_id = activation.cell_id
                                         AND later.occurred_at <= terminal_at
                                         AND later.sequence_no > activation.sequence_no
                                  )
                           )
                       )
                       AND terms.effective_from <= evaluated_at
                       AND (terms.effective_until IS NULL OR terms.effective_until > evaluated_at)
                       AND terms.recheck_at > evaluated_at
                       AND rights_terms_cover_cell(terms.id, cell.id)
                       AND EXISTS (
                           SELECT 1
                             FROM rights_terms_activation_events activation
                            WHERE activation.terms_cell_id = terms.terms_cell_id
                              AND activation.terms_version_id = terms.id
                              AND activation.state = 'ACTIVE'
                              AND activation.actor_type IN ('HUMAN', 'COUNSEL', 'DETERMINATION')
                              AND activation.occurred_at <= evaluated_at
                              AND NOT EXISTS (
                                  SELECT 1 FROM rights_terms_activation_events later
                                   WHERE later.terms_cell_id = activation.terms_cell_id
                                     AND later.occurred_at <= evaluated_at
                                     AND later.sequence_no > activation.sequence_no
                              )
                       )
                       AND (
                           NOT require_current_permission OR (
                               rights_decision.effective_from <= terminal_at
                               AND (rights_decision.effective_until IS NULL
                                    OR rights_decision.effective_until > terminal_at)
                               AND rights_decision.recheck_at > terminal_at
                               AND terms.effective_from <= terminal_at
                               AND (terms.effective_until IS NULL OR terms.effective_until > terminal_at)
                               AND terms.recheck_at > terminal_at
                               AND EXISTS (
                                   SELECT 1
                                     FROM rights_terms_activation_events activation
                                    WHERE activation.terms_cell_id = terms.terms_cell_id
                                      AND activation.terms_version_id = terms.id
                                      AND activation.state = 'ACTIVE'
                                      AND activation.occurred_at <= terminal_at
                                      AND NOT EXISTS (
                                          SELECT 1 FROM rights_terms_activation_events later
                                           WHERE later.terms_cell_id = activation.terms_cell_id
                                             AND later.occurred_at <= terminal_at
                                             AND later.sequence_no > activation.sequence_no
                                      )
                               )
                           )
                       )
                ) INTO provenance_valid;
                IF NOT provenance_valid THEN RETURN FALSE; END IF;
            END IF;
        END LOOP;
    END LOOP;
    RETURN TRUE;
END;
$$;

ALTER FUNCTION rights_prepare_terms_activation() SET search_path FROM CURRENT;
ALTER FUNCTION rights_prepare_decision_activation() SET search_path FROM CURRENT;
ALTER FUNCTION scheduled_acquisition_receipt_provenance_valid(jsonb, uuid, text, text, text, text, text, boolean, timestamp with time zone) SET search_path FROM CURRENT;
