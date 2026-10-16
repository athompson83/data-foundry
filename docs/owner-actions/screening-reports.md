# Screening report operations

This is an engineering runbook, not an owner approval request. See ADR-0019 and the current release evidence.

## HTTP contract

All routes are same-origin on `data.aroqon.com`, require an existing direct Bearer key and refuse marketplace credentials. They are deliberately outside the public dataset API/MCP contracts: those still query the same canonical data.

| Method | Path | Behavior |
| --- | --- | --- |
| POST | `/screening/reports` | JSON `{csv,tier,brand}`; returns all findings and a saved preview ID. `tier` is standard or branded; standard forbids brand. |
| GET | `/screening/reports?before=<timestamp>` | Up to 50 account-owned report summaries and next cursor. |
| GET | `/screening/reports/<id>` | Original dated snapshot; no requery or payment required. |
| POST | `/screening/reports/<id>/checkout` | Create/reuse one Checkout session at the server-owned price. |
| POST | `/screening/reports/<id>/verify` | Re-read current Stripe payment; never accepts a client session ID or paid flag. |
| GET | `/screening/reports/<id>/csv` | Payment-verified download; spreadsheet formula prefixes neutralized. |
| GET | `/screening/reports/<id>/print` | Payment-verified escaped, script-free HTML; printable to PDF. |
| POST | `/screening/reports/<id>/delete` | Expire an open Checkout then erase private report/brand contents. |

Error responses retain private/no-store headers. 400 invalid upload, 401 invalid/revoked/suspended key, 402 unverified payment, 403 inactive new-preview account or marketplace channel, 404 unknown/other-account/deleted/expired report, 409 Checkout preparation conflict, 422 oversized result, 429 quota/rate limit, 503 data/billing/runtime unavailable.

## Release procedure

1. Require green candidate and exact-main protected checks, focused payment/concurrency/migration tests and browser proof. Preserve existing publication gates.
2. Record a D1 Time Travel bookmark. On the exact merged candidate, inspect `wrangler d1 migrations list data-foundry-recalls --remote --config apps/recalls-worker/wrangler.toml`; only 0005 may be pending. Apply with the corresponding `migrations apply` command, then read back the migration and table/index schema.
3. Use `.github/workflows/deploy-recalls.yml` with `expected_sha` and `confirm=deploy-recalls`. Verify deployed source/version. Run the existing authenticated acceptance with fixture revocation, plus a report create/read/recheck/delete journey under a bounded test identity. Never use the exhausted owner's Evaluate key.
4. Validate real test-mode Checkout and successful payment, repeat download, wrong-account refusal, cancellation, replay and refund behavior. Keep test and live receipts separate. `SCREENING_SALES_OPEN=1` is an explicit release change, never implied by `SALES_OPEN`.
5. Verify the existing live Stripe webhook still subscribes to `checkout.session.completed`; delayed payment methods additionally need `checkout.session.async_payment_succeeded`. The pinned API requests cards only. Do not replace the existing webhook or reveal its signing secret.

## Recovery

Close new purchases with `SCREENING_SALES_OPEN=0`; existing paid reads still verify against Stripe. A dataset rights incident uses its existing kill switch, including snapshots. Roll back the Worker, leaving additive storage intact.

If Checkout creation loses its response, retry the same report/attempt within 23 hours: its idempotency key is stable. For an older ambiguous attempt, use Stripe's customer/session inventory to locate the exact report metadata before repairing its reference. Do not blindly clear the attempt or create another charge. An expired known session can be retried normally. Never label an unverified/refunded purchase paid to repair access.

Deletion of an abandoned attempt after 23 hours automatically scans the customer's recent Checkout sessions (bounded to 1,000), matches report/attempt/product/price/mode, preserves any recovered payment reference and expires an open session before erasure. A provider outage or incomplete/ambiguous scan fails closed. Failed preview reservations with no checkout are removed at their seven-day expiry, including their private brand metadata.

Retained inventory is private: do not publish report screenshots or upload customer files to issue threads. Logged errors intentionally exclude CSV, keys, Stripe response bodies and database parameters. Automated cleanup can defer for a billing outage; inspect `screening_retention_billing_retry` and reconcile before erasing uncertain paid records.
