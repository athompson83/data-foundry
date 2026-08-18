-- 0006_resolution.sql
--
-- Entity resolution: candidate pairs, durable judgments, and the redirects that
-- keep IDs/URLs stable after a merge or split.

CREATE TABLE IF NOT EXISTS resolution_candidates (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vertical_id            UUID        NOT NULL REFERENCES verticals (id) ON DELETE RESTRICT,
    left_entity_id         UUID            NULL REFERENCES entities (id) ON DELETE CASCADE,
    left_source_record_id  UUID            NULL REFERENCES source_records (id) ON DELETE CASCADE,
    right_entity_id        UUID            NULL REFERENCES entities (id) ON DELETE CASCADE,
    right_source_record_id UUID            NULL REFERENCES source_records (id) ON DELETE CASCADE,
    method                 TEXT        NOT NULL,
    score                  DOUBLE PRECISION NOT NULL,
    explanation_features   JSONB       NOT NULL DEFAULT '{}'::jsonb,
    decision               TEXT        NOT NULL DEFAULT 'PENDING',
    reviewed_by            TEXT            NULL,
    reviewed_at            TIMESTAMPTZ     NULL,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT resolution_candidates_method_allowed CHECK (method IN (
        'DETERMINISTIC', 'NORMALIZED', 'PROBABILISTIC', 'LLM', 'HUMAN'
    )),
    CONSTRAINT resolution_candidates_decision_allowed CHECK (decision IN (
        'PENDING', 'MATCH', 'NO_MATCH', 'NEEDS_REVIEW'
    )),
    CONSTRAINT resolution_candidates_score_range CHECK (score >= 0 AND score <= 1),
    -- Each side is exactly one of: a canonical entity, or an unresolved record.
    CONSTRAINT resolution_candidates_left_side_exclusive CHECK (
        (left_entity_id IS NULL) <> (left_source_record_id IS NULL)
    ),
    CONSTRAINT resolution_candidates_right_side_exclusive CHECK (
        (right_entity_id IS NULL) <> (right_source_record_id IS NULL)
    ),
    CONSTRAINT resolution_candidates_distinct_sides CHECK (
        left_entity_id IS DISTINCT FROM right_entity_id
        OR left_source_record_id IS DISTINCT FROM right_source_record_id
    )
);

CREATE INDEX IF NOT EXISTS resolution_candidates_queue_idx
    ON resolution_candidates (vertical_id, decision, score DESC);
CREATE INDEX IF NOT EXISTS resolution_candidates_left_entity_idx
    ON resolution_candidates (left_entity_id);
CREATE INDEX IF NOT EXISTS resolution_candidates_right_entity_idx
    ON resolution_candidates (right_entity_id);
CREATE INDEX IF NOT EXISTS resolution_candidates_left_record_idx
    ON resolution_candidates (left_source_record_id);
CREATE INDEX IF NOT EXISTS resolution_candidates_right_record_idx
    ON resolution_candidates (right_source_record_id);

COMMENT ON TABLE resolution_candidates IS
    'Possible same-entity pairs. explanation_features must carry what the matcher keyed on, '
    'so a human can review or reverse the decision (AGENTS.md rule 3).';

