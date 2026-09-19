# Data Foundry: working platform and recurring revenue

Status: Owner-approved implementation plan, 2026-09-08. This document records the
accepted product and technical decisions; the executive checklist records proof.

## Product Owner amendment — 2026-09-16

The original HVAC-first/RapidAPI-first plan below remains the historical implementation
basis for work already completed, but the Product Owner has broadened the standing
commercial direction. This amendment supersedes the original plan where they conflict;
see the approved design at
[`docs/superpowers/specs/2026-09-16-multi-dataset-machine-data-direction-design.md`](../specs/2026-09-16-multi-dataset-machine-data-direction-design.md).

- Data Foundry is a **multi-dataset, multi-industry machine-data platform**. HVAC is
  the reference vertical and first factory proof, not the platform's product identity.
- The monetizable expansion unit is a useful, rights-approved **dataset/data product**.
  Do not wait for comprehensive HVAC coverage, a complete industry, or an arbitrary
  record count before a truthful narrow dataset can launch.
- The first paid release may use **any verified paid machine-access path** supported by
  the release. Direct `API_PAID`/`DIRECT`, API/data exchanges, MCP/agent access, bulk,
  and supported paid-crawler arrangements are channels over the same canonical truth;
  RapidAPI and provider beta programs do not gate every other channel.
- After the first production source proves the factory, source discovery expands across
  unrelated domains. Prefer evidence of machine/developer demand, explicit commercial
  redistribution rights, supported acquisition, authoritative provenance, stable
  identifiers, recurring updates, normalization/linkage value and poor existing machine
  access. Every source still passes its own rights, acquisition, quality, cost and
  operational gates.
- Compatible later datasets should increasingly be configuration/mapping/validation
  work rather than new application architecture. Generalize only from repeated real
  onboarding requirements.
- Commercial progress is measured by useful machine queries, truthful use-case coverage,
  provenance, freshness, external consumption, paid conversion, retention and
  contribution economics—not raw record count alone.
- Capability-based hostnames are canonical: `data.aroqon.com` for public/catalog/search
  and permitted crawler discovery, `api.data.aroqon.com` for API delivery, and
  `mcp.data.aroqon.com/mcp` for MCP/agent access. Verticals/datasets belong in paths,
  schemas, rights scopes, entitlements and configuration rather than long-term
  per-industry API/MCP infrastructure.
- Prefer `data.aroqon.com/docs` for documentation. Add a dedicated docs or bulk hostname
  only when a demonstrated security, caching, entitlement or delivery requirement
  justifies it.
- These names are subdomains of the existing `aroqon.com` zone; no new domain purchase
  is required. Inspect Cloudflare DNS, Worker routes and Custom Domains before creating
  records. This amendment does **not** authorize public DNS cutover.
- One canonical truth does not collapse permissions: public web/indexing, free API,
  paid API, marketplace, MCP/agent, bulk/export and crawler delivery/payment remain
  independently rights- and entitlement-gated. Crawler/payment settings never expand
  upstream source rights.

This amendment does not delay UA-002, weaken the private-canary/public-cutover gates,
or activate a source, legal agreement, credential, payment destination or public route.

## Goal and constraints

Historical 2026-09-08 launch target: launch HVAC Equipment Specifications & Evidence API
for software and catalog developers through RapidAPI. Under the 2026-09-16 amendment,
HVAC/RapidAPI remain valid reference work but are no longer the platform's exclusive
identity or only path to first revenue. Completion still requires an external paying
customer, lawfully sourced useful data, automated refresh/recovery, operating spend
within the approved envelope, and proof that the reusable platform can support another
dataset/vertical without a fork.

- HVAC equipment lookup remains the reference proof; source selection follows current
  `UA-001` evidence rather than this historical plan's source assumptions.
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
  cost. Current source selection is governed by `UA-001`; unknown rights remain refusal.
- Define a bounded equipment category and dictionary: manufacturer, model,
  category, supported specifications/efficiency, evidence and freshness.
