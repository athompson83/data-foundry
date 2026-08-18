-- 0005_relationships.sql
--
-- Canonical graph edges, versioned and evidenced exactly like facts.

CREATE TABLE IF NOT EXISTS relationships (
    id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vertical_id                UUID        NOT NULL REFERENCES verticals (id) ON DELETE RESTRICT,
    subject_entity_id          UUID        NOT NULL REFERENCES entities (id) ON DELETE CASCADE,
    predicate                  TEXT        NOT NULL,
    object_entity_id           UUID        NOT NULL REFERENCES entities (id) ON DELETE CASCADE,
    confidence                 DOUBLE PRECISION NOT NULL,
    valid_from                 TIMESTAMPTZ NOT NULL,
    valid_to                   TIMESTAMPTZ     NULL,
    status                     TEXT        NOT NULL DEFAULT 'PROPOSED',
    supersedes_relationship_id UUID            NULL REFERENCES relationships (id) ON DELETE SET NULL,
    recorded_at                TIMESTAMPTZ NOT NULL,
    created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT relationships_predicate_format CHECK (predicate ~ '^[a-z][a-z0-9_]*$'),
    CONSTRAINT relationships_status_allowed CHECK (status IN (
        'PROPOSED', 'ACTIVE', 'SUPERSEDED', 'DISPUTED', 'RETRACTED'
    )),
    CONSTRAINT relationships_confidence_range CHECK (confidence >= 0 AND confidence <= 1),
    CONSTRAINT relationships_validity_ordered CHECK (valid_to IS NULL OR valid_to >= valid_from),
    CONSTRAINT relationships_no_self_edge CHECK (subject_entity_id <> object_entity_id),
    CONSTRAINT relationships_no_self_supersede
        CHECK (supersedes_relationship_id IS NULL OR supersedes_relationship_id <> id)
);

CREATE UNIQUE INDEX IF NOT EXISTS relationships_single_open_version_key
    ON relationships (subject_entity_id, predicate, object_entity_id)
    WHERE valid_to IS NULL AND status = 'ACTIVE';

CREATE INDEX IF NOT EXISTS relationships_subject_idx
    ON relationships (subject_entity_id, predicate);
CREATE INDEX IF NOT EXISTS relationships_object_idx
    ON relationships (object_entity_id, predicate);
CREATE INDEX IF NOT EXISTS relationships_predicate_idx ON relationships (vertical_id, predicate);
CREATE INDEX IF NOT EXISTS relationships_status_idx ON relationships (status);

COMMENT ON TABLE relationships IS
    'Canonical graph edges. predicate is vertical-defined config. Same append-versioning as facts.';

CREATE TABLE IF NOT EXISTS relationship_evidence (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    relationship_id  UUID        NOT NULL REFERENCES relationships (id) ON DELETE CASCADE,
    artifact_id      UUID        NOT NULL REFERENCES source_artifacts (id) ON DELETE RESTRICT,
    source_record_id UUID        NOT NULL REFERENCES source_records (id) ON DELETE RESTRICT,
    source_value     TEXT        NOT NULL,
    locator_type     TEXT        NOT NULL,
    locator_value    TEXT        NOT NULL DEFAULT '',
    observed_at      TIMESTAMPTZ NOT NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT relationship_evidence_locator_type_allowed CHECK (locator_type IN (
        'WHOLE_DOCUMENT', 'CSS_SELECTOR', 'XPATH', 'JSON_POINTER', 'PAGE',
        'LINE_RANGE', 'BYTE_RANGE', 'TABLE_CELL', 'REGEX_MATCH'
    ))
);

CREATE UNIQUE INDEX IF NOT EXISTS relationship_evidence_unique_locator
    ON relationship_evidence (relationship_id, source_record_id, locator_type, locator_value);
CREATE INDEX IF NOT EXISTS relationship_evidence_relationship_idx
    ON relationship_evidence (relationship_id);
CREATE INDEX IF NOT EXISTS relationship_evidence_artifact_idx
    ON relationship_evidence (artifact_id);
CREATE INDEX IF NOT EXISTS relationship_evidence_source_record_idx
    ON relationship_evidence (source_record_id);

COMMENT ON TABLE relationship_evidence IS
    'Relationships also require evidence (doc 04). Same contract as fact_evidence.';
