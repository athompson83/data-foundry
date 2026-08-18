-- 0002_evidence.sql
--
-- Raw evidence: immutable artifacts and the source-native records extracted
-- from them. A source record is a claim, not a canonical entity.

CREATE TABLE IF NOT EXISTS source_artifacts (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id            UUID        NOT NULL REFERENCES sources (id) ON DELETE RESTRICT,
    url                  TEXT        NOT NULL,
    retrieved_at         TIMESTAMPTZ NOT NULL,
    content_hash         TEXT        NOT NULL,
    mime_type            TEXT        NOT NULL,
    r2_uri               TEXT        NOT NULL,
    http_status          INTEGER     NOT NULL,
    extractor_version    TEXT        NOT NULL,
    policy_snapshot_id   UUID            NULL,
    byte_size            BIGINT          NULL,
    acquisition_provider TEXT        NOT NULL,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT source_artifacts_content_hash_format CHECK (content_hash ~ '^[0-9a-f]{64}$'),
    CONSTRAINT source_artifacts_http_status_range CHECK (http_status BETWEEN 0 AND 599),
    CONSTRAINT source_artifacts_byte_size_nonneg CHECK (byte_size IS NULL OR byte_size >= 0)
);

-- Re-fetching identical bytes from the same URL is the same artifact, not a new
-- one. Changed bytes produce a new row, so the history of a page is preserved.
CREATE UNIQUE INDEX IF NOT EXISTS source_artifacts_identity_key
    ON source_artifacts (source_id, url, content_hash);
CREATE INDEX IF NOT EXISTS source_artifacts_source_retrieved_idx
    ON source_artifacts (source_id, retrieved_at DESC);
CREATE INDEX IF NOT EXISTS source_artifacts_content_hash_idx ON source_artifacts (content_hash);

COMMENT ON TABLE source_artifacts IS
    'Immutable evidence objects. Bytes live in R2 at r2_uri; Postgres keeps the pointer and hash. '
    'Never delete a row cited by a published fact (AGENTS.md rule 10).';

CREATE TABLE IF NOT EXISTS source_records (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id             UUID        NOT NULL REFERENCES sources (id) ON DELETE RESTRICT,
    artifact_id           UUID        NOT NULL REFERENCES source_artifacts (id) ON DELETE RESTRICT,
    source_record_key     TEXT        NOT NULL,
    entity_type           TEXT        NOT NULL,
    raw_payload           JSONB       NOT NULL,
    normalized_payload    JSONB           NULL,
    extraction_confidence DOUBLE PRECISION NOT NULL,
    extractor_version     TEXT        NOT NULL,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT source_records_entity_type_format CHECK (entity_type ~ '^[a-z][a-z0-9_]*$'),
    CONSTRAINT source_records_extraction_confidence_range
        CHECK (extraction_confidence >= 0 AND extraction_confidence <= 1)
);

-- The business key required by the contract: one record per (source, key),
-- regardless of how many artifacts have carried it over time.
CREATE UNIQUE INDEX IF NOT EXISTS source_records_source_key_uniq
    ON source_records (source_id, source_record_key);
CREATE INDEX IF NOT EXISTS source_records_artifact_idx ON source_records (artifact_id);
CREATE INDEX IF NOT EXISTS source_records_entity_type_idx ON source_records (source_id, entity_type);

COMMENT ON TABLE source_records IS
    'Extracted source-native records, pre-resolution. Sources make claims; they do not define entities.';
COMMENT ON COLUMN source_records.extraction_confidence IS
    'Did we read this value off the artifact correctly? Distinct from identity/fact confidence.';
