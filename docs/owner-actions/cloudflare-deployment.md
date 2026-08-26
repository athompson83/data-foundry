# Owner actions — Cloudflare deployment and monetization

Everything here either requires a person in a dashboard/billing relationship or
coordinates repository work with Cloudflare resources that cannot be inferred
from source code alone.

`apps/edge` exists on `main`; usage-accounting corrections are proposed in PR
#14, auth/asynchronous metering in PR #15, the rights-grant model in PR #16, and
the public multi-industry Worker in PR #17. Nothing in this document should be
read as proof those open changes are merged or deployed.

---

## 1. Cloudflare account, zone and Worker routes

### Why automation cannot finish this from repository code alone

The repository does not contain production account identifiers, routes,
Hyperdrive configuration ids or credentials. Those are environment facts and
must remain outside source control.

### Checklist

1. Create or choose the Cloudflare account.
2. Add the production domain as a Cloudflare zone and move its nameservers.
3. Authenticate Wrangler against the intended account.
4. Bind the API Worker to its production hostname/custom domain.
5. Bind the public web Worker to its production hostname/custom domain after PR
   #17 or its successor is merged.
6. Keep marketplace traffic on a dedicated hostname or clearly identifiable
   route if that makes operations and bypass testing simpler, but do not deploy
   a second API implementation.

### Verify

Dry-run deployment resolves the intended account/resources, and production DNS
points only at the intended Workers. A deployment should be attributable to an
exact repository SHA.

---

## 2. Hyperdrive binding to Postgres

### Why this is operational

Creating Hyperdrive requires a live production database connection string. The
credential must not be committed.

### Checklist

1. Provision the production Postgres database and require TLS.
2. Apply the exact repository migrations to production once.
3. Create a Hyperdrive configuration for the API Worker.
4. Configure the usage-consumer Worker with its database binding as required by
   the final PR #15 implementation.
5. Configure the public Worker with the same canonical database access model
   required by PR #17.
6. Record the environment bindings outside the repository and make them
   reproducible through deployment configuration/secret management rather than
   manual memory.

### Verify

- API `/v1/health` returns success and proves a real query-layer round trip.
- A missing/misbound database returns fail-closed unavailability rather than an
  empty in-memory dataset.
- Public pages query the same canonical data as REST/MCP.
- The usage consumer can persist a test event idempotently.

---

## 3. Disconnect the legacy Vercel Git integration

Carried over from ADR-0005 and still independent of Cloudflare adoption.

### Checklist

Vercel dashboard → the project for this repository → Settings → Git →
**Disconnect**.

### Verify

A push creates no Vercel deployment/status. Only after that proof should
`vercel.json` be removed and the old ADR amended.

---

## 4. Pay per crawl — enrollment, not implementation

Pay per crawl is a Cloudflare zone capability, not a Worker billing subsystem.
The repository's role is to provide a public site worth crawling; Cloudflare
controls enrollment, charging and payout mechanics.

### Checklist

1. Enroll the zone if the feature is available.
2. Keep normal search-engine crawlers allowed if organic search is a required
   acquisition channel.
3. Configure AI-crawler charging separately from search-engine crawling.
4. Connect the payout account required by Cloudflare.
5. Measure the effect on crawl volume and organic discovery before treating
   crawler revenue as primary.

### Verify

Charged crawler requests exhibit Cloudflare's expected payment behavior and
normal search crawlers remain able to index the public site.

---

## 5. Metered API access — active implementation, not greenfield anymore

The old statement that auth, tenancy and usage accounting were wholly absent is
stale. `main` contains the initial tenancy/API-key schema; PR #14 corrects its
usage-accounting semantics and PR #15 implements authentication plus asynchronous
usage persistence.

The intended deployment after those changes land is:

```text
client / marketplace
        |
        v
apps/edge Cloudflare Worker
        |
        +-- authenticate + authorize before route execution
        +-- serve canonical query result
        +-- enqueue usage event asynchronously
                           |
                           v
                 Cloudflare Queue
                           |
                           v
                 apps/usage-consumer
                           |
                           v
                       Postgres
```

### Cloudflare resources required

