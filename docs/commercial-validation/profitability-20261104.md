# Profitability work package — 2026-11-04

## Decision

Prioritize adoption of the existing inventory report and recall API over adding more datasets or reducing prices without buyer evidence. A working checkout and Worker invocation count do not establish demand, collected revenue or profit. Private merchant/account measurements are retained outside this public repository.

The first commercial acceptance remains an independent customer paying for a useful result (REV-008/REV-013). REV-019's completed report delivery is not reopened. Existing outreach drafts remain unsent; this package does not authorize messages or advertising spend.

## Changes

- Lead the homepage with the existing free inventory screening workflow, with optional $29 standard / $49 branded reports and explicit limits. Keep API access visible for integration buyers.
- Add `/inventory-recall-check`, a public guide covering inputs, findings, purchase terms, coverage, uncertainty, retention and the API alternative. Include it in the static sitemap only while consumer-product coverage is published. The private report workspace remains `noindex`.
- Return newly issued key holders to Batch screening with a visible link and instructions. Keep credentials out of URLs and browser storage.
- Share lightweight record-count and successful-sync queries between human coverage and full API stats. Human pages no longer calculate unused identifier distinct counts, trade facets, citation joins or latest-attempt histories. Full machine stats keep those fields and their semantics. Dataset-page caches now include the Worker version; homepage caches also distinguish report sales state.
- Correct the repository About homepage to `https://data.aroqon.com`; independently read it back. No infrastructure recreation.

No price, allowance, existing subscription, settlement destination, source permission, publication gate or schema change is included.

## Channel matrix

| Published dataset | Direct API | RapidAPI | One-time inventory reports | MCP / bulk / paid crawling |
| --- | --- | --- | --- | --- |
| FDA Recall Intelligence | Existing monthly plans; free evaluation | Existing separate marketplace channel; current subscriber receipts not verified here | Outside the consumer-product report scope | No newly verified paid offer in this package |
| North American Consumer Product Recalls | Existing monthly plans; free evaluation | Existing separate marketplace channel; extracted identifier publication stays closed | Existing $29 standard / $49 branded snapshots, up to 50 rows | No newly verified paid offer in this package |

Read current stats for actual source freshness and coverage. Prototypes, route-less private canaries, unpublished extractions and exports in development are not additional live revenue channels.

## Verification and release

- Initial focused regression run: three failures reproduced the unnecessary index queries, missing primary inventory offer and absent public guide. The hero-boundary assertion was subsequently corrected to inspect markup after the embedded stylesheet.
- `corepack pnpm exec vitest run --project recalls-worker --reporter=dot` — 262 tests passed across 11 files, including five added checks for query budget/API parity, conversion path, sitemap/withdrawal/privacy, credential-safe onboarding and sales-state cache isolation.
- `corepack pnpm typecheck` and `corepack pnpm --dir apps/recalls-worker typecheck` — passed.
- `corepack pnpm exec wrangler deploy --dry-run --config apps/recalls-worker/wrangler.toml --outdir .artifacts/profitability-worker` — passed; final repeat after onboarding wording also passed, with the output directory in the private evidence folder.
- `corepack pnpm exec vitest run tooling/test/readme-inventory.test.ts --reporter=dot` — 5 passed.
- `git diff --check` — passed.
- Release through candidate CI, exact-main CI, the existing guarded recalls deployment, then fresh production acceptance/revocation and HTTP content checks. The PR and workflow summaries retain the final identifiers; this source document is not proof that those later steps have happened.
- Browser DOM control is disabled in the current Work settings. No new desktop/mobile visual or click-through proof is claimed by the local HTTP/SQL tests.

## Next decisions and measurement

1. Reconcile independent direct subscriptions and collected charges, marketplace receipts, report previews/checkouts/purchases and useful metered requests privately. Exclude operator fixtures and completed $0 checkouts. Expired sessions alone do not establish failed cards or buyer intent.
2. Measure qualified use of the inventory guide, free previews, report checkout and purchases. Worker invocations mix crawlers, scheduled work, public pages, tests and API use; do not use them as the conversion denominator.
3. Keep the existing prices until real buyers identify a pricing objection or measured contribution margin requires a change. Use collected revenue minus processor/marketplace fees, refunds, incremental serving/storage and support to assess contribution. Reconcile shared platform bills before claiming net profit or dollar savings.
4. Advance the existing reviewed acquisition/content work in #66/#71/#78. This guide is the bounded report-specific conversion slice, not an integration or approval of those open branches. Explicit sending authorization is needed for outreach. No paid promotion is initiated.
5. Revisit the full public stats aggregate (issue #115 RC-05) only with measured request/row-read cost and a design preserving exact counts, honest timestamps, failed-sync behavior and withdrawal. Removing its unnecessary use on marketing pages is a bounded improvement, not completion of the whole aggregate optimization.
