# Data Foundry: working platform and recurring revenue

Status: Owner-approved implementation plan, 2026-09-08. This document records the
accepted product and technical decisions; the executive checklist records proof.

## Goal and constraints

Launch HVAC Equipment Specifications & Evidence API for software and catalog
developers through RapidAPI. Completion requires an external paying customer,
lawfully sourced useful data, automated refresh/recovery, operating spend within
$300/month, and a demonstrated second vertical on the same platform.

- HVAC equipment lookup first; ENERGY STAR remains deferred.
- Sources receive fresh named human rights review before real acquisition/sale.
- Reuse canonical Cloudflare and Alpha Lab private `data_foundry` infrastructure.
- Keep acquisition, extraction, normalization, resolution, canonical storage and
  query boundaries. All customer surfaces share canonical truth and rights gates.
- Preserve raw evidence, immutable revisions, exact identifiers, reversible human
  decisions, source-specific image rights, and quality/demand-gated indexing.
- No source activation, publisher contact, legal acceptance, credential exposure,
  payment setup or public cutover is implied by a successful repository build.

## Delivery work packages

### A. Baseline and commercially useful source

- Preserve and integrate local Windows test fixes through review. Reconcile
  README PR #29 without losing operator instructions. Record current Git/CI facts.
- Refresh the source landscape against current publisher documents: acquisition,
  normalization, marketplace resale, refresh frequency, coverage, identifiers and
  cost. ENERGY STAR stays deferred; unknown rights remain refusal.
- Define a bounded equipment category and dictionary: manufacturer, model,
  category, supported specifications/efficiency, evidence and freshness.
- Prepare sample fixtures and three integration-partner interview/outreach
  packages. Sending is separately authorized. Human review selects the source.
- Exit: useful scoped source with documented rights, fixtures and affordable
  approved refresh method. Continue independent engineering if this is pending.

### B. Automatic acquisition to canonical publication

- Add a sixth production ingestion Worker with distinct `df_ingestion`,
  cache-disabled Hyperdrive and ingestion Queue/DLQ.
- Atomically persist acquisition completion and outbox work. Dispatch immediately
  and retry pending work independently of source cadence. Queue only opaque IDs.
- Extract a filesystem-free, explicitly injected JSON/CSV ingest core and compile
  its configuration. Keep offline fixture composition separate. Qualify PDF/HTML
  and other adapters independently without weakening artifact guards.
- Use work identity including acquisition run, artifact/runtime version and work
  kind, database-clock leases, fencing, checkpoints and idempotent completion.
- Bound work parts. No complete-snapshot omission retirement until all declared
  parts finish. Validate R2 receipts/hashes and recheck processing/publication rights.
- Mark PUBLISHED only after canonical promotion. Recover lost delivery, stale
  ownership and exhausted retries through operator tooling.
- Acquisition gains only required outbox privileges, never canonical publishing.
- Exit: scheduled files become customer-visible canonical changes automatically.

### C. Freshness, operations and privacy

- Bounded source interval; 12-hour conditional checks where permitted, target
  publication within two hours of detection; no contractual SLA before proof.
- Separate source update, verification, data change and publication timestamps.
  A valid 304 verifies existing data; failed processing does not freshen it.
- Keep last valid data during transient failure with accurate freshness. Withhold
  rights-expired/revoked material and preserve necessary historical evidence.
- Operator CLI: status, failures, replay/backfill, pause/resume, conflict review,
  auditable correction. Monitor failures/backlog/lag/DLQ/rights/storage/spend.
- Configure owner-verified operations email and prove alert/recovery delivery.
- Sanitize API error telemetry; never retain concrete lookup targets or arbitrary
  exceptions. Implement retention/closure/erasure only from the approved policy.
- Exit: two real refresh cycles and induced failure/recovery succeed.

### D. Multi-industry foundation

- Derive read/write identifier normalization from the same declared rules.
- Prove a synthetic second vertical with different identifiers, entities,
  relationships and filters. Cover Unicode/whitespace/prefix rules, collisions,
  scoped identifiers and withdrawn claims without shared query code changes.
- Preserve independent surface bundle admission. Expand vertical templates and
  adapter documentation with processing, freshness, rights, quality and cost gates.

### E. Customer experience and first payment

- Buyer-focused offering, truthful coverage/freshness/evidence, filters/pagination,
  accessible mobile/keyboard flows, pricing and configurable RapidAPI CTA.
