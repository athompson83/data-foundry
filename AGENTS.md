# AGENTS.md — Data Foundry

## Session control

This repository adopts [`APP_PROJECT_CONTROL_STANDARD.md`](APP_PROJECT_CONTROL_STANDARD.md) as the standing delivery authority until the Product Owner explicitly declares Data Foundry shipped and live or changes that authority.

At the start of every material coding session, read this file, `APP_PROJECT_CONTROL_STANDARD.md`, `PROJECT_CHECKLIST.md`, and `PROGRESS.md`; then reconcile them against Git, relevant pull requests and issues, Cloudflare/runtime state, and the database target. Primary repository and runtime evidence overrides stale handoff text.

During authorized work, act and continue through safe recovery paths: fix relevant actionable defects as found, add regression coverage when meaningful, prefer deterministic local repair loops before hosted CI, verify deployed behavior rather than treating green code checks as runtime proof, remove code only after proving it stale, close resolved findings, and clean merged branches only after confirming they contain no unique work.

Use the existing canonical Cloudflare and Postgres/Supabase infrastructure with native branch, preview, or local isolation. Do not create duplicate Vercel, Cloudflare, or Supabase projects when existing project isolation can safely satisfy the task. Data Foundry's deployment target remains Cloudflare under ADR-0006; the general Vercel authority in the control standard does not override that repository-specific architecture decision.

Before ending a material session, update `PROJECT_CHECKLIST.md` and `PROGRESS.md` once near closeout, update affected roadmap or release documents, resolve completed issues/review findings, record verification evidence, and provide the owner-facing report required by the control standard. Do not turn routine engineering work into owner action.

## Mission

Build a repeatable AI-native data foundry that converts messy, lawfully acquired source data into clean, current, canonical, evidence-backed machine-data products available through human pages, API, MCP, governed crawler access and bulk exports.

## Product and commercial direction

This is standing Product Owner direction. The detailed approved design is [`docs/superpowers/specs/2026-09-16-multi-dataset-machine-data-direction-design.md`](docs/superpowers/specs/2026-09-16-multi-dataset-machine-data-direction-design.md), and the hostname/infrastructure boundary is recorded in [`ADR-0012`](docs/decisions/ADR-0012-machine-data-portfolio-and-capability-hostnames.md).

- **Data Foundry is a multi-dataset, multi-industry machine-data platform.** HVAC is the reference vertical and first factory proof, not the product identity and not a requirement to finish an entire industry before revenue.
- **The primary expansion unit is a useful dataset/data product.** Launch a narrow dataset when its stated machine use case, rights, acquisition, quality, freshness and operational gates are satisfied; do not wait for comprehensive vertical coverage or an arbitrary record count.
- **Machine consumption is the commercial center.** Direct paid API access, data/API exchanges, MCP/agent access, bulk delivery and supported paid-crawler arrangements are channels over the same canonical truth. No marketplace, provider beta or single industry gates every other viable paid channel.
- **Build a portfolio after the first production proof.** Source discovery should span unrelated domains and prioritize evidence of machine/developer demand, clear commercial redistribution rights, supported acquisition, authoritative provenance, stable identifiers, recurring updates, normalization/linkage value and poor existing machine access.
- **Make later datasets cheaper to onboard.** Compatible dataset #2, #3, #10 and beyond should increasingly be configuration, mapping and validation work rather than new application architecture. Generalize from repeated real requirements, not speculative abstractions.
- **Measure commercial usefulness, not database size.** Track useful machine queries, truthful use-case coverage, provenance, freshness, external consumption, paid conversion, retention and contribution economics. Raw record count alone is not a launch criterion.
- **Use capability-based canonical hostnames.** Public/crawler discovery is `data.aroqon.com`; API delivery is `api.data.aroqon.com`; MCP/agent access is `mcp.data.aroqon.com`. Put verticals/datasets in paths, schemas, rights scopes, entitlements and configuration rather than multiplying canonical public hostnames. Preserve ADR-0011's currently implemented per-vertical edge isolation until a separately reviewed change proves a safer/better backing topology; canonical routing does not require an immediate Worker consolidation. Prefer `data.aroqon.com/docs` for documentation; create a separate docs or bulk hostname only for a demonstrated operational need.
- **Do not create DNS merely to reserve names.** These are subdomains of the existing `aroqon.com` zone. Inspect Cloudflare DNS, Worker routes and Custom Domains before provider mutation, and preserve the existing private-canary/public-cutover gates.
- **One truth does not mean one permission.** Public web/indexing, free API, paid API, marketplace, MCP/agent, bulk/export and crawler delivery/payment remain independently rights- and entitlement-gated. Crawler/payment settings never expand upstream source rights.

