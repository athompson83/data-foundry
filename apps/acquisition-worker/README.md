# Scheduled acquisition Worker

`apps/acquisition-worker` is the Cloudflare Cron composition root for Task 9.
It is repository-ready but not deployed. Its tracked `wrangler.toml` declares an
hourly `0 * * * *` trigger, the canonical `RAW_ARTIFACTS` R2 binding, and no
usage Queue; production account, route, Hyperdrive id, provider credentials,
and live evidence remain outside source control.

## Runtime and persistence

`pnpm acquisition:compile` converts each enabled vertical's source and refresh
configuration into a committed runtime artifact. The Worker never reads YAML at
runtime and refuses a `VERTICAL_SLUG` that is not bundled.

Migration `0017_scheduled_acquisition_runs.sql` stores deterministic Cron claims,
rights receipts, provider/result state, validators, and artifact associations;
`0019_scheduled_acquisition_pre_persistence.sql` adds the fourth rights
checkpoint; and `0020_scheduled_acquisition_claim_leases.sql` makes an abandoned
claim recoverable without creating a second slot row. One opaque attempt token
owns a 20-minute execution lease. A terminal duplicate is a no-op, an unexpired
concurrent owner is reported as retryable, an unexpected caught failure releases
its attempt immediately, and an expired attempt is reclaimed with a rotated
fencing token. Successful artifacts are content-addressed and immutable in R2;
retrieval/run history remains in Postgres so deduplication does not erase when
or why bytes were obtained.

## Fail-closed rights boundary

The runner evaluates exact stored `ACQUIRE`, `STORE`, and `CACHE` decisions on
`INTERNAL_PROCESSING`. It rechecks before provider construction, before
transport, and after the provider result has been fully preflighted immediately
before persistence. The pre-persistence hook also verifies that the same
unexpired fencing token still owns the run. A missing grant, sticky denial,
stale terms/review, kill switch, changed stored scope, or lost lease refuses
before the affected provider secret, network boundary, or R2 write. Source YAML
classification and booleans are only inventory/additional hard stops; they
cannot manufacture permission.

The proposed ENERGY STAR source is not bundled. It remains `UNDER_REVIEW`,
`UNREVIEWED`, unapproved, and deferred; this Worker does not contact or acquire
it.

## Verification and deployment

```bash
pnpm acquisition:check
pnpm acquisition:postgres:check
pnpm --filter @data-foundry/acquisition-worker test
pnpm cloudflare:topology:check
pnpm cloudflare:artifacts:check
```

Local development may use `POSTGRES_URL`; production requires `HYPERDRIVE` and
the `RAW_ARTIFACTS` binding and never falls back to an in-memory database.
Provider credentials are read only after exact rights admission. Follow
`docs/owner-actions/cloudflare-deployment.md` for the remaining protected
provider configuration and live Cron/R2/Postgres proof.