1. API Worker deployment for each commercial vertical as defined by the final
   architecture.
2. Hyperdrive/database binding for the API Worker.
3. Usage-events Queue.
4. Dead-letter Queue.
5. Usage-consumer Worker bound to the queue and database.
6. Secrets/variables required for environment and vertical selection.
7. Observability for queue failures, DLQ accumulation and authentication errors.

### Verification before accepting paying traffic

- invalid/missing credentials fail before the route executes;
- revoked, expired and wrong-scope credentials fail closed;
- a valid request succeeds when the usage database is temporarily unavailable
  after the event has been accepted by the queue, matching the chosen
  fail-open accounting policy;
- duplicate queue delivery leaves one usage row;
- usage rows contain the closed route key/template rather than raw entity ids,
  query strings or request bodies;
- tenant and vertical cannot disagree with the authenticating key;
- DLQ behavior is demonstrated against real Cloudflare Queues, not only test
  doubles, before billing depends on it.

---

## 6. RapidAPI / marketplace connection — proxy to Cloudflare, do not redeploy

RapidAPI should be treated as a marketplace/distribution and billing layer over
the canonical Cloudflare API. It does not require another database or another
copy of `apps/api`.

Target path:

```text
RapidAPI subscriber
        |
        v
RapidAPI gateway
        |
        | hidden Data Foundry bearer credential
        | marketplace proxy-secret header
        v
Cloudflare API Worker
        |
        v
canonical query layer
```

### Checklist

1. Create a dedicated Data Foundry marketplace tenant/service credential using
   the existing API-key system.
2. Store that credential as a hidden marketplace header; never expose it in
   public documentation or client-generated snippets.
3. Store the RapidAPI proxy secret as a Cloudflare secret and verify it on the
   marketplace path.
4. Classify the request as marketplace-originated only after both marketplace
   and Data Foundry authentication checks pass.
5. Record marketplace usage internally for reconciliation and unit economics,
   but do not feed those rows into future direct invoicing.
6. Export/generate the marketplace OpenAPI definition from the canonical API
   contract and add a drift check.
7. Disable/minimize marketplace request/response logging beyond what is needed
   operationally, particularly for query parameters that may reveal customer
   research patterns.
8. Perform a bypass test: direct requests to the marketplace hostname without
   valid marketplace proof must fail even if they attempt to spoof plan/channel
   headers.

### Billing rule

RapidAPI is the billing authority for marketplace-originated calls. Data
Foundry still pays its Cloudflare/Postgres infrastructure costs and records
usage, but must not issue a second invoice for the same requests. Direct API
customers remain on a separate billing source/channel.

---

## 7. Rights gate before any commercial route goes live

Deployment readiness is not publication-rights readiness. PR #16 is required
because the same source may legitimately be allowed on a free web comparison
page while prohibited in a paid API, marketplace or sublicensed access path.

Before enabling a paid Cloudflare route or RapidAPI listing:

1. Every contributing real source must have a reviewed rights decision.
2. The exact use case (`API_FREE`, `API_PAID`, `LLM_RETRIEVAL`, export, web,
   redistribution/sublicense as applicable) must resolve to permission.
3. Every required attribution/condition must be enforced on that surface.
4. Unknown/absent grants fail closed.
5. Customer-facing terms must not grant rights broader than Data Foundry has.

Synthetic fixtures can prove deployment mechanics; they cannot satisfy this
commercial gate.

---

## 8. Production launch order

1. Merge/reconcile PR #16 rights model.
2. Merge/reconcile PR #14 usage-accounting corrections.
3. Rebase/land PR #15 auth and metering on the final schema.
4. Rebase/land PR #17 public web on the final rights/query semantics.
5. Provision Cloudflare Postgres/Hyperdrive, Workers, Queues, DLQ, routes and
   secrets.
6. Deploy and prove exact-SHA health/readiness plus real queue behavior.
7. Rights-clear and ingest the first real commercial vertical.
8. Enable public web publication for rights-cleared web use cases.
9. Add the thin RapidAPI adapter and publish one marketplace vertical.
10. Measure demand/cost before expanding plans, verticals or building first-
    party billing.
