-- 0028_audited_foreign_key_indexes.sql
--
-- Add only the four foreign-key access paths justified by the 2026-09-02
-- hosted advisor review. The remaining informational notices require actual
-- traffic evidence before adding write-amplifying indexes.

CREATE INDEX rights_cells_source_idx
    ON rights_cells (source_id)
    WHERE source_id IS NOT NULL;

CREATE INDEX rights_terms_cells_source_idx
    ON rights_terms_cells (source_id)
    WHERE source_id IS NOT NULL;

CREATE INDEX rights_terms_activation_events_version_idx
    ON rights_terms_activation_events (terms_version_id);

-- A repeated activation is immutable legal/rights provenance. Refuse an
-- unexpected historical duplicate explicitly; never guess which event to keep
-- or silently manufacture a clean history so the unique index can be added.
-- SHARE blocks activation writes only for this final check/index window.
LOCK TABLE rights_decision_activation_events IN SHARE MODE;

DO $$
BEGIN
    IF EXISTS (
        SELECT decision_id
          FROM rights_decision_activation_events
         GROUP BY decision_id
        HAVING count(*) > 1
    ) THEN
        RAISE EXCEPTION 'migration 0028 refuses duplicate rights decision activation history'
            USING ERRCODE = '55000';
    END IF;
END;
$$;

CREATE UNIQUE INDEX rights_decision_activation_events_decision_idx
    ON rights_decision_activation_events (decision_id);
