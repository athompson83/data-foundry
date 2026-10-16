# Landing page, RapidAPI and Cloudflare alignment — 2026-10-15

## Verdict

COMPLETE for REV-016 after the recorded release checks. The landing page exposes the two new APIs; the existing RapidAPI listing publishes ten endpoints and an expanded overview/guide; the same canonical Cloudflare Worker serves the reviewed release. This is technical distribution proof. No independent paid customer or revenue is established by operator tests.

## Checklist snapshot

One stable item added: REV-016, channel alignment. REV-014/REV-015 remain DONE; REV-008/REV-013 remain IN_PROGRESS for independent paid consumption/buyer validation. The original collector REV-012 remains IN_PROGRESS with both extraction-publication gates closed. No other item reopened or closed; no unstable portfolio completion percentage.

## Progress report

Canonical base `e517688f0e68ff8b4ecf9a04bc83c6e6954bd479`, existing isolated worktree `C:/Users/Adam/data-foundry-worktrees/revenue-20261015`, branch `codex/channel-sync-20261015`. The older dirty chat checkout is preserved. PR #100 final reviewed head `b16eaf1a2dff168d5a990c4ef66272a0694609ac` adds a landing integration section and scopes its cache to the Worker version plus existing dataset/sales/marketplace gates. Only published datasets appear in examples; no available datasets hides lookup. Direct discovery is unmetered; direct lookup uses one allowance unit. Coverage warnings and raw-evidence limits are visible.

Existing RapidAPI project `api_ba3c8244-55fa-4a3f-8226-c040dcf03bab`, version `apiversion_f3aa3c26-7c24-4949-9ea3-e9a62a50362a` / 1.0.0: added GET `/v1/datasets` (`listDatasets`) and GET `/v1/lookup` (`lookupAcrossDatasets`) manually to its existing v1 group. All eight existing endpoints remain. The overview, guide, query parameters and external documentation links explain selected/default coverage, one explicit dataset for raw evidence, truncation, safety limitations and separate marketplace metering. Existing plans, proxy secret, origin URL, visibility and payout settings are preserved. Saved state survives reload and is visible on the public Hub.

## Problems found and fixed

The landing page omitted the new APIs, and its release-independent edge cache could keep an old page after deployment. Three regression tests cover new links, publication gates and release cache isolation. Review found the runbook's assumed five-minute coverage cache duration was inaccurate: `cached()` uses the existing one-hour `EDGE_TTL_SECONDS`; the documentation and PR description were corrected. The finding was resolved. The superseded CI run was canceled, and the final candidate was checked afresh.

The public RapidAPI guide omitted discovery/unified lookup and described unavailable coverage as 403. It now documents 503 dataset unavailability and separates it from 403 inactive-channel/restricted-route errors. The public direct catalog being unmetered does not make RapidAPI catalog calls free of marketplace allowance. The old September listing package is marked historical, with current operating guidance above it. Closeout review also found ADR-0016 still described hidden paid tiers: its October 15 amendment records the observed public provider state, without inventing when/by whom it changed or claiming a new financial approval. The historical October 9 activation remains intact.

## Required user actions

None for this channel-alignment release. The existing signed-in browser session was reused. No purchase, subscription/price/payout change, new legal acceptance or outbound prospect message was needed.

## Recommended next steps

Continue REV-011 lifecycle reconciliation and qualify the existing portfolio/collector work through rights, provenance and source-quality gates before publishing another dataset. REV-008/REV-013 require independent paid integration evidence; the saved owner BASIC test application is not such evidence. Outreach remains unsent.

## Repository and verification evidence

Local commands:

- `corepack pnpm run typecheck` — passed.
- `corepack pnpm --filter @data-foundry/recalls-worker typecheck` — passed.
- `corepack pnpm exec vitest run apps/recalls-worker/test --maxWorkers=2` — 8 files / 194 tests passed.
- `corepack pnpm exec wrangler deploy --dry-run --config apps/recalls-worker/wrangler.toml --outdir .data/channel-sync-bundle` — passed; SHA-256 `4551ce6c5b4f88a4296eb74ba6f791efa342a91a9d39a0540c749d3f71ca46b7`.
- `git diff --check` — passed.
- Documentation closeout: `corepack pnpm exec vitest run tooling/test/private-canary-provenance-doc.test.ts tooling/test/repository-policy.test.ts --maxWorkers=2` — 2 files / 44 tests passed.
- Local fixture browser at 1366px and 390px: one h1, no horizontal page overflow, new lookup-reference navigation reaches its heading.

Hosted evidence:

- [PR #100](https://github.com/athompson83/data-foundry/pull/100) merged the reviewed candidate as `f84280c02bf371f000426d38c5d6481405b3a9e1`, with an identical source tree. Final code review: no findings.
- [Candidate CI 38840616817](https://github.com/athompson83/data-foundry/actions/runs/38840616817) and [exact-main CI 38841888865](https://github.com/athompson83/data-foundry/actions/runs/38841888865): 262 files / 5,267 tests passed; exact-main real-Postgres migration/privilege controls passed.
- [Guarded deploy 38843189397](https://github.com/athompson83/data-foundry/actions/runs/38843189397): succeeded; deployed bundle SHA-256 matches the local bundle above. Cloudflare independently confirms deployment `3289ea1d-c372-46bc-a19f-e2db4e7b1a91`, version `07ee9246-42b8-4104-a793-2e18c014fd30`, 100%, annotation naming the full source and run.
- [Fresh production acceptance 38843342262](https://github.com/athompson83/data-foundry/actions/runs/38843342262): 27/27 checks, 13 metered requests / delta 13, both dataset payloads preserved through unified lookup; closed fixture and revoked key rejected 401/401/401. A separate D1 read confirms suspended / zero active keys.
- Public production HTTP: homepage, docs, catalog, marketplace OpenAPI and both stats endpoints return 200; contract has ten paths and no account/billing paths. Homepage client cache header is `no-cache`.
- Real production browser: 1366px and 390px, one h1, no page overflow; Copy confirmation and new lookup-reference navigation pass; zero console errors or failed network requests. Screenshots and secret-free receipts are in ignored `.data/channel-sync-*`. The updated public RapidAPI listing and production API section are left open; temporary preview/editor tabs are closed and the local preview process is stopped.

RapidAPI gateway acceptance through the existing subscribed BASIC application: catalog 200, unified lookup 200 with separate FDA and consumer-product payloads, single-dataset raw lookup 200 with redaction/digest evidence, and multi-dataset raw rejection 400. Public Hub shows ten endpoints. Read-only D1 direct usage before/after remains four usage rows / 5,257 requests; no direct double billing. These are operator request checks, not paid-subscriber evidence. No key or proxy secret is stored in this report.

Provider target remains account `c2832821a9ab36419cde6ee08112f6d3`, Worker `data-foundry-recalls`, D1 `84acdedd-4d3e-457e-9bdc-3b118590e172`, existing R2 `data-foundry-raw-artifacts`, `data.aroqon.com` and `api.data.aroqon.com`, six-hour acquisition cron. No migration or publication-flag change. Both extraction-publication flags remain 0. The existing hostname-only RUM suppression and strict CSP are preserved. Existing development dependency backlog #48 remains separate.

Rollback: Worker version `413c7b8a-4a2c-4ed0-9dee-aaae1e61b340`, source `68c4ad7d3800b9480c4277d01548c9e12fbb3e64`. No database rollback needed. RapidAPI additions use already accepted backend routes; reverting a landing release does not require deleting marketplace endpoints or changing plans.
