-- 0018_mcp_access_channel.sql
--
-- MCP is an independently authorized retrieval channel. Its usage is useful
-- for operations and product analytics, but no first-party MCP billing model
-- has been approved. The only valid pair is therefore MCP/NONE.
--
-- This migration widens closed vocabularies only. It does not backfill,
-- infer, or reclassify any existing key or usage row.

INSERT INTO api_route_keys (key, description) VALUES
    ('mcp.server_discover', 'MCP server capability discovery'),
    ('mcp.tools_list',      'MCP tool catalogue listing'),
    ('mcp.tools_call',      'MCP tool invocation'),
    ('mcp.protocol_failure','Authenticated MCP protocol refusal');

ALTER TABLE api_keys
    DROP CONSTRAINT api_keys_access_classification_allowed;

ALTER TABLE api_keys
    ADD CONSTRAINT api_keys_access_classification_allowed CHECK (
        (access_tier IS NULL AND billing_source IS NULL)
        OR (access_tier = 'API_FREE' AND billing_source = 'DIRECT')
        OR (access_tier = 'API_PAID' AND billing_source = 'DIRECT')
        OR (access_tier = 'RAPIDAPI' AND billing_source = 'RAPIDAPI')
        OR (access_tier = 'MCP' AND billing_source = 'NONE')
    );

ALTER TABLE api_usage_events
    DROP CONSTRAINT api_usage_events_access_classification_allowed;

ALTER TABLE api_usage_events
    ADD CONSTRAINT api_usage_events_access_classification_allowed CHECK (
        (access_tier IS NULL AND billing_source IS NULL)
        OR (access_tier = 'API_FREE' AND billing_source = 'DIRECT')
        OR (access_tier = 'API_PAID' AND billing_source = 'DIRECT')
        OR (access_tier = 'RAPIDAPI' AND billing_source = 'RAPIDAPI')
        OR (access_tier = 'MCP' AND billing_source = 'NONE')
    );

ALTER TABLE api_usage_events
    DROP CONSTRAINT api_usage_events_method_allowed;

ALTER TABLE api_usage_events
    ADD CONSTRAINT api_usage_events_method_allowed CHECK (method IN ('GET', 'HEAD', 'POST'));

CREATE OR REPLACE FUNCTION enforce_api_key_access_classification()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.access_tier IS NULL OR NEW.billing_source IS NULL THEN
            RAISE EXCEPTION USING
                ERRCODE = '23502',
                MESSAGE = 'new api_keys rows require an explicit access_tier and billing_source',
                HINT = 'Use API_FREE/DIRECT, API_PAID/DIRECT, RAPIDAPI/RAPIDAPI, or MCP/NONE. No default is inferred.';
        END IF;
        RETURN NEW;
    END IF;

    IF OLD.access_tier IS NULL AND OLD.billing_source IS NULL THEN
        RETURN NEW;
    END IF;

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

COMMENT ON COLUMN api_keys.access_tier IS
    'Closed access-surface classification: API_FREE, API_PAID, RAPIDAPI, or MCP. NULL means a quarantined legacy key, never wildcard access.';
COMMENT ON COLUMN api_keys.billing_source IS
    'Billing authority paired with access_tier: DIRECT, RAPIDAPI, or NONE. MCP/NONE and RAPIDAPI/RAPIDAPI usage are analytics-only.';
COMMENT ON COLUMN api_usage_events.access_tier IS
    'Snapshot of the authenticating key access tier. MCP is independent from direct and marketplace API access.';
COMMENT ON COLUMN api_usage_events.billing_source IS
    'Snapshot of billing authority. NONE is analytics-only and never an internal invoice candidate.';
