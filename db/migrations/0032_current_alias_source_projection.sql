-- 0032_current_alias_source_projection.sql
--
-- Source-scoped identifier lookup must use the same effective claims as alias
-- display without granting query runtimes access to raw alias history. Append
-- the contributing source IDs while retaining every existing view column and
-- the deterministic display winner established in 0025.

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
       alias_row.created_at,
       effective_claim.current_source_ids
  FROM entity_aliases alias_row
  JOIN LATERAL (
       SELECT alias_claim.asserted_alias_value,
              alias_claim.source_id,
              alias_claim.identity_confidence,
              array_remove(array_agg(alias_claim.source_id) OVER (), NULL::uuid)
                  AS current_source_ids
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

COMMENT ON COLUMN current_entity_aliases.current_source_ids IS
    'Source IDs from all effective current alias claims, excluding NULL curated attribution. Membership is independent of the deterministic display winner; duplicate source claims may repeat an ID.';
