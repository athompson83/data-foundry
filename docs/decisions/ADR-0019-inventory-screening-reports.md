# ADR-0019 — One-time inventory screening reports

Date: 2026-10-16. Status: implemented; production sales require release acceptance.

The owner requested implementation of the supplied additional-revenue proposal. Start with a finished, bounded result over the existing consumer-product dataset: a free safety preview, a $29 standard batch report or a $49 report carrying the customer's business name. These are experimental offer prices, not demand or revenue evidence. Both include CSV, a printable HTML document (print to PDF), a dated evidence snapshot and a remedy review worksheet. They are one-time purchases, separate from existing API subscriptions and marketplace allowances.

## Scope and truth

Use the canonical recalls Worker, D1 customer/key system, product query layer and Stripe account. No new infrastructure, source acquisition, model publishing, account system or financial ledger. Migration 0005 adds private report snapshots and references to Stripe Checkout; Stripe remains payment authority. Up to 50 CSV rows / 64 KiB, five attempted previews per account per rolling day, one existing API allowance unit per preview. The report result is bounded to 900 KB. Inventory fields are item, GTIN and model; names alone do not match.

Four outcomes: exact GTIN notice; model/invalid-identifier possible match requiring review; no match in stated coverage; insufficient information or unavailable coverage. A negative assessment requires successful CPSC and HC syncs within 48 hours. Results always expose source attempts, successful clocks, partial CPSC history, incomplete identifier coverage and excluded product domains. An exact notice match is not proof of a particular unit's recall status. No LLM entity merges, safety certification, legal compliance or entitlement promise. Published extraction gates remain unchanged and the report explicitly excludes model-proposed identifiers.

All returned safety concerns and official source links are visible before payment. Payment buys the formatted result and longer retention, not hidden safety information. The existing CPSC and HC rights records admit redistribution of these normalized fields; retain source attribution, Canada licence wording and non-endorsement on both standard and branded output. Do not redistribute contact text, images or additional source fields. Branded means a text business name, not a safety seal or removal of source attribution.

## Billing, tenancy and retention

The browser retains the key only in memory, clears it on navigation and sends it only to same-origin report endpoints. Every report read/mutation is customer-scoped, no-store and non-indexable. Current dataset withdrawal hides stored contents too; listing metadata and deleting remain available. Canceled subscribers retain access to separately purchased reports unless their key is revoked or account suspended.

Server-owned tiers, amount, currency, customer, report ID and checkout attempt bind payment to one snapshot. Persisted attempt plus Stripe idempotency key prevents duplicate Checkout creation on retries. Expired sessions rotate with compare-and-swap. An ambiguous creation older than Stripe's idempotency retention fails closed for support recovery rather than risking another charge. Signed Checkout webhooks and authenticated reads share verification. Every download rechecks payment/intent/charge state, including refunds, disputes and test/live mode. Redirects and client-supplied payment claims never grant access. No inventory is sent to Stripe.

Preview contents expire in seven days; a first verified payment extends retention to one year without replay renewal. Scheduled cleanup reconciles potentially missed payment webhooks before deleting expired unpaid contents, retaining them for retry if Stripe is unavailable. Customers may delete report contents; outstanding Checkout links are expired first. Financial references remain. Report terms and privacy copy describe these behaviors.

## Follow-on products

Saved inventories can be manually rechecked as new dated previews. Automated inventory monitoring, email alerts, embeddable widgets, claims filing, advertising, affiliates and evaluation packs remain deferred. Monitoring needs qualified source coverage/freshness, bounded scheduling and an alert delivery contract; widgets need domain/rights controls; advertising/affiliates need actual human traffic and approved programs. The worksheet organizes official remedy review but files no claim and promises no reimbursement.

## Release and rollback

Use the existing guarded main deployment. Take a D1 Time Travel bookmark and apply additive 0005 before deployment; the old Worker ignores its table. Do not change existing migration files. Retain `SCREENING_SALES_OPEN=0` until payment and browser acceptance qualify the release. The separate switch closes new purchases without invalidating purchased downloads. `PRODUCT_RECALLS_KILL_SWITCH=1` withdraws dataset content. Roll back the Worker bundle without dropping the report table or erasing purchases.

Acceptance must distinguish local SQLite, browser/local runtime, real Stripe test-mode payment, protected CI, production runtime and independent paid buyers. A test payment is never revenue proof.
