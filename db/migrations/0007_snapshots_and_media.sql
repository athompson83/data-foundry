-- 0007_snapshots_and_media.sql
--
-- Immutable published dataset versions, and rights-governed media assets.

CREATE TABLE IF NOT EXISTS dataset_snapshots (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vertical_id    UUID        NOT NULL REFERENCES verticals (id) ON DELETE RESTRICT,
    version        TEXT        NOT NULL,
    generated_at   TIMESTAMPTZ NOT NULL,
    record_counts  JSONB       NOT NULL DEFAULT '{}'::jsonb,
    schema_version TEXT        NOT NULL,
    manifest_uri   TEXT        NOT NULL,
    checksums      JSONB       NOT NULL DEFAULT '{}'::jsonb,
    status         TEXT        NOT NULL DEFAULT 'BUILDING',
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT dataset_snapshots_status_allowed
        CHECK (status IN ('BUILDING', 'PUBLISHED', 'WITHDRAWN', 'FAILED'))
);

CREATE UNIQUE INDEX IF NOT EXISTS dataset_snapshots_version_key
    ON dataset_snapshots (vertical_id, version);
CREATE INDEX IF NOT EXISTS dataset_snapshots_status_idx
    ON dataset_snapshots (vertical_id, status, generated_at DESC);

COMMENT ON TABLE dataset_snapshots IS
    'Immutable published versions. Corrections produce a new version; snapshots are never rewritten.';

CREATE TABLE IF NOT EXISTS media_assets (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vertical_id           UUID        NOT NULL REFERENCES verticals (id) ON DELETE RESTRICT,
    entity_id             UUID            NULL REFERENCES entities (id) ON DELETE SET NULL,
    source_id             UUID        NOT NULL REFERENCES sources (id) ON DELETE RESTRICT,
    source_url            TEXT        NOT NULL,
    content_hash          TEXT            NULL,
    media_type            TEXT        NOT NULL,
    rights_classification TEXT        NOT NULL DEFAULT 'UNREVIEWED',
    license_id            TEXT            NULL,
    attribution           JSONB       NOT NULL,
    allowed_display_modes TEXT[]      NOT NULL DEFAULT '{}',
    r2_uri                TEXT            NULL,
    width                 INTEGER         NULL,
    height                INTEGER         NULL,
    alt_text              TEXT            NULL,
    primary_rank          INTEGER     NOT NULL DEFAULT 0,
    status                TEXT        NOT NULL DEFAULT 'PENDING_REVIEW',
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT media_assets_media_type_allowed CHECK (media_type IN (
        'PRODUCT_PHOTO', 'DIAGRAM', 'SCHEMATIC', 'LABEL', 'DRAWING',
        'MANUAL_COVER', 'CHART', 'LOGO', 'OTHER'
    )),
    CONSTRAINT media_assets_rights_classification_allowed
        CHECK (rights_classification IN ('GREEN', 'AMBER', 'RED', 'UNREVIEWED')),
    CONSTRAINT media_assets_status_allowed
        CHECK (status IN ('PENDING_REVIEW', 'APPROVED', 'BLOCKED', 'RETIRED')),
    CONSTRAINT media_assets_content_hash_format
        CHECK (content_hash IS NULL OR content_hash ~ '^[0-9a-f]{64}$'),
    CONSTRAINT media_assets_dimensions_positive CHECK (
        (width IS NULL OR width > 0) AND (height IS NULL OR height > 0)
    ),
    CONSTRAINT media_assets_primary_rank_nonneg CHECK (primary_rank >= 0),
    -- AGENTS.md rule 9, enforced in storage: caching bytes into R2 is
    -- republication. An asset cannot have an r2_uri unless its rights are
    -- cleared and it is not hotlink-only.
    CONSTRAINT media_assets_cache_requires_rights CHECK (
        r2_uri IS NULL
        OR (
            rights_classification IN ('GREEN', 'AMBER')
            AND NOT ('HOTLINK_ONLY' = ANY (allowed_display_modes))
        )
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS media_assets_source_url_key
    ON media_assets (source_id, source_url);
CREATE INDEX IF NOT EXISTS media_assets_entity_rank_idx
    ON media_assets (entity_id, primary_rank);
CREATE INDEX IF NOT EXISTS media_assets_rights_idx ON media_assets (rights_classification, status);
CREATE INDEX IF NOT EXISTS media_assets_content_hash_idx ON media_assets (content_hash);

COMMENT ON TABLE media_assets IS
    'Images are evidence and licensed assets, not decoration. r2_uri stays NULL until a rights '
    'decision permits caching (AGENTS.md rule 9).';
