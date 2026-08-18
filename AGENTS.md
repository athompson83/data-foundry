# AGENTS.md — Data Foundry

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
