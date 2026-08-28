-- 0014_rights_grant_matrix.sql
--
-- Surface-aware rights decisions with immutable evidence and append-only
-- activation history. Absence is refusal. This migration deliberately creates
-- no ALLOW decision from rights_classification or the legacy registry booleans.
--
-- PostgreSQL 15+ is required: sparse scope identity depends on
-- UNIQUE ... NULLS NOT DISTINCT. CI and production verification target PG16.

CREATE TABLE IF NOT EXISTS rights_publishers (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    publisher_key TEXT        NOT NULL,
    legal_name    TEXT        NOT NULL,
    status        TEXT        NOT NULL DEFAULT 'ACTIVE',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT rights_publishers_key_format
        CHECK (publisher_key ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
    CONSTRAINT rights_publishers_name_nonempty CHECK (btrim(legal_name) <> ''),
    CONSTRAINT rights_publishers_status_allowed
        CHECK (status IN ('ACTIVE', 'PROHIBITED', 'RETIRED'))
);

CREATE UNIQUE INDEX IF NOT EXISTS rights_publishers_key_key
    ON rights_publishers (publisher_key);

ALTER TABLE sources ADD COLUMN IF NOT EXISTS rights_publisher_id UUID NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'sources_rights_publisher_fk'
    ) THEN
        ALTER TABLE sources
            ADD CONSTRAINT sources_rights_publisher_fk
            FOREIGN KEY (rights_publisher_id) REFERENCES rights_publishers (id) ON DELETE RESTRICT;
    END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS sources_rights_publisher_idx ON sources (rights_publisher_id);

-- The acquisition package already stamped artifacts with a policy-snapshot UUID,
-- but the production pipeline kept the referenced record only in process memory.
-- Persist the complete, content-addressed snapshot before any artifact may cite it.
CREATE TABLE IF NOT EXISTS acquisition_policy_snapshots (
    id            UUID PRIMARY KEY,
    snapshot_hash TEXT        NOT NULL,
    captured_at   TIMESTAMPTZ NOT NULL,
    snapshot      JSONB       NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT acquisition_policy_snapshots_hash_format
        CHECK (snapshot_hash ~ '^[0-9a-f]{64}$'),
    CONSTRAINT acquisition_policy_snapshots_object
        CHECK (jsonb_typeof(snapshot) = 'object'),
    CONSTRAINT acquisition_policy_snapshots_id_matches
        CHECK (snapshot ->> 'id' = id::text),
    CONSTRAINT acquisition_policy_snapshots_hash_matches
        CHECK (snapshot ->> 'snapshot_hash' = snapshot_hash)
);

CREATE UNIQUE INDEX IF NOT EXISTS acquisition_policy_snapshots_hash_key
    ON acquisition_policy_snapshots (snapshot_hash);

ALTER TABLE source_artifacts
    ADD COLUMN IF NOT EXISTS acquisition_route TEXT NULL,
    ADD COLUMN IF NOT EXISTS account_or_product_plan TEXT NULL,
    ADD COLUMN IF NOT EXISTS acquisition_jurisdiction TEXT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'source_artifacts_acquisition_route_allowed'
    ) THEN
        ALTER TABLE source_artifacts
            ADD CONSTRAINT source_artifacts_acquisition_route_allowed CHECK (
                acquisition_route IS NULL OR acquisition_route IN (
                    'DIRECT_HTTP', 'BROWSER_RUN', 'CRAWL4AI', 'VENDOR_API',
                    'SITEMAP', 'BULK_FILE', 'RSS', 'MANUAL_UPLOAD'
                )
            );
    END IF;
END;
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'source_artifacts_acquisition_plan_nonempty'
    ) THEN
        ALTER TABLE source_artifacts
            ADD CONSTRAINT source_artifacts_acquisition_plan_nonempty CHECK (
                account_or_product_plan IS NULL OR btrim(account_or_product_plan) <> ''
            );
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'source_artifacts_acquisition_jurisdiction_nonempty'
    ) THEN
        ALTER TABLE source_artifacts
            ADD CONSTRAINT source_artifacts_acquisition_jurisdiction_nonempty CHECK (
                acquisition_jurisdiction IS NULL OR btrim(acquisition_jurisdiction) <> ''
            );
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'source_artifacts_acquisition_route_required'
    ) THEN
        -- Existing rows cannot be assigned a route without manufacturing
        -- provenance. NOT VALID preserves those legacy rows while enforcing the
        -- requirement for every new/updated artifact.
        ALTER TABLE source_artifacts
            ADD CONSTRAINT source_artifacts_acquisition_route_required
            CHECK (acquisition_route IS NOT NULL) NOT VALID;
    END IF;
END;
$$;

-- Identical bytes acquired under different contractual scopes are distinct
-- evidence objects even though they share one content-addressed R2 object.
DROP INDEX IF EXISTS source_artifacts_identity_key;
CREATE UNIQUE INDEX source_artifacts_identity_key
    ON source_artifacts (
        source_id, url, content_hash, acquisition_route,
        account_or_product_plan, acquisition_jurisdiction
    ) NULLS NOT DISTINCT;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
          FROM source_artifacts artifact
          LEFT JOIN acquisition_policy_snapshots snapshot
            ON snapshot.id = artifact.policy_snapshot_id
         WHERE artifact.policy_snapshot_id IS NOT NULL
           AND snapshot.id IS NULL
    ) THEN
        RAISE EXCEPTION
            'cannot enforce acquisition policy snapshot provenance: legacy artifact references an unavailable snapshot'
            USING ERRCODE = '23503',
                  HINT = 'Restore the exact historical snapshot record; do not synthesize or clear the reference.';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'source_artifacts_policy_snapshot_fk'
    ) THEN
        ALTER TABLE source_artifacts
            ADD CONSTRAINT source_artifacts_policy_snapshot_fk
            FOREIGN KEY (policy_snapshot_id)
            REFERENCES acquisition_policy_snapshots (id) ON DELETE RESTRICT;
    END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS rights_evidence_artifacts (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    kind           TEXT        NOT NULL,
    canonical_uri  TEXT        NOT NULL,
    storage_uri    TEXT        NOT NULL,
    content_sha256 TEXT        NOT NULL,
    mime_type      TEXT        NOT NULL,
    captured_at    TIMESTAMPTZ NOT NULL,
    created_by     TEXT        NOT NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT rights_evidence_kind_allowed CHECK (kind IN (
        'TERMS', 'AGREEMENT', 'POLICY', 'CORRESPONDENCE', 'REVIEW_MEMO'
    )),
    CONSTRAINT rights_evidence_canonical_uri_nonempty CHECK (btrim(canonical_uri) <> ''),
    CONSTRAINT rights_evidence_storage_uri_nonempty CHECK (btrim(storage_uri) <> ''),
    CONSTRAINT rights_evidence_hash_format CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
    CONSTRAINT rights_evidence_mime_nonempty CHECK (btrim(mime_type) <> ''),
    CONSTRAINT rights_evidence_creator_nonempty CHECK (btrim(created_by) <> '')
);

CREATE UNIQUE INDEX IF NOT EXISTS rights_evidence_storage_hash_key
    ON rights_evidence_artifacts (storage_uri, content_sha256);

