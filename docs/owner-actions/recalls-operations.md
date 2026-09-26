# FDA Recall Intelligence — operations runbook

Worker `data-foundry-recalls` · D1 `data-foundry-recalls` (`84acdedd-4d3e-457e-9bdc-3b118590e172`) · R2 `data-foundry-raw-artifacts` under `recalls/` · Cloudflare account `c2832821a9ab36419cde6ee08112f6d3`. Architecture: [ADR-0015](../decisions/ADR-0015-first-paid-dataset-fda-recalls-on-d1.md).

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

`SALES_OPEN = "0"` shows "opening shortly" and creates no Checkout sessions. Only the Product Owner authorises `"1"`.

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
| `ADMIN_TOKEN` | any random value of 32 or more characters | `wrangler secret put ADMIN_TOKEN` |
