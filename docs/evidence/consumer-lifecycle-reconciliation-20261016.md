# Consumer-recall lifecycle reconciliation — 2026-10-16

## Verdict

**COMPLETE for REV-011 lifecycle and sample reconciliation.** The consumer-recall composite and both existing member feeds are LIVE. This corrects stale BUILDING metadata against the accepted deployed product; it adds no source, route, channel, entitlement or acquisition permission. Independent paid use remains unverified.

## Checklist Snapshot

REV-011 is completed in this session; no checklist item is added or reopened. REV-008/REV-013 (independent paid consumption and buyers) and REV-012 (productive collector qualification) remain IN_PROGRESS. The portfolio denominator is not stable, so no completion percentage is asserted. See [PROJECT_CHECKLIST.md](../../PROJECT_CHECKLIST.md).

## Progress Report

Base `075544f2471cf594b427039726b45799744e86d8`, canonical repo `C:/Users/Adam/data-foundry`, reused isolated worktree `C:/Users/Adam/data-foundry-worktrees/revenue-20261015`, branch `codex/consumer-lifecycle-20261016`. Source `f84280c02bf371f000426d38c5d6481405b3a9e1` still serves production as Worker version `07ee9246-42b8-4104-a793-2e18c014fd30`, deployment `3289ea1d-c372-46bc-a19f-e2db4e7b1a91` at 100%. The documentation-main CI run 38844322835 is now confirmed successful. The old dirty chat checkout is preserved.

Changed metadata: the `consumer-product-recalls-north-america` dataset, `cpsc-recalls` and `health-canada-consumer-product-recalls` feed stages; their completed-acceptance notes and evidence links; generated local-collector policy metadata; source-rights operational channel notes; checklist/progress. Health Canada's source name now explicitly limits the live product to the consumer-product slice of its broader index. Historical prototype coverage and join measurements remain unchanged. The policy generator also uses the existing portable CLI-entry helper so its generation/check commands actually execute on Windows.

No Worker code, migration, installed collector policy, publication flag, price, subscription, payout or source-rights grant is changed. The landing page, direct API and ten-endpoint RapidAPI listing already expose this dataset, so no new provider activation or production deployment is needed for this metadata reconciliation.

## Problems Found and Fixed

The dataset and both member feeds still said BUILDING and requested hosted acceptance after it had passed on October 9 and again on October 16. These stale entries could send the scout/collector planner back to completed gates. All three are advanced together to LIVE, with current evidence and a useful maintenance/expansion next action. Generated policy is refreshed from the registry; enabled tasks, acquisition classifications, rights verdicts, source membership and rate limits are checked to remain identical.

The generator's old entry guard split `process.argv[1]` only on `/`, so a Windows filesystem entry silently skipped the entire command and returned success. A real subprocess regression reproduced the empty output. Reusing `tooling/lib/cli-entry.ts` repairs the guard: `--check` now fails with exit 1 for stale output, generation writes the policy, and a subsequent check reports it current. The regression checks actual process output rather than only importing the compiler function.

The source-rights records also described RapidAPI as not enabled. Their operational notes now reflect the already accepted October 9 activation and October 15 distribution release; MCP and bulk remain closed. This records channel state without expanding the underlying rights determination.

The consumer catalog sample is a September 27 parser-output snapshot, accurately labeled `product-recall-structuring@1`. Its 32 displayed business-field leaves match current canonical `@2` storage. The sample stays labeled as historical parser output, not recast as a captured API response. Its linked notice is resolved through the stored declared citation; title similarity or the Health Canada joint marker is not used as a link.

## Required User Actions

None for this work package. Existing outreach remains unsent. No purchase or plan change is needed to reconcile accepted lifecycle metadata.

## Recommended Next Steps

Agent-owned: assess the existing portfolio/scout PR #88 against current main, source rights and operational acceptance before integrating another dataset. Continue REV-012 qualification within the existing allowance and closed extraction-publication gates. REV-008/REV-013 still need independent paid integration evidence; operator fixtures are not buyers.

## Repository and Evidence Record

Fresh evidence at 2026-10-16T03:50Z, account `c2832821a9ab36419cde6ee08112f6d3`, D1 `84acdedd-4d3e-457e-9bdc-3b118590e172`, existing R2 `data-foundry-raw-artifacts`:

- Production D1 migrations 0001–0004 are present. Counts: CPSC 10,053, Health Canada 5,216, total 15,269. Every row uses `product-recall-structuring@2`; zero rows lack a 64-character raw digest or nonempty evidence reference. This checks reference presence, not a fresh read-back of every R2 object.
- Public stats return the same agency counts, 347 resolved declared links, newest CPSC notice 2026-10-15 and HC notice 2026-10-13. Last successful source refreshes: CPSC `2026-10-16T00:20:14.828Z`, HC `2026-10-16T00:20:32.332Z`; within the six-hour schedule at observation. The catalog returns 200 and includes the consumer dataset.
- Sample `cpsc-25203`: source ID 25203, model `DXH70CFAVX`, GTIN `00089301008588`, units US 21,250 / Canada 500, current raw SHA-256 `708dd4a8d900f30dc380225039c8af12cbbeb0f242e885bd0da10f5c336f4b6d`. All 32 displayed business-field leaves match the historical sample, including hazard/remedy classes, firms, facets and its declared linked notice.
- Counterpart `hc-77184`: source ID 77184, raw SHA-256 `d6d0233d1cc1fe8b9a58e93735a18e1ce2185646449b4883720c4a3ba55c2724`. Its description and remedy text are withheld. The D1 citation joins the exact canonical counterpart URL. Both notices remain separate records.
- Hosted authenticated behavior is independently bounded to [acceptance 38843342262](https://github.com/athompson83/data-foundry/actions/runs/38843342262), refreshed as successful on its exact serving source. It passed 27 checks, raw evidence/redactions, filters, lookup parity and exact 13-unit metering, then revoked the fixture key (401/401/401). This reconciliation makes read-only provider/public calls and does not issue another key or repeat metered acceptance.
- Existing [channel-alignment evidence](channel-alignment-20261015.md) records desktop/mobile, actual RapidAPI gateway calls, channel isolation and deployed bundle identity. This session changes none of those interfaces and does not claim a new browser or marketplace run.

Local verification: `corepack pnpm run typecheck` passed. `corepack pnpm exec vitest run tooling/test/source-pipeline.test.ts tooling/test/readme-inventory.test.ts tooling/test/private-canary-provenance-doc.test.ts tooling/test/repository-policy.test.ts tooling/test/local-collector-policy-cli.test.ts tooling/test/cli-entry.test.ts apps/recalls-worker/test/catalog-registry.test.ts --maxWorkers=2` passed 7 files / 1,097 tests. Three additional focused local-collector policy/rights checks passed. `corepack pnpm run collector:policy` and `corepack pnpm run collector:policy:check` run successfully on Windows after the repair. The semantic policy comparison passed; `git diff --check` passed. Final protected PR and exact-main CI evidence is recorded in this work package's pull request. Secret-free local receipts/scripts are in ignored `.data/consumer-lifecycle-*`, `.data/lifecycle-d1-samples.json` and `.data/reconcile-consumer-sample.ts`. Production changed: **no**. Recovery: revert the metadata/CLI commit and regenerate the repository collector policy; the deployed Worker and database need no rollback.