CREATE TABLE IF NOT EXISTS resolution_judgments (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vertical_id            UUID        NOT NULL REFERENCES verticals (id) ON DELETE RESTRICT,
    candidate_id           UUID            NULL REFERENCES resolution_candidates (id) ON DELETE SET NULL,
    verdict                TEXT        NOT NULL,
    left_entity_id         UUID            NULL REFERENCES entities (id) ON DELETE SET NULL,
    left_source_record_id  UUID            NULL REFERENCES source_records (id) ON DELETE SET NULL,
    right_entity_id        UUID            NULL REFERENCES entities (id) ON DELETE SET NULL,
    right_source_record_id UUID            NULL REFERENCES source_records (id) ON DELETE SET NULL,
    merged_into_entity_id  UUID            NULL REFERENCES entities (id) ON DELETE SET NULL,
    decided_by_kind        TEXT        NOT NULL,
    decided_by_actor       TEXT        NOT NULL,
    decided_at             TIMESTAMPTZ NOT NULL,
    identity_confidence    DOUBLE PRECISION NOT NULL,
    rationale              TEXT        NOT NULL DEFAULT '',
    reverses_judgment_id   UUID            NULL REFERENCES resolution_judgments (id) ON DELETE RESTRICT,
    active                 BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT resolution_judgments_verdict_allowed
        CHECK (verdict IN ('MERGE', 'NOT_MERGE', 'SPLIT')),
    CONSTRAINT resolution_judgments_actor_kind_allowed
        CHECK (decided_by_kind IN ('HUMAN', 'RULE', 'MODEL')),
    CONSTRAINT resolution_judgments_identity_confidence_range
        CHECK (identity_confidence >= 0 AND identity_confidence <= 1),
    CONSTRAINT resolution_judgments_no_self_reversal
        CHECK (reverses_judgment_id IS NULL OR reverses_judgment_id <> id),
    -- A MERGE must say which entity survived; a NOT_MERGE must not.
    CONSTRAINT resolution_judgments_merge_target CHECK (
        (verdict = 'MERGE' AND merged_into_entity_id IS NOT NULL)
        OR (verdict <> 'MERGE' AND merged_into_entity_id IS NULL)
    )
);

CREATE INDEX IF NOT EXISTS resolution_judgments_active_idx
    ON resolution_judgments (vertical_id, verdict, active);
CREATE INDEX IF NOT EXISTS resolution_judgments_left_entity_idx
    ON resolution_judgments (left_entity_id);
CREATE INDEX IF NOT EXISTS resolution_judgments_right_entity_idx
    ON resolution_judgments (right_entity_id);
CREATE INDEX IF NOT EXISTS resolution_judgments_candidate_idx
    ON resolution_judgments (candidate_id);
-- Negative judgments are queried on every resolution pass to suppress pairs the
-- matcher has already been told are wrong.
CREATE INDEX IF NOT EXISTS resolution_judgments_negative_idx
    ON resolution_judgments (vertical_id, left_entity_id, right_entity_id)
    WHERE verdict = 'NOT_MERGE' AND active;

COMMENT ON TABLE resolution_judgments IS
    'Durable merge/not-merge decisions. Rows are never deleted; a reversal is a new row pointing at '
    'the old via reverses_judgment_id. Negative judgments prevent repeated bad matching.';

CREATE TABLE IF NOT EXISTS entity_redirects (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vertical_id    UUID        NOT NULL REFERENCES verticals (id) ON DELETE RESTRICT,
    from_entity_id UUID        NOT NULL REFERENCES entities (id) ON DELETE CASCADE,
    to_entity_id   UUID        NOT NULL REFERENCES entities (id) ON DELETE CASCADE,
    from_slug      TEXT            NULL,
    reason         TEXT        NOT NULL,
    judgment_id    UUID            NULL REFERENCES resolution_judgments (id) ON DELETE SET NULL,
    active         BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT entity_redirects_reason_allowed
        CHECK (reason IN ('MERGE', 'SPLIT', 'RENAME', 'RETIRE')),
    CONSTRAINT entity_redirects_no_self_redirect CHECK (from_entity_id <> to_entity_id),
    CONSTRAINT entity_redirects_slug_format
        CHECK (from_slug IS NULL OR from_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);

-- One live destination per retired id, so URL resolution is unambiguous.
CREATE UNIQUE INDEX IF NOT EXISTS entity_redirects_active_source_key
    ON entity_redirects (from_entity_id) WHERE active;
CREATE INDEX IF NOT EXISTS entity_redirects_target_idx ON entity_redirects (to_entity_id);
CREATE INDEX IF NOT EXISTS entity_redirects_slug_idx
    ON entity_redirects (vertical_id, from_slug) WHERE from_slug IS NOT NULL;

COMMENT ON TABLE entity_redirects IS
    'Keeps IDs and public URLs stable across merge/split/rename. Merges stay reversible.';
