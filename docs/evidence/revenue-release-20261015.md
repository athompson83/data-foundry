# Revenue recovery closeout — 2026-10-15

## Verdict

**COMPLETE for the technical selling-path recovery.** First independent paid revenue remains IN_PROGRESS. Final live Stripe read still shows one active $0 Evaluate subscription and no paid subscription. Marketplace revenue is unknown; public paid offers are not receipts. See [the diagnosis and unsent outreach packet](../commercial-validation/revenue-recovery-20261015.md).

## Checklist snapshot

- REV-012: DONE — deployed buyer access, browser usage and Stripe upgrade selection independently verified.
- REV-008: IN_PROGRESS — needs an independent paid subscription followed by a useful metered request.
- REV-013: IN_PROGRESS — three researched integration prospects and prepared drafts; no independent buyer conversation or sent message is claimed.
- PRs #86 and #94 were incorporated and automatically marked merged through #96. One review finding was repaired and resolved. No roadmap percentage is reported because its denominator changes.

## Progress report

Canonical main began at `e551c89628b7faf55cd3bb4d049c8892a4fd6db3`; the deployed recalls source began at `a8e875eec327ccaad1261f7804e3a12430f90ac2`. [PR #96](https://github.com/athompson83/data-foundry/pull/96) merged as **`94c852cf85ed39e57886c122d099f305eefd3baa`**, whose tree matches the reviewed candidate. The canonical checkout was fast-forwarded only after confirming it remained clean. The older chat checkout at `0ae6c7a` and its four unrelated dirty files were preserved.

The production site now exposes API signup/no-card evaluation, the accepted direct starting price, registry-defined use cases, truthful marketplace discovery, `/pricing`, and private `/account` usage and Stripe portal access. Account controls reuse existing authentication and unmetered operations. No production migration, price, customer subscription, settlement destination, source-rights or publication-gate change was made.

Stripe's four existing products had misleading FDA-only names/descriptions despite including consumer-product data. Product names, descriptions and URLs now cover FDA, CPSC and Health Canada; the existing portal headline is `Data Foundry — Recall Intelligence APIs`. Fresh provider reads preserve the four product/price IDs and $0/$49/$149/$299 USD monthly prices. Privacy/terms URLs and plan-change/cancellation policies were preserved. These are copy changes, not charges or subscription changes.

## Problems found and fixed

1. **Stale marketplace discovery.** The site said listings were unavailable despite public paid RapidAPI plans. It now links the listing only when the full delivery gate, including a usable installed proxy secret, passes. Absent/short-secret regressions cover the review finding.
2. **Purchase friction.** Hero actions now expose API access; existing customers can check usage and open billing in the browser. `/pricing` returns the canonical pricing section instead of 404. Post-checkout navigation exposes account management.
3. **Browser authentication transport.** Real browser testing caught a canonical-host redirect that CSP blocked. Same-origin endpoints repair it, refuse cross-host redirects/marketplace-shaped requests, and retain private/no-store responses. Keys are masked and absent from URLs, storage and logs.
4. **Blocked release pipeline.** Main CI [37939649506](https://github.com/athompson83/data-foundry/actions/runs/37939649506) had failed on October 9 because the checklist lost its historical-evidence boundary. Complete logs identified the deterministic documentation failure. The existing assertion was preserved; the boundary was restored and all 12 related tests pass.
5. **Billing description mismatch.** Stripe checkout/portal copy described only FDA data. The existing products and portal copy were corrected and read back; the private browser plan chooser displays all three paid tiers correctly.

## Required user actions

**UA-REV-OUTREACH:** explicitly authorize sending the prepared inFlow, Booqable and Cheqroom messages through published business contact channels. External messaging needs the owner's direct sending instruction. This gates outreach, not engineering or deployment; the request is pending and nothing was sent. If deferred, the site can sell but buyer validation remains unproven. Agent-owned product operation and evidence review can continue. Recommended: a small targeted first batch, then learn from actual identifier coverage and responses before changing prices or adding more datasets.

No purchase, advertising spend, paid subscription, financial-settlement change, legal acceptance, automated follow-up or mailing-list enrollment was performed.

## Recommended next steps

1. REV-013 — agent after sending authorization: execute the three reviewed messages through each company's published business/integration channel.
2. REV-008/REV-013 — agent with an independent buyer: establish usable manufacturer identifiers, verify coverage, then observe a paid subscription and first useful metered request. Internal asset labels are not UPCs; an unmatched item is not a safety clearance.
3. Reconcile marketplace subscriber/receipt evidence when authorized provider access is available. Public BASIC/PRO/ULTRA/MEGA prices alone do not establish revenue. Direct hard limits and marketplace overage terms remain distinct.
4. Keep Pay Per Crawl out of the current revenue forecast: the live zone eligibility API returned `can_be_enabled=false`, `enabled=false`. Configuration/signature endpoints were unavailable through the connector; no legal agreement or payout onboarding was attempted.

## Repository and evidence record

| Layer | Exact evidence |
| --- | --- |
| Reviewed candidate | `3f8a55bb39baa411f3fe45ffaa829c027c0c0d53`; [CI 38784788623](https://github.com/athompson83/data-foundry/actions/runs/38784788623) passed 261 files / 5,233 tests plus applicable gates |
| Qualified main / deployed source | `94c852cf85ed39e57886c122d099f305eefd3baa`; [main CI 38786999276](https://github.com/athompson83/data-foundry/actions/runs/38786999276) passed all jobs, including real Postgres and 5,233 tests |
| Guarded deployment | [38788979975](https://github.com/athompson83/data-foundry/actions/runs/38788979975), succeeded; pending-D1-migration guard passed |
| Serving version | `733e7d49-75d6-4d5f-bc2d-6019c39ed2d0`, 100%; Cloudflare deployment `5f1910b9-0b51-4bf8-bf6c-b8c7cf8d888b`, annotation binds source `94c852c…` and deploy run |
| Uploaded bundle | SHA-256 `f3aabb5a92f7ee89feebcdea0179c1a1f9d67593cb8e74114e8293f3faf691c7` |
| Authenticated API acceptance | [38789247318](https://github.com/athompson83/data-foundry/actions/runs/38789247318): all 22 checks, 11 metered fixture requests, exact serving version/source; fixture suspended, 0 active fixture keys, subsequent requests 401/401 |
| Direct entry-point acceptance | `/`, `/account`, `/docs`, `/recalls`, `/product-recalls`: 200; `/pricing`: 301; Evaluate and Developer checkout: 303 to `checkout.stripe.com`, no payment submitted |
| Real browser acceptance | 390px production account page: actual key entry and clicks returned Evaluate 100/100 and upgrade guidance, no key in browser storage, no overflow or script errors; Manage billing reached Stripe and all three paid plans were visible. No subscription update submitted. The real key stayed inside a private local process and was never printed. |
| Unmetered account proof | Authenticated same-origin usage and portal APIs returned 200/private/no-store; owner request count stayed 100 |
| Search discovery submission | Existing IndexNow ownership proof verified; provider returned 200 for homepage and docs on October 15. Receipt proves submission only, not indexing, traffic or customers. Existing record feeds and their watermarks were unchanged. |
| Database / infrastructure | Existing recalls D1 `84acdedd-4d3e-457e-9bdc-3b118590e172`, raw-artifact R2 and Cloudflare Worker reused; no duplicate provider project or production migration |
| Local checks | Root/Worker typechecks; 250 Worker/parser tests before two added gate regressions, 31 focused account/site checks afterwards; 1,058 pipeline/inventory/provenance-doc checks; dry-run bundle and diff checks |
| Local limits | An extra full local suite was stopped when free memory fell to 1.3 GiB; it is not claimed passing. Hosted complete suites above provide full proof. Agent-created local Wrangler/test processes were stopped. |
| Security scope | Review finding repaired/resolved; key, transport, method/channel and destination controls tested. 16 pre-existing development-dependency alerts remain under issue #48; this release does not claim a clean dependency audit. |
| Recovery | Previous serving version `eafd2479-65b6-4f50-b8f6-6ab4d9ae2092`, source `a8e875eec327ccaad1261f7804e3a12430f90ac2`. Old Stripe product copy and sanitized verification receipts retained locally. |

This closeout changes documentation only. It does not redeploy the Worker or invalidate the named serving-source proof. Freshly created verification Checkout Sessions are engineering probes and must be excluded from customer-conversion metrics.
