-- 0010_fact_verifications.sql
--
-- The "Source verified" badge, recorded rather than recomputed.
--
-- The badge is the strongest claim the product makes to a customer, and until
-- now it existed only as a pure function: given today's evidence and today's
-- policy, is this value verified? That is enough to render a page and not
-- nearly enough to answer the question that actually gets asked — "your export
-- said this was verified in March; on what basis?" Recomputing it cannot
-- answer that, because both inputs have moved: the evidence may have been
-- superseded and the policy may have been rewritten.
--
-- So a verdict is stored as an event, with everything needed to re-read it
-- later without trusting today's code: the claim it was about, the value that
-- was published, the exact evidence behind it, the outcome and its blockers,
-- the policy version that produced it, and when it was evaluated.
--
-- `policy_version` is the load-bearing column. `verification-policy-v2` refuses
-- a badge that `v1` would have granted (v1 accepted any dated backer; v2
-- requires the *authoritative* backer to be dated). A stored verdict is only
-- interpretable against the version named on it.

CREATE TABLE IF NOT EXISTS fact_verifications (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    -- RESTRICT on BOTH foreign keys, not just fact_id. A CASCADE here would
    -- delete the verdict rows first, which un-blocks the CASCADE from
    -- facts.entity_id and lets one entity delete erase exactly the history this
    -- table exists to keep. The RESTRICT below is only as strong as this one.
    entity_id           UUID        NOT NULL REFERENCES entities (id) ON DELETE RESTRICT,
    property            TEXT        NOT NULL,
    -- RESTRICT, not CASCADE: a verdict outliving the claim it judged would be
    -- unreadable, and a claim is never deleted anyway (AGENTS.md rule 10).
    fact_id             UUID        NOT NULL REFERENCES facts (id) ON DELETE RESTRICT,
    -- The value as published at evaluation time, kept even though the fact row
    -- also holds it: a verdict must stay readable without re-joining a table
    -- whose row may since have been superseded.
    selected_value      JSONB       NOT NULL,
    unit                TEXT            NULL,
    verified            BOOLEAN     NOT NULL,
    reason              TEXT        NOT NULL,
    blockers            TEXT[]      NOT NULL DEFAULT '{}',
    /* The mechanical inputs, so a verdict can be re-derived and disputed. */
    signals             JSONB       NOT NULL,
    /* {artifact_id, content_hash, source_record_id, locator, url} per backer. */
    evidence_refs       JSONB       NOT NULL,
    selection_rule      TEXT        NOT NULL,
    policy_version      TEXT        NOT NULL,
    evaluated_at        TIMESTAMPTZ NOT NULL,
    /* sha256 over outcome + blockers + evidence refs; see the index below. */
    verdict_fingerprint TEXT        NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT fact_verifications_property_format CHECK (property ~ '^[a-z][a-z0-9_]*$'),
    CONSTRAINT fact_verifications_policy_version_present CHECK (policy_version <> ''),
    CONSTRAINT fact_verifications_fingerprint_format
        CHECK (verdict_fingerprint ~ '^[0-9a-f]{64}$'),
    -- A verdict must name its blockers from the declared vocabulary. An
    -- unrecognised code would make a stored refusal unexplainable later, which
    -- is exactly what this table exists to prevent.
    CONSTRAINT fact_verifications_blockers_known CHECK (
        blockers <@ ARRAY[
            'NO_EVIDENCE', 'UNRESOLVED_CONFLICT', 'NO_AUTHORITATIVE_SUPPORT',
            'NON_AUTHORITATIVE_ADJUDICATION', 'RIGHTS_RESTRICTED', 'UNKNOWN_EVIDENCE_DATE'
        ]::text[]
    ),
    -- Verified means nothing blocked it. Storing a "verified" row that also
    -- lists a blocker would record a contradiction as history.
    CONSTRAINT fact_verifications_verified_has_no_blockers CHECK (
        verified = (cardinality(blockers) = 0)
    )
);

-- Re-evaluating an unchanged claim under an unchanged policy is the same
-- verdict, not a new one: without this, every refresh cycle would append a
-- duplicate and the history would be noise. A changed outcome, changed
-- evidence or a bumped policy version all produce a different key and are
-- appended as the new events they are.
CREATE UNIQUE INDEX IF NOT EXISTS fact_verifications_identity_key
    ON fact_verifications (fact_id, policy_version, verdict_fingerprint);
CREATE INDEX IF NOT EXISTS fact_verifications_entity_property_idx
    ON fact_verifications (entity_id, property, evaluated_at DESC);
CREATE INDEX IF NOT EXISTS fact_verifications_policy_version_idx
    ON fact_verifications (policy_version);

COMMENT ON TABLE fact_verifications IS
    'History of "Source verified" verdicts. Append-only: a verdict is an event, and the policy '
    'version stamped on it is what makes an old one still readable after the policy changes.';
COMMENT ON COLUMN fact_verifications.policy_version IS
    'The verification policy that produced this verdict. Never re-interpret a verdict under a '
    'different version: v2 refuses badges v1 granted.';
COMMENT ON COLUMN fact_verifications.evidence_refs IS
    'The exact evidence the verdict rested on, by artifact content hash, so it can be re-checked '
    'against the same bytes rather than against whatever the source says today.';
