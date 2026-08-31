-- 0025_alias_claim_evidence_gate.sql
--
-- A current source-record alias claim must not become a resolution/search
-- contribution merely because its source record is finalized. Bind the exact
-- claim to immutable entity evidence so that the source participates in the
-- surface rights AND. Existing unlinked ALIAS evidence is deliberately not
-- guessed or backfilled; those source aliases remain hidden until a
-- rights-admitted reingest records an exact claim/evidence pair.

ALTER TABLE entity_evidence
    ADD COLUMN IF NOT EXISTS entity_alias_claim_id UUID NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM pg_constraint
         WHERE conrelid = 'public.entity_evidence'::regclass
           AND conname = 'entity_evidence_alias_claim_fk'
    ) THEN
        ALTER TABLE entity_evidence
            ADD CONSTRAINT entity_evidence_alias_claim_fk
            FOREIGN KEY (entity_alias_claim_id)
            REFERENCES entity_alias_claims (id)
            ON DELETE RESTRICT
            NOT VALID;
    END IF;
END;
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM pg_constraint
         WHERE conrelid = 'public.entity_evidence'::regclass
           AND conname = 'entity_evidence_alias_claim_shape'
    ) THEN
        ALTER TABLE entity_evidence
            ADD CONSTRAINT entity_evidence_alias_claim_shape CHECK (
                (
                    contribution_role = 'ALIAS' AND
                    entity_alias_claim_id IS NOT NULL
                ) OR (
                    contribution_role <> 'ALIAS' AND
                    entity_alias_claim_id IS NULL
                )
            ) NOT VALID;
    END IF;
END;
$$;

-- The old locator-only key could collapse two separately asserted aliases that
-- were extracted from one structured location. Keep ordinary evidence
-- locator-idempotent, make ALIAS evidence idempotent by exact claim, and retain
-- a legacy key only for pre-0025 unlinked rows.
DROP INDEX IF EXISTS entity_evidence_unique_locator;
CREATE UNIQUE INDEX IF NOT EXISTS entity_evidence_non_alias_unique_locator
    ON entity_evidence (
        entity_id, source_record_id, contribution_role, locator_type, locator_value
    )
    WHERE contribution_role <> 'ALIAS';
CREATE UNIQUE INDEX IF NOT EXISTS entity_evidence_alias_claim_unique
    ON entity_evidence (entity_alias_claim_id)
    WHERE contribution_role = 'ALIAS' AND entity_alias_claim_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS entity_evidence_legacy_alias_unique_locator
    ON entity_evidence (
        entity_id, source_record_id, contribution_role, locator_type, locator_value
    )
    WHERE contribution_role = 'ALIAS' AND entity_alias_claim_id IS NULL;

CREATE OR REPLACE FUNCTION entity_evidence_validate_alias_claim()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    claim_kind TEXT;
    claim_entity_id UUID;
    claim_source_record_id UUID;
    claim_locator_type TEXT;
    claim_locator_value TEXT;
BEGIN
    IF NEW.contribution_role <> 'ALIAS' THEN
        RETURN NEW;
    END IF;

    SELECT alias_claim.claim_kind,
           alias_row.entity_id,
           alias_claim.source_record_id,
           alias_claim.locator_type,
           alias_claim.locator_value
      INTO claim_kind,
           claim_entity_id,
           claim_source_record_id,
           claim_locator_type,
           claim_locator_value
      FROM entity_alias_claims alias_claim
      JOIN entity_aliases alias_row ON alias_row.id = alias_claim.entity_alias_id
     WHERE alias_claim.id = NEW.entity_alias_claim_id;

    IF claim_kind IS DISTINCT FROM 'SOURCE_RECORD' OR
       claim_entity_id IS DISTINCT FROM NEW.entity_id OR
       claim_source_record_id IS DISTINCT FROM NEW.source_record_id OR
       claim_locator_type IS DISTINCT FROM NEW.locator_type OR
       claim_locator_value IS DISTINCT FROM NEW.locator_value THEN
        RAISE EXCEPTION 'ALIAS entity evidence must bind its exact source-record alias claim'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS entity_evidence_validate_alias_claim_insert ON entity_evidence;
CREATE TRIGGER entity_evidence_validate_alias_claim_insert
    BEFORE INSERT ON entity_evidence
    FOR EACH ROW EXECUTE FUNCTION entity_evidence_validate_alias_claim();

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
                   source_record.is_current = TRUE AND
                   EXISTS (
                       SELECT 1
                         FROM entity_evidence alias_evidence
                        WHERE alias_evidence.entity_alias_claim_id = alias_claim.id
                   )
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

COMMENT ON COLUMN entity_evidence.entity_alias_claim_id IS
    'Exact source-record alias claim supported by this immutable ALIAS contribution. NULL is retained only for pre-0025 history and non-ALIAS roles.';
COMMENT ON VIEW current_entity_aliases IS
    'Exact identifiers inside their half-open validity window, backed by an effective curated claim or an exact current source-record claim/evidence pair.';
