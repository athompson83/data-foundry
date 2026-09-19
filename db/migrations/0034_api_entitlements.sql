-- 0034_api_entitlements.sql
--
-- What a direct customer is ENTITLED to consume in a billing period, and how
-- much of it they have consumed. This is the "strict quota" ADR-0007 declined
-- to build "until asked"; the 2026-09-19 self-service direction asks for it:
-- a prepaid monthly subscription with an included request allowance and a hard
-- stop, and an evaluation tier capped the same way. ADR-0014 records the
-- decision.
--
-- Three things this table deliberately is not:
--
--   1. Not a price list. `plan_code` and `included_requests` describe what one
--      tenant bought; the catalogue of what is for sale stays outside the
--      schema, exactly as 0011's closing note intended.
--   2. Not metering. `api_usage_events` remains the asynchronous, idempotent
--      record of consumption (ADR-0009). `consumed_requests` is a synchronous
--      reservation counter that exists only so request N+1 can be refused
--      before it is served. The two are reconciled, never conflated.
--   3. Not the marketplace's quota. RapidAPI enforces its own plans per
--      subscriber at the proxy; rows here carry `billing_source = 'DIRECT'`
--      only, and the check constraint says so.
--
-- One tenant may hold at most one entitlement per vertical per period start;
-- the runtime selects the row whose period contains "now". Periods are half
-- open: [period_start, period_end).

CREATE TABLE IF NOT EXISTS api_entitlements (
    id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         UUID        NOT NULL REFERENCES api_tenants (id) ON DELETE RESTRICT,
    vertical_id       UUID        NOT NULL REFERENCES verticals (id) ON DELETE RESTRICT,
    billing_source    TEXT        NOT NULL DEFAULT 'DIRECT',
    -- The commercial plan this period was sold under, as a lowercase slug.
    -- A label for reconciliation, not a lookup into a price table.
    plan_code         TEXT        NOT NULL,
    included_requests INTEGER     NOT NULL,
    consumed_requests INTEGER     NOT NULL DEFAULT 0,
    period_start      TIMESTAMPTZ NOT NULL,
    period_end        TIMESTAMPTZ NOT NULL,
    status            TEXT        NOT NULL DEFAULT 'ACTIVE',
    cancelled_at      TIMESTAMPTZ     NULL,
    -- A payment-provider or invoice reference, when one exists. Opaque text;
    -- never a secret, never customer contact data.
    external_ref      TEXT            NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT api_entitlements_billing_source_direct CHECK (billing_source = 'DIRECT'),
    CONSTRAINT api_entitlements_plan_code_slug CHECK (plan_code ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
    CONSTRAINT api_entitlements_included_nonnegative CHECK (included_requests >= 0),
    CONSTRAINT api_entitlements_consumed_nonnegative CHECK (consumed_requests >= 0),
    -- The hard stop, enforced by the database and not only by the edge: a
    -- reservation that would exceed the allowance cannot be written at all.
    CONSTRAINT api_entitlements_consumed_within_allowance CHECK (consumed_requests <= included_requests),
    CONSTRAINT api_entitlements_period_ordered CHECK (period_end > period_start),
    CONSTRAINT api_entitlements_status_allowed CHECK (status IN ('ACTIVE', 'CANCELLED')),
    CONSTRAINT api_entitlements_cancelled_consistent CHECK ((status = 'CANCELLED') = (cancelled_at IS NOT NULL)),
    CONSTRAINT api_entitlements_external_ref_bounded CHECK (external_ref IS NULL OR length(external_ref) <= 200)
);

-- One period per tenant, vertical and start instant; renewal appends the next.
CREATE UNIQUE INDEX IF NOT EXISTS api_entitlements_period_uniq
    ON api_entitlements (tenant_id, vertical_id, billing_source, period_start);

-- The request-path lookup: the active period containing "now" for one tenant
-- and vertical. Small table, hot row; the index keeps the reservation a
-- single indexed UPDATE.
CREATE INDEX IF NOT EXISTS api_entitlements_active_lookup_idx
    ON api_entitlements (tenant_id, vertical_id, billing_source, period_start, period_end)
    WHERE status = 'ACTIVE';

-- Two audited operator interventions join the closed action vocabulary:
-- renewing an entitlement into its next period and cancelling one. The audit
-- table's inline CHECK is replaced additively; history rows are untouched.
ALTER TABLE operator_actions DROP CONSTRAINT IF EXISTS operator_actions_action_check;
ALTER TABLE operator_actions ADD CONSTRAINT operator_actions_action_check
    CHECK (action IN (
        'PAUSE_SOURCE', 'RESUME_SOURCE', 'REPLAY_DELIVERY', 'RETIRE_DELIVERY', 'BACKFILL_RUN',
        'RETRACT_FACT', 'REVOKE_KEY', 'CLOSE_ACCOUNT', 'RENEW_ENTITLEMENT', 'CANCEL_ENTITLEMENT'
    ));
