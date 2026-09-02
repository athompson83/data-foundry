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

CREATE UNIQUE INDEX rights_decision_activation_events_decision_idx
    ON rights_decision_activation_events (decision_id);

CREATE INDEX rights_terms_activation_events_version_idx
    ON rights_terms_activation_events (terms_version_id);
