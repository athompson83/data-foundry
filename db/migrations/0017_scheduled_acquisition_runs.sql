-- 0017_scheduled_acquisition_runs.sql
--
-- Durable, idempotent scheduled acquisition claims. Freshness is published
-- only by a terminal success whose complete artifact set was linked in the
-- same transaction. Claimed, empty, refused, failed, and partial runs are never
-- evidence that a source is fresh.

CREATE OR REPLACE FUNCTION scheduled_acquisition_validators_valid(value JSONB)
RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
    IF jsonb_typeof(value) <> 'object'
       OR value - 'etag' - 'lastModified' - 'contentHash' <> '{}'::jsonb THEN
        RETURN FALSE;
    END IF;
    IF value ? 'etag' AND (
       jsonb_typeof(value -> 'etag') <> 'string'
       OR length(value ->> 'etag') NOT BETWEEN 1 AND 1024) THEN
        RETURN FALSE;
    END IF;
    IF value ? 'lastModified' AND (
       jsonb_typeof(value -> 'lastModified') <> 'string'
       OR length(value ->> 'lastModified') NOT BETWEEN 1 AND 128) THEN
        RETURN FALSE;
    END IF;
    IF value ? 'contentHash' AND (
       jsonb_typeof(value -> 'contentHash') <> 'string'
       OR (value ->> 'contentHash') !~ '^[0-9a-f]{64}$') THEN
        RETURN FALSE;
    END IF;
    RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION scheduled_acquisition_iso_utc_valid(value TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
    parsed TIMESTAMPTZ;
BEGIN
    IF value IS NULL OR value !~
       '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]\.[0-9]{3}Z$' THEN
        RETURN FALSE;
    END IF;
    BEGIN
        parsed := value::TIMESTAMPTZ;
    EXCEPTION WHEN OTHERS THEN
        RETURN FALSE;
    END;
    RETURN to_char(parsed AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') = value;
END;
$$;

CREATE OR REPLACE FUNCTION scheduled_acquisition_scope_frame(value TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE WHEN value IS NULL THEN '-1:'
                ELSE octet_length(convert_to(value, 'UTF8'))::TEXT || ':' || value END
$$;

CREATE OR REPLACE FUNCTION scheduled_acquisition_scope_digest(
    run_id UUID,
    idempotency_key TEXT,
    vertical_slug TEXT,
    source_id UUID,
    source_key TEXT,
    target_id TEXT,
    target_url TEXT,
    acquisition_route TEXT,
    account_or_product_plan TEXT,
    acquisition_jurisdiction TEXT,
    asset_class TEXT,
    output_class TEXT,
    result_url_policy JSONB,
    scheduled_for TIMESTAMPTZ,
    runtime_digest TEXT
) RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
    SELECT encode(sha256(convert_to(array_to_string(ARRAY[
        scheduled_acquisition_scope_frame('scheduled-acquisition-scope-v1'),
        scheduled_acquisition_scope_frame(lower(run_id::TEXT)),
        scheduled_acquisition_scope_frame(idempotency_key),
        scheduled_acquisition_scope_frame(vertical_slug),
        scheduled_acquisition_scope_frame(lower(source_id::TEXT)),
        scheduled_acquisition_scope_frame(source_key),
        scheduled_acquisition_scope_frame(target_id),
        scheduled_acquisition_scope_frame(target_url),
        scheduled_acquisition_scope_frame(acquisition_route),
        scheduled_acquisition_scope_frame(account_or_product_plan),
        scheduled_acquisition_scope_frame(acquisition_jurisdiction),
        scheduled_acquisition_scope_frame(asset_class),
        scheduled_acquisition_scope_frame(output_class),
        scheduled_acquisition_scope_frame(result_url_policy::TEXT),
        scheduled_acquisition_scope_frame(
            to_char(scheduled_for AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
        ),
        scheduled_acquisition_scope_frame(runtime_digest),
        scheduled_acquisition_scope_frame('ACTIVE'),
        scheduled_acquisition_scope_frame('INTERNAL_PROCESSING'),
        scheduled_acquisition_scope_frame(NULL),
        scheduled_acquisition_scope_frame('[]'),
        scheduled_acquisition_scope_frame('ACQUIRE,STORE,CACHE')
    ], '|'), 'UTF8')), 'hex')
$$;

CREATE OR REPLACE FUNCTION scheduled_acquisition_result_url_policy_valid(value JSONB)
RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
    IF jsonb_typeof(value) <> 'object'
       OR NOT (value ?& ARRAY['allowedOrigins', 'allowedPathPrefixes'])
       OR value - 'allowedOrigins' - 'allowedPathPrefixes' <> '{}'::JSONB
       OR jsonb_typeof(value -> 'allowedOrigins') <> 'array'
       OR jsonb_array_length(value -> 'allowedOrigins') NOT BETWEEN 1 AND 16
       OR jsonb_typeof(value -> 'allowedPathPrefixes') <> 'array'
       OR jsonb_array_length(value -> 'allowedPathPrefixes') NOT BETWEEN 1 AND 32
       OR EXISTS (
            SELECT 1 FROM jsonb_array_elements(value -> 'allowedOrigins') item
             WHERE jsonb_typeof(item) <> 'string'
                OR item #>> '{}' !~ '^https://[a-z0-9.-]+(:[0-9]{1,5})?$'
       )
       OR EXISTS (
            SELECT 1 FROM jsonb_array_elements(value -> 'allowedPathPrefixes') item
             WHERE jsonb_typeof(item) <> 'string'
                OR item #>> '{}' !~ '^/[^?#]*$'
                OR item #>> '{}' ~ '(^|/)\.\.(/|$)'
       ) THEN
        RETURN FALSE;
    END IF;
    RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION scheduled_acquisition_result_url_allowed(
    target_url TEXT,
    acquisition_route TEXT,
    policy JSONB,
    result_url TEXT,
    relation TEXT
) RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
    result_origin TEXT;
    result_path TEXT;
    prefix TEXT;
    origin_allowed BOOLEAN;
    path_allowed BOOLEAN := FALSE;
BEGIN
    IF NOT scheduled_acquisition_result_url_policy_valid(policy)
       OR result_url !~ '^https://'
       OR result_url LIKE '%#%' THEN
        RETURN FALSE;
    END IF;
    IF relation = 'TARGET' THEN
        IF result_url IS DISTINCT FROM target_url THEN RETURN FALSE; END IF;
    ELSIF relation = 'CHILD_RESOURCE' THEN
        IF result_url IS NOT DISTINCT FROM target_url
           OR acquisition_route NOT IN ('BROWSER_RUN', 'CRAWL4AI') THEN
            RETURN FALSE;
        END IF;
    ELSE
        RETURN FALSE;
    END IF;

    result_origin := lower(substring(result_url FROM '^(https://[^/?#]+)'));
    result_path := substring(result_url FROM '^https://[^/?#]+([^?#]*)');
    IF result_origin IS NULL OR result_path IS NULL THEN RETURN FALSE; END IF;
    IF result_path = '' THEN result_path := '/'; END IF;
    SELECT EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(policy -> 'allowedOrigins') origin
         WHERE lower(origin) = result_origin
    ) INTO origin_allowed;
    IF NOT origin_allowed THEN RETURN FALSE; END IF;
    FOR prefix IN SELECT item FROM jsonb_array_elements_text(policy -> 'allowedPathPrefixes') item LOOP
        IF result_path = prefix
           OR (right(prefix, 1) = '/' AND left(result_path, length(prefix)) = prefix)
           OR (right(prefix, 1) <> '/' AND left(result_path, length(prefix) + 1) = prefix || '/') THEN
            path_allowed := TRUE;
            EXIT;
        END IF;
    END LOOP;
    RETURN path_allowed;
END;
$$;

CREATE OR REPLACE FUNCTION scheduled_acquisition_uuid_or_null_valid(value JSONB)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE AS $$
    SELECT value = 'null'::JSONB OR (
        jsonb_typeof(value) = 'string'
        AND value #>> '{}' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    )
$$;

CREATE OR REPLACE FUNCTION scheduled_acquisition_receipt_valid(value JSONB)
RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
    checkpoint JSONB;
    decision JSONB;
    decision_index INTEGER;
    expected_operations TEXT[] := ARRAY['ACQUIRE', 'STORE', 'CACHE'];
    permission BOOLEAN;
BEGIN
    IF jsonb_typeof(value) <> 'array' OR jsonb_array_length(value) > 3 THEN
        RETURN FALSE;
    END IF;
    FOR checkpoint IN SELECT item FROM jsonb_array_elements(value) item LOOP
        IF jsonb_typeof(checkpoint) <> 'object'
           OR NOT (checkpoint ?& ARRAY['stage', 'basis', 'scopeDigest', 'evaluatedAt', 'decisions'])
           OR checkpoint - 'stage' - 'basis' - 'scopeDigest' - 'evaluatedAt' - 'decisions' <> '{}'::jsonb
           OR checkpoint ->> 'stage' NOT IN ('INITIAL', 'PRE_PROVIDER', 'PRE_TRANSPORT')
           OR checkpoint ->> 'basis' NOT IN ('ADMITTED', 'RIGHTS_REFUSED', 'NOT_DUE')
           OR jsonb_typeof(checkpoint -> 'scopeDigest') <> 'string'
           OR (checkpoint ->> 'scopeDigest') !~ '^[0-9a-f]{64}$'
           OR jsonb_typeof(checkpoint -> 'evaluatedAt') <> 'string'
           OR NOT scheduled_acquisition_iso_utc_valid(checkpoint ->> 'evaluatedAt')
           OR jsonb_typeof(checkpoint -> 'decisions') <> 'array'
           OR jsonb_array_length(checkpoint -> 'decisions') <> 3 THEN
            RETURN FALSE;
        END IF;
        decision_index := 0;
        FOR decision IN SELECT item FROM jsonb_array_elements(checkpoint -> 'decisions') item LOOP
            decision_index := decision_index + 1;
            IF jsonb_typeof(decision) <> 'object'
               OR NOT (decision ?& ARRAY[
                    'operation', 'permitted', 'state', 'reasonCode',
                    'cellId', 'decisionId', 'termsVersionId'
                  ])
               OR decision - 'operation' - 'permitted' - 'state' - 'reasonCode'
                           - 'cellId' - 'decisionId' - 'termsVersionId' <> '{}'::jsonb
               OR decision ->> 'operation' <> expected_operations[decision_index]
               OR jsonb_typeof(decision -> 'permitted') <> 'boolean'
               OR decision ->> 'state' NOT IN ('ALLOW', 'DENY', 'CONDITIONAL', 'UNKNOWN', 'NOT_APPLICABLE')
               OR decision ->> 'reasonCode' NOT IN (
                    'ALLOW', 'CONDITIONAL_ALLOW', 'NO_GRANT', 'EXPLICIT_UNKNOWN',
                    'MISSING_PROVENANCE', 'MALFORMED_SNAPSHOT', 'SOURCE_PROHIBITED',
                    'KILL_SWITCH_ENGAGED', 'SOURCE_STATUS_BLOCKED',
                    'RIGHTS_CLASSIFICATION_BLOCKED', 'PUBLISHER_UNMAPPED', 'STICKY_DENY',
                    'AMBIGUOUS_SCOPE', 'NOT_APPLICABLE', 'TERMS_MISSING',
                    'TERMS_NOT_CURRENT', 'TERMS_REVOKED', 'TERMS_NOT_EFFECTIVE',
                    'TERMS_VERSION_INVALID', 'TERMS_SCOPE_MISMATCH',
                    'DECISION_NOT_EFFECTIVE', 'REVIEW_DUE', 'AUTOMATED_PERMISSION',
                    'PERMISSION_REVIEW_INVALID', 'CONDITION_MISSING',
                    'UNKNOWN_CONDITION_EVALUATOR', 'CONDITION_UNMET',
                    'CONDITION_AUDIT_MISSING', 'CONDITION_RECEIPT_INVALID',
                    'CONDITION_RECEIPT_STALE', 'ACTIVATION_INVALID'
                  )
               OR NOT scheduled_acquisition_uuid_or_null_valid(decision -> 'cellId')
               OR NOT scheduled_acquisition_uuid_or_null_valid(decision -> 'decisionId')
               OR NOT scheduled_acquisition_uuid_or_null_valid(decision -> 'termsVersionId') THEN
                RETURN FALSE;
            END IF;
            permission := (decision ->> 'permitted')::BOOLEAN;
            IF permission IS DISTINCT FROM (
                (decision ->> 'state' = 'ALLOW' AND decision ->> 'reasonCode' = 'ALLOW')
                OR (decision ->> 'state' = 'CONDITIONAL'
                    AND decision ->> 'reasonCode' = 'CONDITIONAL_ALLOW')
            ) THEN
                RETURN FALSE;
            END IF;
            IF permission AND (
               decision -> 'cellId' = 'null'::JSONB
               OR decision -> 'decisionId' = 'null'::JSONB
               OR decision -> 'termsVersionId' = 'null'::JSONB) THEN
                RETURN FALSE;
            END IF;
        END LOOP;
    END LOOP;
    RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION scheduled_acquisition_receipt_valid_for(
    value JSONB,
    run_status TEXT,
    expected_scope_digest TEXT,
    claimed_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ
) RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
    checkpoint JSONB;
    checkpoint_index INTEGER := 0;
    checkpoint_count INTEGER;
    expected_stages TEXT[] := ARRAY['INITIAL', 'PRE_PROVIDER', 'PRE_TRANSPORT'];
    evaluated_at TIMESTAMPTZ;
    previous_evaluated_at TIMESTAMPTZ := claimed_at;
    all_permitted BOOLEAN;
BEGIN
    IF NOT scheduled_acquisition_receipt_valid(value) THEN
        RETURN FALSE;
    END IF;
    checkpoint_count := jsonb_array_length(value);
    IF run_status = 'CLAIMED' THEN
        RETURN checkpoint_count = 0;
    END IF;
    IF run_status NOT IN ('SUCCEEDED', 'SKIPPED', 'REFUSED', 'FAILED')
       OR completed_at IS NULL THEN
        RETURN FALSE;
    END IF;
    IF (run_status = 'SUCCEEDED' AND checkpoint_count <> 3)
       OR (run_status = 'SKIPPED' AND checkpoint_count <> 1)
       OR (run_status = 'REFUSED' AND checkpoint_count NOT BETWEEN 1 AND 3) THEN
        RETURN FALSE;
    END IF;

    FOR checkpoint IN SELECT item FROM jsonb_array_elements(value) item LOOP
        checkpoint_index := checkpoint_index + 1;
        evaluated_at := (checkpoint ->> 'evaluatedAt')::TIMESTAMPTZ;
        SELECT bool_and((decision ->> 'permitted')::BOOLEAN)
          INTO all_permitted
          FROM jsonb_array_elements(checkpoint -> 'decisions') decision;
        IF checkpoint ->> 'stage' <> expected_stages[checkpoint_index]
           OR checkpoint ->> 'scopeDigest' <> expected_scope_digest
           OR evaluated_at < claimed_at
           OR evaluated_at > completed_at
           OR evaluated_at < previous_evaluated_at THEN
            RETURN FALSE;
        END IF;
        previous_evaluated_at := evaluated_at;

        IF run_status IN ('SUCCEEDED', 'FAILED') AND (
           checkpoint ->> 'basis' <> 'ADMITTED' OR NOT all_permitted) THEN
            RETURN FALSE;
        ELSIF run_status = 'SKIPPED' AND (
           checkpoint ->> 'basis' <> 'NOT_DUE' OR NOT all_permitted) THEN
            RETURN FALSE;
        ELSIF run_status = 'REFUSED' AND checkpoint_index < checkpoint_count AND (
           checkpoint ->> 'basis' <> 'ADMITTED' OR NOT all_permitted) THEN
            RETURN FALSE;
        ELSIF run_status = 'REFUSED' AND checkpoint_index = checkpoint_count AND (
           checkpoint ->> 'basis' <> 'RIGHTS_REFUSED' OR all_permitted) THEN
            RETURN FALSE;
        END IF;
    END LOOP;
    RETURN TRUE;
END;
$$;

CREATE TABLE IF NOT EXISTS scheduled_acquisition_runs (
    id                         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    idempotency_key            TEXT        NOT NULL UNIQUE,
    vertical_slug              TEXT        NOT NULL,
    source_id                  UUID        NOT NULL REFERENCES sources (id) ON DELETE RESTRICT,
    source_key                 TEXT        NOT NULL,
    target_id                  TEXT        NOT NULL,
    target_url                 TEXT        NOT NULL,
    acquisition_route          TEXT        NOT NULL,
    account_or_product_plan    TEXT            NULL,
    acquisition_jurisdiction   TEXT            NULL,
    asset_class                TEXT        NOT NULL,
    output_class               TEXT        NOT NULL,
    result_url_policy          JSONB       NOT NULL,
    scheduled_for              TIMESTAMPTZ NOT NULL,
    claimed_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at               TIMESTAMPTZ     NULL,
    fresh_at                   TIMESTAMPTZ     NULL,
    status                     TEXT        NOT NULL DEFAULT 'CLAIMED',
    outcome                    TEXT            NULL,
    failure_code               TEXT            NULL,
    rights_receipt             JSONB       NOT NULL DEFAULT '[]'::jsonb,
    provider                   TEXT            NULL,
    validators                 JSONB       NOT NULL DEFAULT '{}'::jsonb,
    expected_artifact_count    INTEGER     NOT NULL DEFAULT 0,
    artifact_count             INTEGER     NOT NULL DEFAULT 0,
    runtime_digest             TEXT        NOT NULL,
    rights_scope_digest        TEXT        GENERATED ALWAYS AS (
        scheduled_acquisition_scope_digest(
            id, idempotency_key, vertical_slug, source_id, source_key, target_id,
            target_url, acquisition_route, account_or_product_plan,
            acquisition_jurisdiction, asset_class, output_class, result_url_policy,
            scheduled_for, runtime_digest
        )
    ) STORED,
    created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT scheduled_acquisition_runs_idempotency_nonempty
        CHECK (btrim(idempotency_key) <> ''),
    CONSTRAINT scheduled_acquisition_runs_identity_nonempty
        CHECK (btrim(vertical_slug) <> '' AND btrim(source_key) <> '' AND btrim(target_id) <> ''),
    CONSTRAINT scheduled_acquisition_runs_target_url_absolute
        CHECK (target_url ~ '^https://'),
    CONSTRAINT scheduled_acquisition_runs_result_url_policy
        CHECK (scheduled_acquisition_result_url_policy_valid(result_url_policy)
           AND scheduled_acquisition_result_url_allowed(
               target_url, acquisition_route, result_url_policy, target_url, 'TARGET'
           )),
    CONSTRAINT scheduled_acquisition_runs_route_allowed
        CHECK (acquisition_route IN (
            'DIRECT_HTTP', 'BROWSER_RUN', 'CRAWL4AI', 'VENDOR_API',
            'SITEMAP', 'BULK_FILE', 'RSS', 'MANUAL_UPLOAD'
        )),
    CONSTRAINT scheduled_acquisition_runs_scope_allowed
        CHECK (asset_class IN ('DATA', 'DOCUMENT', 'IMAGE', 'TRADEMARK', 'PERSONAL_DATA')
           AND output_class IN (
               'RAW_RECORD', 'NORMALIZED_FACT', 'DERIVED_METRIC', 'METADATA',
               'IMAGE_OR_MEDIA', 'PERSONAL_DATA'
           )),
    CONSTRAINT scheduled_acquisition_runs_status_allowed
        CHECK (status IN ('CLAIMED', 'SUCCEEDED', 'SKIPPED', 'REFUSED', 'FAILED')),
    CONSTRAINT scheduled_acquisition_runs_outcome_allowed
        CHECK (outcome IS NULL OR outcome IN ('FETCHED', 'NOT_MODIFIED', 'EMPTY')),
    CONSTRAINT scheduled_acquisition_runs_receipt_contract
        CHECK (scheduled_acquisition_receipt_valid_for(
            rights_receipt, status, rights_scope_digest, claimed_at, completed_at
        )),
    CONSTRAINT scheduled_acquisition_runs_validators_shape
        CHECK (scheduled_acquisition_validators_valid(validators)),
    CONSTRAINT scheduled_acquisition_runs_provider_allowed
        CHECK (provider IS NULL OR provider IN ('http', 'browser-run', 'crawl4ai', 'fixture')),
    CONSTRAINT scheduled_acquisition_runs_failure_code_allowed CHECK (
        failure_code IS NULL OR failure_code IN (
            'NOT_DUE', 'RIGHTS_REFUSED', 'EMPTY_RESPONSE', 'PROVIDER_UNAVAILABLE',
            'PROVIDER_CONFIGURATION', 'TRANSPORT_FAILED', 'PERSISTENCE_FAILED',
            'RUNTIME_CONFIGURATION', 'INTERNAL_ERROR'
        )
    ),
    CONSTRAINT scheduled_acquisition_runs_artifact_counts
        CHECK (expected_artifact_count >= 0 AND artifact_count >= 0),
    CONSTRAINT scheduled_acquisition_runs_runtime_digest
        CHECK (runtime_digest ~ '^[0-9a-f]{64}$'),
    CONSTRAINT scheduled_acquisition_runs_time_order CHECK (
        (completed_at IS NULL OR completed_at >= claimed_at)
        AND (fresh_at IS NULL OR (
            completed_at IS NOT NULL AND fresh_at >= claimed_at AND fresh_at <= completed_at
        ))
    ),
    CONSTRAINT scheduled_acquisition_runs_terminal_shape CHECK (
        (status = 'CLAIMED'
          AND completed_at IS NULL AND fresh_at IS NULL AND outcome IS NULL
          AND failure_code IS NULL AND provider IS NULL
          AND expected_artifact_count = 0 AND artifact_count = 0)
        OR
        (status = 'SUCCEEDED'
          AND completed_at IS NOT NULL AND fresh_at IS NOT NULL
          AND outcome IN ('FETCHED', 'NOT_MODIFIED')
          AND failure_code IS NULL AND provider IS NOT NULL
          AND expected_artifact_count = artifact_count
          AND ((outcome = 'FETCHED' AND artifact_count > 0)
            OR (outcome = 'NOT_MODIFIED' AND artifact_count = 0 AND validators <> '{}'::jsonb)))
        OR
        (status = 'SKIPPED'
          AND completed_at IS NOT NULL AND fresh_at IS NULL AND outcome IS NULL
          AND failure_code = 'NOT_DUE' AND provider IS NULL
          AND expected_artifact_count = 0 AND artifact_count = 0)
        OR
        (status = 'REFUSED'
          AND completed_at IS NOT NULL AND fresh_at IS NULL AND outcome IS NULL
          AND failure_code = 'RIGHTS_REFUSED'
          AND provider IS NULL AND expected_artifact_count = 0 AND artifact_count = 0)
        OR
        (status = 'FAILED'
          AND completed_at IS NOT NULL AND fresh_at IS NULL
          AND ((outcome = 'EMPTY' AND failure_code = 'EMPTY_RESPONSE' AND provider IS NOT NULL)
            OR (outcome IS NULL AND failure_code IN (
                'PROVIDER_UNAVAILABLE', 'PROVIDER_CONFIGURATION', 'TRANSPORT_FAILED',
                'PERSISTENCE_FAILED', 'RUNTIME_CONFIGURATION', 'INTERNAL_ERROR'
            )))
          AND expected_artifact_count = 0 AND artifact_count = 0)
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS scheduled_acquisition_runs_slot_key
    ON scheduled_acquisition_runs (vertical_slug, source_id, target_id, scheduled_for);
CREATE INDEX IF NOT EXISTS scheduled_acquisition_runs_latest_success_idx
    ON scheduled_acquisition_runs (source_id, target_id, fresh_at DESC)
    WHERE status = 'SUCCEEDED';
CREATE INDEX IF NOT EXISTS scheduled_acquisition_runs_status_idx
    ON scheduled_acquisition_runs (status, claimed_at);

CREATE TABLE IF NOT EXISTS scheduled_acquisition_run_artifacts (
    run_id                UUID        NOT NULL REFERENCES scheduled_acquisition_runs (id) ON DELETE RESTRICT,
    artifact_id           UUID        NOT NULL REFERENCES source_artifacts (id) ON DELETE RESTRICT,
    ordinal               INTEGER     NOT NULL,
    target_url            TEXT        NOT NULL,
    result_url            TEXT        NOT NULL,
    result_relation       TEXT        NOT NULL,
    retrieval_key         TEXT        NOT NULL,
    acquisition_provider  TEXT        NOT NULL,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (run_id, artifact_id),
    CONSTRAINT scheduled_acquisition_run_artifacts_ordinal_nonnegative CHECK (ordinal >= 0),
    CONSTRAINT scheduled_acquisition_run_artifacts_ordinal_unique UNIQUE (run_id, ordinal),
    CONSTRAINT scheduled_acquisition_run_artifacts_urls_https
        CHECK (target_url ~ '^https://' AND result_url ~ '^https://'),
    CONSTRAINT scheduled_acquisition_run_artifacts_relation_allowed
        CHECK (result_relation IN ('TARGET', 'CHILD_RESOURCE')),
    CONSTRAINT scheduled_acquisition_run_artifacts_retrieval_key CHECK (
        length(retrieval_key) BETWEEN 1 AND 2048
        AND retrieval_key ~ '^[a-z0-9][a-z0-9._/-]*$'
        AND retrieval_key !~ '(^|/)\.\.(/|$)'
    ),
    CONSTRAINT scheduled_acquisition_run_artifacts_provider_allowed
        CHECK (acquisition_provider IN ('http', 'browser-run', 'crawl4ai', 'fixture'))
);

CREATE OR REPLACE FUNCTION scheduled_acquisition_run_artifact_guard()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
    run_status TEXT;
    run_source UUID;
    run_target_url TEXT;
    run_route TEXT;
    run_plan TEXT;
    run_jurisdiction TEXT;
    run_result_url_policy JSONB;
    artifact_source UUID;
    artifact_url TEXT;
    artifact_route TEXT;
    artifact_plan TEXT;
    artifact_jurisdiction TEXT;
BEGIN
    SELECT status, source_id, target_url, acquisition_route,
           account_or_product_plan, acquisition_jurisdiction, result_url_policy
      INTO run_status, run_source, run_target_url, run_route,
           run_plan, run_jurisdiction, run_result_url_policy
      FROM scheduled_acquisition_runs WHERE id = NEW.run_id FOR UPDATE;
    SELECT source_id, url, acquisition_route,
           account_or_product_plan, acquisition_jurisdiction
      INTO artifact_source, artifact_url, artifact_route,
           artifact_plan, artifact_jurisdiction
      FROM source_artifacts WHERE id = NEW.artifact_id;

    IF run_status IS DISTINCT FROM 'CLAIMED' THEN
        RAISE EXCEPTION 'artifacts may be linked only while a scheduled acquisition run is CLAIMED'
            USING ERRCODE = '55000';
    END IF;
    IF artifact_source IS DISTINCT FROM run_source THEN
        RAISE EXCEPTION 'scheduled acquisition artifact source does not match the run source'
            USING ERRCODE = '23514';
    END IF;
    IF artifact_route IS DISTINCT FROM run_route
       OR artifact_plan IS DISTINCT FROM run_plan
       OR artifact_jurisdiction IS DISTINCT FROM run_jurisdiction THEN
        RAISE EXCEPTION 'scheduled acquisition artifact target or acquisition scope does not match the run'
            USING ERRCODE = '23514';
    END IF;
    IF NEW.target_url IS DISTINCT FROM run_target_url
       OR NEW.result_url IS DISTINCT FROM artifact_url
       OR NOT scheduled_acquisition_result_url_allowed(
           run_target_url, run_route, run_result_url_policy,
           NEW.result_url, NEW.result_relation
       ) THEN
        RAISE EXCEPTION 'scheduled acquisition result is not associated with the claimed target policy'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER scheduled_acquisition_run_artifact_insert_guard
    BEFORE INSERT ON scheduled_acquisition_run_artifacts
    FOR EACH ROW EXECUTE FUNCTION scheduled_acquisition_run_artifact_guard();

CREATE OR REPLACE FUNCTION scheduled_acquisition_run_terminal_guard()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
    linked_count INTEGER;
    wrong_provider_count INTEGER;
    prior_fetched_count INTEGER;
BEGIN
    IF TG_OP = 'DELETE' OR (TG_OP = 'UPDATE' AND OLD.status <> 'CLAIMED') THEN
        RAISE EXCEPTION 'terminal scheduled acquisition run is immutable'
            USING ERRCODE = '55000';
    END IF;

    IF TG_OP = 'UPDATE' AND (
       NEW.id IS DISTINCT FROM OLD.id
       OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
       OR NEW.vertical_slug IS DISTINCT FROM OLD.vertical_slug
       OR NEW.source_id IS DISTINCT FROM OLD.source_id
       OR NEW.source_key IS DISTINCT FROM OLD.source_key
       OR NEW.target_id IS DISTINCT FROM OLD.target_id
       OR NEW.target_url IS DISTINCT FROM OLD.target_url
       OR NEW.acquisition_route IS DISTINCT FROM OLD.acquisition_route
       OR NEW.account_or_product_plan IS DISTINCT FROM OLD.account_or_product_plan
       OR NEW.acquisition_jurisdiction IS DISTINCT FROM OLD.acquisition_jurisdiction
       OR NEW.asset_class IS DISTINCT FROM OLD.asset_class
       OR NEW.output_class IS DISTINCT FROM OLD.output_class
       OR NEW.result_url_policy IS DISTINCT FROM OLD.result_url_policy
       OR NEW.scheduled_for IS DISTINCT FROM OLD.scheduled_for
       OR NEW.claimed_at IS DISTINCT FROM OLD.claimed_at
       OR NEW.runtime_digest IS DISTINCT FROM OLD.runtime_digest
       OR NEW.created_at IS DISTINCT FROM OLD.created_at
    ) THEN
        RAISE EXCEPTION 'scheduled acquisition claim identity and scope are immutable'
            USING ERRCODE = '55000';
    END IF;

    IF TG_OP = 'UPDATE' AND NEW.status = 'CLAIMED' THEN
        RAISE EXCEPTION 'a scheduled acquisition claim may only transition to a terminal state'
            USING ERRCODE = '55000';
    END IF;

    IF TG_OP = 'UPDATE' AND NEW.status <> 'CLAIMED' THEN
        SELECT count(*)::integer,
               count(*) FILTER (
                 WHERE link.acquisition_provider IS DISTINCT FROM NEW.provider
               )::integer
          INTO linked_count, wrong_provider_count
          FROM scheduled_acquisition_run_artifacts link
          JOIN source_artifacts artifact ON artifact.id = link.artifact_id
         WHERE link.run_id = OLD.id;
        IF linked_count <> NEW.artifact_count THEN
            RAISE EXCEPTION 'scheduled acquisition terminal artifact count does not match linked artifacts'
                USING ERRCODE = '23514';
        END IF;
        IF NEW.status = 'SUCCEEDED' AND wrong_provider_count <> 0 THEN
            RAISE EXCEPTION 'scheduled acquisition retrieval provider does not match the completion provider'
                USING ERRCODE = '23514';
        END IF;
        IF NEW.status = 'SUCCEEDED' AND NEW.outcome = 'NOT_MODIFIED' THEN
            SELECT count(*)::integer INTO prior_fetched_count
              FROM scheduled_acquisition_runs prior
             WHERE prior.id <> OLD.id
               AND prior.source_id = OLD.source_id
               AND prior.target_id = OLD.target_id
               AND prior.target_url = OLD.target_url
               AND prior.acquisition_route = OLD.acquisition_route
               AND prior.account_or_product_plan IS NOT DISTINCT FROM OLD.account_or_product_plan
               AND prior.acquisition_jurisdiction IS NOT DISTINCT FROM OLD.acquisition_jurisdiction
               AND prior.asset_class = OLD.asset_class
               AND prior.output_class = OLD.output_class
               AND prior.runtime_digest = OLD.runtime_digest
               AND prior.status = 'SUCCEEDED'
               AND prior.outcome = 'FETCHED'
               AND prior.artifact_count > 0
               AND EXISTS (
                 SELECT 1 FROM scheduled_acquisition_run_artifacts link
                  WHERE link.run_id = prior.id
               );
            IF prior_fetched_count = 0 THEN
                RAISE EXCEPTION 'NOT_MODIFIED requires a prior artifact-backed FETCHED success for the exact scope and runtime'
                    USING ERRCODE = '23514';
            END IF;
        END IF;
    END IF;
    RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER scheduled_acquisition_runs_terminal_immutable
    BEFORE UPDATE OR DELETE ON scheduled_acquisition_runs
    FOR EACH ROW EXECUTE FUNCTION scheduled_acquisition_run_terminal_guard();

CREATE OR REPLACE FUNCTION scheduled_acquisition_run_artifact_immutable()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'scheduled acquisition artifact links are immutable'
        USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER scheduled_acquisition_run_artifacts_immutable
    BEFORE UPDATE OR DELETE OR TRUNCATE ON scheduled_acquisition_run_artifacts
    FOR EACH STATEMENT EXECUTE FUNCTION scheduled_acquisition_run_artifact_immutable();

COMMENT ON TABLE scheduled_acquisition_runs IS
    'Durable scheduler claim and terminal result ledger. Only SUCCEEDED FETCHED/NOT_MODIFIED rows carry freshness.';
COMMENT ON COLUMN scheduled_acquisition_runs.rights_receipt IS
    'Exact ACQUIRE/STORE/CACHE decision provenance evaluated for this target; never an inferred permission.';
COMMENT ON TABLE scheduled_acquisition_run_artifacts IS
    'Complete immutable artifact set atomically linked before a FETCHED run may become terminal.';
