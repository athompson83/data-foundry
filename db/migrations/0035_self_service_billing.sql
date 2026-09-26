-- 0035_self_service_billing.sql
--
-- Self-service paid API access (Stripe Checkout) and the monthly allowance
-- hard stop the published plans promise.
--
-- Plans and prices stay configuration (`verticals/<slug>/product.yaml`); the
-- database records only what a customer bought and how much they have used:
--
--   api_tenant_allowances      the monthly request allowance a tenant bought.
--                              No row means no allowance is enforced, which
--                              keeps every operator-provisioned key working
--                              exactly as before.
--   api_usage_monthly_counters one row per tenant per UTC calendar month,
--                              maintained by a trigger on api_usage_events so
--                              a replayed (conflicting) event never counts twice.
--   api_subscriptions          the Stripe customer/subscription behind a tenant,
--                              and the one-time claim of its first key.
--   billing_webhook_events     provider event ids already applied (idempotency).

CREATE TABLE IF NOT EXISTS api_tenant_allowances (
    tenant_id                 UUID        PRIMARY KEY REFERENCES api_tenants (id) ON DELETE RESTRICT,
    plan_code                 TEXT        NOT NULL,
    monthly_request_allowance INTEGER     NOT NULL,
    updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT api_tenant_allowances_plan_code_shape CHECK (plan_code ~ '^[a-z][a-z0-9_-]{0,62}$'),
    CONSTRAINT api_tenant_allowances_positive CHECK (monthly_request_allowance > 0)
);

CREATE TABLE IF NOT EXISTS api_usage_monthly_counters (
    tenant_id     UUID    NOT NULL REFERENCES api_tenants (id) ON DELETE RESTRICT,
    period_month  DATE    NOT NULL,
    request_count BIGINT  NOT NULL DEFAULT 0,

    PRIMARY KEY (tenant_id, period_month),
    CONSTRAINT api_usage_monthly_counters_month_start CHECK (period_month = date_trunc('month', period_month)::date),
    CONSTRAINT api_usage_monthly_counters_nonneg CHECK (request_count >= 0)
);

-- Counts every persisted request that did not fail on our side. A 5xx is the
-- platform's fault and never consumes a customer's allowance.
CREATE OR REPLACE FUNCTION api_usage_monthly_counters_increment()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.status < 500 THEN
        INSERT INTO api_usage_monthly_counters (tenant_id, period_month, request_count)
        VALUES (NEW.tenant_id, date_trunc('month', NEW.occurred_at AT TIME ZONE 'UTC')::date, 1)
        ON CONFLICT (tenant_id, period_month)
        DO UPDATE SET request_count = api_usage_monthly_counters.request_count + 1;
    END IF;
    RETURN NEW;
END;
$$;

ALTER FUNCTION api_usage_monthly_counters_increment() SET search_path FROM CURRENT;

DROP TRIGGER IF EXISTS api_usage_events_count_monthly ON api_usage_events;
CREATE TRIGGER api_usage_events_count_monthly
    AFTER INSERT ON api_usage_events
    FOR EACH ROW EXECUTE FUNCTION api_usage_monthly_counters_increment();

CREATE TABLE IF NOT EXISTS api_subscriptions (
    id                          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id                   UUID        NOT NULL REFERENCES api_tenants (id) ON DELETE RESTRICT,
    vertical_id                 UUID        NOT NULL REFERENCES verticals (id) ON DELETE RESTRICT,
    provider                    TEXT        NOT NULL,
    provider_customer_id        TEXT        NOT NULL,
    provider_subscription_id    TEXT        NOT NULL,
    provider_checkout_session_id TEXT       NOT NULL,
    plan_code                   TEXT        NOT NULL,
    status                      TEXT        NOT NULL,
    current_period_end          TIMESTAMPTZ     NULL,
    key_claimed_at              TIMESTAMPTZ     NULL,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT api_subscriptions_provider_allowed CHECK (provider IN ('STRIPE')),
    CONSTRAINT api_subscriptions_status_allowed CHECK (status IN (
        'INCOMPLETE', 'TRIALING', 'ACTIVE', 'PAST_DUE', 'UNPAID', 'CANCELED', 'PAUSED'
    )),
    CONSTRAINT api_subscriptions_plan_code_shape CHECK (plan_code ~ '^[a-z][a-z0-9_-]{0,62}$'),
    CONSTRAINT api_subscriptions_customer_nonempty CHECK (btrim(provider_customer_id) <> ''),
    CONSTRAINT api_subscriptions_subscription_nonempty CHECK (btrim(provider_subscription_id) <> ''),
    CONSTRAINT api_subscriptions_session_nonempty CHECK (btrim(provider_checkout_session_id) <> '')
);

CREATE UNIQUE INDEX IF NOT EXISTS api_subscriptions_provider_subscription_uniq
    ON api_subscriptions (provider, provider_subscription_id);
CREATE UNIQUE INDEX IF NOT EXISTS api_subscriptions_provider_session_uniq
    ON api_subscriptions (provider, provider_checkout_session_id);
CREATE INDEX IF NOT EXISTS api_subscriptions_tenant ON api_subscriptions (tenant_id);

CREATE TABLE IF NOT EXISTS billing_webhook_events (
    provider          TEXT        NOT NULL,
    provider_event_id TEXT        NOT NULL,
    event_type        TEXT        NOT NULL,
    received_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

    PRIMARY KEY (provider, provider_event_id),
    CONSTRAINT billing_webhook_events_provider_allowed CHECK (provider IN ('STRIPE')),
    CONSTRAINT billing_webhook_events_type_nonempty CHECK (btrim(event_type) <> '')
);