ALTER TABLE sources
    ADD COLUMN IF NOT EXISTS rights_publisher_mapping_evidence_artifact_id UUID NULL,
    ADD COLUMN IF NOT EXISTS rights_publisher_mapping_reviewer_type TEXT NULL,
    ADD COLUMN IF NOT EXISTS rights_publisher_mapping_reviewed_by TEXT NULL,
    ADD COLUMN IF NOT EXISTS rights_publisher_mapping_reviewed_at TIMESTAMPTZ NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'sources_rights_publisher_mapping_evidence_fk'
           AND conrelid = 'sources'::regclass
    ) THEN
        ALTER TABLE sources
            ADD CONSTRAINT sources_rights_publisher_mapping_evidence_fk
            FOREIGN KEY (rights_publisher_mapping_evidence_artifact_id)
            REFERENCES rights_evidence_artifacts (id) ON DELETE RESTRICT;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'sources_rights_publisher_mapping_complete'
           AND conrelid = 'sources'::regclass
    ) THEN
        ALTER TABLE sources
            ADD CONSTRAINT sources_rights_publisher_mapping_complete CHECK (
                (rights_publisher_id IS NULL AND
                 rights_publisher_mapping_evidence_artifact_id IS NULL AND
                 rights_publisher_mapping_reviewer_type IS NULL AND
                 rights_publisher_mapping_reviewed_by IS NULL AND
                 rights_publisher_mapping_reviewed_at IS NULL)
                OR
                (rights_publisher_id IS NOT NULL AND
                 rights_publisher_mapping_evidence_artifact_id IS NOT NULL AND
                 rights_publisher_mapping_reviewer_type IN ('HUMAN', 'COUNSEL') AND
                 rights_publisher_mapping_reviewed_by IS NOT NULL AND
                 btrim(rights_publisher_mapping_reviewed_by) <> '' AND
                 rights_publisher_mapping_reviewed_at IS NOT NULL)
            );
    END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS rights_terms_cells (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    publisher_id            UUID NULL REFERENCES rights_publishers (id) ON DELETE RESTRICT,
    source_id               UUID NULL REFERENCES sources (id) ON DELETE RESTRICT,
    acquisition_route       TEXT NULL,
    account_or_product_plan TEXT NULL,
    jurisdiction            TEXT NULL,
    created_by              TEXT        NOT NULL,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT rights_terms_cells_one_subject
        CHECK ((publisher_id IS NULL) <> (source_id IS NULL)),
    CONSTRAINT rights_terms_cells_route_allowed CHECK (
        acquisition_route IS NULL OR acquisition_route IN (
            'DIRECT_HTTP', 'BROWSER_RUN', 'CRAWL4AI', 'VENDOR_API',
            'SITEMAP', 'BULK_FILE', 'RSS', 'MANUAL_UPLOAD'
        )
    ),
    CONSTRAINT rights_terms_cells_plan_nonempty
        CHECK (account_or_product_plan IS NULL OR btrim(account_or_product_plan) <> ''),
    CONSTRAINT rights_terms_cells_jurisdiction_nonempty
        CHECK (jurisdiction IS NULL OR btrim(jurisdiction) <> ''),
    CONSTRAINT rights_terms_cells_creator_nonempty CHECK (btrim(created_by) <> '')
);

CREATE UNIQUE INDEX IF NOT EXISTS rights_terms_cells_scope_key
    ON rights_terms_cells (
        publisher_id, source_id, acquisition_route, account_or_product_plan, jurisdiction
    ) NULLS NOT DISTINCT;

CREATE TABLE IF NOT EXISTS rights_terms_versions (
    id                           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    terms_cell_id                UUID        NOT NULL REFERENCES rights_terms_cells (id) ON DELETE RESTRICT,
    evidence_artifact_id         UUID        NOT NULL REFERENCES rights_evidence_artifacts (id) ON DELETE RESTRICT,
    content_sha256               TEXT        NOT NULL,
    version_label                TEXT        NOT NULL,
    effective_from               TIMESTAMPTZ NOT NULL,
    effective_until              TIMESTAMPTZ NULL,
    recheck_at                   TIMESTAMPTZ NOT NULL,
    supersedes_terms_version_id  UUID NULL REFERENCES rights_terms_versions (id) ON DELETE RESTRICT,
    created_by                   TEXT        NOT NULL,
    created_at                   TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT rights_terms_versions_hash_format CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
    CONSTRAINT rights_terms_versions_label_nonempty CHECK (btrim(version_label) <> ''),
    CONSTRAINT rights_terms_versions_effective_order CHECK (
        effective_until IS NULL OR effective_until > effective_from
    ),
    CONSTRAINT rights_terms_versions_recheck_order CHECK (recheck_at > effective_from),
    CONSTRAINT rights_terms_versions_no_self_supersede CHECK (
        supersedes_terms_version_id IS NULL OR supersedes_terms_version_id <> id
    ),
    CONSTRAINT rights_terms_versions_creator_nonempty CHECK (btrim(created_by) <> '')
);

CREATE UNIQUE INDEX IF NOT EXISTS rights_terms_versions_cell_label_key
    ON rights_terms_versions (terms_cell_id, version_label);
