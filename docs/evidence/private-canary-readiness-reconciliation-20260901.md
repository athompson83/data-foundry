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
- Runtime-fix provenance commit:
  `df4a66561eab2a5fdc4d93e3489f07ff82ccd382`. It repaired the shared-DLQ
  loss path, but it is an ancestor of the integrated branch head and is not an
  informally selectable deployment target.
- Integrated branch head at this reconciliation:
  `64bb05bdb2dc5877f526acf9e38c02146d2d5831`. It contains the later CI and
  documentation follow-up commits.
- Pre-repair PR #26 head:
  `effa3ec82c96e8f68d21ddc4d2b32919497dbddb`, based on protected `main`
  `290df1342094433e92978ec97eb37cc02fc4eb50`. CI run `33517988867` completed
  successfully on that head, but its legacy artifact gate built only five
  ordinary Worker manifests and omitted `apps/private-canary`.
- **Repository state alone designates no Worker release candidate.** Every SHA above is
  historical provenance only. None may be used for a migration, artifact build
  intended for deployment, or provider deployment until a reviewed exact
  release SHA is repository-validated and the separate provider gates are
  complete.

The original candidate was superseded by necessary runtime repairs: private
fixture cycles, closed metering verification, TLS-only direct migration,
immutable Git-object migration loading, exact private-canary deployment
validation, and a TLS-only disposable CI database path. The runtime-fix commit
also isolates synthetic metering into a dedicated Queue/DLQ pair and control
traffic into a dedicated ingress/DLQ/quarantine chain rather than consuming the
shared usage DLQ.

The required provenance gate is deliberately explicit. Repository engineering
continues while provider-side containment is pending, but no provider operation
may begin until both gates are satisfied. The exact release SHA selected for
provider work must contain the runtime changes, tests, six-artifact gate, and
aligned documentation. A clean
checkout of that exact SHA must dry-run and scan all six route-less
private-canary Worker artifacts: five reduced target Workers (each with a
synthetic Hyperdrive configuration only for the credential-free build) plus the
private-canary harness without Hyperdrive. Every generated artifact directory
must be present and scanned; any target entrypoint or manifest that cannot
bundle fails the gate closed. The historical five-Worker artifact check is
insufficient and must not be cited as six-Worker provenance.

That repository artifact attestation is not provider deployment evidence. Do
not add a documentation-only follow-up commit after that verification. Instead,
record the selected SHA and its exact test evidence in the durable release/PR
record, then obtain
provider evidence mapping all six temporary Worker scripts/versions to the same
SHA before any canary fixture. A source-path comparison, historical ancestor, or
later documentation SHA is not an artifact attestation.

## Cloudflare inventory

The scoped account/zone inventory reported:

- no Data Foundry Worker;
- no Data Foundry Hyperdrive configuration;
- no Data Foundry Worker route;
- no exact Data Foundry hostname DNS record;
- no Data Foundry R2 bucket was visible in this 2026-09-01 snapshot. An earlier
  2026-09-02 observation listed `data-foundry-raw-artifacts`, but the later
  authoritative 2026-09-02T14:46Z API refresh found zero R2 buckets and
  supersedes that same-day observation. The raw-artifact bucket is currently
  absent; even when present it is not the private-canary receipt bucket or
  Worker/R2 binding proof;
- `data-foundry-usage-events` and
  `data-foundry-usage-events-dlq`, each with 1,209,600 seconds (14 days)
  retention and zero configured consumers.

The fresh session made no Cloudflare mutation. Read-only inventory can prove
the current absence/presence above, but cannot by itself attribute the two
preexisting Queue objects to an earlier session. No public DNS or Worker route
was introduced.

The authoritative 2026-09-02T14:46Z API refresh keeps the ordinary two-queue,
14-day, zero-consumer observation current and records the standard usage model,
zero Data Foundry Workers, zero Hyperdrives, zero R2 buckets, and no Data
Foundry hostname record or Worker route. It names no unrelated Worker scripts.

## Hosted database inventory

This section is a 2026-09-01 baseline only. It is superseded for database
state by [the 2026-09-02 hosted migration and grant record](alpha-lab-hosted-migration-20260902.md),
which proves the private schema, 26-ledger migration result, and staged
`NOLOGIN` role grants. It remains relevant only for the earlier empty-schema
baseline and the still-unproven route-less canary infrastructure.

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

- The five target runtime passwords, five role-specific Hyperdrives, R2 receipt
  bucket, and six temporary Worker deployment manifests remain owner/provider-
  gated. The five reduced targets need Hyperdrive; the private-canary harness
  must remain without Hyperdrive.
- The first canary must remain service-bound and route-less: no public DNS,
  Worker route, workers.dev endpoint, or real-source publication is authorized
  by this reconciliation.
- The observed normal usage Queue/DLQ pair is a read-only baseline only; it is
  neither private-canary ingress nor a private-canary consumer source. It stays
  unchanged, and only the ordinary usage consumer may consume
  `data-foundry-usage-events`. The private-canary path instead requires all five
  additional, still-unprovisioned 14-day queues: synthetic metering uses
  `data-foundry-private-canary-usage-events` ->
  `data-foundry-private-canary-usage-events-dlq`; control uses
  `data-foundry-private-canary-events` ->
  `data-foundry-private-canary-dlq` ->
  `data-foundry-private-canary-quarantine`. Their retry, consumer, quarantine,
  database-persistence, and idempotency behavior remain unproven until the
  synthetic private canary is deployed and exercised.

## Related records

- [Sensitive browser-state containment](sensitive-browser-state-containment-20260901.md)
- [Cloudflare deployment owner actions](../owner-actions/cloudflare-deployment.md)
- [Project checklist](../../PROJECT_CHECKLIST.md)
