# ADR-0014 — Direct-customer request allowance with a hard stop

**Status:** Accepted, 2026-09-19. Revisits the "strict quota" section of ADR-0007, which deferred this mechanism "until asked"; the 2026-09-19 self-service direction asks for it.

**Relates to:** ADR-0007 (rate limiting, accounting and quota are three systems), ADR-0009 (usage metering over a queue), ADR-0010 (rights grant matrix), migration `0034_api_entitlements.sql`, `docs/owner-actions/direct-api-pricing-and-invoicing-decision.md`.

## Context

The pricing page and the pricing decision have said since 2026-09-08 that a plan's included requests end in a **hard stop with no automatic overage**, and the 2026-09-19 direction fixes the initial offer at a prepaid monthly subscription with 5,000 included requests, a hard stop, and an evaluation tier capped at 100 requests. Nothing enforced any of it: `api_keys` deliberately holds no limits (ADR-0007), `0012` dropped the last per-key limit column, and the only "quota" a direct customer would meet was the absence of one.

ADR-0007 was right about the shape of the problem. Refusing request N+1 because N have been served needs a synchronous, strongly consistent counter on the request path — exactly the property abuse protection gives up for speed and metering gives up for durability. It therefore has to be its own mechanism, and this ADR is that mechanism.

## Decision

1. **A new table, `api_entitlements`, records what one tenant bought for one vertical in one billing period**: `plan_code`, `included_requests`, `consumed_requests`, a half-open `[period_start, period_end)`, `status` (`ACTIVE` or `CANCELLED`) and an opaque `external_ref` for a payment-provider or invoice reference. It is not a price list and not metering; both of those stay where ADR-0007 and 0011 put them. Only `billing_source = 'DIRECT'` rows exist: the marketplace enforces its own plans per subscriber before a request reaches the origin, and MCP is analytics-only.
2. **Reserve, then serve.** After authentication and before any route executes, a `DIRECT`-billed request performs one atomic `UPDATE … SET consumed_requests = consumed_requests + 1 WHERE … AND consumed_requests < included_requests RETURNING …` against the tenant's active period. The row lock serializes a tenant's concurrent requests; the predicate and the table's check constraint make over-consumption impossible rather than unlikely. A tenant with no active period is refused `403 FORBIDDEN` (indistinguishable on the wire from the other 403s, on purpose); a spent period is refused `429 QUOTA_EXHAUSTED` with `Retry-After` set to the seconds until the period ends. Refusals execute nothing and are **not metered**: like an authentication failure, they consumed nothing billable.
3. **Our fault does not spend the customer's allowance.** A response with status 500 or above releases the unit it reserved. Client errors keep theirs: the request was served, the answer was "no".
4. **A served response tells the client where it stands** through `x-allowance-limit`, `x-allowance-remaining` and `x-allowance-reset` (the period end, ISO 8601), so "inspect allowance" needs no extra endpoint or credential.
5. **The evaluation tier is the same mechanism.** `API_FREE`/`DIRECT` keys are entitled exactly like paid ones, with a smaller allowance; there is no second cap.
6. **Provisioning creates the first period; audited operator actions renew and cancel.** `pnpm credentials:provision --plan-code <slug> --included-requests <n>` inserts `[now, now + 1 month)` alongside the key. `RENEW_ENTITLEMENT` appends the next consecutive period with the same plan and allowance (idempotent per request id; refused once a later period exists), `CANCEL_ENTITLEMENT` ends one, and `CLOSE_ACCOUNT` now cancels the account's active periods as well as revoking its keys. When a payment provider is adopted, its signed, idempotent events drive these same actions; nothing grants access from a browser redirect.
7. **The edge's database identity grows by exactly eleven column grants**: `SELECT` on nine columns of `api_entitlements` and `UPDATE` on `consumed_requests` and `updated_at`. It cannot create, cancel, re-price or re-period an entitlement. The generated runtime grant inventory moves from 286 to 297 expected grants; the hosted database, at 286 after 2026-09-18, must receive migration `0034` and the regenerated grant SQL before a direct key can be served there.

## Consequences

- A direct key with no active period is refused. This is the intended fail-closed default for a paid product and costs nothing today: the hosted database holds zero keys. Tests that mint direct keys now seed a period as well.
- The pricing page's "hard stop at the allowance" is true for direct keys once `0034` is hosted. It was not true before this decision, and the pricing decision document is corrected to say so.
- Reservation adds one indexed `UPDATE` (and, on refusal, one `SELECT`) to every direct request on the same Hyperdrive connection authentication already uses. At the initial offer's volumes this is negligible; if it ever is not, the Durable Object alternative ADR-0007 named remains open, behind the same `reserveEntitlement` seam.
- `consumed_requests` and `api_usage_events` will differ by design: the counter includes 4xx-served requests and excludes released 5xx faults, while metering records every served response. Reconciliation compares them; neither is corrected to match the other.
- `QUOTA_EXHAUSTED` joins the closed opaque-edge error vocabulary and every authenticated route documents a `429` in OpenAPI.
- Renewal is an operator action, not a scheduled job. Automatic renewal arrives with the payment provider whose confirmed payment is the only legitimate trigger for it.

## Alternatives considered

- **Derive the count from `api_usage_events`.** Rejected: metering is asynchronous and at-least-once; a limit read from it overshoots by the queue's lag and cannot be a hard stop.
- **Cloudflare rate-limiting binding keyed by tenant.** Rejected for this purpose: it is a sliding window, not a billing period, and it cannot express "5,000 in the month you paid for".
- **Durable Object counter.** Deferred, not rejected: correct but a second stateful system with its own deployment, for a problem one indexed row solves at the initial offer's scale.
- **Fail open when no period exists.** Rejected: a paid product that serves unpaid keys by default has no hard stop.