- Executable TypeScript/Python model lookup, enrichment and evidence examples.
- Customer license/privacy/support/correction material with legal review explicit.
- Prove subscribe -> useful request -> integrate -> renewal; marketplace auth,
  limits/cancellation/reconciliation and exclusion from direct invoicing.
- Verify actual MCP client; keep MCP/NONE analytics until paid entitlement work.
- Do not advertise unsupported comparison/replacement/compatibility workflows.

### F. Canonical deployment and recovery

- Clear UA-006 containment, reconcile provider/database metadata, establish and
  restore an isolated backup before dependent mutation.
- Freeze reviewed release SHA, apply truly pending migrations and new ingest DDL,
  verify durable/live paths, privileges and shared-database reachability.
- Securely activate six runtime credentials; verify all six paths before six
  cache-disabled Hyperdrives. Retain ordinary usage Queue/DLQ and add ingestion.
- Extend role packets, probes, topology and artifact checks together: six ordinary
  Workers plus six reduced capability targets and one harness = 13 artifacts.
- Synthetic ingestion is a separate versioned canary phase with private ingestion
  Queue/DLQ and synthetic bucket; preserve receipt-only bucket and credential-free
  harness. Prove live persistence, idempotency, retries/DLQ, R2, isolation and cleanup.
- Public exposure requires later action-time confirmation after private proof.
  Keep PUBLIC_CACHE_MODE=no-store. Prove rollback and restore; internal RPO24h /
  RTO4h are objectives until measured.

### G. Successive releases after first marketplace revenue

- Bulk: bounded CSV/JSONL/Parquet, immutable manifests/checksums, private R2,
  versions, scheduled rebuilds and entitlement-checked delivery.
- Direct: Stripe checkout/portal/webhooks, entitlements, key lifecycle, reporting,
  quotas. Paid MCP adds commercial entitlements and supported-client auth.
- New real verticals repeat source, buyer, rights, quality, cost and operational
  gates. These releases do not delay the first marketplace sale.

## Domains and commercial defaults

| Purpose | Planned address |
|---|---|
| Public platform / HVAC | data.aroqon.com / data.aroqon.com/hvac |
| Direct / marketplace API | hvac-api.aroqon.com/v1 / hvac-marketplace.aroqon.com/v1 |
| MCP | hvac-mcp.aroqon.com/mcp |

Redirect existing /data/hvac routes to /hvac. Any optional hvac.aroqon.com alias
redirects to the canonical site. Hostnames remain proposals until provider proof.

Introductory price hypotheses: Free100 requests; Developer$49/5,000;
Growth$149/25,000; Scale$299/75,000 monthly. Hard limits, no automatic overages.
Benchmark costs and validate buyer demand before commercial activation.
RapidAPI's current explicit policy is 25% plus PayPal payout fees:
https://docs.rapidapi.com/docs/payouts-and-finance

Monthly envelopes: Cloudflare$50, database/recovery$75,
acquisition/source/production-AI$75, monitoring/support$25, reserve$75.
These are caps, not observed bills; one-time legal/source contracts are separate.

After lawful beta: day30 three design partners/first payment; day60 five paid
accounts/$300 gross MRR/three weekly integrations; day90 ten paid accounts/$600
gross MRR/70% first-renewal retention/positive contribution. Targets are not
forecasts. Hold expansion when activation, retention or margins fail.

## Execution and acceptance

Use existing GitHub/Cloudflare/Supabase skills and connections; RapidAPI/PayPal
owner flow, Stripe later. No additional plugin is required. Verify Ubuntu/WSL
Node/pnpm/Postgres tooling before secret-safe operator work.

Coordinator plus up to three bounded lanes: data pipeline, customer experience,
and platform/operations. Rotate independent review. Serialize shared migrations,
provider changes, Git commits, final candidate and cutover. Production scheduling
runs on Cloudflare, never dependent on an open Codex session.

Required tests: changed/304/duplicate/out-of-order acquisition; crash/lease/retry
recovery; corrupted/oversized artifacts; schema drift; complete vs incremental
snapshots; rights revoked at each stage; authorized web/API/MCP/export parity;
different vertical identifiers; payment/limit/cancellation/no-double-billing;
mobile/keyboard/canonical/SEO; alerts/revocation/backup/rollback/cost evidence.

Each release records exact SHA, local checks, protected CI/review, runtime IDs,
observations and recovery point. Update checklist/progress once near closeout.
UA-001..006 retain exact owner-only scope; unrelated engineering continues.
