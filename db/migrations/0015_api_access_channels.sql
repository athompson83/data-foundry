-- 0015_api_access_channels.sql
--
-- A key's vertical says which industry it may read. These two additional
-- fields say which API surface the key was issued for and who, if anyone, is
-- authoritative for billing requests made through that surface.
--
-- They are deliberately a closed pair rather than independent labels:
--
--   API_FREE  + DIRECT    direct free API; measure, never invoice
--   API_PAID  + DIRECT    direct paid API; eligible for later invoicing
--   RAPIDAPI  + RAPIDAPI  marketplace API; measure, never invoice internally
--
-- There is no DEFAULT and there is no backfill. Existing rows predate this
-- distinction, so assigning any of the three pairs to them would invent a
-- commercial fact. They remain NULL/NULL and therefore unusable by the auth
-- layer until an operator classifies each key explicitly. New keys, by
-- contrast, cannot be inserted without an explicit valid pair.

ALTER TABLE api_keys
    ADD COLUMN access_tier TEXT NULL,
    ADD COLUMN billing_source TEXT NULL;

ALTER TABLE api_usage_events
    ADD COLUMN access_tier TEXT NULL,
    ADD COLUMN billing_source TEXT NULL;

-- Both NULL is the quarantined legacy state. Partial NULL and every crossed or
-- unknown pair are refused. The trigger below prevents new keys from using the
-- legacy state; keeping it representable is solely what makes this a safe
-- populated-database migration without a guessed backfill.
ALTER TABLE api_keys
    ADD CONSTRAINT api_keys_access_classification_allowed CHECK (
        (access_tier IS NULL AND billing_source IS NULL)
        OR (access_tier = 'API_FREE' AND billing_source = 'DIRECT')
        OR (access_tier = 'API_PAID' AND billing_source = 'DIRECT')
        OR (access_tier = 'RAPIDAPI' AND billing_source = 'RAPIDAPI')
    );

ALTER TABLE api_usage_events
    ADD CONSTRAINT api_usage_events_access_classification_allowed CHECK (
        (access_tier IS NULL AND billing_source IS NULL)
        OR (access_tier = 'API_FREE' AND billing_source = 'DIRECT')
        OR (access_tier = 'API_PAID' AND billing_source = 'DIRECT')
        OR (access_tier = 'RAPIDAPI' AND billing_source = 'RAPIDAPI')
    );

-- A usage event carries a snapshot of the authenticating key's classification.
-- The key id is already unique; this redundant tuple is the target required by
-- the composite foreign key below, just as 0011/0012 use redundant tenant and
-- vertical tuples to make mis-attribution unrepresentable.
ALTER TABLE api_keys
    ADD CONSTRAINT api_keys_id_access_classification_uniq
    UNIQUE (id, access_tier, billing_source);

-- MATCH FULL is load-bearing. api_key_id is NOT NULL, so a newly inserted usage
-- row with NULL/NULL classification is a partially-null composite and is
-- refused. NOT VALID exempts only rows that existed before this constraint was
-- added; PostgreSQL still enforces it for every new insert and relevant update.
-- This lets legacy usage remain quarantined without reopening the path for new
-- unclassified or mismatched accounting records.
ALTER TABLE api_usage_events
    ADD CONSTRAINT api_usage_events_access_matches_key
    FOREIGN KEY (api_key_id, access_tier, billing_source)
    REFERENCES api_keys (id, access_tier, billing_source)
    MATCH FULL
    ON DELETE RESTRICT
    NOT VALID;

CREATE FUNCTION enforce_api_key_access_classification()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.access_tier IS NULL OR NEW.billing_source IS NULL THEN
            RAISE EXCEPTION USING
                ERRCODE = '23502',
                MESSAGE = 'new api_keys rows require an explicit access_tier and billing_source',
                HINT = 'Use API_FREE/DIRECT, API_PAID/DIRECT, or RAPIDAPI/RAPIDAPI. No default is inferred.';
        END IF;
        -- The CHECK constraint owns vocabulary and pair validation.
        RETURN NEW;
    END IF;

    -- A pre-0015 key may be classified once. Both values must be assigned in
    -- the same statement; the CHECK constraint refuses a partial or invalid
    -- transition. Repeating the same values is harmless and is not a change.
    IF OLD.access_tier IS NULL AND OLD.billing_source IS NULL THEN
        RETURN NEW;
    END IF;

    -- A classification is issuance history, not mutable plan state. Rotating a
    -- key is the safe way to change surface: otherwise an event queued before
    -- this UPDATE could be persisted under a different billing authority.
    IF NEW.access_tier IS DISTINCT FROM OLD.access_tier
       OR NEW.billing_source IS DISTINCT FROM OLD.billing_source THEN
        RAISE EXCEPTION USING
            ERRCODE = '55000',
            MESSAGE = 'an API key access classification is immutable once assigned',
            HINT = 'Revoke this key and issue a new key with the intended classification.';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER api_keys_access_classification_guard
    BEFORE INSERT OR UPDATE OF access_tier, billing_source ON api_keys
    FOR EACH ROW
    EXECUTE FUNCTION enforce_api_key_access_classification();

COMMENT ON COLUMN api_keys.access_tier IS
    'Closed API surface classification: API_FREE, API_PAID, or RAPIDAPI. NULL means a quarantined pre-0015 key, never wildcard access.';
COMMENT ON COLUMN api_keys.billing_source IS
    'Billing authority paired with access_tier: DIRECT or RAPIDAPI. RapidAPI usage is never internally invoiceable.';
COMMENT ON COLUMN api_usage_events.access_tier IS
    'Snapshot of the authenticating key access tier. Pre-0015 rows remain NULL rather than receiving a guessed backfill.';
COMMENT ON COLUMN api_usage_events.billing_source IS
    'Snapshot of the authenticating key billing authority. RAPIDAPI rows are analytics/reconciliation only, never internal invoice candidates.';