Do not silently regress this direction to an HVAC-only product, a RapidAPI-only business, or a requirement for a new canonical public hostname per vertical. Historical documents may retain superseded assumptions as history; active guidance must identify the current direction explicitly.

## North-star workflow

```text
Source approved
→ artifact acquired
→ record extracted
→ values normalized
→ entity resolved
→ facts/relationships validated
→ provenance attached
→ published to canonical query layer
→ web/API/MCP/exports generated
```

## Non-negotiable rules

1. **No source without rights metadata.** Unreviewed/RED sources must not publish.
2. **No published fact without evidence.** Critical facts require traceable source lineage.
3. **No silent LLM entity merges.** AI may recommend bounded decisions; merges must be auditable and reversible.
4. **No vertical-specific forks of the app.** Add fields, filters and page behavior through vertical schemas/configuration.
5. **One source of truth.** Web/API/MCP must read from the same canonical query layer.
6. **Keep acquisition providers swappable.** Cloudflare Browser Run and Crawl4AI are adapters, not domain logic.
7. **Exact identifiers beat semantic search.** Never replace deterministic matching with vector similarity.
8. **Do not create thin SEO pages.** Indexability is quality/demand gated.
9. **Respect image rights.** Do not cache/republish images unless rights policy permits it.
10. **Preserve raw evidence.** Do not discard artifacts required to explain or reprocess canonical facts.

## Architecture boundaries

- Acquisition gets artifacts.
- Extraction creates source-native records.
- Normalization creates typed canonical candidates.
- Entity resolution links identities.
- Canonical storage maintains entities/facts/relationships/evidence.
- Query layer serves consumers.
- Web/API/MCP are interfaces, not business-logic owners.

Avoid imports that cross these boundaries in the wrong direction.

## Implementation preferences

- TypeScript for web/API/MCP/Cloudflare services.
- Python where mature extraction/data/record-linkage tooling is strongest.
- Postgres for operational canonical storage.
- R2 for raw artifacts and exports.
- Parquet for analytical/bulk output.
- JSONL for AI-friendly bulk output.
- Cloudflare Streamable HTTP for new remote MCP deployment.

## Vertical requirements

A vertical must define:

- entity schemas;
- relationship predicates;
- normalization rules;
- source registry entries;
- filter metadata;
- SEO/indexability policy;
- MCP intents/tools;
- quality rules;
- fixtures/golden records;
- rights notes.

## Testing requirements

Every change must preserve:

- schema compatibility or explicit migration;
- provenance coverage;
- source fixture extraction;
- entity-resolution golden tests;
- API/MCP parity;
- structured metadata validity;
- sitemap/indexability consistency;
- rights gates.

<!-- BEGIN ECONOMICAL CI -->
## Economical CI (Codex and Claude)

These rules apply equally to Codex, Claude, and any other coding agent:

- Inspect the complete changed-file set before selecting tests. Run the narrowest relevant local checks first, and broaden only when shared code, schemas, migrations, security boundaries, or release behavior changed.
- Record the exact local commands and results in the pull request. Do not push a speculative fix merely to use GitHub Actions as a debugger.
- Do not manually rerun a failed Action until its complete failing job and step logs identify a root cause. Never create an empty commit to retrigger CI.
- Classify failures as deterministic code/configuration, base drift/conflict, flaky/transient, dependency/service outage, secret/permission boundary, or obsolete workflow. A transient external failure may receive at most one targeted rerun when the evidence supports it.
- Use a draft pull request while iterating when repeated pushes would otherwise run CI. Mark it ready only after relevant local checks pass.
- GitHub Actions are the clean-environment and protected-gate proof. Preserve migration, rights, provenance, security, deployment, and release assurances when their inputs change; cost reduction must not weaken them.
<!-- END ECONOMICAL CI -->

## Documentation

Update relevant docs in the same PR as behavior changes. Keep architecture decisions in ADRs. Never leave important assumptions only in prompts or chat history.

## Scope control

For MVP, do not introduce:

- Kubernetes;
- a dedicated graph DB;
- a dedicated search cluster;
- dozens of MCP tools;
- a generalized workflow builder;
- separate repos/apps per vertical;
- new per-vertical public hostname families or duplicate infrastructure merely because a dataset belongs to a different industry; preserve existing reviewed isolation until a measured change justifies migration;
- arbitrary customer ETL;

unless measured requirements prove the existing architecture insufficient.
