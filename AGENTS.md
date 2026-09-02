# AGENTS.md — Data Foundry

## Session control

This repository adopts [`APP_PROJECT_CONTROL_STANDARD.md`](APP_PROJECT_CONTROL_STANDARD.md) as the standing delivery authority until the Product Owner explicitly declares Data Foundry shipped and live or changes that authority.

At the start of every material coding session, read this file, `APP_PROJECT_CONTROL_STANDARD.md`, `PROJECT_CHECKLIST.md`, and `PROGRESS.md`; then reconcile them against Git, relevant pull requests and issues, Cloudflare/runtime state, and the database target. Primary repository and runtime evidence overrides stale handoff text.

During authorized work, act and continue through safe recovery paths: fix relevant actionable defects as found, add regression coverage when meaningful, prefer deterministic local repair loops before hosted CI, verify deployed behavior rather than treating green code checks as runtime proof, remove code only after proving it stale, close resolved findings, and clean merged branches only after confirming they contain no unique work.

Use the existing canonical Cloudflare and Postgres/Supabase infrastructure with native branch, preview, or local isolation. Do not create duplicate Vercel, Cloudflare, or Supabase projects when existing project isolation can safely satisfy the task. Data Foundry's deployment target remains Cloudflare under ADR-0006; the general Vercel authority in the control standard does not override that repository-specific architecture decision.

Before ending a material session, update `PROJECT_CHECKLIST.md` and `PROGRESS.md` once near closeout, update affected roadmap or release documents, resolve completed issues/review findings, record verification evidence, and provide the owner-facing report required by the control standard. Do not turn routine engineering work into owner action.

## Mission

Build a repeatable AI-native data foundry that converts messy, lawfully acquired source data into canonical, evidence-backed vertical knowledge products available through human pages, API, MCP and bulk exports.

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
- arbitrary customer ETL;

unless measured requirements prove the existing architecture insufficient.