CREATE INDEX IF NOT EXISTS rights_terms_versions_supersedes_key
    ON rights_terms_versions (supersedes_terms_version_id)
    WHERE supersedes_terms_version_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS rights_terms_activation_events (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    terms_cell_id    UUID        NOT NULL REFERENCES rights_terms_cells (id) ON DELETE RESTRICT,
    terms_version_id UUID        NOT NULL REFERENCES rights_terms_versions (id) ON DELETE RESTRICT,
    sequence_no      BIGINT      NOT NULL,
    state            TEXT        NOT NULL,
    actor_type       TEXT        NOT NULL,
    actor            TEXT        NOT NULL,
    reason           TEXT        NOT NULL,
    occurred_at      TIMESTAMPTZ NOT NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT rights_terms_activation_state_allowed CHECK (state IN ('ACTIVE', 'REVOKED')),
    CONSTRAINT rights_terms_activation_actor_type_allowed
        CHECK (actor_type IN ('AUTOMATED', 'HUMAN', 'COUNSEL')),
    CONSTRAINT rights_terms_activation_actor_nonempty CHECK (btrim(actor) <> ''),
    CONSTRAINT rights_terms_activation_reason_nonempty CHECK (btrim(reason) <> ''),
    CONSTRAINT rights_terms_activation_sequence_positive CHECK (sequence_no > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS rights_terms_activation_cell_sequence_key
    ON rights_terms_activation_events (terms_cell_id, sequence_no);

CREATE OR REPLACE FUNCTION rights_validate_terms_version()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    evidence_hash TEXT;
    superseded_cell UUID;
BEGIN
    SELECT content_sha256 INTO evidence_hash
      FROM rights_evidence_artifacts WHERE id = NEW.evidence_artifact_id;
    IF evidence_hash IS DISTINCT FROM NEW.content_sha256 THEN
        RAISE EXCEPTION 'rights terms hash must equal its immutable evidence hash'
            USING ERRCODE = '23514';
    END IF;
    IF NEW.supersedes_terms_version_id IS NOT NULL THEN
        SELECT terms_cell_id INTO superseded_cell
          FROM rights_terms_versions WHERE id = NEW.supersedes_terms_version_id;
        IF superseded_cell IS DISTINCT FROM NEW.terms_cell_id THEN
            RAISE EXCEPTION 'a terms version may supersede only a version in the same cell'
                USING ERRCODE = '23514';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER rights_terms_versions_validate_insert
    BEFORE INSERT ON rights_terms_versions
    FOR EACH ROW EXECUTE FUNCTION rights_validate_terms_version();

CREATE OR REPLACE FUNCTION rights_prepare_terms_activation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    selected_version rights_terms_versions%ROWTYPE;
    prior_event rights_terms_activation_events%ROWTYPE;
BEGIN
    SELECT * INTO selected_version
      FROM rights_terms_versions WHERE id = NEW.terms_version_id;
    IF selected_version.id IS NULL OR selected_version.terms_cell_id IS DISTINCT FROM NEW.terms_cell_id THEN
        RAISE EXCEPTION 'terms activation must name the version''s exact cell'
            USING ERRCODE = '23514';
    END IF;
    PERFORM id FROM rights_terms_cells WHERE id = NEW.terms_cell_id FOR UPDATE;
    IF NEW.occurred_at > clock_timestamp() THEN
        RAISE EXCEPTION 'rights terms activation cannot be future-dated'
            USING ERRCODE = '23514';
    END IF;
    SELECT * INTO prior_event
      FROM rights_terms_activation_events
     WHERE terms_cell_id = NEW.terms_cell_id
     ORDER BY sequence_no DESC LIMIT 1;
    IF prior_event.id IS NOT NULL AND NEW.occurred_at <= prior_event.occurred_at THEN
        RAISE EXCEPTION 'rights terms activation history must move forward in time'
            USING ERRCODE = '23514';
    END IF;
    IF NEW.state = 'ACTIVE' THEN
        IF NEW.actor_type NOT IN ('HUMAN', 'COUNSEL') THEN
            RAISE EXCEPTION 'only a human or counsel may activate controlling terms'
                USING ERRCODE = '23514';
        END IF;
        IF EXISTS (
            SELECT 1 FROM rights_terms_activation_events
             WHERE terms_version_id = NEW.terms_version_id
        ) THEN
            RAISE EXCEPTION 'a terms version is activated at most once; revocation is terminal'
                USING ERRCODE = '23514';
        END IF;
        IF prior_event.id IS NULL THEN
            IF selected_version.supersedes_terms_version_id IS NOT NULL THEN
                RAISE EXCEPTION 'the first active terms version cannot supersede an absent current version'
                    USING ERRCODE = '23514';
            END IF;
        ELSIF selected_version.supersedes_terms_version_id IS DISTINCT FROM prior_event.terms_version_id THEN
            RAISE EXCEPTION 'new active terms must explicitly supersede the prior current version'
                USING ERRCODE = '23514';
        END IF;
    ELSE
        IF prior_event.id IS NULL OR prior_event.state <> 'ACTIVE' OR
           prior_event.terms_version_id IS DISTINCT FROM NEW.terms_version_id THEN
            RAISE EXCEPTION 'revocation must target the exact current active terms version'
                USING ERRCODE = '23514';
        END IF;
    END IF;
    SELECT COALESCE(max(sequence_no), 0) + 1 INTO NEW.sequence_no
      FROM rights_terms_activation_events WHERE terms_cell_id = NEW.terms_cell_id;
    RETURN NEW;
END;
$$;

CREATE TRIGGER rights_terms_activation_prepare_insert
    BEFORE INSERT ON rights_terms_activation_events
    FOR EACH ROW EXECUTE FUNCTION rights_prepare_terms_activation();

CREATE OR REPLACE FUNCTION activate_rights_terms(
    p_terms_version_id UUID,
    p_actor_type TEXT,
    p_actor TEXT,
    p_reason TEXT,
    p_occurred_at TIMESTAMPTZ DEFAULT now()
)
RETURNS BIGINT
LANGUAGE plpgsql
AS $$
DECLARE
    target_cell UUID;
    assigned_sequence BIGINT;
BEGIN
    SELECT terms_cell_id INTO target_cell
      FROM rights_terms_versions WHERE id = p_terms_version_id;
    IF target_cell IS NULL THEN
        RAISE EXCEPTION 'unknown rights terms version %', p_terms_version_id
            USING ERRCODE = '23503';
    END IF;
    INSERT INTO rights_terms_activation_events
        (terms_cell_id, terms_version_id, sequence_no, state, actor_type, actor, reason, occurred_at)
    VALUES
        (target_cell, p_terms_version_id, 1, 'ACTIVE', p_actor_type, p_actor, p_reason, p_occurred_at)
    RETURNING sequence_no INTO assigned_sequence;
    RETURN assigned_sequence;
END;
$$;

CREATE OR REPLACE FUNCTION revoke_rights_terms(
    p_terms_version_id UUID,
    p_actor_type TEXT,
    p_actor TEXT,
    p_reason TEXT,
    p_occurred_at TIMESTAMPTZ DEFAULT now()
)
RETURNS BIGINT
LANGUAGE plpgsql
AS $$
DECLARE
    target_cell UUID;
    assigned_sequence BIGINT;
BEGIN
    SELECT terms_cell_id INTO target_cell
      FROM rights_terms_versions WHERE id = p_terms_version_id;
    IF target_cell IS NULL THEN
        RAISE EXCEPTION 'unknown rights terms version %', p_terms_version_id
            USING ERRCODE = '23503';
    END IF;
    INSERT INTO rights_terms_activation_events
        (terms_cell_id, terms_version_id, sequence_no, state, actor_type, actor, reason, occurred_at)
    VALUES
        (target_cell, p_terms_version_id, 1, 'REVOKED', p_actor_type, p_actor, p_reason, p_occurred_at)
    RETURNING sequence_no INTO assigned_sequence;
    RETURN assigned_sequence;
END;
$$;

CREATE OR REPLACE VIEW current_rights_terms AS
SELECT DISTINCT ON (event.terms_cell_id)
       event.terms_cell_id,
       event.terms_version_id,
       event.sequence_no,
       event.state,
       event.actor_type,
       event.actor,
       event.reason,
       event.occurred_at
  FROM rights_terms_activation_events event
 WHERE event.occurred_at <= CURRENT_TIMESTAMP
 ORDER BY event.terms_cell_id, event.sequence_no DESC;

CREATE TABLE IF NOT EXISTS rights_field_groups (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id   UUID        NOT NULL REFERENCES sources (id) ON DELETE RESTRICT,
    group_key   TEXT        NOT NULL,
    name        TEXT        NOT NULL,
    created_by  TEXT        NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT rights_field_groups_key_format CHECK (group_key ~ '^[a-z][a-z0-9_]*$'),
    CONSTRAINT rights_field_groups_name_nonempty CHECK (btrim(name) <> ''),
    CONSTRAINT rights_field_groups_creator_nonempty CHECK (btrim(created_by) <> '')
);

CREATE UNIQUE INDEX IF NOT EXISTS rights_field_groups_source_key
    ON rights_field_groups (source_id, group_key);
CREATE UNIQUE INDEX IF NOT EXISTS rights_field_groups_id_source_key
    ON rights_field_groups (id, source_id);

CREATE TABLE IF NOT EXISTS rights_field_group_members (
    field_group_id UUID        NOT NULL,
    source_id      UUID        NOT NULL,
    field_key      TEXT        NOT NULL,
    created_by     TEXT        NOT NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

    PRIMARY KEY (field_group_id, field_key),
    CONSTRAINT rights_field_group_members_group_fk
        FOREIGN KEY (field_group_id, source_id)
        REFERENCES rights_field_groups (id, source_id) ON DELETE RESTRICT,
    CONSTRAINT rights_field_group_members_field_format CHECK (field_key ~ '^[a-z][a-z0-9_]*$'),
    CONSTRAINT rights_field_group_members_creator_nonempty CHECK (btrim(created_by) <> '')
);

CREATE UNIQUE INDEX IF NOT EXISTS rights_field_group_members_nonoverlap_key
    ON rights_field_group_members (source_id, field_key);

CREATE TABLE IF NOT EXISTS rights_cells (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    publisher_id            UUID NULL REFERENCES rights_publishers (id) ON DELETE RESTRICT,
    source_id               UUID NULL REFERENCES sources (id) ON DELETE RESTRICT,
    acquisition_route       TEXT NULL,
    account_or_product_plan TEXT NULL,
    jurisdiction            TEXT NULL,
    asset_class             TEXT NULL,
    field_key               TEXT NULL,
    field_group_id          UUID NULL REFERENCES rights_field_groups (id) ON DELETE RESTRICT,
    output_class            TEXT NULL,
    operation               TEXT        NOT NULL,
    channel                 TEXT        NOT NULL,
    created_by              TEXT        NOT NULL,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT rights_cells_one_subject CHECK ((publisher_id IS NULL) <> (source_id IS NULL)),
    CONSTRAINT rights_cells_one_field_scope CHECK (field_key IS NULL OR field_group_id IS NULL),
    CONSTRAINT rights_cells_field_scope_requires_source CHECK (
        (field_key IS NULL AND field_group_id IS NULL) OR source_id IS NOT NULL
    ),
    CONSTRAINT rights_cells_field_format CHECK (field_key IS NULL OR field_key ~ '^[a-z][a-z0-9_]*$'),
    CONSTRAINT rights_cells_route_allowed CHECK (
        acquisition_route IS NULL OR acquisition_route IN (
            'DIRECT_HTTP', 'BROWSER_RUN', 'CRAWL4AI', 'VENDOR_API',
            'SITEMAP', 'BULK_FILE', 'RSS', 'MANUAL_UPLOAD'
        )
    ),
    CONSTRAINT rights_cells_asset_class_allowed CHECK (
        asset_class IS NULL OR asset_class IN ('DATA', 'DOCUMENT', 'IMAGE', 'TRADEMARK', 'PERSONAL_DATA')
    ),
    CONSTRAINT rights_cells_output_class_allowed CHECK (
        output_class IS NULL OR output_class IN (
            'RAW_RECORD', 'NORMALIZED_FACT', 'DERIVED_METRIC',
            'METADATA', 'IMAGE_OR_MEDIA', 'PERSONAL_DATA'
        )
    ),
    CONSTRAINT rights_cells_operation_allowed CHECK (operation IN (
        'ACQUIRE', 'STORE', 'NORMALIZE', 'DERIVE', 'DISPLAY_PUBLICLY',
        'BUILD_COMPARISON_TOOLS', 'QUOTE_OR_EXCERPT', 'SERVE_API_ACCESS',
        'SELL_API_ACCESS', 'REDISTRIBUTE_RAW', 'REDISTRIBUTE_NORMALIZED',
        'OFFER_BULK_EXPORT', 'SUBLICENSE_ACCESS', 'LLM_RETRIEVAL',
        'DELIVER_TO_PARTNERS', 'TRAIN_MODELS', 'EVALUATE_MODELS', 'CACHE',
        'RETAIN_AFTER_TERMINATION'
    )),
    CONSTRAINT rights_cells_channel_allowed CHECK (channel IN (
        'INTERNAL_PROCESSING', 'PUBLIC_WEBSITE', 'SEARCH_INDEX',
        'DIRECT_CUSTOMER_API', 'RAPIDAPI_MARKETPLACE', 'MCP_AGENT',
        'BULK_DOWNLOAD', 'PARTNER_DELIVERY', 'MODEL_PIPELINE'
    )),
    CONSTRAINT rights_cells_plan_nonempty
        CHECK (account_or_product_plan IS NULL OR btrim(account_or_product_plan) <> ''),
    CONSTRAINT rights_cells_jurisdiction_nonempty
        CHECK (jurisdiction IS NULL OR btrim(jurisdiction) <> ''),
    CONSTRAINT rights_cells_creator_nonempty CHECK (btrim(created_by) <> '')
);

CREATE UNIQUE INDEX IF NOT EXISTS rights_cells_scope_key
    ON rights_cells (
        publisher_id, source_id, acquisition_route, account_or_product_plan,
        jurisdiction, asset_class, field_key, field_group_id, output_class,
        operation, channel
    ) NULLS NOT DISTINCT;

CREATE OR REPLACE FUNCTION rights_validate_cell_field_group()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    group_source UUID;
BEGIN
    IF NEW.field_group_id IS NULL THEN
        RETURN NEW;
    END IF;
    SELECT source_id INTO group_source FROM rights_field_groups WHERE id = NEW.field_group_id;
    IF group_source IS NULL OR group_source IS DISTINCT FROM NEW.source_id THEN
        RAISE EXCEPTION 'rights field group must belong to the cell source'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER rights_cells_validate_field_group_insert
    BEFORE INSERT ON rights_cells
    FOR EACH ROW EXECUTE FUNCTION rights_validate_cell_field_group();

CREATE TABLE IF NOT EXISTS rights_decisions (
    id                           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cell_id                      UUID        NOT NULL REFERENCES rights_cells (id) ON DELETE RESTRICT,
    state                        TEXT        NOT NULL,
    controlling_terms_version_id UUID NULL REFERENCES rights_terms_versions (id) ON DELETE RESTRICT,
    evidence_artifact_id         UUID NULL REFERENCES rights_evidence_artifacts (id) ON DELETE RESTRICT,
    clause_ref                   TEXT NULL,
    review_status                TEXT        NOT NULL,
    reviewer_type                TEXT        NOT NULL,
    reviewed_by                  TEXT NULL,
    reviewed_at                  TIMESTAMPTZ NOT NULL,
    effective_from               TIMESTAMPTZ NULL,
    effective_until              TIMESTAMPTZ NULL,
    recheck_at                   TIMESTAMPTZ NULL,
    rationale                    TEXT        NOT NULL,
    supersedes_decision_id       UUID NULL REFERENCES rights_decisions (id) ON DELETE RESTRICT,
    created_by                   TEXT        NOT NULL,
    created_at                   TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT rights_decisions_state_allowed CHECK (
        state IN ('ALLOW', 'DENY', 'CONDITIONAL', 'UNKNOWN', 'NOT_APPLICABLE')
    ),
    CONSTRAINT rights_decisions_review_status_allowed
        CHECK (review_status IN ('ASSESSMENT', 'APPROVED', 'REJECTED')),
    CONSTRAINT rights_decisions_reviewer_type_allowed
        CHECK (reviewer_type IN ('AUTOMATED', 'HUMAN', 'COUNSEL')),
    CONSTRAINT rights_decisions_effective_order CHECK (
        effective_until IS NULL OR (effective_from IS NOT NULL AND effective_until > effective_from)
    ),
    CONSTRAINT rights_decisions_permission_evidence CHECK (
        state NOT IN ('ALLOW', 'CONDITIONAL') OR (
            controlling_terms_version_id IS NOT NULL AND
            evidence_artifact_id IS NOT NULL AND
            clause_ref IS NOT NULL AND btrim(clause_ref) <> '' AND
            reviewed_by IS NOT NULL AND btrim(reviewed_by) <> '' AND
            effective_from IS NOT NULL AND recheck_at IS NOT NULL AND
            recheck_at > effective_from
        )
    ),
    CONSTRAINT rights_decisions_rationale_nonempty CHECK (btrim(rationale) <> ''),
    CONSTRAINT rights_decisions_creator_nonempty CHECK (btrim(created_by) <> ''),
    CONSTRAINT rights_decisions_no_self_supersede CHECK (
        supersedes_decision_id IS NULL OR supersedes_decision_id <> id
    )
);

CREATE INDEX IF NOT EXISTS rights_decisions_supersedes_key
    ON rights_decisions (supersedes_decision_id)
    WHERE supersedes_decision_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS rights_decision_conditions (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    decision_id      UUID        NOT NULL REFERENCES rights_decisions (id) ON DELETE RESTRICT,
    condition_key    TEXT        NOT NULL,
    condition_type   TEXT        NOT NULL,
    evaluator_key    TEXT        NOT NULL,
    evaluator_version TEXT       NOT NULL,
    parameters_sha256 TEXT       NOT NULL,
    parameters       JSONB       NOT NULL,
    parameters_canonical TEXT GENERATED ALWAYS AS (parameters::text) STORED,
    audit_required   BOOLEAN     NOT NULL DEFAULT true,
    created_by       TEXT        NOT NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT rights_decision_conditions_key_format
        CHECK (condition_key ~ '^[a-z][a-z0-9_]*$'),
    CONSTRAINT rights_decision_conditions_type_allowed CHECK (condition_type IN (
        'ATTRIBUTION', 'FRESHNESS', 'VOLUME_CAP', 'PURPOSE_LIMITATION', 'JURISDICTION', 'OTHER'
    )),
    CONSTRAINT rights_decision_conditions_evaluator_format
        CHECK (evaluator_key ~ '^[a-z][a-z0-9_.-]*$'),
    CONSTRAINT rights_decision_conditions_version_nonempty CHECK (btrim(evaluator_version) <> ''),
    CONSTRAINT rights_decision_conditions_parameters_hash
        CHECK (
            parameters_sha256 ~ '^[0-9a-f]{64}$' AND
            parameters_sha256 = encode(
                sha256(convert_to(parameters::text, 'UTF8')),
                'hex'
            )
        ),
    CONSTRAINT rights_decision_conditions_parameters_object
        CHECK (jsonb_typeof(parameters) = 'object'),
    CONSTRAINT rights_decision_conditions_creator_nonempty CHECK (btrim(created_by) <> '')
);

CREATE UNIQUE INDEX IF NOT EXISTS rights_decision_conditions_decision_key
    ON rights_decision_conditions (decision_id, condition_key);

CREATE OR REPLACE FUNCTION rights_validate_condition_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM rights_decision_activation_events
         WHERE decision_id = NEW.decision_id
    ) THEN
        RAISE EXCEPTION 'conditions are frozen when their decision is first activated'
            USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION rights_validate_decision_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    superseded_cell UUID;
BEGIN
    IF NEW.supersedes_decision_id IS NOT NULL THEN
        SELECT cell_id INTO superseded_cell
          FROM rights_decisions WHERE id = NEW.supersedes_decision_id;
        IF superseded_cell IS DISTINCT FROM NEW.cell_id THEN
            RAISE EXCEPTION 'a rights decision may supersede only a decision in the same cell'
                USING ERRCODE = '23514';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER rights_decisions_validate_insert
    BEFORE INSERT ON rights_decisions
    FOR EACH ROW EXECUTE FUNCTION rights_validate_decision_insert();

CREATE TABLE IF NOT EXISTS rights_decision_activation_events (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cell_id     UUID        NOT NULL REFERENCES rights_cells (id) ON DELETE RESTRICT,
    decision_id UUID        NOT NULL REFERENCES rights_decisions (id) ON DELETE RESTRICT,
    sequence_no BIGINT      NOT NULL,
    actor_type  TEXT        NOT NULL,
    actor       TEXT        NOT NULL,
    reason      TEXT        NOT NULL,
    occurred_at TIMESTAMPTZ NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT rights_decision_activation_actor_type_allowed
        CHECK (actor_type IN ('AUTOMATED', 'HUMAN', 'COUNSEL')),
    CONSTRAINT rights_decision_activation_actor_nonempty CHECK (btrim(actor) <> ''),
    CONSTRAINT rights_decision_activation_reason_nonempty CHECK (btrim(reason) <> ''),
    CONSTRAINT rights_decision_activation_sequence_positive CHECK (sequence_no > 0)
);

CREATE TRIGGER rights_decision_conditions_validate_insert
    BEFORE INSERT ON rights_decision_conditions
    FOR EACH ROW EXECUTE FUNCTION rights_validate_condition_insert();

CREATE UNIQUE INDEX IF NOT EXISTS rights_decision_activation_cell_sequence_key
    ON rights_decision_activation_events (cell_id, sequence_no);

CREATE OR REPLACE VIEW current_rights_decisions AS
SELECT DISTINCT ON (event.cell_id)
       event.cell_id,
       event.decision_id,
       decision.state,
       event.sequence_no,
       event.actor_type,
       event.actor,
       event.reason,
       event.occurred_at
  FROM rights_decision_activation_events event
  JOIN rights_decisions decision ON decision.id = event.decision_id
 WHERE event.occurred_at <= CURRENT_TIMESTAMP
 ORDER BY event.cell_id, event.sequence_no DESC;

CREATE OR REPLACE FUNCTION rights_terms_cover_cell(
    p_terms_version_id UUID,
    p_cell_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    terms_scope rights_terms_cells%ROWTYPE;
    cell_scope rights_cells%ROWTYPE;
    mapped_publisher UUID;
BEGIN
    SELECT cell.* INTO terms_scope
      FROM rights_terms_versions version
      JOIN rights_terms_cells cell ON cell.id = version.terms_cell_id
     WHERE version.id = p_terms_version_id;
    SELECT * INTO cell_scope FROM rights_cells WHERE id = p_cell_id;
    IF terms_scope.id IS NULL OR cell_scope.id IS NULL THEN RETURN false; END IF;

    IF terms_scope.source_id IS NOT NULL THEN
        IF cell_scope.source_id IS DISTINCT FROM terms_scope.source_id THEN RETURN false; END IF;
    ELSE
        IF cell_scope.publisher_id IS NOT NULL THEN
            IF cell_scope.publisher_id IS DISTINCT FROM terms_scope.publisher_id THEN RETURN false; END IF;
        ELSE
            SELECT rights_publisher_id INTO mapped_publisher FROM sources WHERE id = cell_scope.source_id;
            IF mapped_publisher IS DISTINCT FROM terms_scope.publisher_id THEN RETURN false; END IF;
        END IF;
    END IF;

    IF terms_scope.acquisition_route IS NOT NULL AND
       cell_scope.acquisition_route IS DISTINCT FROM terms_scope.acquisition_route THEN RETURN false; END IF;
    IF terms_scope.account_or_product_plan IS NOT NULL AND
       cell_scope.account_or_product_plan IS DISTINCT FROM terms_scope.account_or_product_plan THEN RETURN false; END IF;
    IF terms_scope.jurisdiction IS NOT NULL AND
       cell_scope.jurisdiction IS DISTINCT FROM terms_scope.jurisdiction THEN RETURN false; END IF;
    RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION rights_prepare_decision_activation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    selected_decision rights_decisions%ROWTYPE;
    selected_terms rights_terms_versions%ROWTYPE;
    current_terms_record RECORD;
    prior_event rights_decision_activation_events%ROWTYPE;
    condition_count BIGINT;
BEGIN
    SELECT * INTO selected_decision FROM rights_decisions WHERE id = NEW.decision_id;
    IF selected_decision.id IS NULL OR selected_decision.cell_id IS DISTINCT FROM NEW.cell_id THEN
        RAISE EXCEPTION 'decision activation must name the decision''s exact cell'
            USING ERRCODE = '23514';
    END IF;

    PERFORM id FROM rights_cells WHERE id = NEW.cell_id FOR UPDATE;
    IF NEW.occurred_at > clock_timestamp() THEN
        RAISE EXCEPTION 'rights decision activation cannot be future-dated'
            USING ERRCODE = '23514';
    END IF;
    IF EXISTS (
        SELECT 1 FROM rights_decision_activation_events
         WHERE decision_id = NEW.decision_id
    ) THEN
        RAISE EXCEPTION 'a rights decision version may be activated only once'
            USING ERRCODE = '23514';
    END IF;
    SELECT * INTO prior_event
      FROM rights_decision_activation_events
     WHERE cell_id = NEW.cell_id ORDER BY sequence_no DESC LIMIT 1;
    IF prior_event.id IS NOT NULL AND NEW.occurred_at <= prior_event.occurred_at THEN
        RAISE EXCEPTION 'rights decision activation history must move forward in time'
            USING ERRCODE = '23514';
    END IF;
    IF prior_event.id IS NULL THEN
        IF selected_decision.supersedes_decision_id IS NOT NULL THEN
            RAISE EXCEPTION 'the first active decision in a cell cannot supersede an absent current decision'
                USING ERRCODE = '23514';
        END IF;
    ELSIF selected_decision.supersedes_decision_id IS DISTINCT FROM prior_event.decision_id THEN
        RAISE EXCEPTION 'new current decision must explicitly supersede the prior current decision'
            USING ERRCODE = '23514';
    END IF;

    IF selected_decision.state IN ('ALLOW', 'CONDITIONAL') THEN
        IF NEW.actor_type NOT IN ('HUMAN', 'COUNSEL') OR
           selected_decision.reviewer_type NOT IN ('HUMAN', 'COUNSEL') OR
           NEW.actor_type IS DISTINCT FROM selected_decision.reviewer_type OR
           NEW.actor IS DISTINCT FROM selected_decision.reviewed_by OR
           selected_decision.review_status <> 'APPROVED' OR
           selected_decision.reviewed_at > NEW.occurred_at OR
           selected_decision.effective_from IS NULL OR
           selected_decision.effective_from > NEW.occurred_at OR
           (selected_decision.effective_until IS NOT NULL AND
            selected_decision.effective_until <= NEW.occurred_at) OR
           selected_decision.recheck_at IS NULL OR
           selected_decision.recheck_at <= NEW.occurred_at THEN
            RAISE EXCEPTION 'ALLOW/CONDITIONAL requires current human approval and review dates'
                USING ERRCODE = '23514';
        END IF;

        SELECT * INTO selected_terms
          FROM rights_terms_versions WHERE id = selected_decision.controlling_terms_version_id;
        SELECT * INTO current_terms_record
          FROM current_rights_terms WHERE terms_cell_id = selected_terms.terms_cell_id;
        IF selected_terms.id IS NULL OR
           current_terms_record.terms_version_id IS DISTINCT FROM selected_terms.id OR
           current_terms_record.state IS DISTINCT FROM 'ACTIVE' OR
           selected_terms.effective_from > NEW.occurred_at OR
           (selected_terms.effective_until IS NOT NULL AND
            selected_terms.effective_until <= NEW.occurred_at) OR
           selected_terms.recheck_at <= NEW.occurred_at OR
           NOT rights_terms_cover_cell(selected_terms.id, NEW.cell_id) THEN
            RAISE EXCEPTION 'permission is not bound to the exact current effective terms scope'
                USING ERRCODE = '23514';
        END IF;

        SELECT count(*) INTO condition_count
          FROM rights_decision_conditions WHERE decision_id = selected_decision.id;
        IF selected_decision.state = 'CONDITIONAL' AND condition_count = 0 THEN
            RAISE EXCEPTION 'CONDITIONAL cannot activate without structured conditions'
                USING ERRCODE = '23514';
        END IF;
    END IF;

    SELECT COALESCE(max(sequence_no), 0) + 1 INTO NEW.sequence_no
      FROM rights_decision_activation_events WHERE cell_id = NEW.cell_id;
    RETURN NEW;
END;
$$;

CREATE TRIGGER rights_decision_activation_prepare_insert
    BEFORE INSERT ON rights_decision_activation_events
    FOR EACH ROW EXECUTE FUNCTION rights_prepare_decision_activation();

CREATE OR REPLACE FUNCTION activate_rights_decision(
    p_decision_id UUID,
    p_actor_type TEXT,
    p_actor TEXT,
    p_reason TEXT,
    p_occurred_at TIMESTAMPTZ DEFAULT now()
)
RETURNS BIGINT
LANGUAGE plpgsql
AS $$
DECLARE
    target_cell UUID;
    assigned_sequence BIGINT;
BEGIN
    SELECT cell_id INTO target_cell FROM rights_decisions WHERE id = p_decision_id;
    IF target_cell IS NULL THEN
        RAISE EXCEPTION 'unknown rights decision %', p_decision_id USING ERRCODE = '23503';
    END IF;
    INSERT INTO rights_decision_activation_events
        (cell_id, decision_id, sequence_no, actor_type, actor, reason, occurred_at)
    VALUES
        (target_cell, p_decision_id, 1, p_actor_type, p_actor, p_reason, p_occurred_at)
    RETURNING sequence_no INTO assigned_sequence;
    RETURN assigned_sequence;
END;
$$;

CREATE OR REPLACE FUNCTION rights_cell_requires_decision()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM rights_decision_activation_events
         WHERE cell_id = NEW.id AND occurred_at <= CURRENT_TIMESTAMP
    ) THEN
        RAISE EXCEPTION 'rights cell % must have one explicit current decision before commit', NEW.id
            USING ERRCODE = '23514';
    END IF;
    RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER rights_cells_require_decision
    AFTER INSERT ON rights_cells
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION rights_cell_requires_decision();

CREATE TABLE IF NOT EXISTS rights_deny_exceptions (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    deny_decision_id      UUID        NOT NULL REFERENCES rights_decisions (id) ON DELETE RESTRICT,
    exception_decision_id UUID        NOT NULL REFERENCES rights_decisions (id) ON DELETE RESTRICT,
    evidence_artifact_id  UUID        NOT NULL REFERENCES rights_evidence_artifacts (id) ON DELETE RESTRICT,
    clause_ref            TEXT        NOT NULL,
    reviewer_type         TEXT        NOT NULL,
    reviewed_by           TEXT        NOT NULL,
    reviewed_at           TIMESTAMPTZ NOT NULL,
    effective_from        TIMESTAMPTZ NOT NULL,
    effective_until       TIMESTAMPTZ NULL,
    recheck_at            TIMESTAMPTZ NOT NULL,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT rights_deny_exceptions_not_self CHECK (deny_decision_id <> exception_decision_id),
    CONSTRAINT rights_deny_exceptions_clause_nonempty CHECK (btrim(clause_ref) <> ''),
    CONSTRAINT rights_deny_exceptions_reviewer_allowed CHECK (reviewer_type IN ('HUMAN', 'COUNSEL')),
    CONSTRAINT rights_deny_exceptions_reviewer_nonempty CHECK (btrim(reviewed_by) <> ''),
    CONSTRAINT rights_deny_exceptions_effective_order CHECK (
        effective_until IS NULL OR effective_until > effective_from
    ),
    CONSTRAINT rights_deny_exceptions_recheck_order CHECK (recheck_at > effective_from)
);

CREATE INDEX IF NOT EXISTS rights_deny_exceptions_pair_key
    ON rights_deny_exceptions (deny_decision_id, exception_decision_id);

CREATE OR REPLACE FUNCTION rights_scope_is_strictly_narrower(
    p_deny_cell_id UUID,
    p_exception_cell_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    broad rights_cells%ROWTYPE;
    narrow rights_cells%ROWTYPE;
    mapped_publisher UUID;
    is_strict BOOLEAN := false;
BEGIN
    SELECT * INTO broad FROM rights_cells WHERE id = p_deny_cell_id;
    SELECT * INTO narrow FROM rights_cells WHERE id = p_exception_cell_id;
    IF broad.id IS NULL OR narrow.id IS NULL OR
       broad.operation IS DISTINCT FROM narrow.operation OR
       broad.channel IS DISTINCT FROM narrow.channel THEN RETURN false; END IF;

    IF broad.source_id IS NOT NULL THEN
        IF narrow.source_id IS DISTINCT FROM broad.source_id OR narrow.publisher_id IS NOT NULL THEN
            RETURN false;
        END IF;
    ELSE
        IF narrow.publisher_id IS NOT NULL THEN
            IF narrow.publisher_id IS DISTINCT FROM broad.publisher_id THEN RETURN false; END IF;
        ELSIF narrow.source_id IS NOT NULL THEN
            SELECT rights_publisher_id INTO mapped_publisher FROM sources WHERE id = narrow.source_id;
            IF mapped_publisher IS DISTINCT FROM broad.publisher_id THEN RETURN false; END IF;
            is_strict := true;
        ELSE
            RETURN false;
        END IF;
    END IF;

    IF broad.field_key IS NOT NULL THEN
        IF narrow.field_key IS DISTINCT FROM broad.field_key OR narrow.field_group_id IS NOT NULL THEN
            RETURN false;
        END IF;
    ELSIF broad.field_group_id IS NOT NULL THEN
        IF narrow.field_group_id IS NOT NULL THEN
            IF narrow.field_group_id IS DISTINCT FROM broad.field_group_id OR narrow.field_key IS NOT NULL THEN
                RETURN false;
            END IF;
        ELSIF narrow.field_key IS NOT NULL THEN
            IF NOT EXISTS (
                SELECT 1 FROM rights_field_group_members
                 WHERE field_group_id = broad.field_group_id AND field_key = narrow.field_key
            ) THEN RETURN false; END IF;
            is_strict := true;
        ELSE
            RETURN false;
        END IF;
    ELSIF narrow.field_key IS NOT NULL OR narrow.field_group_id IS NOT NULL THEN
        is_strict := true;
    END IF;

    IF broad.output_class IS NOT NULL AND narrow.output_class IS DISTINCT FROM broad.output_class THEN RETURN false;
    ELSIF broad.output_class IS NULL AND narrow.output_class IS NOT NULL THEN is_strict := true; END IF;
    IF broad.asset_class IS NOT NULL AND narrow.asset_class IS DISTINCT FROM broad.asset_class THEN RETURN false;
    ELSIF broad.asset_class IS NULL AND narrow.asset_class IS NOT NULL THEN is_strict := true; END IF;
    IF broad.acquisition_route IS NOT NULL AND narrow.acquisition_route IS DISTINCT FROM broad.acquisition_route THEN RETURN false;
    ELSIF broad.acquisition_route IS NULL AND narrow.acquisition_route IS NOT NULL THEN is_strict := true; END IF;
    IF broad.account_or_product_plan IS NOT NULL AND narrow.account_or_product_plan IS DISTINCT FROM broad.account_or_product_plan THEN RETURN false;
    ELSIF broad.account_or_product_plan IS NULL AND narrow.account_or_product_plan IS NOT NULL THEN is_strict := true; END IF;
    IF broad.jurisdiction IS NOT NULL AND narrow.jurisdiction IS DISTINCT FROM broad.jurisdiction THEN RETURN false;
    ELSIF broad.jurisdiction IS NULL AND narrow.jurisdiction IS NOT NULL THEN is_strict := true; END IF;
    RETURN is_strict;
END;
$$;

CREATE OR REPLACE FUNCTION rights_validate_deny_exception()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    deny_record rights_decisions%ROWTYPE;
    exception_record rights_decisions%ROWTYPE;
    relationship_evidence_hash TEXT;
    deny_evidence_hash TEXT;
    exception_evidence_hash TEXT;
BEGIN
    SELECT * INTO deny_record FROM rights_decisions WHERE id = NEW.deny_decision_id;
    SELECT * INTO exception_record FROM rights_decisions WHERE id = NEW.exception_decision_id;
    IF deny_record.state IS DISTINCT FROM 'DENY' OR
       exception_record.state NOT IN ('ALLOW', 'CONDITIONAL') THEN
        RAISE EXCEPTION 'deny exception must name an exact DENY and ALLOW/CONDITIONAL pair'
            USING ERRCODE = '23514';
    END IF;
    SELECT content_sha256 INTO relationship_evidence_hash
      FROM rights_evidence_artifacts WHERE id = NEW.evidence_artifact_id;
    SELECT content_sha256 INTO deny_evidence_hash
      FROM rights_evidence_artifacts WHERE id = deny_record.evidence_artifact_id;
    SELECT content_sha256 INTO exception_evidence_hash
      FROM rights_evidence_artifacts WHERE id = exception_record.evidence_artifact_id;
    IF NEW.evidence_artifact_id = deny_record.evidence_artifact_id OR
       NEW.evidence_artifact_id = exception_record.evidence_artifact_id OR
       relationship_evidence_hash IS NOT DISTINCT FROM deny_evidence_hash OR
       relationship_evidence_hash IS NOT DISTINCT FROM exception_evidence_hash THEN
        RAISE EXCEPTION 'deny exception requires independent relationship evidence'
            USING ERRCODE = '23514';
    END IF;
    IF NOT rights_scope_is_strictly_narrower(deny_record.cell_id, exception_record.cell_id) THEN
        RAISE EXCEPTION 'deny exception must be a strict, non-widening subset of the exact denial'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER rights_deny_exceptions_validate_insert
    BEFORE INSERT ON rights_deny_exceptions
    FOR EACH ROW EXECUTE FUNCTION rights_validate_deny_exception();

CREATE TABLE IF NOT EXISTS rights_migration_assessments (
    source_id         UUID PRIMARY KEY REFERENCES sources (id) ON DELETE RESTRICT,
    assessment_state  TEXT        NOT NULL,
    reason            TEXT        NOT NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT rights_migration_assessment_state_allowed
        CHECK (assessment_state = 'REVIEW_REQUIRED'),
    CONSTRAINT rights_migration_assessment_reason_nonempty CHECK (btrim(reason) <> '')
);

INSERT INTO rights_migration_assessments (source_id, assessment_state, reason)
SELECT id, 'REVIEW_REQUIRED',
       'Legacy classification and boolean policy were preserved as metadata but did not create a grant.'
  FROM sources
ON CONFLICT (source_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS entity_evidence (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_id        UUID        NOT NULL REFERENCES entities (id) ON DELETE RESTRICT,
    artifact_id      UUID        NOT NULL REFERENCES source_artifacts (id) ON DELETE RESTRICT,
    source_record_id UUID        NOT NULL REFERENCES source_records (id) ON DELETE RESTRICT,
    contribution_role TEXT       NOT NULL,
    locator_type     TEXT        NOT NULL,
    locator_value    TEXT        NOT NULL DEFAULT '',
    observed_at      TIMESTAMPTZ NOT NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT entity_evidence_role_allowed CHECK (contribution_role IN (
        'EXISTENCE', 'CANONICAL_NAME', 'CANONICAL_SLUG', 'IDENTITY', 'ALIAS'
    )),
    CONSTRAINT entity_evidence_locator_type_allowed CHECK (locator_type IN (
        'WHOLE_DOCUMENT', 'CSS_SELECTOR', 'XPATH', 'JSON_POINTER', 'PAGE',
        'LINE_RANGE', 'BYTE_RANGE', 'TABLE_CELL', 'REGEX_MATCH'
    ))
);

CREATE UNIQUE INDEX IF NOT EXISTS entity_evidence_unique_locator
    ON entity_evidence (
        entity_id, source_record_id, contribution_role, locator_type, locator_value
    );
CREATE INDEX IF NOT EXISTS entity_evidence_entity_idx ON entity_evidence (entity_id);

CREATE OR REPLACE FUNCTION entity_evidence_validate_provenance()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    record_artifact UUID;
    record_source UUID;
    artifact_source UUID;
BEGIN
    SELECT artifact_id, source_id INTO record_artifact, record_source
      FROM source_records WHERE id = NEW.source_record_id;
    SELECT source_id INTO artifact_source
      FROM source_artifacts WHERE id = NEW.artifact_id;
    IF record_artifact IS DISTINCT FROM NEW.artifact_id OR
       record_source IS DISTINCT FROM artifact_source THEN
        RAISE EXCEPTION 'entity evidence artifact must be the source record''s exact artifact'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER entity_evidence_validate_provenance_insert
    BEFORE INSERT ON entity_evidence
    FOR EACH ROW EXECUTE FUNCTION entity_evidence_validate_provenance();

CREATE TABLE IF NOT EXISTS fact_dependencies (
    derived_fact_id    UUID        NOT NULL REFERENCES facts (id) ON DELETE RESTRICT,
    input_fact_id      UUID        NOT NULL REFERENCES facts (id) ON DELETE RESTRICT,
    transformation_ref TEXT        NOT NULL,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),

    PRIMARY KEY (derived_fact_id, input_fact_id),
    CONSTRAINT fact_dependencies_not_self CHECK (derived_fact_id <> input_fact_id),
    CONSTRAINT fact_dependencies_transform_nonempty CHECK (btrim(transformation_ref) <> '')
);

CREATE INDEX IF NOT EXISTS fact_dependencies_input_idx ON fact_dependencies (input_fact_id);

CREATE OR REPLACE FUNCTION fact_dependencies_reject_cycle()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    -- A table lock makes the recursive check serializable across concurrent
    -- writers; row locks cannot protect an edge that does not exist yet.
    LOCK TABLE fact_dependencies IN SHARE ROW EXCLUSIVE MODE;
    IF EXISTS (
        WITH RECURSIVE ancestors(id) AS (
            SELECT NEW.input_fact_id
            UNION
            SELECT dependency.input_fact_id
              FROM fact_dependencies dependency
              JOIN ancestors ON dependency.derived_fact_id = ancestors.id
        )
        SELECT 1 FROM ancestors WHERE id = NEW.derived_fact_id
    ) THEN
        RAISE EXCEPTION 'fact dependency would create a provenance cycle'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER fact_dependencies_reject_cycle_insert
    BEFORE INSERT ON fact_dependencies
    FOR EACH ROW EXECUTE FUNCTION fact_dependencies_reject_cycle();

CREATE OR REPLACE FUNCTION rights_reject_history_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'rights and provenance history is append-only'
        USING ERRCODE = '55000';
END;
$$;

CREATE OR REPLACE FUNCTION rights_validate_source_publisher_mapping()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    publisher_status TEXT;
BEGIN
    IF TG_OP = 'UPDATE' AND OLD.rights_publisher_id IS NOT NULL AND (
        NEW.rights_publisher_id IS DISTINCT FROM OLD.rights_publisher_id OR
        NEW.rights_publisher_mapping_evidence_artifact_id IS DISTINCT FROM
            OLD.rights_publisher_mapping_evidence_artifact_id OR
        NEW.rights_publisher_mapping_reviewer_type IS DISTINCT FROM
            OLD.rights_publisher_mapping_reviewer_type OR
        NEW.rights_publisher_mapping_reviewed_by IS DISTINCT FROM
            OLD.rights_publisher_mapping_reviewed_by OR
        NEW.rights_publisher_mapping_reviewed_at IS DISTINCT FROM
            OLD.rights_publisher_mapping_reviewed_at
    ) THEN
        RAISE EXCEPTION 'an evidenced source-to-publisher rights mapping is immutable'
            USING ERRCODE = '55000';
    END IF;
    IF NEW.rights_publisher_id IS NOT NULL THEN
        SELECT status INTO publisher_status
          FROM rights_publishers WHERE id = NEW.rights_publisher_id;
        IF publisher_status IS DISTINCT FROM 'ACTIVE' THEN
            RAISE EXCEPTION 'a source may map only to an ACTIVE rights publisher'
                USING ERRCODE = '23514';
        END IF;
        IF NEW.rights_publisher_mapping_reviewed_at > clock_timestamp() THEN
            RAISE EXCEPTION 'publisher mapping review cannot be future-dated'
                USING ERRCODE = '23514';
        END IF;
        IF TG_OP = 'UPDATE' AND OLD.rights_publisher_id IS NULL AND (
            EXISTS (SELECT 1 FROM rights_cells WHERE source_id = NEW.id) OR
            EXISTS (SELECT 1 FROM rights_terms_cells WHERE source_id = NEW.id)
        ) THEN
            RAISE EXCEPTION 'publisher mapping must be established before source rights history'
                USING ERRCODE = '23514';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER sources_validate_rights_publisher_mapping
    BEFORE INSERT OR UPDATE ON sources
    FOR EACH ROW EXECUTE FUNCTION rights_validate_source_publisher_mapping();

CREATE OR REPLACE FUNCTION rights_validate_publisher_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.publisher_key IS DISTINCT FROM OLD.publisher_key OR
       NEW.legal_name IS DISTINCT FROM OLD.legal_name OR
       (OLD.status IN ('PROHIBITED', 'RETIRED') AND NEW.status IS DISTINCT FROM OLD.status) THEN
        RAISE EXCEPTION 'rights publisher identity is immutable and terminal statuses cannot reactivate'
            USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER rights_publishers_validate_update
    BEFORE UPDATE ON rights_publishers
    FOR EACH ROW EXECUTE FUNCTION rights_validate_publisher_update();

CREATE OR REPLACE FUNCTION source_artifacts_reject_scope_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.acquisition_route IS DISTINCT FROM OLD.acquisition_route OR
       NEW.account_or_product_plan IS DISTINCT FROM OLD.account_or_product_plan OR
       NEW.acquisition_jurisdiction IS DISTINCT FROM OLD.acquisition_jurisdiction OR
       NEW.policy_snapshot_id IS DISTINCT FROM OLD.policy_snapshot_id THEN
        RAISE EXCEPTION 'artifact acquisition scope and policy provenance are immutable'
            USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER source_artifacts_scope_immutable
    BEFORE UPDATE ON source_artifacts
    FOR EACH ROW EXECUTE FUNCTION source_artifacts_reject_scope_mutation();

CREATE TRIGGER rights_evidence_artifacts_immutable
    BEFORE UPDATE OR DELETE OR TRUNCATE ON rights_evidence_artifacts
    FOR EACH STATEMENT EXECUTE FUNCTION rights_reject_history_mutation();
CREATE TRIGGER acquisition_policy_snapshots_immutable
    BEFORE UPDATE OR DELETE OR TRUNCATE ON acquisition_policy_snapshots
    FOR EACH STATEMENT EXECUTE FUNCTION rights_reject_history_mutation();
CREATE TRIGGER rights_terms_cells_immutable
    BEFORE UPDATE OR DELETE OR TRUNCATE ON rights_terms_cells
    FOR EACH STATEMENT EXECUTE FUNCTION rights_reject_history_mutation();
CREATE TRIGGER rights_terms_versions_immutable
    BEFORE UPDATE OR DELETE OR TRUNCATE ON rights_terms_versions
    FOR EACH STATEMENT EXECUTE FUNCTION rights_reject_history_mutation();
CREATE TRIGGER rights_terms_activation_events_immutable
    BEFORE UPDATE OR DELETE OR TRUNCATE ON rights_terms_activation_events
    FOR EACH STATEMENT EXECUTE FUNCTION rights_reject_history_mutation();
CREATE TRIGGER rights_field_groups_immutable
    BEFORE UPDATE OR DELETE OR TRUNCATE ON rights_field_groups
    FOR EACH STATEMENT EXECUTE FUNCTION rights_reject_history_mutation();
CREATE TRIGGER rights_field_group_members_immutable
    BEFORE UPDATE OR DELETE OR TRUNCATE ON rights_field_group_members
    FOR EACH STATEMENT EXECUTE FUNCTION rights_reject_history_mutation();
CREATE TRIGGER rights_cells_immutable
    BEFORE UPDATE OR DELETE OR TRUNCATE ON rights_cells
    FOR EACH STATEMENT EXECUTE FUNCTION rights_reject_history_mutation();
CREATE TRIGGER rights_decisions_immutable
    BEFORE UPDATE OR DELETE OR TRUNCATE ON rights_decisions
    FOR EACH STATEMENT EXECUTE FUNCTION rights_reject_history_mutation();
CREATE TRIGGER rights_decision_conditions_immutable
    BEFORE UPDATE OR DELETE OR TRUNCATE ON rights_decision_conditions
    FOR EACH STATEMENT EXECUTE FUNCTION rights_reject_history_mutation();
CREATE TRIGGER rights_decision_activation_events_immutable
    BEFORE UPDATE OR DELETE OR TRUNCATE ON rights_decision_activation_events
    FOR EACH STATEMENT EXECUTE FUNCTION rights_reject_history_mutation();
CREATE TRIGGER rights_deny_exceptions_immutable
    BEFORE UPDATE OR DELETE OR TRUNCATE ON rights_deny_exceptions
    FOR EACH STATEMENT EXECUTE FUNCTION rights_reject_history_mutation();
CREATE TRIGGER rights_migration_assessments_immutable
    BEFORE UPDATE OR DELETE OR TRUNCATE ON rights_migration_assessments
    FOR EACH STATEMENT EXECUTE FUNCTION rights_reject_history_mutation();
CREATE TRIGGER entity_evidence_immutable
    BEFORE UPDATE OR DELETE OR TRUNCATE ON entity_evidence
    FOR EACH STATEMENT EXECUTE FUNCTION rights_reject_history_mutation();
CREATE TRIGGER fact_dependencies_immutable
    BEFORE UPDATE OR DELETE OR TRUNCATE ON fact_dependencies
    FOR EACH STATEMENT EXECUTE FUNCTION rights_reject_history_mutation();

COMMENT ON TABLE rights_cells IS
    'Stable sparse scopes. Each cell receives immutable decisions and append-only activation events.';
COMMENT ON TABLE rights_decisions IS
    'Immutable decision versions. ALLOW/CONDITIONAL become effective only through validated activation.';
COMMENT ON TABLE rights_deny_exceptions IS
    'Explicit independently evidenced relationship from one exact DENY to one strict-narrow exception.';
COMMENT ON TABLE rights_migration_assessments IS
    'Legacy source review queue. No row here grants any operation or channel.';
