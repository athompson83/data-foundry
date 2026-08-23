-- 0011_api_tenancy.sql
--
-- Who is calling, whether they may, and what they used. The first tables in
-- this schema that describe a CUSTOMER rather than the knowledge graph.
--
-- Four rules are enforced here rather than left to application discipline,
-- because each of them is the kind of thing that is remembered until the once
-- it is not:
--
--   1. A key's secret is never stored. `api_keys` holds a SHA-256 hash and a
--      display prefix; the secret exists once, in the response that created it.
--   2. Revocation is a timestamp, not a delete. A deleted key cannot explain
--      the usage rows that reference it, and those rows are what an invoice is
--      made of.
--   3. Usage outlives the key. `api_usage_events` references `api_keys` with
--      ON DELETE RESTRICT for the same reason `fact_evidence` does.
--   4. A usage row cannot name a tenant other than the one whose key was used.
--      See `api_usage_events_key_belongs_to_tenant` below; this one was missing
--      in the first draft and is the reason to read that constraint carefully.
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

    -- A SHAPE guard, and only that. It makes the ordinary failure — somebody
    -- storing the raw key in this column — fail loudly, because `df_live_<b64>`
    -- cannot match. It does NOT prove the value is a SHA-256 digest: a
    -- hand-written 64-character hex string passes. Proof of hashing lives in
    -- `packages/api-keys`, not in a regex.
    CONSTRAINT api_keys_token_hash_shape CHECK (token_hash ~ '^[0-9a-f]{64}$'),
    CONSTRAINT api_keys_token_prefix_shape CHECK (char_length(token_prefix) BETWEEN 4 AND 16),
    CONSTRAINT api_keys_rate_limit_positive CHECK (
        rate_limit_per_minute IS NULL OR rate_limit_per_minute > 0
    ),
    -- Redundant against the primary key on its own, and the point is the
    -- redundancy: a composite foreign key can only target a uniquely-constrained
    -- column pair, and `api_usage_events` needs one to pin a usage row to the
    -- tenant that actually owns the key.
    CONSTRAINT api_keys_id_tenant_uniq UNIQUE (id, tenant_id)
);

-- Lookup is by hash on every authenticated request, so it is the hot path.
CREATE UNIQUE INDEX IF NOT EXISTS api_keys_token_hash_uniq ON api_keys (token_hash);
CREATE INDEX IF NOT EXISTS api_keys_tenant ON api_keys (tenant_id);

CREATE TABLE IF NOT EXISTS api_usage_events (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID        NOT NULL REFERENCES api_tenants (id) ON DELETE RESTRICT,
    api_key_id   UUID        NOT NULL REFERENCES api_keys (id) ON DELETE RESTRICT,
    occurred_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- The matched route TEMPLATE — `/v1/entities/{id}`, not the id. What a
    -- NAMED customer looked up is a disclosure surface, and an invoice does not
    -- need it. The constraints below are a guard against the two shapes that
    -- leak in practice, NOT proof that this is a template: no general CHECK can
    -- tell a literal path segment from a parameter. The durable design is a
    -- registered route vocabulary referenced by a foreign key, and it belongs
    -- with the change that populates this table, where the route list exists.
    route        TEXT        NOT NULL,
    method       TEXT        NOT NULL,
    status       INTEGER     NOT NULL,
    -- What the request cost us, for usage-based pricing that is not just a
    -- request count. Rows served is the honest unit for a data API.
    rows_served  INTEGER     NOT NULL DEFAULT 0,
    duration_ms  INTEGER     NULL,

    -- Matches the API-wide allow-list. If a billable write method is ever
    -- introduced this fails closed on a legitimate request, which is the safer
    -- direction: silently omitting write usage from metering is unbilled work.
    -- Widen it in the same change that introduces the method.
    CONSTRAINT api_usage_events_method_allowed CHECK (method IN ('GET', 'HEAD')),
    CONSTRAINT api_usage_events_status_range CHECK (status BETWEEN 100 AND 599),
    CONSTRAINT api_usage_events_rows_served_nonneg CHECK (rows_served >= 0),
    CONSTRAINT api_usage_events_duration_nonneg CHECK (duration_ms IS NULL OR duration_ms >= 0),
    -- Leak shape one: a query string.
    CONSTRAINT api_usage_events_route_no_query CHECK (route !~ '[?&]'),
    -- Leak shape two: an interpolated entity id. This is the one that would
    -- actually happen — `request.url` reaches for it far more naturally than the
    -- matched template does.
    CONSTRAINT api_usage_events_route_no_uuid CHECK (
        route !~* '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
    ),

    -- The invariant the separate foreign keys above do NOT give.
    --
    -- Validating `tenant_id` and `api_key_id` independently permits a row that
    -- charges tenant B for a request made with tenant A's key: both references
    -- resolve, and nothing compares them. That is an invoice billed to the
    -- wrong customer and an audit trail that contradicts itself, and it was
    -- possible in the first draft of this migration. Found in review.
    --
    -- The composite reference closes it in the database rather than in whichever
    -- code path happens to write the row.
    CONSTRAINT api_usage_events_key_belongs_to_tenant
        FOREIGN KEY (api_key_id, tenant_id)
        REFERENCES api_keys (id, tenant_id)
        ON DELETE RESTRICT
);

-- Invoicing reads a tenant's window; both indexes serve that shape.
CREATE INDEX IF NOT EXISTS api_usage_events_tenant_window
    ON api_usage_events (tenant_id, occurred_at);
CREATE INDEX IF NOT EXISTS api_usage_events_key_window
    ON api_usage_events (api_key_id, occurred_at);
