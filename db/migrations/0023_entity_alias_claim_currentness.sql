-- 0023_entity_alias_claim_currentness.sql
--
-- `entity_aliases.source_id` is display/provenance metadata on a shared exact-
-- identifier row. It is not evidence that the source still asserts the alias.
-- Record each assertion independently and derive the resolution/search index
-- from current claims instead of leaving stale source aliases active forever.

ALTER TABLE entity_aliases
    ADD COLUMN IF NOT EXISTS authority_epoch BIGINT NOT NULL DEFAULT 0;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM pg_constraint
         WHERE conrelid = 'public.entity_aliases'::regclass
           AND contype = 'c'
           AND conname = 'entity_aliases_authority_epoch_nonnegative'
    ) THEN
        ALTER TABLE entity_aliases
            ADD CONSTRAINT entity_aliases_authority_epoch_nonnegative
            CHECK (authority_epoch >= 0);
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION entity_aliases_enforce_authority_epoch()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.entity_id IS DISTINCT FROM OLD.entity_id OR
       NEW.alias_type IS DISTINCT FROM OLD.alias_type OR
       NEW.normalized_value IS DISTINCT FROM OLD.normalized_value THEN
        RAISE EXCEPTION 'an alias identity is immutable once staged'
            USING ERRCODE = '23514';
    END IF;
    IF NEW.valid_to IS DISTINCT FROM OLD.valid_to THEN
        IF NEW.authority_epoch IS DISTINCT FROM OLD.authority_epoch + 1 THEN
            RAISE EXCEPTION 'an alias validity transition must advance its authority epoch exactly once'
                USING ERRCODE = '23514';
        END IF;
    ELSIF NEW.authority_epoch IS DISTINCT FROM OLD.authority_epoch THEN
        RAISE EXCEPTION 'an alias authority epoch cannot change without a validity transition'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS entity_aliases_enforce_authority_epoch ON entity_aliases;
CREATE TRIGGER entity_aliases_enforce_authority_epoch
    BEFORE UPDATE OF entity_id, alias_type, normalized_value, valid_to, authority_epoch
    ON entity_aliases
    FOR EACH ROW EXECUTE FUNCTION entity_aliases_enforce_authority_epoch();