- Prepare sample fixtures and three integration-partner interview/outreach
  packages. Sending is separately authorized. Human review selects the source.
  *(2026-09-19: interview/outreach packages are optional under the self-service
  direction and are not a Phase A exit condition; rights and a working
  purchase-to-access path are.)*
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
- After the first real production proof, qualify datasets across unrelated domains and
  measure onboarding effort. Repeated source-specific code is a signal to improve the
  reusable boundary; do not create separate infrastructure merely because a dataset
  belongs to a different industry.

### E. Customer experience and first payment

- Buyer-focused offering, truthful coverage/freshness/evidence, filters/pagination,
  accessible mobile/keyboard flows, pricing and configurable channel CTA.
- Executable TypeScript/Python model lookup, enrichment and evidence examples.
- Customer license/privacy/support/correction material with legal review explicit.
- Prove paid entitlement -> useful request -> integration -> renewal through at least
  one verified machine-access channel; preserve channel-specific auth, limits,
  cancellation/reconciliation and no-double-billing behavior.
- Verify actual MCP client; paid MCP remains separately entitlement-gated.
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

### G. Successive machine-data releases

- Bulk: bounded CSV/JSONL/Parquet, immutable manifests/checksums, private R2,
  versions, scheduled rebuilds and entitlement-checked delivery when justified.
- Direct: paid entitlements, key lifecycle, reporting and quotas through the approved
  billing path. Paid MCP adds commercial entitlements and supported-client auth.
- New real datasets/verticals repeat source, buyer, rights, quality, cost and
  operational gates. They may proceed in parallel after the factory proof and do not
  wait for comprehensive coverage of an earlier industry.
- API exchanges and supported paid-crawler programs are additional channels; provider
  enrollment does not block a different verified paid machine-access path.

## Domains and commercial defaults

Current canonical capability architecture:

| Purpose | Canonical address |
|---|---|
| Public catalog / human / search / permitted crawler discovery | `data.aroqon.com/{vertical-or-dataset}/...` |
| Direct and exchange-backed API | `api.data.aroqon.com/v1/{vertical-or-dataset}/...` |
| MCP / agent access | `mcp.data.aroqon.com/mcp` |
| Documentation | Prefer `data.aroqon.com/docs` |

The September 8 proposal used `hvac-api.aroqon.com`,
`hvac-marketplace.aroqon.com`, and `hvac-mcp.aroqon.com`. Those values are
**superseded as canonical long-term architecture before public deployment**. Do not
create compatibility infrastructure for a proposed hostname that was never exposed to
external consumers. A marketplace-specific hostname may exist only when a concrete
provider/security requirement justifies it; it still converges on the canonical query
layer. A dedicated bulk/download hostname is deferred until implementation evidence
shows a separate security, caching, entitlement or delivery boundary is useful.

Redirect existing `/data/hvac` routes to `/hvac` where that compatibility remains
applicable. Hostnames remain proposals until provider proof and the existing public
cutover authorization.

Introductory price hypotheses: Free100 requests; Developer$49/5,000;
Growth$149/25,000; Scale$299/75,000 monthly. Hard limits, no automatic overages.
Benchmark costs and validate buyer demand before commercial activation. Channel fees
must be verified from the provider at activation time rather than treated as timeless.

Monthly envelopes: Cloudflare$50, database/recovery$75,
acquisition/source/production-AI$75, monitoring/support$25, reserve$75.
These are caps, not observed bills; one-time legal/source contracts are separate.

Historical beta targets remain experiments, not forecasts: day30 three design
partners/first payment; day60 five paid accounts/$300 gross MRR/three weekly
integrations; day90 ten paid accounts/$600 gross MRR/70% first-renewal retention/
positive contribution. Hold expansion when activation, retention or margins fail.
*(2026-09-19: "three design partners" is no longer a day-30 target; the
self-service measure is qualified visits → evaluation → checkout → paid
activation → useful requests → renewal, with customer payment collected,
settlement pending and owner payout received kept as distinct states.)*

## Execution and acceptance

Use existing GitHub/Cloudflare/Supabase skills and connections. No additional plugin is
required merely to implement the repository architecture. Verify Ubuntu/WSL
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
Existing UA IDs retain exact owner-only scope; unrelated engineering continues.
