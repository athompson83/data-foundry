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

-- Backfill before the unique indexes below can be built.
--
-- Everything written before this migration carries `episode_seq = 1` from the
-- column default, and nothing before this migration constrained the judgment
-- pair — the table comment promises the opposite of a constraint ("Rows are
-- never deleted; a reversal is a new row"). A pair that was merged, reversed
-- and merged again therefore holds two lawful `MERGE` rows, both numbered 1,
-- and `resolution_judgments_episode_order_key` cannot be built over them.
--
-- Numbering is by decision time, so the sequence reproduces the order the
-- decisions were actually made. `created_at` then `id` only break ties between
-- rows that are otherwise indistinguishable; the choice among identical rows is
-- arbitrary but stable, which is what re-running this migration requires.
--
-- Only pre-migration rows are touched, identified by the empty fingerprint that
-- no computed identity can produce. Rows written by the current resolver keep
-- the sequence it assigned them, so re-applying this migration cannot renumber
-- live history.
WITH legacy AS (
    SELECT id,
           row_number() OVER (
               PARTITION BY vertical_id, left_source_record_id,
                            CASE WHEN left_source_record_id IS NULL THEN left_entity_id END,
                            CASE WHEN left_source_record_id IS NULL THEN right_entity_id END
               ORDER BY decided_at, created_at, id
           ) AS seq
      FROM resolution_judgments
     WHERE evidence_fingerprint = ''
)
UPDATE resolution_judgments AS j
   SET episode_seq = legacy.seq::INTEGER
  FROM legacy
 WHERE legacy.id = j.id
   AND j.episode_seq IS DISTINCT FROM legacy.seq::INTEGER;

-- The partial index below admits one active row per pair. Pre-migration history
-- can hold several, because nothing stopped it. The most recent episode stays
-- current; the earlier ones stop speaking for the pair without losing a byte of
-- what they recorded — `active` says which judgment is current, not whether it
-- happened.
WITH superseded AS (
    SELECT id,
           row_number() OVER (
               PARTITION BY vertical_id, left_source_record_id,
                            CASE WHEN left_source_record_id IS NULL THEN left_entity_id END,
                            CASE WHEN left_source_record_id IS NULL THEN right_entity_id END
               ORDER BY episode_seq DESC
           ) AS rank
      FROM resolution_judgments
     WHERE active
)
UPDATE resolution_judgments AS j
   SET active = FALSE
  FROM superseded
 WHERE superseded.id = j.id
   AND superseded.rank > 1;

-- At most one *current* judgment per open question.
--
-- The question matters, and it is not the same on both sides of the table.
--
-- A record-attachment judgment answers "where does this record belong?". The
-- entity it resolved to is the ANSWER. Keying identity on the answer meant that
-- when a record stopped matching one entity and started matching another, the
-- lookup found no current episode and appended a fresh one — leaving two active
-- judgments claiming one record belonged to two different entities, one of them
-- a certain merge into an entity the record had already left.
--
-- An entity-to-entity judgment answers "are these two the same?". There both
-- sides are the question and the verdict is the answer, so a pair told
-- NOT_MERGE and later MERGE supersedes rather than accumulating a second
-- current judgment. `verdict` is excluded from both keys for that reason: it is
-- always the answer, never the question.
CREATE UNIQUE INDEX IF NOT EXISTS resolution_judgments_current_record_key
    ON resolution_judgments (vertical_id, left_source_record_id)
    WHERE active AND left_source_record_id IS NOT NULL;

-- NULLS NOT DISTINCT because an entity-side judgment may leave one end null
-- once a referenced entity is deleted; two such rows are still one question.
CREATE UNIQUE INDEX IF NOT EXISTS resolution_judgments_current_pair_key
    ON resolution_judgments (vertical_id, left_entity_id, right_entity_id)
    NULLS NOT DISTINCT
    WHERE active AND left_source_record_id IS NULL;

-- History ordering is by episode number, not by a wall clock that ties when two
-- episodes land in the same run instant. Partitioned by the same question the
-- currency indexes use, so a number is never reused within one history.
CREATE UNIQUE INDEX IF NOT EXISTS resolution_judgments_record_episode_key
    ON resolution_judgments (vertical_id, left_source_record_id, episode_seq)
    WHERE left_source_record_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS resolution_judgments_pair_episode_key
    ON resolution_judgments (vertical_id, left_entity_id, right_entity_id, episode_seq)
    NULLS NOT DISTINCT
    WHERE left_source_record_id IS NULL;

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
    '1-based position of this episode in the history of one question — where a source record 
    belongs, or whether two entities are the same. Deterministic ordering key.';
