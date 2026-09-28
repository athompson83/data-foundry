# Recalls Worker: operations runbook (FDA Recall Intelligence and North American Consumer Product Recalls)

Worker `data-foundry-recalls` · D1 `data-foundry-recalls` (`84acdedd-4d3e-457e-9bdc-3b118590e172`) · R2 `data-foundry-raw-artifacts` under `recalls/` · Cloudflare account `c2832821a9ab36419cde6ee08112f6d3`. Architecture: [ADR-0015](../decisions/ADR-0015-first-paid-dataset-fda-recalls-on-d1.md).

## Deploying

The `Deploy recalls Worker` workflow (`.github/workflows/deploy-recalls.yml`) is the only deployment path. Nothing deploys on push.

1. Merge the reviewed change to `main`, and wait for the push-to-`main` CI run on the merge commit to succeed.
2. Actions → *Deploy recalls Worker* → *Run workflow* on `main`, with `confirm = deploy-recalls` and `expected_sha` set to the full merge commit SHA.
3. Approve the `production` environment when GitHub asks.

The workflow then:

- refuses a different SHA, red CI, a missing `CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID` environment secret, a different account, or a pending D1 migration;
- runs the Worker's typecheck and tests;
- records the live version as the rollback target;
- deploys with the tag `<sha:12>`, then verifies the new live version carries that tag and smoke-tests both origins.

It shares the `deploy-production` concurrency lock, so production deploys never overlap. Bindings, Custom Domains, the Cron schedule and vars come from the reviewed `wrangler.toml`. Secrets are not touched by a deploy.

The token needs Workers Scripts:Edit and D1:Read on account `c2832821a9ab36419cde6ee08112f6d3`.

**Rollback:** `pnpm exec wrangler rollback <rollback version> --name data-foundry-recalls` from `apps/recalls-worker`. The run summary prints the exact command.

## Production acceptance

The `Recalls production acceptance` workflow (`.github/workflows/recalls-acceptance.yml`) runs `apps/recalls-worker/scripts/acceptance.ts` against production. Dispatch it on `main` with `confirm = accept-recalls` and `expected_sha` set to the commit the deploy workflow put live, then approve the environment. It checks out that commit, which must be on `main`, and the script refuses to issue a key unless `/admin/version` shows the live version tagged with that commit, and it fails if the serving version changed by the end of the run. The workflow shares the `deploy-production` lock, so no deploy can start mid-run. Evidence therefore always describes what is serving. It needs the `RECALLS_ADMIN_TOKEN` environment secret, holding the same value as the Worker's `ADMIN_TOKEN`.

The script works on the internal customer `acceptance-20260928`:

- **Customer.** Stripe id `cus_acceptance_internal_20260928`, email `acceptance-internal@aroqon.invalid`, `developer` plan, `active`. The customer stays `active` and holds no active key between runs. If it is ever found `canceled`, reactivate that one row (`UPDATE customer SET status = 'active' WHERE id = 'acceptance-20260928'`, only while it has no active key). The script checks the status and names it. The script refuses any customer id that does not match `cus_acceptance_internal_YYYYMMDD`, because a reissue revokes that customer's existing keys.
- **Key.** Issued through `POST /admin/reissue-key`. It exists only inside the script's process and is never printed.
- **Requests.** About fifteen metered requests:
  - CPSC and Health Canada search, pagination, the fire hazard filter, and code lookup;
  - `include=raw` records with digest, provenance and attribution checks;
  - an unknown id (404);
  - FDA search, lookup and record;
  - metering (the account delta equals the data requests);
  - rejection of missing and unissued keys.
- **Revocation.** The script always revokes through `POST /admin/revoke-keys`, then proves the key returns 401.

The evidence (statuses, ids, counts and digests) goes to the job log and step summary. An operator holding `ADMIN_TOKEN` can run the same script locally with `ADMIN_TOKEN=… ACCEPTANCE_EXPECTED_SHA=<live commit> pnpm exec tsx apps/recalls-worker/scripts/acceptance.ts`.

API keys are `rcl_live_` followed by exactly 32 characters from `[A-Za-z0-9]` (`mintApiKey`). The Worker refuses any other shape before looking the key up, so a key must be issued by the Worker and never written into D1 by hand. That shape check is why the hand-written keys of 2026-09-28 were rejected.

## Operator endpoints

All operator endpoints need `Authorization: Bearer $ADMIN_TOKEN`. Without it they answer 404.

