-- 0021_source_record_evidence_reconciliation.sql
--
-- A source_record_key identifies a logical source-native record. Its bytes
-- and locators may legitimately change on a later acquisition, but evidence
-- rows are immutable. Keep the previous revision and its lineage intact, and
-- make one newly-ingested revision current instead of mutating or deleting
-- evidence through an exception to the provenance guard.

ALTER TABLE source_records
    ADD COLUMN IF NOT EXISTS is_current BOOLEAN NOT NULL DEFAULT TRUE;

DROP INDEX IF EXISTS source_records_source_key_uniq;
CREATE UNIQUE INDEX IF NOT EXISTS source_records_current_source_key_uniq
    ON source_records (source_id, source_record_key)
    WHERE is_current;
CREATE INDEX IF NOT EXISTS source_records_current_lookup_idx
    ON source_records (source_id, source_record_key)
    WHERE is_current;

CREATE TABLE IF NOT EXISTS source_record_reconciliations (
    id                           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    superseded_source_record_id  UUID NOT NULL UNIQUE REFERENCES source_records (id) ON DELETE RESTRICT,
    replacement_source_record_id UUID NOT NULL UNIQUE REFERENCES source_records (id) ON DELETE RESTRICT,
    reconciled_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT source_record_reconciliations_distinct_ids
        CHECK (superseded_source_record_id <> replacement_source_record_id)
);

COMMENT ON COLUMN source_records.is_current IS
    'Exactly one current revision exists for each logical (source_id, source_record_key).';
COMMENT ON TABLE source_record_reconciliations IS
    'Append-only link from an immutable superseded source-record revision to its current replacement.';
