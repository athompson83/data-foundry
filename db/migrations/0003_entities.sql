-- 0003_entities.sql
--
-- Canonical entities and the exact-identifier alias index.

CREATE TABLE IF NOT EXISTS entities (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vertical_id      UUID        NOT NULL REFERENCES verticals (id) ON DELETE RESTRICT,
    entity_type      TEXT        NOT NULL,
    canonical_name   TEXT        NOT NULL,
    canonical_slug   TEXT        NOT NULL,
    status           TEXT        NOT NULL DEFAULT 'CANDIDATE',
    quality_score    DOUBLE PRECISION NOT NULL DEFAULT 0,
    first_seen_at    TIMESTAMPTZ NOT NULL,
    last_verified_at TIMESTAMPTZ     NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT entities_entity_type_format CHECK (entity_type ~ '^[a-z][a-z0-9_]*$'),
    CONSTRAINT entities_slug_format CHECK (canonical_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
    CONSTRAINT entities_status_allowed CHECK (status IN (
        'CANDIDATE', 'ACTIVE', 'MERGED', 'SPLIT', 'SUPPRESSED', 'RETIRED'
    )),
    CONSTRAINT entities_quality_score_range CHECK (quality_score >= 0 AND quality_score <= 1)
);

CREATE UNIQUE INDEX IF NOT EXISTS entities_slug_key
    ON entities (vertical_id, entity_type, canonical_slug);
CREATE INDEX IF NOT EXISTS entities_type_status_idx ON entities (vertical_id, entity_type, status);
CREATE INDEX IF NOT EXISTS entities_canonical_name_idx ON entities (vertical_id, canonical_name);
CREATE INDEX IF NOT EXISTS entities_last_verified_idx ON entities (vertical_id, last_verified_at);

COMMENT ON TABLE entities IS
    'Canonical real-world things. entity_type is vertical-defined config, not a platform enum.';
COMMENT ON COLUMN entities.quality_score IS
    'entity_quality_score: completeness/corroboration/freshness. Not a fact or identity confidence.';

CREATE TABLE IF NOT EXISTS entity_aliases (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_id           UUID        NOT NULL REFERENCES entities (id) ON DELETE CASCADE,
    alias_type          TEXT        NOT NULL,
    alias_value         TEXT        NOT NULL,
    normalized_value    TEXT        NOT NULL,
    source_id           UUID            NULL REFERENCES sources (id) ON DELETE SET NULL,
    identity_confidence DOUBLE PRECISION NOT NULL,
    valid_from          TIMESTAMPTZ NOT NULL,
    valid_to            TIMESTAMPTZ     NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT entity_aliases_alias_type_format CHECK (alias_type ~ '^[a-z][a-z0-9_]*$'),
    CONSTRAINT entity_aliases_identity_confidence_range
        CHECK (identity_confidence >= 0 AND identity_confidence <= 1),
    CONSTRAINT entity_aliases_validity_ordered CHECK (valid_to IS NULL OR valid_to >= valid_from)
);

CREATE UNIQUE INDEX IF NOT EXISTS entity_aliases_entity_type_value_key
    ON entity_aliases (entity_id, alias_type, normalized_value);
-- AGENTS.md rule 7: exact identifiers beat semantic search. This is the index
-- that makes deterministic lookup the fast path, so nothing is tempted to reach
-- for vector similarity to resolve a part number.
CREATE INDEX IF NOT EXISTS entity_aliases_lookup_idx
    ON entity_aliases (alias_type, normalized_value);
CREATE INDEX IF NOT EXISTS entity_aliases_normalized_value_idx ON entity_aliases (normalized_value);
CREATE INDEX IF NOT EXISTS entity_aliases_entity_idx ON entity_aliases (entity_id);
CREATE INDEX IF NOT EXISTS entity_aliases_source_idx ON entity_aliases (source_id);

COMMENT ON TABLE entity_aliases IS
    'Aliases and identifiers used to locate/resolve an entity. Deterministic matching lives here.';
