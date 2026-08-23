-- 0011_api_tenancy.sql
--
-- Who is calling, whether they may, and what they used. The first tables in
-- this schema that describe a CUSTOMER rather than the knowledge graph.
--
-- Three rules are enforced here rather than left to application discipline,
-- because each of them is the kind of thing that is remembered until the once
-- it is not:
--
--   1. A key's secret is never stored. `api_keys` holds a SHA-256 hash and a
--      display prefix; the secret exists once, in the response that created it.
--      A CHECK refuses a hash that is not 64 lowercase hex characters, so a
--      column accidentally fed a raw key fails loudly at the boundary instead
--      of silently becoming a plaintext credential store.
--   2. Revocation is a timestamp, not a delete. A deleted key cannot explain
--      the usage rows that reference it, and those rows are what an invoice is
--      made of.
--   3. Usage outlives the key. `api_usage_events` references `api_keys` with
--      ON DELETE RESTRICT for the same reason `fact_evidence` does: the record
--      of what happened is worth more than the convenience of removing it.
--
-- Deliberately absent: prices, plans and invoices. Metering is a measurement
-- and billing is a commercial arrangement; conflating them here would bake one
-- pricing model into the schema.

CREATE TABLE IF NOT EXISTS api_tenants (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug          TEXT        NOT NULL,
    name          TEXT        NOT NULL,
    status        TEXT        NOT NULL DEFAULT 'ACTIVE',
    -- The external billing account, when one exists. Nullable because a tenant
    -- can be created before it is ever charged (trials, internal use).
    billing_ref   TEXT            NULL,
    contact_email TEXT            NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT api_tenants_status_allowed CHECK (status IN ('ACTIVE', 'SUSPENDED', 'CLOSED'))
);

CREATE UNIQUE INDEX IF NOT EXISTS api_tenants_slug_uniq ON api_tenants (slug);

CREATE TABLE IF NOT EXISTS api_keys (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID        NOT NULL REFERENCES api_tenants (id) ON DELETE RESTRICT,
    -- SHA-256 of the presented secret, lowercase hex. Never the secret itself.
    token_hash   TEXT        NOT NULL,
    -- The leading characters, kept so a human can identify a key in a list
    -- without the secret being recoverable from what is stored.
    token_prefix TEXT        NOT NULL,
    label        TEXT        NOT NULL,
    -- Which vertical this key may read. NULL means every vertical this
    -- deployment serves; a value scopes the key to one.
    vertical_id  UUID            NULL REFERENCES verticals (id) ON DELETE RESTRICT,
    rate_limit_per_minute INTEGER NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_used_at TIMESTAMPTZ     NULL,
    expires_at   TIMESTAMPTZ     NULL,
    -- Revocation is a timestamp, never a DELETE: a removed key cannot explain
    -- the usage rows that reference it.
    revoked_at   TIMESTAMPTZ     NULL,

    -- A hash-shaped value, or the column is being used to store something else.
    CONSTRAINT api_keys_token_hash_shape CHECK (token_hash ~ '^[0-9a-f]{64}$'),
    CONSTRAINT api_keys_token_prefix_shape CHECK (char_length(token_prefix) BETWEEN 4 AND 16),
    CONSTRAINT api_keys_rate_limit_positive CHECK (
        rate_limit_per_minute IS NULL OR rate_limit_per_minute > 0
    )
);

-- Lookup is by hash on every authenticated request, so it is the hot path.
CREATE UNIQUE INDEX IF NOT EXISTS api_keys_token_hash_uniq ON api_keys (token_hash);
CREATE INDEX IF NOT EXISTS api_keys_tenant ON api_keys (tenant_id);

CREATE TABLE IF NOT EXISTS api_usage_events (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID        NOT NULL REFERENCES api_tenants (id) ON DELETE RESTRICT,
    api_key_id   UUID        NOT NULL REFERENCES api_keys (id) ON DELETE RESTRICT,
    occurred_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- The matched ROUTE TEMPLATE, never the request target. `/v1/entities/{id}`
    -- rather than `/v1/entities/9f3c...`: an entity id in a metering table is a
    -- record of what a customer looked up, which is a disclosure surface and
    -- not something an invoice needs.
    route        TEXT        NOT NULL,
    method       TEXT        NOT NULL,
    status       INTEGER     NOT NULL,
    -- What the request cost us, for usage-based pricing that is not just a
    -- request count. Rows served is the honest unit for a data API.
    rows_served  INTEGER     NOT NULL DEFAULT 0,
    duration_ms  INTEGER     NULL,

    CONSTRAINT api_usage_events_method_allowed CHECK (method IN ('GET', 'HEAD')),
    CONSTRAINT api_usage_events_status_range CHECK (status BETWEEN 100 AND 599),
    CONSTRAINT api_usage_events_rows_served_nonneg CHECK (rows_served >= 0),
    CONSTRAINT api_usage_events_duration_nonneg CHECK (duration_ms IS NULL OR duration_ms >= 0),
    -- A metering row must not carry a request target. The route template is a
    -- fixed vocabulary; anything with a query string or a UUID in it is a leak.
    CONSTRAINT api_usage_events_route_is_template CHECK (route !~ '[?&]')
);

-- Invoicing reads a tenant's window; both indexes serve that shape.
CREATE INDEX IF NOT EXISTS api_usage_events_tenant_window
    ON api_usage_events (tenant_id, occurred_at);
CREATE INDEX IF NOT EXISTS api_usage_events_key_window
    ON api_usage_events (api_key_id, occurred_at);
