# Revenue recovery — 2026-10-15

**Shipped closeout:** the technical selling-path repair is deployed and verified; see [the exact release, browser and API evidence](../evidence/revenue-release-20261015.md). The initial observations below remain a dated snapshot, including operator checkout probes. No independent paid customer or sent outreach is claimed.

## Decision

Prioritize selling the two live datasets and removing purchase friction. Keep the accepted direct prices ($49/$149/$299 monthly), existing infrastructure, source rights and publication gates. Additional datasets and paid crawling do not gate this work. A technically working API is not evidence of paying demand.

## Fresh evidence

Snapshot collected 2026-10-15, independently of old handoffs:

| Source and scope | Observation | What it establishes |
| --- | --- | --- |
| Aroqon Data live Stripe account; all subscriptions, limit 100, `has_more=false` | One active Evaluate subscription at $0; zero paid subscriptions | Direct subscription MRR is $0. No paid direct subscriber has been acquired. |
| Same account; all Checkout Sessions, limit 100, `has_more=false` | 13 sessions: 1 completed Evaluate, 4 expired Evaluate, 6 expired Developer, 1 expired Growth, 1 expired Scale | No paid Checkout completed. These include engineering probes; they are **not** eight independently identified buyer abandonments. |
| Production D1 `customer`, `api_key`, `usage_month` | Only the Evaluate customer has a real Stripe subscription. October: Evaluate 100 requests; internal suspended fixture 33. Other Developer rows have no Stripe subscription or active keys. | Internal tests must not be counted as paid users or buyer traffic. The owner's collector uses the exhausted Evaluate account. |
| Public FDA/product stats and D1 `sync_run` | 87,739 FDA records and 15,263 consumer-product notices; successful refreshes on October 15. Two earlier CPSC errors were followed by successful runs. | Saleable data is live and current; persistent refresh failure is not the observed revenue blocker. Counts are a dated snapshot. |
| [RapidAPI public pricing](https://rapidapi.com/athompson83/api/data-foundry/pricing), rendered in Chrome | BASIC $0/500, PRO $29/15,000, ULTRA $99/100,000, MEGA $299/1,000,000. Paid tiers show overages; platform bandwidth fees also apply. | The October 9 free-only note is stale. Paid marketplace offers exist. Subscriber counts, marketplace receipts and payouts were **not** accessible; marketplace revenue is unknown. |
| Live site | Claims marketplace listings are unavailable; primary hero buttons only explore/docs; existing billing management requires an API call; `/pricing` returns 404. | Confirmed conversion and access defects. These do not establish the conversion lift from repairing them. |
| Stripe default portal configuration | Active; subscription price changes, cancellation, payment updates and invoice history enabled. Customer login page disabled. | Existing self-service portal can support the browser entry point; no new billing system is needed. |
| Cloudflare deployments and GitHub | Serving source `a8e875eec327ccaad1261f7804e3a12430f90ac2`, version `eafd2479-65b6-4f50-b8f6-6ab4d9ae2092`. Canonical main `e551c89628b7faf55cd3bb4d049c8892a4fd6db3`. Landing PR #94 conflicts with main. | Reconcile and release the existing work instead of editing the older, dirty checkout open in the chat. |

No current visitor, independent-buyer, conversion-rate or marketplace-subscriber denominator was available. Do not infer customer demand from Worker requests, record counts, crawlers or internal fixtures. Historical Pay Per Crawl eligibility is not current revenue evidence and was not reverified for this release.

## Repairs in this release

- Integrate the existing catalog-driven landing work from PR #94, with catalog, runtime routes and structured metadata kept in parity.
- Put API access, free/no-card evaluation, paid starting price and concrete registry-defined integration use cases on the landing page.
- Link the live marketplace, while distinguishing its keys, plans and overage terms from direct hard-stop plans.
- Add `/account`: password-masked key input, usage, exhausted-allowance upgrade guidance and Stripe portal access. Reuse existing authentication and account logic through same-origin endpoints; never put keys in URLs, browser storage or cookies. Restrict portal navigation to HTTPS `billing.stripe.com`; clear the key on departure. CSP permits only same-origin connections on this page.
- Keep account responses and portal links private/no-store, reject unsupported methods and marketplace-shaped requests, and preserve the unmetered account path.
- Redirect `/pricing` to the existing canonical pricing section; expose account management in navigation and post-checkout instructions.

Prices, marketplace configuration, payment destinations, customer subscriptions, rights/publication gates and production schema are unchanged by this package. Opening a portal session does not upgrade or charge the owner.

## Verification and release path

- `corepack pnpm install --frozen-lockfile --offline` — installed the existing lockfile in an isolated worktree.
- `corepack pnpm typecheck` and `corepack pnpm --filter @data-foundry/recalls-worker typecheck` — passed after repairing a strict tuple type in a new test.
- `corepack pnpm exec vitest run --project recalls-worker --project recall-structuring --project product-recall-structuring` — 250 tests passed.
- `corepack pnpm exec vitest run tooling/test/source-pipeline.test.ts tooling/test/readme-inventory.test.ts` — 1,046 passed.
- New browser-script tests cover usage, exhausted quota, authentication failure, private header transport, key clearing and rejection of unsafe billing destinations. Route tests cover CSP, private caching, methods, marketplace isolation and pricing redirect. The two initial regressions failed on the missing CTA and 404 account route before implementation.
- Local Wrangler applied migrations 0001–0004 **locally only**. Chrome typed a synthetic local key and clicked Check usage: 100/100, upgrade guidance, zero browser-storage entries. Homepage and account were measured at a 390px mobile viewport without horizontal overflow. Browser testing found and repaired the canonical API-host redirect/CSP failure.
- Existing live owner key was read only inside a local process and never printed. Account API returned Evaluate, 100 used, 0 remaining. Portal API returned an HTTPS `billing.stripe.com` destination. No subscription or payment was submitted.
- Protected PR checks, exact-main CI, the guarded `Deploy recalls Worker` workflow and fresh production verification are required before calling this change live. Record their final IDs in the release evidence; do not infer deployment from this candidate document.

## Acquisition work ready for execution

The first buyer hypothesis is software that already has manufacturer model numbers, retail barcodes or lot numbers and needs to attach official recall evidence. Internal asset labels are **not** UPCs and must not be sent as if they were. Data Foundry is a source-backed lookup service, not a safety certification or guarantee that an unmatched item is safe.

Three research-qualified companies, not confirmed leads:

| Company | Primary-source fit | Proposed first discussion |
| --- | --- | --- |
| inFlow Inventory | [Integrations](https://www.inflowinventory.com/integrations) and [official product/support page](https://www.inflowinventory.com/contact-support) describe an API/integrations and barcode/lot workflows | Add FDA lot/GTIN recall evidence to inventory review; establish whether their customers retain manufacturer identifiers. |
| Booqable | [Official API v4](https://developers.booqable.com/v4) exposes products, stock items and barcodes | Check rental equipment using manufacturer model numbers/retail identifiers, without treating rental asset tags as manufacturer codes. |
| Cheqroom | [Official integrations](https://www.cheqroom.com/capabilities/integrations/) and [equipment inventory](https://www.cheqroom.com/by-use-case/inventory-management/) describe APIs and asset operations | Attach matched official recall notices to equipment review; validate identifier availability and review ownership first. |

### Unsent message for inFlow

Subject: FDA recall evidence alongside barcode and lot inventory

Hi inFlow team,

Data Foundry turns FDA, CPSC and Health Canada recall records into a JSON API with exact identifiers and a source record behind each result. Your barcode, lot and integration workflows look relevant to checking inventory against official notices.

Would a source-backed recall lookup be useful to your product team or an integration partner? We would start by checking whether the manufacturer identifiers your customers retain overlap our coverage; a missing match is not a safety clearance. The direct API has a no-card, 100-request evaluation and paid plans from $49/month with a hard limit: https://data.aroqon.com/#pricing. Documentation: https://data.aroqon.com/docs.

Could you point us to the person who owns inventory-data integrations? If this is outside your scope, no follow-up is needed.

Data Foundry / Aroqon Data
data@mail.proviciency.com

### Unsent message for Booqable

Subject: Official recall lookup for rental-equipment integrations

Hi Booqable team,

Your API exposes products, stock items and barcodes. Data Foundry offers structured CPSC and Health Canada notices with manufacturer model/UPC lookup, hazards, remedies and source evidence.

We are exploring whether a rental-equipment integration could flag matched official notices for human review. It would use manufacturer identifiers, not your internal asset labels, and an unmatched item would not be represented as safe. Would your integrations team be open to evaluating identifier coverage? There is a no-card, 100-request direct evaluation and paid access from $49/month: https://data.aroqon.com/#pricing. Documentation: https://data.aroqon.com/docs#product-recalls.

Please route this to the relevant integrations contact if useful. If it is outside your scope, no follow-up is needed.

Data Foundry / Aroqon Data
data@mail.proviciency.com

### Unsent message for Cheqroom

Subject: Source-backed recall evidence for equipment review

Hi Cheqroom team,

Your asset-operation integrations look relevant to equipment review workflows. Data Foundry structures CPSC and Health Canada notices into one JSON API, with manufacturer model/UPC lookup and the original source behind each match.

Would attaching matched official recall notices to equipment records be useful to your integrations team? The first step would be validating the manufacturer identifiers available in a real workflow; internal asset tags are not equivalent, and no match does not establish safety. A no-card, 100-request direct evaluation is available, followed by plans from $49/month: https://data.aroqon.com/#pricing. Documentation: https://data.aroqon.com/docs#product-recalls.

If useful, please point us to the relevant integrations contact. If this is outside your scope, no follow-up is needed.

Data Foundry / Aroqon Data
data@mail.proviciency.com

No message has been sent. Before sending, select each company's published business/integration contact channel and obtain the owner's explicit sending instruction. Do not infer consent for a mailing list or automated follow-ups.

## Next acceptance criteria

REV-015: ship the repaired buyer/upgrade journey with exact deployed-source and authenticated portal evidence. REV-013: three independent buyer conversations, one useful integration test on the buyer's own identifiers, then one real paid subscription **and metered request**. These are targets, not observed results. Interview non-buyers before cutting prices or adding more datasets. Track external evaluations, useful matches, paid completions and first metered requests separately from operator tests.
