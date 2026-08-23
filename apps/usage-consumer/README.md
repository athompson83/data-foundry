# `@data-foundry/usage-consumer`

The Cloudflare Queue consumer that turns delivered usage events into rows in
`api_usage_events`. One file of substance.

| file | what it is |
|---|---|
| `src/index.ts` | the `queue()` handler and its per-message ack/retry policy |
| `src/env.ts` | what this consumer is configured with, and what it refuses to start without |

See [ADR-0006](../../docs/decisions/ADR-0006-cloudflare-is-the-deployment-target.md)
and `apps/edge/README.md`'s "Authentication and metering" section for the other
half of this design — `apps/edge` publishes, this consumes.

## Why a separate Worker

`apps/edge` answers a request without ever waiting on a database write:
its usage event is published to a queue and the response goes out regardless
of whether that publish, or any write it eventually causes, succeeds. This
package is where that write actually happens, on its own schedule, in its
own isolate, so a read request's latency and success can never be coupled to
this consumer's health.

## The ack/retry policy

Every message in a batch is handled independently — one `for` loop, one
try/catch per message, no transaction wrapping the whole batch. Cloudflare
redelivers per message, not per batch, so one bad message must never roll
back or block the ack of the others alongside it.

* **Persists, then acks.** `persistUsageEvent`'s `ON CONFLICT (id) DO NOTHING`
  is what makes redelivery safe: a duplicate is not a failure, and is acked
  exactly like a first-time insert.
* **Malformed → retry, never ack.** A message that fails
  `parseUsageEvent` is retried rather than discarded. Cloudflare Queues has
  no "route straight to the dead-letter queue" API; the only way a message
  leaves the queue without being persisted is exhausting `max_retries`,
  configured on `[[queues.consumers]]` in `wrangler.toml` below. Acking an
  unparseable message would make it disappear without ever being persisted
  *or* dead-lettered.
* **Persistence throws → retry, never ack.** A transient database failure
  (the pool is down, a connection times out) gets the same treatment as a
  malformed message: retried, not acked, not silently dropped.
* **A missing database refuses the whole batch.** If `HYPERDRIVE`/
  `POSTGRES_URL` is not configured, `consumeBatch` throws before touching any
  message. Nothing is acked or retried by this code; Cloudflare's own
  whole-batch retry (triggered when `queue()` throws) takes over, which is
  the correct behaviour for a systemic failure rather than a per-message one.

## Running

```bash
pnpm vitest run --project usage-consumer   # this package
pnpm --filter @data-foundry/usage-consumer dev      # wrangler dev
pnpm --filter @data-foundry/usage-consumer deploy   # wrangler deploy
```

`wrangler dev` wants a database — same `.dev.vars` convention as `apps/edge`.

Deployment needs an account id, a Hyperdrive binding, and the queue itself
(plus its dead-letter queue) to already exist in the account, none of which
are in this repository. See
[docs/owner-actions/cloudflare-deployment.md](../../docs/owner-actions/cloudflare-deployment.md).

## Deliberately absent

* **No billing, pricing, plans, invoices or subscriptions.** This consumer
  writes measurement rows. Nothing here interprets them as a bill.
* **No Durable Object.** A Durable Object earns its keep for strongly
  consistent global state: a global quota, atomic prepaid-credit
  decrementing, serialized per-tenant mutation, or a hard rate limit needing
  cross-edge-location coordination. Persisting an already-idempotent row
  needs none of those — `ON CONFLICT (id) DO NOTHING` gets the same
  exactly-once-row guarantee from ordinary Postgres, without paying for
  single-object serialization on every message.
