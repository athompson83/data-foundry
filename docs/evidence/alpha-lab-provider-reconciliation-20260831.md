# Alpha Lab provider reconciliation — 2026-08-31

**Scope:** Read-only reconciliation of the user-confirmed Alpha Lab database
target, the Aroqon Cloudflare zone/account, and the configured Vercel data
hostname.

**Redaction:** This record deliberately omits provider account, project,
deployment, route, and credential identifiers. It contains no connection
string, secret, database password, or provider-token value.

**Status:** `NOT_LIVE` — this is infrastructure-state evidence, not a
deployment, runtime-health, source-rights, or commercial-readiness certificate.

## Evidence lineage

- **Immutable redacted-record anchor:** Git blob
  `967980c531dd2c48e70bd1f6e5b1d56ab7cbaff1`, committed in
  `2e54ddf734d9299ce9e3f949a0a2d75ea33423cf`. It freezes the original
  redacted reconciliation record; this annotation adds traceability without
  exposing the restricted provider material.
- **Restricted source reference:** authenticated provider dashboard/API audit
  views, where owner access permits, are the owner-restricted sources of
  record. Native responses and account details are intentionally not committed
  or reproduced here; this file retains only scoped, redacted assertions.

The scoped read-only probes were refreshed independently at the UTC times
below. Each timestamp is point-in-time evidence only, not a claim that provider
state remains current after that observation.

| Provider probe | Observed at (UTC) | Restricted-source reference |
| --- | --- | --- |
| Alpha Lab database target | `2026-08-31T21:11:23.342Z` | authenticated Alpha Lab database audit view |
| Aroqon Cloudflare zone/account | `2026-08-31T21:11:35.006Z` | authenticated Cloudflare dashboard/API audit view |
| Vercel-served data hostname | `2026-08-31T21:11:13.990Z` | Vercel-served hostname response; Vercel project audit remains owner-restricted |

## Observations

- Data Foundry belongs in a private `data_foundry` schema in the shared Alpha
  Lab database target. The shared `public` schema belongs to an unrelated
  application and was not changed. This reconciliation did not create or alter
  a Data Foundry schema, role, grant, migration ledger, or data.
- The `aroqon.com` Cloudflare zone was active/full. Existing wildcard, apex,
  `www`, CAA, and `_domainconnect` records do not establish a Data Foundry
  deployment.
- No Data Foundry Cloudflare Worker, Worker route, Hyperdrive configuration,
  Queue/DLQ, or R2 bucket was present to exercise. The account was on Workers
  Free; the planned fourteen-day Queue retention requires a Workers Paid plan.
- The configured Vercel data hostname returned `404: NOT_FOUND`. Its Git
  connection was disconnected and historical deployments failed because the
  expected output directory was absent. It is not a verified Data Foundry
  runtime or rollback target.

## Consequences

- A separate Cloudflare canary hostname must be deployed and verified before
  any change to `data.aroqon.com`. A wildcard DNS record and a Vercel domain
  association are not replacement evidence for that canary.
- Live provisioning remains owner-gated: Workers Paid approval, secure
  database-role password entry, protected deployment values, and the later
  production-hostname confirmation each require their normal owner workflow.
- No real HVAC source or effective publication/commercial grant was established
  by this reconciliation. Infrastructure proof cannot make a vertical public
  or commercial.

## Cross-references

- The ordered canary, role-isolation, queue, and cutover procedure is in
  [`docs/owner-actions/cloudflare-deployment.md`](../owner-actions/cloudflare-deployment.md).
- The project gates and owner actions are tracked in
  [`PROJECT_CHECKLIST.md`](../../PROJECT_CHECKLIST.md) and
  [`PROGRESS.md`](../../PROGRESS.md).
