# ADR-0007 — Abuse protection, accounting and quota are three systems

**Status:** Accepted
**Date:** 2026-08-23
**Relates to:** ADR-0006 (Cloudflare Workers is the deployment target), `db/migrations/0012_usage_accounting_corrections.sql`

## Context

`db/migrations/0011_api_tenancy.sql` gave `api_keys` a `rate_limit_per_minute`
column. It was removed in 0012, and the reason is worth recording, because the
column was not a small mistake — it was three different jobs collapsed into one
number, stored in the one place that cannot do any of them.

Nothing on the request path can read Postgres per request. An edge worker that
consulted a row before serving would add a round trip to every call and would
become, under exactly the load a limit exists to shed, the bottleneck the limit
was meant to prevent. So the column was unreadable by the only component in a
position to act on it, and a limit nothing enforces is worse than no limit: it
reads as a control, and somebody will eventually believe it.

Underneath that is the real confusion. "Rate limiting" is used for three
requirements that differ in latency budget, in consistency, in where they run,
and — most tellingly — in which direction they fail.

## Decision

> These are three separate systems. They are named separately, built
> separately, and fail in opposite directions on purpose.

### 1. Abuse protection — availability

**Question:** is this traffic threatening the service?

Runs at the edge, before the origin and before any database. Approximate by
design: a counter that is a few requests out of date is fine, because the
purpose is to shed load rather than to bill for it. Configured at Cloudflare
(WAF rate limiting rules and the Workers rate-limiting binding), not in this
schema, because it must be enforced by something that is already in the request
path and already has to be up for the request to exist at all.

**Fails closed.** When it cannot decide, it refuses. Serving unbounded traffic
because a counter was unavailable is how an outage becomes a bigger outage.

### 2. Accounting — revenue

**Question:** what did we serve, and to whom?

Runs asynchronously, off the critical path, over a Cloudflare Queue into
`api_usage_events`. Its requirement is durability and attribution — the right
tenant, the right vertical, the right route — not immediacy. An invoice built an
hour late is an invoice; an invoice for the wrong customer is a liability.

**Fails open.** The owner decision on this is explicit: undercount rather than
block an authorized read. A metering pipeline that could refuse a paid request
has converted a bookkeeping failure into a customer-facing outage, which is a
strictly worse trade for both parties. The cost of failing open is a request we
did not bill, and that is a cost we can absorb and detect.

### 3. Strict quota — entitlement

**Question:** has this customer already consumed what they are entitled to?

This is the expensive one. Refusing request N+1 because N requests have already
been served requires a synchronous, strongly-consistent counter read on the
request path — precisely the property abuse protection gives up for speed and
accounting gives up for durability. It cannot be built from either of the other
two without inheriting the reason they are cheap.

**Not built, and deliberately so.** Nobody has asked for a hard ceiling, and the
schema deliberately holds no prices, plans or invoices to define one against. If
it is ever needed it arrives as its own mechanism — a Durable Object or a
Cloudflare rate-limiting binding keyed by tenant — and this ADR is revisited
rather than worked around.

## Consequences

**The failure directions are the test.** If a proposed change would make abuse
protection fail open, or accounting fail closed, the change has confused two of
these systems. That is a cheaper check than re-deriving the argument, and it is
the check to apply to the next person who proposes putting a limit in a column.

**`api_keys` holds no limits.** It holds identity, scope and lifecycle: who the
key belongs to, which vertical it may read, and whether it is still usable.
What a caller is *entitled* to is a commercial arrangement, and this schema
holds no commercial arrangements — see 0011's closing note on prices, plans and
invoices, which this decision extends rather than revises.

**The API-key display prefix is 16 characters by design.** Eight characters are
the fixed `df_live_` or `df_test_` label and eight are variable base64url
characters, about 48 bits of distinguishing power. The previous 12-character
shape exposed only about 24 distinguishing bits and reaches birthday collisions
at ordinary large-tenant key counts, defeating the prefix's support and
revocation purpose. The remaining secret still carries more than 200 undisclosed
bits. `packages/api-keys/src/index.ts` implements the length and
`packages/api-keys/test/api-keys.test.ts` pins both sides of the trade-off.

**Abuse protection is an owner action, not a code change.** It is configured in
the Cloudflare dashboard against the zone; see
`docs/owner-actions/cloudflare-deployment.md`. Nothing in this repository can
assert it is switched on, so nothing in this repository claims it is.
