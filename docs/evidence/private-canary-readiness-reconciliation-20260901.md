# Private-canary readiness reconciliation — 2026-09-01

**Scope:** Fresh, read-only reconciliation for the Data Foundry private-schema
and route-less synthetic-canary workstream. This is point-in-time infrastructure
evidence, not a deployment, rights, runtime, or production-readiness
certificate. Provider identifiers, connection strings, credentials, and browser
state are deliberately omitted.

## Candidate provenance

- Authorized original runtime candidate:
  `504d91fd10afa91001abe02cf9aaa4c95034cfca`.
- First runtime-hardening candidate:
  `e60d664a998f3fa4051aa7fd0b7dc9dc99a83d85`, now superseded because its
  private canary could consume the shared usage DLQ without a no-loss
  downstream path.
- Current runtime-code candidate:
  `df4a66561eab2a5fdc4d93e3489f07ff82ccd382`.

The original candidate was superseded by necessary runtime repairs: private
fixture cycles, closed metering verification, TLS-only direct migration,
immutable Git-object migration loading, exact private-canary deployment
validation, and a TLS-only disposable CI database path. The current candidate
also isolates synthetic control traffic into a dedicated ingress, DLQ, and
quarantine rather than consuming the shared usage DLQ. Later checklist and
runbook edits must remain a separate documentation SHA; they cannot substitute
for the runtime candidate. Any provider deployment must record each target
Worker script/version and prove it corresponds to the runtime-code candidate.

## Cloudflare inventory

The scoped account/zone inventory reported:

- no Data Foundry Worker;
- no Data Foundry Hyperdrive configuration;
- no Data Foundry Worker route;
- no exact Data Foundry hostname DNS record;
- no Data Foundry R2 bucket;
- `data-foundry-usage-events` and
  `data-foundry-usage-events-dlq`, each with 1,209,600 seconds (14 days)
  retention and zero configured consumers.

The fresh session made no Cloudflare mutation. Read-only inventory can prove
the current absence/presence above, but cannot by itself attribute the two
preexisting Queue objects to an earlier session. No public DNS or Worker route
was introduced.

## Hosted database inventory

The scoped, read-only database check reported a pre-staged `data_foundry`
schema owned by the migration principal, with:

- zero private tables, indexes, functions, and migration-ledger table;
- five staged runtime roles;
- zero direct runtime logins, privileged runtime roles, runtime memberships,
  runtime object ownerships, default ACL rows, table grants, and function
  grants; and
- no Data Foundry migration ledger in the shared `public` schema.

This proves that the hosted migration, its 46-table result, 57 function
signatures, and 200 exact grants have **not** been applied. It also preserves a
clear read-only baseline for proving that the shared `public` schema and
unrelated application objects remain unchanged after the controlled direct-TLS
migration.

## Consequences

- The five runtime passwords, five Hyperdrives, R2 receipt bucket, target
  Worker deployment manifests, and private Worker deployment remain
  owner/provider-gated.
- The first canary must remain service-bound and route-less: no public DNS,
  Worker route, workers.dev endpoint, or real-source publication is authorized
  by this reconciliation.
- The observed normal usage Queue/DLQ pair is a read-only baseline only; it is
  neither private-canary ingress nor a private-canary consumer source. The
  current candidate requires three additional, still-unprovisioned 14-day
  queues: `data-foundry-private-canary-events`,
  `data-foundry-private-canary-dlq`, and
  `data-foundry-private-canary-quarantine`. Their retry, consumer, quarantine,
  database-persistence, and idempotency behavior remain unproven until the
  synthetic private canary is deployed and exercised.

## Related records

- [Sensitive browser-state containment](sensitive-browser-state-containment-20260901.md)
- [Cloudflare deployment owner actions](../owner-actions/cloudflare-deployment.md)
- [Project checklist](../../PROJECT_CHECKLIST.md)
