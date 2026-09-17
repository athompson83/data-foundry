# External verification canary — what is possible today

Prepared 2026-09-16 in response to a request for a temporary public HTTPS canary
that an external verifier (ChatGPT) could call without credentials.

## Headline

**The preferred design cannot be built, and the stated success condition cannot
be met by anyone today — not because the surface is unreachable, but because
there is no deployed pipeline behind it.**

The fallback is available, already implemented, already green, and already
publicly readable. It proves a real synthetic transaction through real
PostgreSQL with the real runners — but it is **not** the deployed pipeline, and
this document does not pretend otherwise.

## Why the preferred design is not available

Four independently sufficient reasons, each measured today.

**1. The Cloudflare connector is not authenticated in this session.** Its tools
are not loadable. No Worker, route, or binding can be created from here.

**2. The private canary is deliberately route-less by design.**
`apps/private-canary/wrangler.toml` opens with:

> *"There is deliberately no public route, workers.dev endpoint, preview URL,
> Hyperdrive, database credential, source artifact bucket, or Queue producer."*

with `workers_dev = false` and `preview_urls = false`. Adding a public route is
not a configuration gap to fill — it contradicts the reviewed architecture, and
the request's own security rules forbid weakening the production authentication
model. **This is the reason that would still apply even if the other three were
solved.**

**3. No runtime database credentials exist.** Measured via the read-only
management connector: all six `df_*` roles are `NOLOGIN` with no password, and
`df_ingestion` does not exist at all. No Worker could reach PostgreSQL.

**4. The hosted schema is seven migrations behind.** The ledger is `0001`–`0026`;
`0027`–`0033` are unapplied. UA-002 is blocked on an external capability. There
is no canonical query surface in the hosted database to write through to.

**Conclusion:** a public endpoint would be a facade over a pipeline that is not
deployed. Building one would satisfy the letter of the request and mislead the
verifier, which is worse than returning nothing.

## What does exist, and is verifiable right now

The repository is **public**, so GitHub Actions runs are readable by anyone with
no credentials. CI already runs a job that performs the synthetic end-to-end
transaction against **real PostgreSQL** — not PGlite — with certificate-verified
TLS and a job-local CA, structurally equivalent to the hosted direct path.

**Reference run on merged release `2063ea8` — all steps green, reported
independently:**

`https://github.com/athompson83/data-foundry/actions/runs/35137492353/job/104933454084`

| Stage | Result |
| --- | --- |
| Start disposable TLS PostgreSQL | success |
| Bootstrap narrow private migration role | success |
| Verify raw private schema owner ACL baseline | success |
| Apply migrations to Postgres | success |
| Re-apply must be a no-op | success |
| Refuse database-wide migration CREATE | success |
| Stage disposable runtime roles and apply exact grants | success |
| Activate disposable runtime roles with isolated credentials | success |
| Direct runtime-role TLS connection regression | success |
| **Real ingestion role publish and immutable-history regression** | **success** |
| Effective runtime and migration-role privilege negative controls | success |
| Source-record reconciliation concurrency regression | success |
| Credential provisioning concurrency regression | success |
| Scheduled acquisition concurrency and transaction controls | success |

Each step is a separate GitHub step with its own conclusion, so **no stage
infers success from an upstream stage** — which the request explicitly asked for.

**There are no secrets to leak.** Every password in that job is generated
per-run with `openssl rand` and dies with the container. Nothing in it touches
the hosted database, a production credential, or real-source data.

## What that run proves, and what it does not

**Proves** — `tooling/scripts/check-ingestion-postgres.ts`, *"Disposable
PostgreSQL proof for the real ingestion role, using fictional fixtures only"*:

- The real `runScheduledAcquisition` runner executes against fixed synthetic
  fixtures whose SHA-256 is pinned (`SYNTHETIC_INGESTION_FIXTURES` refuses hash
  drift).
- The real `processIngestionDelivery` ingestion runner processes the delivery.
- Canonical PostgreSQL ends with `facts > 0` **and** `fact_evidence > 0`,
  asserted, under the real `df_ingestion` role with its exact grants.
- Unauthorised mutations are rejected (negative controls pass).

**Does not prove** — and these are the gaps that matter for the requested flow:

| Requested stage | Status |
| --- | --- |
| Queue delivery occurred | **Not proven.** The ingestion runner is invoked directly; no real Cloudflare Queue is exercised |
| R2 artifact/receipt exists | **Not proven.** The check uses `InMemoryObjectClient`, so the artifact-store *interface* is exercised, not real R2 |
| Deployed Workers processed it | **Not proven.** No Workers are deployed |
| Query layer read from the hosted database | **Not proven.** The hosted schema is seven migrations behind |
| REST/MCP parity on a public surface | **Not possible.** No public surface exists |

So it is a **code-path proof against ephemeral infrastructure**, not a
deployed-system proof. Calling it end-to-end verification of Data Foundry would
be the same overclaim this session has already made three times in other forms.

## What an external verifier can do today

**Observe, not initiate.** The success condition allows either.

1. Open the run URL above — no credentials, no login for public repo runs.
2. Confirm each stage's independent conclusion.
3. Read `tooling/scripts/check-ingestion-postgres.ts` and
   `.github/workflows/ci.yml` in the public repo to confirm the job does what
   this document claims rather than taking the summary on trust.
4. Confirm the negative controls passed — that unauthorised mutations were
   rejected is as important as the positive path.

**Triggering** a fresh run requires write access, so ChatGPT cannot initiate
one. A new run appears automatically on any pull request touching the paths that
select the Postgres job.

## The increment that would close the gap, if wanted

A `workflow_dispatch` verification workflow taking a caller-supplied
**correlation id** (non-secret), reusing the existing job, and publishing a
sanitized per-stage JSON block to the run summary. That would give a stable,
citable artifact per verification rather than requiring the verifier to read a
CI job built for a different purpose.

It would still prove exactly what the job above proves — no more. **It is a
reporting improvement, not additional verification**, and it is not worth
building until someone has said the existing run is insufficient. Deliberately
not built on that basis.

## Cleanup

**Nothing was created, exposed, or deployed, so there is nothing to tear down.**
No route, no endpoint, no token, no credential, no public surface. The cleanup
obligation is discharged by there being nothing to clean up.

Any future canary should carry its own expiry and teardown record before it is
created, not after.
