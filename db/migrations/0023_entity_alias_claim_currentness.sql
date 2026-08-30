-- 0023_entity_alias_claim_currentness.sql
--
-- `entity_aliases.source_id` is display/provenance metadata on a shared exact-
-- identifier row. It is not evidence that the source still asserts the alias.
-- Record each assertion independently and derive the resolution/search index
-- from current claims instead of leaving stale source aliases active forever.

CREATE TABLE IF NOT EXISTS entity_alias_claims (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_alias_id   UUID        NOT NULL REFERENCES entity_aliases (id) ON DELETE RESTRICT,
    asserted_alias_value TEXT     NOT NULL,
    identity_confidence DOUBLE PRECISION NOT NULL,
    claim_kind        TEXT        NOT NULL,
    source_record_id  UUID            NULL REFERENCES source_records (id) ON DELETE RESTRICT,
    locator_type      TEXT            NULL,
    locator_value     TEXT            NULL,
    valid_to          TIMESTAMPTZ     NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT entity_alias_claims_kind_allowed
        CHECK (claim_kind IN ('CURATED', 'SOURCE_RECORD')),
    CONSTRAINT entity_alias_claims_asserted_alias_value_length
        CHECK (char_length(asserted_alias_value) BETWEEN 1 AND 500),
    CONSTRAINT entity_alias_claims_identity_confidence_range
        CHECK (identity_confidence >= 0 AND identity_confidence <= 1),
    CONSTRAINT entity_alias_claims_shape_valid CHECK (
        (
            claim_kind = 'CURATED' AND
            source_record_id IS NULL AND
            locator_type IS NULL AND
            locator_value IS NULL
        ) OR (
            claim_kind = 'SOURCE_RECORD' AND
            source_record_id IS NOT NULL AND
            locator_type IS NOT NULL AND
            locator_value IS NOT NULL AND
            valid_to IS NULL
        )
    ),
    CONSTRAINT entity_alias_claims_locator_type_allowed CHECK (
        locator_type IS NULL OR locator_type IN (
            'WHOLE_DOCUMENT', 'CSS_SELECTOR', 'XPATH', 'JSON_POINTER', 'PAGE',
            'LINE_RANGE', 'BYTE_RANGE', 'TABLE_CELL', 'REGEX_MATCH'
        )
    )
);

-- Natural keys make retried writes idempotent without rewriting provenance.
CREATE UNIQUE INDEX IF NOT EXISTS entity_alias_claims_curated_current_key
    ON entity_alias_claims (entity_alias_id, asserted_alias_value, identity_confidence)
    WHERE claim_kind = 'CURATED' AND valid_to IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS entity_alias_claims_curated_history_key
    ON entity_alias_claims (
        entity_alias_id, asserted_alias_value, identity_confidence, valid_to
    )
    WHERE claim_kind = 'CURATED' AND valid_to IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS entity_alias_claims_source_record_key
    ON entity_alias_claims (
        entity_alias_id, source_record_id, locator_type, locator_value,
        asserted_alias_value, identity_confidence
    )
    WHERE claim_kind = 'SOURCE_RECORD';
CREATE INDEX IF NOT EXISTS entity_alias_claims_alias_idx
    ON entity_alias_claims (entity_alias_id);
CREATE INDEX IF NOT EXISTS entity_alias_claims_source_record_idx
    ON entity_alias_claims (source_record_id)
    WHERE source_record_id IS NOT NULL;

CREATE OR REPLACE FUNCTION entity_alias_claims_validate_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    record_state TEXT;
    record_current BOOLEAN;
BEGIN
    IF NEW.claim_kind = 'SOURCE_RECORD' THEN
        SELECT revision_state, is_current
          INTO record_state, record_current
          FROM source_records
         WHERE id = NEW.source_record_id;

        IF record_state IS DISTINCT FROM 'FINALIZED' OR record_current IS DISTINCT FROM TRUE THEN
            RAISE EXCEPTION 'a source alias claim must cite a current finalized source-record revision'
                USING ERRCODE = '23514';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS entity_alias_claims_validate_insert_trigger ON entity_alias_claims;
CREATE TRIGGER entity_alias_claims_validate_insert_trigger
    BEFORE INSERT ON entity_alias_claims
    FOR EACH ROW EXECUTE FUNCTION entity_alias_claims_validate_insert();

CREATE OR REPLACE FUNCTION entity_alias_claims_reject_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'entity alias claim history is append-only'
        USING ERRCODE = '55000';
END;
$$;

DROP TRIGGER IF EXISTS entity_alias_claims_immutable ON entity_alias_claims;
CREATE TRIGGER entity_alias_claims_immutable
    BEFORE UPDATE OR DELETE OR TRUNCATE ON entity_alias_claims
    FOR EACH STATEMENT EXECUTE FUNCTION entity_alias_claims_reject_mutation();

-- A legacy NULL source_id is the one condition that unambiguously means a
-- manual/editorial assertion. Source-backed legacy rows deliberately receive
-- no manufactured claim: they remain in entity_aliases history but are absent
-- from current resolution until a new finalized source record reasserts them.
INSERT INTO entity_alias_claims (
    entity_alias_id, asserted_alias_value, identity_confidence, claim_kind,
    source_record_id, locator_type, locator_value, valid_to, created_at
)
SELECT alias_row.id, alias_row.alias_value, alias_row.identity_confidence,
       'CURATED', NULL, NULL, NULL, alias_row.valid_to, alias_row.created_at
  FROM entity_aliases alias_row
 WHERE alias_row.source_id IS NULL
ON CONFLICT DO NOTHING;

CREATE OR REPLACE VIEW current_entity_aliases AS
SELECT alias_row.id,
       alias_row.entity_id,
       alias_row.alias_type,
       alias_row.alias_value,
       alias_row.normalized_value,
       alias_row.source_id,
       alias_row.identity_confidence,
       alias_row.valid_from,
       alias_row.valid_to,
       alias_row.created_at
  FROM entity_aliases alias_row
 WHERE alias_row.valid_to IS NULL
   AND EXISTS (
       SELECT 1
         FROM entity_alias_claims alias_claim
         LEFT JOIN source_records source_record
           ON source_record.id = alias_claim.source_record_id
        WHERE alias_claim.entity_alias_id = alias_row.id
          AND (
              (
                  alias_claim.claim_kind = 'CURATED' AND
                  alias_claim.valid_to IS NULL
              ) OR (
                  alias_claim.claim_kind = 'SOURCE_RECORD' AND
                  alias_claim.valid_to IS NULL AND
                  source_record.revision_state = 'FINALIZED' AND
                  source_record.is_current = TRUE
              )
          )
   );

COMMENT ON TABLE entity_alias_claims IS
    'Append-only authority for alias currentness. Source ownership on entity_aliases never substitutes for a claim.';
COMMENT ON VIEW current_entity_aliases IS
    'Globally unretired exact identifiers backed by an open curated claim or a current finalized source-record claim.';
