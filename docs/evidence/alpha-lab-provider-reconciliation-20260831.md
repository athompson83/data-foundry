# Alpha Lab provider reconciliation — 2026-08-31

**Scope:** Read-only reconciliation of the user-confirmed Alpha Lab database
target, the Aroqon Cloudflare zone/account, and the configured Vercel data
hostname.

**Redaction:** This record deliberately omits provider account, project,
deployment, route, and credential identifiers. It contains no connection
string, secret, database password, or provider-token value.

**Status:** `NOT_LIVE` — this is infrastructure-state evidence, not a
deployment, runtime-health, source-rights, or commercial-readiness certificate.

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
  Free; the planned fourteen-day Queue retention requires Workers Paid.
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
