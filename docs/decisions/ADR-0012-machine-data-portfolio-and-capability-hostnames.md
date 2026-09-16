# ADR-0012 — Machine-data portfolio and capability-based hostnames

**Status:** Accepted by Product Owner, 2026-09-16

**Relates to:** ADR-0006 (Cloudflare deployment), ADR-0010 (surface-aware rights), ADR-0011 (web frontend and multi-industry sites), `AGENTS.md`, and the 2026-09-16 multi-dataset machine-data design.

## Context

The first revenue plan and ADR-0011 were written while HVAC was the concrete proof and the paid API was deliberately deployed one vertical at a time. The September 8 plan therefore proposed industry-specific public machine hostnames such as `hvac-api.aroqon.com` and `hvac-mcp.aroqon.com`.

The Product Owner has now clarified the standing business objective: Data Foundry is a portfolio of clean, current, evidence-backed datasets for machine consumption across industries. HVAC remains the reference vertical, but completing an industry is not a prerequisite to monetizing a useful rights-approved dataset. Direct API, exchanges, MCP/agents, bulk, and supported paid-crawler arrangements are channels over the same canonical truth.

Per-industry public hostnames would make the external contract scale with the number of datasets and would encourage future agents to create infrastructure as a side effect of adding data. That is not the desired long-term product boundary.

## Decision

Data Foundry uses stable capability-based canonical hostnames:

| Capability | Canonical address |
| --- | --- |
| Public catalog, human pages, search and permitted crawler discovery | `https://data.aroqon.com/{vertical-or-dataset}/...` |
| Direct and exchange-backed API | `https://api.data.aroqon.com/v1/{vertical-or-dataset}/...` |
| MCP / agent access | `https://mcp.data.aroqon.com/mcp` |
| Documentation | Prefer `https://data.aroqon.com/docs` |

A dedicated bulk/download or documentation hostname is added only when a demonstrated security, caching, entitlement, delivery, or operational requirement justifies it.

These are subdomains of the existing `aroqon.com` Cloudflare zone; this decision requires no new domain purchase. Provider configuration must inspect existing DNS, routes, Worker Custom Domains, and unrelated Aroqon services before mutation. This ADR does not itself authorize public DNS or route changes.

Vertical and dataset identity belongs in paths, schemas, source registry/configuration, rights scopes, entitlements, usage attribution, and query context. Do not make a new public API or MCP hostname the default cost of adding a dataset.

Marketplace/provider-specific traffic may use a dedicated route or hostname when the provider's authentication or security model concretely requires it. Such a hostname is an adapter boundary, not the canonical data identity, and must converge on the same canonical query layer.

## Relationship to ADR-0011

ADR-0011 remains authoritative for the **implemented web Worker** and for the current per-vertical `apps/edge` composition/isolation behavior until a separately reviewed implementation changes it. This ADR supersedes ADR-0011 only where its external URL/infrastructure expansion model would imply that every future industry must receive a new canonical public API/MCP hostname.

Do **not** refactor the current per-vertical edge Worker merely to satisfy this ADR before first revenue. The canonical `api.data.aroqon.com` contract may route vertical-scoped paths to isolated backing deployments if that preserves current safety with less release risk. A future consolidation to one multi-vertical API Worker requires its own evidence and review because `QueryModel`, tenant/vertical authorization, blast-radius isolation, rate limiting, and deployment recovery are security/reliability boundaries.

Similarly, the existing MCP implementation remains one-vertical credential scoped where currently designed. The public MCP hostname is stable; internal routing/composition may evolve separately without multiplying canonical hostnames.

## Rights and monetization consequences

One canonical hostname never implies one permission. `PUBLIC_WEB`, `SEARCH_INDEX`, `API_FREE`, `API_PAID`, marketplace, `MCP`, bulk/export, and future crawler delivery/payment remain independently rights- and entitlement-gated for every contributing source.

Crawler controls and paid-crawl mechanisms apply to the public data surface and do not replace API/MCP authentication, billing, or source-rights evaluation. Search discovery, model training, agent retrieval, and paid crawling are separate policies.

## Portfolio consequences

After the first production source proves the factory, dataset discovery should span unrelated domains. Prefer sources with evidence of machine/developer demand, explicit commercial redistribution rights, supported acquisition, authoritative provenance, stable identifiers, recurring updates, normalization/linkage value, and poor existing machine access.

Compatible later datasets should increasingly be onboarded through configuration, mapping, validation, rights review, and source adapters. Repeated source-specific implementation is evidence for a reusable improvement; speculative generalization is not.

A dataset may launch before its broader industry is comprehensive when its stated use case, rights, acquisition, quality, freshness, operational behavior, and commercial access are truthful and verified. Record count alone is not a release criterion.

## Migration and compatibility

The September 8 proposed `hvac-api.aroqon.com`, `hvac-marketplace.aroqon.com`, and `hvac-mcp.aroqon.com` names were not production contracts. Do not create legacy redirects or compatibility infrastructure for a hostname that was never externally exposed. If primary evidence later shows an external consumer used one, preserve compatibility deliberately and document it.

Repository configuration can move toward the canonical hostnames in parallel with UA-002, but provider mutation and public exposure remain behind the existing private-canary and public-cutover gates.
