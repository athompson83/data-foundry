# Recall API expansion — 2026-10-15

Distribution follow-up: the [channel-alignment release](channel-alignment-20261015.md) supersedes this serving version and verifies the two new endpoints on the public RapidAPI listing. The evidence below remains historical to source `68c4ad7`.

## Verdict

**COMPLETE for this API expansion.** Source `68c4ad7d3800b9480c4277d01548c9e12fbb3e64` is deployed and accepted on both canonical hosts. All 27 authenticated production checks pass; desktop and mobile documentation journeys pass. This extends the two existing live recall datasets; it does not publish another source or establish paid revenue.

## Checklist snapshot

REV-014 is DONE: public machine-readable discovery and cross-dataset identifier lookup, payload parity, provenance and raw-evidence integrity, fail-closed requested coverage, one direct request unit, the monthly hard stop, independent marketplace/extraction gates, and authenticated production acceptance with revocation. REV-008/REV-013 (first independent paid consumption/buyer validation) remain IN_PROGRESS. The previous recovery accidentally reused the collector's REV-012 ID: buyer access is corrected to REV-015 (DONE); the original collector REV-012 remains IN_PROGRESS with publication closed. One item added (REV-014), one ID corrected, none reopened; no unstable portfolio percentage. See [checklist](../../PROJECT_CHECKLIST.md) and [progress](../../PROGRESS.md).

## Progress report

Canonical base: `986b3170d83e90754678874bcb2eb50963b5aff0`; prior serving source: `94c852cf85ed39e57886c122d099f305eefd3baa`, version `733e7d49-75d6-4d5f-bc2d-6019c39ed2d0`. The clean existing revenue worktree is reused on `codex/recall-api-expansion-20261015`. The older dirty chat checkout is preserved.

