-- 0009_resolution_judgment_episodes.sql
--
-- Judgment *event* identity (finding #2b).
--
-- `resolution_judgments` was deduplicated by the resolver on the tuple
-- (vertical, left entity, left source record, right entity, verdict). That
-- tuple cannot distinguish a retry of one decision from a materially different
-- later decision about the same pair, so a clean MERGE recorded on Monday
-- silently swallowed the PROVISIONAL, conflicted MERGE recorded on Tuesday:
-- `resolution_candidates` showed the conflict while the judgment trail still
-- showed the earlier certain decision.
--
-- Identity is now (what the decision rested on, what was decided):
--
--   evidence_fingerprint  sha256 over the key-ordered evidence the decision
--                         rested on — the identifiers keyed on, the entities
--                         they resolved to, the conflict set, the blocking key
--                         and the hard conflicts. Deliberately excludes
--                         per-run bookkeeping (which run wrote it, whether the
--                         entity happened to be created on this pass), because
--                         a retry must fingerprint identically.
--   decision_fingerprint  sha256 over the key-ordered decision — verdict,
--                         surviving entity, identity confidence.
--
-- Same pair + same evidence + same decision  => the same logical event; a retry
-- is a no-op. Anything else => a new episode, appended, pointing at the episode
-- it supersedes. Nothing is ever rewritten or deleted, so the earlier decision
-- stays readable exactly as it was decided (AGENTS.md rule 3).

ALTER TABLE resolution_judgments
    ADD COLUMN IF NOT EXISTS evidence_fingerprint   TEXT    NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS decision_fingerprint   TEXT    NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS supersedes_judgment_id UUID        NULL
        REFERENCES resolution_judgments (id) ON DELETE RESTRICT,
    ADD COLUMN IF NOT EXISTS episode_seq            INTEGER NOT NULL DEFAULT 1;

-- An empty fingerprint marks history recorded before this migration existed:
-- it can never match a computed one, so the first pass after upgrading appends
-- a fresh episode instead of pretending the old row carried an identity.
-- Fingerprints are always written as a pair; half a fingerprint is a bug, not a
-- state.
DO $$
BEGIN
    ALTER TABLE resolution_judgments
        ADD CONSTRAINT resolution_judgments_fingerprints_paired CHECK (
            (evidence_fingerprint = '') = (decision_fingerprint = '')
        );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    ALTER TABLE resolution_judgments
        ADD CONSTRAINT resolution_judgments_episode_seq_positive CHECK (episode_seq >= 1);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    ALTER TABLE resolution_judgments
        ADD CONSTRAINT resolution_judgments_no_self_supersession CHECK (
            supersedes_judgment_id IS NULL OR supersedes_judgment_id <> id
        );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- At most one *current* judgment per logical pair. Every consumer that reads
-- `WHERE active` already assumes this; without the index, "supersede the old
-- one" is caller discipline that two concurrent resolvers can both skip.
-- NULLS NOT DISTINCT because one side of a pair is always NULL (a judgment is
-- either record-to-entity or entity-to-entity).
CREATE UNIQUE INDEX IF NOT EXISTS resolution_judgments_current_episode_key
    ON resolution_judgments (vertical_id, left_entity_id, left_source_record_id,
                             right_entity_id, verdict)
    NULLS NOT DISTINCT
    WHERE active;

-- History ordering is by episode number, not by a wall clock that ties when two
-- episodes land in the same run instant.
CREATE UNIQUE INDEX IF NOT EXISTS resolution_judgments_episode_order_key
    ON resolution_judgments (vertical_id, left_entity_id, left_source_record_id,
                             right_entity_id, verdict, episode_seq)
    NULLS NOT DISTINCT;

CREATE INDEX IF NOT EXISTS resolution_judgments_supersedes_idx
    ON resolution_judgments (supersedes_judgment_id)
    WHERE supersedes_judgment_id IS NOT NULL;

COMMENT ON COLUMN resolution_judgments.evidence_fingerprint IS
    'sha256 of the key-ordered evidence this decision rested on. Equal fingerprints on the same '
    'pair mean the same logical event was retried, not that a second decision was made.';
COMMENT ON COLUMN resolution_judgments.decision_fingerprint IS
    'sha256 of the key-ordered decision (verdict, surviving entity, identity confidence).';
COMMENT ON COLUMN resolution_judgments.supersedes_judgment_id IS
    'The episode this one replaces as current. Distinct from reverses_judgment_id, which undoes a '
    'decision; a supersession refines the same open question with newer evidence.';
COMMENT ON COLUMN resolution_judgments.episode_seq IS
    '1-based position of this episode in the pair''s judgment history. Deterministic ordering key.';
