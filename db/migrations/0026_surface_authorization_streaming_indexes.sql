-- Stream surface authorization evidence through bounded per-candidate probes.
-- The single-column indexes remain useful for ordinary lookups, but they do not
-- guarantee that PostgreSQL can satisfy ORDER BY ... LIMIT without first
-- materializing every matching TID at high selectivity. These composite indexes
-- make the request boundary executable as an ordered index scan.

CREATE INDEX IF NOT EXISTS entity_evidence_entity_id_stream_idx
    ON entity_evidence (entity_id, id);

CREATE INDEX IF NOT EXISTS fact_evidence_fact_id_stream_idx
    ON fact_evidence (fact_id, id);

COMMENT ON INDEX entity_evidence_entity_id_stream_idx IS
    'Streams bounded surface-authorization evidence by entity without a full relation scan.';

COMMENT ON INDEX fact_evidence_fact_id_stream_idx IS
    'Streams bounded surface-authorization evidence by fact without a full relation scan.';
