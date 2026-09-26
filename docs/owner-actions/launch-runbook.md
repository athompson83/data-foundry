# Launch runbook: from merged code to the first paid request

Every engineering prerequisite for the paid vehicles API is merged-ready in PR #57. What remains is access, accounts and execution against real sources. Follow this in order. Each step names the runbook that holds the exact commands.

| # | Step | Who | Where |
| --- | --- | --- | --- |
| 1 | Allow the environment to reach `vpic.nhtsa.dot.gov`, `api.nhtsa.gov`, `static.nhtsa.gov`, `www.nhtsa.gov`, `www.fueleconomy.gov`, `api.cloudflare.com`; add `CLOUDFLARE_API_TOKEN` (and repository secrets `CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID` for the deploy workflow) | Owner (`UA-009`) | claude.ai environment settings; GitHub repository settings |
| 2 | Merge PR #57 | Owner | GitHub |
| 3 | **Done 2026-09-26.** Captured the NHTSA and EPA terms pages and the bulk files; verified every `SOURCES.md` assumption. Corrections: two NHTSA archives (`FLAT_RCL_PRE_2010`/`POST_2010`), unquoted parsing, a wider campaign-number pattern. Evidence is in `docs/sources/evidence/vehicles/` | Agent | `docs/owner-actions/vehicles-initial-load.md` |
| 4 | **Written 2026-09-26; not yet recorded.** NHTSA recalls: `PUBLIC_DOMAIN_US_GOVERNMENT_WORK`, every surface ALLOW. **EPA: `PUBLISHED_TERMS_PERMIT`, every customer surface UNKNOWN**, because fueleconomy.gov's copyright statement is non-commercial. EPA fuel economy therefore cannot ship until EPA-hosted evidence or written approval exists. Next, run `pnpm rights:record` | Agent | `docs/sources/vehicles-federal-rights-determination-20260926.md` |
| 5 | Activate the vehicles source YAMLs (status, classification, acquisition approval) in a reviewed PR, (the fixtures are already real samples) | Agent | `verticals/vehicles/` |
| 6 | Apply migrations `0034` and `0035` and the post-migration grant upgrade to the hosted database (313 grants, 60 functions) | Agent + owner-held migration credential | `docs/owner-actions/cloudflare-deployment.md`, `pnpm migrate:supabase:export` |
| 7 | Bulk-load the initial snapshot with `pnpm ingest --vertical vehicles --artifact … --evidence-dir …`: a dry run first, then the real load | Agent | `docs/owner-actions/vehicles-initial-load.md` |
| 8 | Deploy the Workers (manual `deploy-production` workflow or local Wrangler), including `data-foundry-edge-vehicles` on `api.data.aroqon.com/v1/vehicles/*` | Agent (after UA-005 already authorized) | `docs/owner-actions/cloudflare-deployment.md` section 10 |
| 9 | Stripe in test mode: set the `STRIPE_*`/`BILLING_*` settings with the sandbox price ids, register the webhook, and run one test purchase end to end | Agent | `docs/owner-actions/stripe-billing-setup.md` |
| 10 | Activate the Stripe account for live payments, recreate the five prices in live mode, and switch the secrets | Owner (`UA-010`), then agent | `docs/owner-actions/stripe-billing-setup.md` |
| 11 | RapidAPI: enroll, import `openapi/data-foundry-vehicles-rapidapi-v1.openapi.json` unchanged, configure plans and the proxy secret, run `credentials:provision`, then make a test-subscriber call | Owner (`UA-004`) + agent | `docs/owner-actions/rapidapi-vehicles-listing.md` |
| 12 | Set `availability: available` and `direct_checkout` in `verticals/vehicles/product.yaml` once the terms, privacy and support policies (`UA-007`) are approved | Owner (`UA-007`) + agent | `docs/owner-actions/stripe-billing-setup.md` section 4a |

The launch is done when a real customer's paid request on `api.data.aroqon.com/v1/vehicles/...` is served from rights-approved, evidence-backed data and metered against their allowance.