CREATE TABLE IF NOT EXISTS entity_alias_claims (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_alias_id   UUID        NOT NULL REFERENCES entity_aliases (id) ON DELETE RESTRICT,
    asserted_alias_value TEXT     NOT NULL,
    asserted_normalized_value TEXT NOT NULL,
    identity_confidence DOUBLE PRECISION NOT NULL,
    claim_kind        TEXT        NOT NULL,
    source_id         UUID            NULL REFERENCES sources (id) ON DELETE RESTRICT,
    source_record_id  UUID            NULL REFERENCES source_records (id) ON DELETE RESTRICT,
    authority_epoch   BIGINT      NOT NULL,
    locator_type      TEXT            NULL,
    locator_value     TEXT            NULL,
    valid_to          TIMESTAMPTZ     NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT entity_alias_claims_kind_allowed
        CHECK (claim_kind IN ('CURATED', 'SOURCE_RECORD')),
    CONSTRAINT entity_alias_claims_asserted_alias_value_length
        CHECK (char_length(asserted_alias_value) BETWEEN 1 AND 500),
    CONSTRAINT entity_alias_claims_asserted_normalized_value_length
        CHECK (char_length(asserted_normalized_value) BETWEEN 1 AND 500),
    CONSTRAINT entity_alias_claims_identity_confidence_range
        CHECK (identity_confidence >= 0 AND identity_confidence <= 1),
    CONSTRAINT entity_alias_claims_authority_epoch_nonnegative
        CHECK (authority_epoch >= 0),
    CONSTRAINT entity_alias_claims_shape_valid CHECK (
        (
            claim_kind = 'CURATED' AND
            source_record_id IS NULL AND
            locator_type IS NULL AND
            locator_value IS NULL
        ) OR (
            claim_kind = 'SOURCE_RECORD' AND
            source_id IS NOT NULL AND
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
    ON entity_alias_claims (
        entity_alias_id, authority_epoch, asserted_alias_value, asserted_normalized_value,
        identity_confidence, COALESCE(source_id, '00000000-0000-0000-0000-000000000000'::uuid)
    )
    WHERE claim_kind = 'CURATED' AND valid_to IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS entity_alias_claims_curated_history_key
    ON entity_alias_claims (
        entity_alias_id, authority_epoch, asserted_alias_value, asserted_normalized_value,
        identity_confidence, COALESCE(source_id, '00000000-0000-0000-0000-000000000000'::uuid),
        valid_to
    )
    WHERE claim_kind = 'CURATED' AND valid_to IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS entity_alias_claims_source_record_key
    ON entity_alias_claims (
        entity_alias_id, authority_epoch, source_record_id, locator_type, locator_value,
        asserted_alias_value, asserted_normalized_value, identity_confidence
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
    record_source_id UUID;
    alias_normalized_value TEXT;
    alias_authority_epoch BIGINT;
BEGIN
    SELECT normalized_value, authority_epoch
      INTO alias_normalized_value, alias_authority_epoch
      FROM entity_aliases
     WHERE id = NEW.entity_alias_id;

    IF alias_normalized_value IS NULL OR
       NEW.asserted_normalized_value IS DISTINCT FROM alias_normalized_value THEN
        RAISE EXCEPTION 'an alias claim must cite the staged normalized alias identity'
            USING ERRCODE = '23514';
    END IF;

    IF NEW.authority_epoch IS DISTINCT FROM alias_authority_epoch THEN
        RAISE EXCEPTION 'an alias claim must cite the current alias authority epoch'
            USING ERRCODE = '23514';
    END IF;

    IF NEW.claim_kind = 'SOURCE_RECORD' THEN
        SELECT revision_state, is_current, source_id
          INTO record_state, record_current, record_source_id
          FROM source_records
         WHERE id = NEW.source_record_id;

        IF record_state IS DISTINCT FROM 'FINALIZED' OR record_current IS DISTINCT FROM TRUE THEN
            RAISE EXCEPTION 'a source alias claim must cite a current finalized source-record revision'
                USING ERRCODE = '23514';
        END IF;
        IF NEW.source_id IS DISTINCT FROM record_source_id THEN
            RAISE EXCEPTION 'a source alias claim must derive source attribution from its source record'
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

-- Backfill no authority. `entity_aliases.source_id` used ON DELETE SET NULL
-- before this ledger existed, so even NULL cannot prove an editorial claim.
-- Every legacy alias remains historical-only until an explicit curated action
-- or a current finalized source-record revision reasserts it.

CREATE OR REPLACE VIEW current_entity_aliases AS
SELECT alias_row.id,
       alias_row.entity_id,
       alias_row.alias_type,
       effective_claim.asserted_alias_value AS alias_value,
       alias_row.normalized_value,
       effective_claim.source_id,
       effective_claim.identity_confidence,
       alias_row.valid_from,
       alias_row.valid_to,
       alias_row.created_at
  FROM entity_aliases alias_row
  JOIN LATERAL (
       SELECT alias_claim.asserted_alias_value,
              alias_claim.source_id,
              alias_claim.identity_confidence
         FROM entity_alias_claims alias_claim
          LEFT JOIN source_records source_record
            ON source_record.id = alias_claim.source_record_id
          LEFT JOIN sources claim_source
            ON claim_source.id = alias_claim.source_id
         WHERE alias_claim.entity_alias_id = alias_row.id
           AND alias_claim.authority_epoch = alias_row.authority_epoch
           AND alias_claim.asserted_normalized_value = alias_row.normalized_value
           AND (alias_claim.valid_to IS NULL OR alias_claim.valid_to > now())
           AND (
               alias_claim.claim_kind = 'CURATED' OR (
                   alias_claim.claim_kind = 'SOURCE_RECORD' AND
                   source_record.revision_state = 'FINALIZED' AND
                   source_record.is_current = TRUE
               )
           )
         ORDER BY
               (alias_claim.asserted_alias_value = alias_claim.asserted_normalized_value) DESC,
               COALESCE(claim_source.authority_rank, 0) DESC,
               alias_claim.asserted_alias_value COLLATE "C",
               COALESCE(alias_claim.source_id::text, '') COLLATE "C",
               alias_claim.identity_confidence DESC,
               alias_claim.id
         LIMIT 1
  ) effective_claim ON TRUE
 WHERE alias_row.valid_from <= now()
   AND (alias_row.valid_to IS NULL OR alias_row.valid_to > now());

COMMENT ON TABLE entity_alias_claims IS
    'Append-only authority for alias currentness. Source ownership on entity_aliases never substitutes for a claim.';
COMMENT ON VIEW current_entity_aliases IS
    'Exact identifiers inside their half-open validity window, backed by an effective curated claim or a current finalized source-record claim.';