| Endpoint | Effect |
| --- | --- |
| `POST /admin/reissue-key?stripe_customer_id=…` | Revokes every key of that customer and returns one new key |
| `POST /admin/revoke-keys?stripe_customer_id=…` | Revokes every key of that customer. The customer row and usage history are kept |
| `GET /admin/version` | The serving version's id, tag (the source commit's first 12 characters, set by the deploy workflow) and upload time, from the `CF_VERSION_METADATA` binding |
| `GET /admin/indexnow-status` | For each feed (`recalls`, `product-recalls`), its R2 watermark and its last scheduled run (`trigger: "scheduled"`, scheduled time, submitted count, statuses, whether the watermark advanced) |
| `POST /admin/sync?category=…&from=…&to=…` | Manual FDA window sync (not during a migration) |

IndexNow runs only from the Cron trigger (`17 */6 * * *`). There is no manual IndexNow path, so a `last_run` record is proof of a scheduled run. A successful IndexNow submission is not evidence that a search engine indexed the page.

## Lost API key

Keys are stored only as SHA-256 hashes, so a lost key cannot be shown again. It is replaced.

1. The customer emails support from the address they used at checkout.
2. In the Stripe dashboard, find the customer by that email and confirm it matches exactly. Note the `cus_…` id. If the email does not match, do not reissue. Ask the customer to write from the billing address, or to verify through the Stripe billing portal.
3. Reissue the key. This revokes every current key for that customer and returns one new key:

   ```sh
   curl -sS -X POST "https://data.aroqon.com/admin/reissue-key?stripe_customer_id=cus_…" \
     -H "Authorization: Bearer $ADMIN_TOKEN"
   ```

   `ADMIN_TOKEN` is a Worker secret; an operator without it sets a new one with `wrangler secret put ADMIN_TOKEN`. A wrong or missing token returns 404.
4. Send the new key only to the verified billing email. Do not keep a copy.

A customer who still has a working key rotates it themselves with `POST /v1/account/rotate-key`.

## Pausing the dataset (rights kill switch)

Set `SOURCE_KILL_SWITCH = "1"` in `apps/recalls-worker/wrangler.toml` and deploy, or change the variable in the dashboard.

- Acquisition stops and the scheduled sync becomes a no-op.
- Every `/v1/recalls…` endpoint, including cached stats, returns 503.
- Account endpoints keep working, so customers can still manage billing.

## Opening and closing sales

`SALES_OPEN = "0"` shows "opening shortly" and creates no Checkout sessions. Only the Product Owner authorises `"1"`; sales were opened on 2026-09-27 on the owner's launch instruction. To stop new sales, set `"0"` and deploy; existing subscriptions and keys keep working.

## Pausing the scheduled sync

To stop ingestion from racing a migration or import, clear the Cron trigger and confirm it is empty:

```sh
curl -X PUT -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" -H "content-type: application/json" \
  "https://api.cloudflare.com/client/v4/accounts/<account>/workers/scripts/data-foundry-recalls/schedules" -d '[]'
```

To restore it, send `[{"cron":"17 */6 * * *"}]`; `wrangler deploy` also restores it from `wrangler.toml`. The manual `/admin/sync` endpoint needs `ADMIN_TOKEN` and must not be called during a migration.

## Database recovery

D1 Time Travel keeps point-in-time history for 30 days on Workers Paid.

1. Record a bookmark before any schema change or bulk write:

   ```sh
   wrangler d1 time-travel info data-foundry-recalls
   ```

2. To restore to that point, pause the Cron first, then:

   ```sh
   wrangler d1 time-travel restore data-foundry-recalls --bookmark=<bookmark>
   ```

   A restore overwrites the database in place. It returns a new bookmark for the state it replaced, so the restore can itself be undone.

Raw evidence in R2 is append-only and is not touched by a D1 restore. A restored row's `raw_ref` still resolves, because bundles are never rewritten.

## Rotating secrets

| Secret | Where it comes from | After rotating |
| --- | --- | --- |
| `STRIPE_SECRET_KEY` | Stripe dashboard → API keys | `wrangler secret put STRIPE_SECRET_KEY` on `data-foundry-recalls` right away, or checkout and webhooks fail |
| `STRIPE_WEBHOOK_SECRET` | Stripe → Webhooks → endpoint `we_1UK1TtLlvU3ZaHdiy7KqSNdW` → roll signing secret | `wrangler secret put STRIPE_WEBHOOK_SECRET` |
| `ADMIN_TOKEN` | any random value of 32 or more characters | `wrangler secret put ADMIN_TOKEN`, and update the `RECALLS_ADMIN_TOKEN` environment secret in GitHub to the same value |
| `RAPIDAPI_PROXY_SECRET` | RapidAPI provider dashboard → the listing's security settings | `wrangler secret put RAPIDAPI_PROXY_SECRET`. Only once the channel is being opened (ADR-0016) |