[PR #98](https://github.com/athompson83/data-foundry/pull/98) merged the reviewed candidate `0dd359adfe419dd3a2d2abd511e0244596f13fe3` as `68c4ad7d3800b9480c4277d01548c9e12fbb3e64`, with an identical tree. The canonical checkout was fast-forwarded after confirming it was clean. The closeout branch is `codex/api-expansion-closeout-20261015`; its changes are documentation only.

- `GET /v1/datasets`: public, unmetered, revalidated JSON from the same catalog and gates as the site. Includes stable dataset/registry IDs, fields, sources and terms, limitations, refresh intention, stats and documentation URLs. Counts and actual freshness remain at each stats endpoint.
- `GET /v1/lookup?code=...`: authenticated exact lookup across both datasets; `datasets=recalls` or `datasets=product-recalls` explicitly narrows coverage. One direct HTTP data request consumes one monthly request unit. Results preserve each dataset's complete existing lookup payload, match details, attribution and evidence; notices are not merged. The aggregate truncation flag is true when any dataset is truncated.
- Default coverage always requests both datasets. Any withdrawn requested dataset yields 503 before direct metering; no silent omission. Malformed/duplicate/unknown parameters are rejected before metering. The existing gateway authentication and independent marketplace extracted-identifier entitlement remain in force.
- `include=raw` requires exactly one explicitly selected dataset (400 before direct metering otherwise), preserving the existing response memory envelope. It uses the existing digest verification, consumer-record redactions and caps (FDA 10 or consumer products 25; otherwise 100 each). Evidence failure yields an error, never partial success. Empty results explicitly do not establish safety or complete recall coverage.
- OpenAPI, human docs, API root and llms references expose these interfaces under the same publication gates. The existing production acceptance runner now checks public discovery, both lookup payloads against their original endpoints, exact metering and post-run revocation on the new route.

## Problems found and fixed

Integrators previously had to discover fields from HTML/OpenAPI and make separate identifier requests to each dataset. The new interfaces reduce this work without another canonical store, parser or billing ledger. Regression coverage prevents silent withdrawal omissions and extraction-channel leakage. Three review findings were repaired and resolved: aggregate raw-payload memory (single-dataset admission), future dataset misdispatch (exhaustive adapters), and freshness-only acceptance races (exclude only last_seen_at). Code review on the final head completed with no further findings.

Live browser acceptance found a pre-existing zone-wide Cloudflare analytics injection blocked by the site's self-only CSP. The analytics product's rule limit refused a hostname exclusion without changing its existing rule. A dry-run-validated configuration rule now sets `disable_rum: true` only for `http.host eq "data.aroqon.com"`: ruleset `66857bb7be08463a8cb2b031fce0faaf`, rule `ec80292c2ea54ac9bf8d3ca4044865db`. The existing zone analytics configuration is preserved. The strict CSP is unchanged, and both browser viewports now have zero failed requests. [Cloudflare documents this host-scoped setting and its precedence](https://developers.cloudflare.com/rules/configuration-rules/settings/#disable-real-user-monitoring-rum).

The checklist ID collision was corrected so completed billing work cannot imply the unfinished collector is published. Documentation review also caught stale current-version fields: the recovery deployment is now explicitly historical, and Protected-main state names the new serving source/version and acceptance run. No unrelated issue was closed; development-dependency/CI backlog #48 remains separate.

## Required user actions

None for this engineering release. Existing outreach remains unsent and separately requires a sending instruction. No purchase, paid subscription change, settlement change or legal acceptance is part of this work package.

## Recommended next steps

1. Agent-owned REV-011: reconcile the already accepted live consumer-dataset lifecycle metadata independently of the unmerged scout work.
2. Agent-owned portfolio expansion: assess the ENERGY STAR prototype in PR #88 and its composite dataset/source rights, linkage, acquisition and freshness gates before publishing another product.
3. Agent-owned REV-012: qualify productive collection and serving separately; extraction publication remains closed.
4. REV-013/REV-008: validate actual independent integration demand and paid consumption; API expansion alone does not demonstrate either. Outreach sending remains separately unapproved.

## Repository and evidence record

Repository: `athompson83/data-foundry`; runtime remains Worker `data-foundry-recalls`, account `c2832821a9ab36419cde6ee08112f6d3`, D1 `84acdedd-4d3e-457e-9bdc-3b118590e172`, existing R2 `data-foundry-raw-artifacts`, canonical `data.aroqon.com`/`api.data.aroqon.com`. Production D1 confirms migrations 0001–0004 applied. No schema, price, subscription, source-rights or publication-flag change was made; the only provider configuration addition is the hostname-scoped analytics suppression described above.

Local checks use at most two test workers to preserve Windows resource headroom:

- `corepack pnpm run typecheck` — passed.
- `corepack pnpm --filter @data-foundry/recalls-worker typecheck` — passed.
- `corepack pnpm exec vitest run apps/recalls-worker/test packages/recall-structuring/test packages/product-recall-structuring/test --maxWorkers=2` — 11 files, 283 tests passed after the review repairs, including the production acceptance runner against the real Worker and SQLite/R2 adapters.
- `corepack pnpm exec wrangler deploy --dry-run --config apps/recalls-worker/wrangler.toml --outdir .data/api-expansion-bundle` — bundle qualification; this does not publish.
- `git diff --check` — passed.
- Documentation closeout: `corepack pnpm exec vitest run tooling/test/private-canary-provenance-doc.test.ts tooling/test/repository-policy.test.ts --maxWorkers=2` — 44 tests passed; historical provider-evidence boundaries preserved.

The lookup registry is exhaustive over `DatasetKey`: adding a third dataset without its own validator and query fails typechecking instead of silently labeling consumer-recall results as another product. Existing public-behavior parity tests cover dispatch for both current datasets and explicit subsets.

Acceptance parity excludes only `last_seen_at`, which an unchanged-byte scheduled refresh may update between HTTP requests. Identity, raw digest, parser version, changed-at, record fields, counts, bounds, matches and attribution still compare exactly; a tampered count still fails acceptance and revokes the fixture key. A regression reproduced and repairs the freshness-only false failure.

Hosted and runtime evidence:

- [Candidate CI 38833719227](https://github.com/athompson83/data-foundry/actions/runs/38833719227): 262 files / 5,264 tests plus required contract/artifact checks passed. Earlier candidates were canceled for review repairs. One ready/draft scheduling race was identified and received one targeted rerun; subsequent draft synchronize runs finished before ready was set.
- [Exact-main CI 38834998413](https://github.com/athompson83/data-foundry/actions/runs/38834998413): all jobs passed, including 5,264 tests and real-Postgres migration/privilege negative controls.
- [Guarded deployment 38835940028](https://github.com/athompson83/data-foundry/actions/runs/38835940028): succeeded. Cloudflare independently confirms deployment `072edc5d-778f-4f7d-866e-7d2a0555b99f`, version `413c7b8a-4a2c-4ed0-9dee-aaae1e61b340`, 100%, annotation naming the full deployed source and run. The local final-source bundle and deploy receipt agree on SHA-256 `0bc7eade2de16d6db3fd605c3533ca4d21faddf233b65605dee72f156678cdef`.
- [Production acceptance 38836065670](https://github.com/athompson83/data-foundry/actions/runs/38836065670): all 27 checks passed on that exact version, including both dataset payloads through the new route, public revalidated discovery, and 13 metered requests / exactly 13 usage units. Fixture closed, keys revoked, account/data/new-lookup calls rejected 401/401/401. A separate production D1 read confirms fixture `suspended`, zero active keys.
- Real production browser, 1366px and 390px: homepage → API docs → new discovery/lookup headings; public catalog 200, one h1, coverage warning visible in the document, no horizontal overflow, page errors or failed requests. Browser contexts closed. No customer key was entered or stored.
- Secret-free local receipts/logs: reused worktree `.data/api-expansion-*`; they are ignored and not published. Source branch is merged; no unique unmerged code remains. The older chat checkout's pre-existing dirty files are preserved.

Rollback: restore Worker version `733e7d49-75d6-4d5f-bc2d-6019c39ed2d0` (source `94c852c`). To reverse analytics suppression, disable/delete only rule `ec80292c2ea54ac9bf8d3ca4044865db`; preserve any later rules. No database rollback is needed. New routes are verified on the direct API; the public RapidAPI listing was not re-imported, so marketplace publication of these two additions is not claimed.
