-- 0004_facts.sql
--
-- Field-level claims, append-versioned, with mandatory many-to-many evidence.
--
-- The shape of this table is the single most load-bearing decision in the
-- model: a changed value is a NEW ROW, and the old row is closed by setting
-- valid_to. Nothing here ever overwrites normalized_value. See
-- docs/decisions/ADR-0001-canonical-fact-model.md.

CREATE TABLE IF NOT EXISTS facts (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_id          UUID        NOT NULL REFERENCES entities (id) ON DELETE CASCADE,
    property           TEXT        NOT NULL,
    normalized_value   JSONB       NOT NULL,
    value_type         TEXT        NOT NULL,
    unit               TEXT            NULL,
    valid_from         TIMESTAMPTZ NOT NULL,
    valid_to           TIMESTAMPTZ     NULL,
    status             TEXT        NOT NULL DEFAULT 'PROPOSED',
    confidence         DOUBLE PRECISION NOT NULL,
    supersedes_fact_id UUID            NULL REFERENCES facts (id) ON DELETE SET NULL,
    recorded_at        TIMESTAMPTZ NOT NULL,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT facts_property_format CHECK (property ~ '^[a-z][a-z0-9_]*$'),
    CONSTRAINT facts_value_type_allowed CHECK (value_type IN (
        'string', 'number', 'integer', 'boolean', 'date', 'datetime',
        'enum', 'url', 'quantity', 'array', 'object'
    )),
    CONSTRAINT facts_status_allowed CHECK (status IN (
        'PROPOSED', 'ACTIVE', 'SUPERSEDED', 'DISPUTED', 'RETRACTED'
    )),
    CONSTRAINT facts_confidence_range CHECK (confidence >= 0 AND confidence <= 1),
    CONSTRAINT facts_validity_ordered CHECK (valid_to IS NULL OR valid_to >= valid_from),
    CONSTRAINT facts_no_self_supersede CHECK (supersedes_fact_id IS NULL OR supersedes_fact_id <> id)
);

-- The versioning invariant, enforced by the database rather than by convention:
-- at most one open ACTIVE version per (entity, property). A second concurrent
-- writer trying to "update" a fact by inserting a parallel open row fails here
-- instead of silently creating two current truths.
CREATE UNIQUE INDEX IF NOT EXISTS facts_single_open_version_key
    ON facts (entity_id, property)
    WHERE valid_to IS NULL AND status = 'ACTIVE';

CREATE INDEX IF NOT EXISTS facts_entity_property_idx ON facts (entity_id, property);
CREATE INDEX IF NOT EXISTS facts_property_idx ON facts (property);
CREATE INDEX IF NOT EXISTS facts_validity_idx ON facts (entity_id, valid_from, valid_to);
CREATE INDEX IF NOT EXISTS facts_status_idx ON facts (status);
CREATE INDEX IF NOT EXISTS facts_supersedes_idx ON facts (supersedes_fact_id);

COMMENT ON TABLE facts IS
    'Field-level claims about an entity. Append-only versioning: close valid_to, insert a new row. '
    'Never UPDATE normalized_value.';
COMMENT ON COLUMN facts.valid_from IS 'When the claim is true of the world (valid time).';
COMMENT ON COLUMN facts.recorded_at IS 'When the platform learned it (transaction time).';
COMMENT ON COLUMN facts.confidence IS
    'fact_confidence only. Do not write extraction or identity confidence here.';

CREATE TABLE IF NOT EXISTS fact_evidence (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    fact_id          UUID        NOT NULL REFERENCES facts (id) ON DELETE CASCADE,
    artifact_id      UUID        NOT NULL REFERENCES source_artifacts (id) ON DELETE RESTRICT,
    source_record_id UUID        NOT NULL REFERENCES source_records (id) ON DELETE RESTRICT,
    source_value     TEXT        NOT NULL,
    locator_type     TEXT        NOT NULL,
    locator_value    TEXT        NOT NULL DEFAULT '',
    observed_at      TIMESTAMPTZ NOT NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT fact_evidence_locator_type_allowed CHECK (locator_type IN (
        'WHOLE_DOCUMENT', 'CSS_SELECTOR', 'XPATH', 'JSON_POINTER', 'PAGE',
        'LINE_RANGE', 'BYTE_RANGE', 'TABLE_CELL', 'REGEX_MATCH'
    ))
);

-- Genuine many-to-many: one fact may cite many artifacts (corroboration), and
-- one artifact backs many facts. locator_value defaults to '' rather than NULL
-- so this uniqueness actually bites.
CREATE UNIQUE INDEX IF NOT EXISTS fact_evidence_unique_locator
    ON fact_evidence (fact_id, source_record_id, locator_type, locator_value);
CREATE INDEX IF NOT EXISTS fact_evidence_fact_idx ON fact_evidence (fact_id);
CREATE INDEX IF NOT EXISTS fact_evidence_artifact_idx ON fact_evidence (artifact_id);
CREATE INDEX IF NOT EXISTS fact_evidence_source_record_idx ON fact_evidence (source_record_id);

COMMENT ON TABLE fact_evidence IS
    'Many-to-many evidence for facts. AGENTS.md rule 2: no published fact without evidence. '
    'ON DELETE RESTRICT on artifacts is deliberate - evidence outlives convenience.';
