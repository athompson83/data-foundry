# ADR-0008 — Usage events carry tenant and vertical, and two composite keys make that safe

**Status:** Accepted
**Date:** 2026-08-23
**Relates to:** `db/migrations/0011_api_tenancy.sql`, `db/migrations/0012_usage_accounting_corrections.sql`, ADR-0007

## Context

`api_usage_events.tenant_id` is derivable. Every usage row names an
`api_key_id`, every key names a tenant, and keys are never deleted — revocation
is a timestamp, and the foreign key is `ON DELETE RESTRICT` — so the join is
always available. The same is now true of `vertical_id`.

Storing a derivable column is a denormalization, and this particular
denormalization has already caused a real defect. In the first draft of 0011,
`tenant_id` and `api_key_id` were validated independently: both foreign keys
resolved, nothing compared them, and a usage row could charge tenant B for a
request made with tenant A's key. That is an invoice billed to the wrong
customer and an audit trail that contradicts itself. Review caught it before it
was applied anywhere.

The default should therefore be to normalize — you cannot mis-attribute what you
do not store — and the burden is on the denormalization to earn its place with a
measurement rather than an argument.

## Measurement

**Reproducible.** The script is `tooling/scripts/bench-usage-invoicing.ts`:

```
POSTGRES_URL=postgres://user@host:5432/scratch pnpm tsx tooling/scripts/bench-usage-invoicing.ts
```

It refuses to run without an explicit `POSTGRES_URL` and refuses a database that
already holds usage rows. Nothing in CI runs it — it writes two million rows and
takes about two minutes, which is the wrong shape for a gate. It exists so the
table below can be checked, and so it can be re-run when a schema, index, query
or plan assumption changes, which is the condition this ADR sets for revisiting
the decision.

**The figures below are one run.** A re-run on 2026-08-23 against the same
PostgreSQL 16.13 gave 77.0 ms vs 160.8 ms on the largest tenant (2.1×) and
58.3 ms vs 151.9 ms per-vertical (2.6×), with buffers 13,872/0 against
31,126/3,303. Absolute milliseconds move between runs — different random
identifiers, different cache state — and the smallest-tenant row moved most, from
3.0 ms to 0.5 ms, because "smallest" is whichever tenant the key distribution
happened to give the fewest rows. **The ratio and the plan shape are what the
decision rests on, and those held.** Quote the ratio, not the milliseconds.


PostgreSQL 16.13, 2,000,000 usage events (645 MB) across 200 tenants, 1,398
keys and 4 verticals, spread over 90 days. One tenant deliberately holds 500
keys: the case that decides the question, because it is the tenant whose
normalized query has to reach the most keys. Both shapes have the index they
would have in production — `(tenant_id, occurred_at)` and `(vertical_id,
occurred_at)` for the denormalized reads, `(api_key_id, occurred_at)` for the
join. Best of five runs, after `ANALYZE`.

The query is the one an invoice is actually built from: a month's calls and rows
served, grouped by route, for one tenant.

| Read | Denormalized | Normalized (join `api_keys`) | Ratio |
|---|---|---|---|
| Tenant invoice, 500-key tenant | **83 ms** | 158 ms | 1.9× |
| Tenant invoice, 2-key tenant | **3.0 ms** | 3.0 ms | 1.0× |
| Per-vertical attribution | **61 ms** | 141 ms | 2.3× |

The timings are the visible part; the buffer counts are the durable part. On the
per-vertical read the denormalized plan touches 13,162 shared buffers and reads
none from disk. The normalized plan touches 30,346 and reads a further 4,080 —
2.6× the pages, and it leaves cache to do it. That ratio is a property of having
to visit `api_keys` for rows the index could have filtered, so it does not
improve as the table grows; it is the shape of the plan, not a warm-cache
artifact.

Two honest qualifications. Usage is distributed uniformly across keys in this
fixture, where real traffic is skewed — that makes the small-tenant row
optimistic for the join, not pessimistic. And 2 million rows is a small table;
the margin was measured where the difference is *least* pronounced.

## Decision

> `api_usage_events` stores `tenant_id` and `vertical_id`, and two composite
> foreign keys make it impossible for either to disagree with the key that made
> the request.

```sql
CONSTRAINT api_usage_events_key_belongs_to_tenant
    FOREIGN KEY (api_key_id, tenant_id)   REFERENCES api_keys (id, tenant_id),
CONSTRAINT api_usage_events_vertical_matches_key
    FOREIGN KEY (api_key_id, vertical_id) REFERENCES api_keys (id, vertical_id)
```

Both are **total**, which is why 0012 also made `api_keys.vertical_id` NOT NULL.
A composite foreign key with a NULL component is satisfied vacuously under MATCH
SIMPLE, so a nullable scope would have left the constraint unenforceable for
exactly the keys with the widest reach — the ones where a mis-attribution costs
most. One key names one vertical; access to two industries is two keys. How
broad a customer's access is belongs to a plan, and this schema holds no plans
(ADR-0007).

## Consequences

**The denormalization is no longer a correctness risk, which is the whole
argument.** Normalizing would have removed the defect by removing the column;
the composite keys remove it by making the disagreement unrepresentable. Both
are sound, and only one of them also answers the invoicing query twice as fast.

**A metering writer cannot invent an attribution.** It must supply the tenant
and vertical that the key it authenticated actually belongs to, or the insert is
refused — not by whichever code path happens to write the row, but by the
database, on every path, including one written later by someone who has not read
this file. `tooling/test/migrations.test.ts` proves it by inserting the
disagreeing rows and expecting SQLSTATE 23503.

**If this is revisited, re-measure rather than re-argue.** The measurement above
is reproducible; the plan shapes are the reason, and a change in either — a
partitioned usage table, a materialized invoice rollup — could legitimately flip
the answer.
