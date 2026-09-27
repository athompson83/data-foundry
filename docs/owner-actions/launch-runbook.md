# Launch runbook: from merged code to the first paid request

Every engineering prerequisite for the paid vehicles API is merged-ready in PR #57. What remains is access, accounts and execution against real sources. Follow this in order. Each step names the runbook that holds the exact commands.

| # | Step | Who | Where |
| --- | --- | --- | --- |
| 1 | Allow the environment to reach `vpic.nhtsa.dot.gov`, `api.nhtsa.gov`, `static.nhtsa.gov`, `www.nhtsa.gov`, `www.fueleconomy.gov`, `api.cloudflare.com`; add `CLOUDFLARE_API_TOKEN` (and repository secrets `CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID` for the deploy workflow) | Owner (`UA-009`) | claude.ai environment settings; GitHub repository settings |
| 2 | Merge PR #57 | Owner | GitHub |
| 3 | Capture NHTSA and EPA terms pages and the bulk files. Verify every assumption in `verticals/vehicles/SOURCES.md`: columns, order, quoting, zip member names, and the `RCLTYPECD` code set | Agent | `docs/owner-actions/vehicles-initial-load.md` |
| 4 | Write `docs/sources/determinations/<source>.yaml` (ADR-0013 basis `PUBLIC_DOMAIN_US_GOVERNMENT_WORK`, evidence digests, per-surface decisions), then run `pnpm rights:record` | Agent | `docs/source-onboarding.md` Stage 1 step 6 |
| 5 | Activate the vehicles source YAMLs (status, classification, acquisition approval) in a reviewed PR, replacing the synthetic shape fixtures with captured samples | Agent | `verticals/vehicles/` |
| 6 | Apply migrations `0034` and `0035` and the post-migration grant upgrade to the hosted database (313 grants, 60 functions) | Agent + owner-held migration credential | `docs/owner-actions/cloudflare-deployment.md`, `pnpm migrate:supabase:export` |
| 7 | Bulk-load the initial snapshot with `pnpm ingest --vertical vehicles --artifact … --evidence-dir …`: a dry run first, then the real load | Agent | `docs/owner-actions/vehicles-initial-load.md` |
| 8 | Deploy the Workers (manual `deploy-production` workflow or local Wrangler), including `data-foundry-edge-vehicles` on `api.data.aroqon.com/v1/vehicles/*`. First convert both of `data-foundry-recalls`' Custom Domains (`api.data.aroqon.com` and `data.aroqon.com`) to route patterns in a reviewed change to `apps/recalls-worker/wrangler.toml`, deploy it, and verify the recall API, pages, checkout, Stripe webhook and `/admin/*` endpoints, as `UA-005` and ADR-0015 describe; a Custom Domain otherwise takes every path, including the web Worker's `/vehicles/*` pages | Agent (after UA-005 already authorized) | `docs/owner-actions/cloudflare-deployment.md` section 10 |
| 9 | Stripe in test mode: set the `STRIPE_*`/`BILLING_*` settings with the sandbox price ids, register the webhook, and run one test purchase end to end | Agent | `docs/owner-actions/stripe-billing-setup.md` |
| 10 | The Stripe account is already activated for live payments (owner part of `UA-010`, done 2026-09-26). Recreate the five prices in live mode, add them to the billing portal's plan switching, and switch the secrets | Agent | `docs/owner-actions/stripe-billing-setup.md` |
| 11 | RapidAPI: enroll, import `openapi/data-foundry-vehicles-rapidapi-v1.openapi.json` unchanged, configure plans and the proxy secret, run `credentials:provision`, then make a test-subscriber call | Owner (`UA-004`) + agent | `docs/owner-actions/rapidapi-vehicles-listing.md` |
| 12 | Set `availability: available` and `direct_checkout` in `verticals/vehicles/product.yaml` once the terms, privacy and support policies (`UA-007`) are approved | Owner (`UA-007`) + agent | `docs/owner-actions/stripe-billing-setup.md` section 4a |

The launch is done when a real customer's paid request on `api.data.aroqon.com/v1/vehicles/...` is served from rights-approved, evidence-backed data and metered against their allowance.
