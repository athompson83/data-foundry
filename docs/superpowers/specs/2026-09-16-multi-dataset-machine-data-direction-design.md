# Data Foundry Multi-Dataset Machine-Data Direction Design

Status: Product Owner approved, 2026-09-16.

## Purpose

Data Foundry is a multi-dataset, multi-industry machine-data platform. It converts lawfully acquired source data into clean, current, evidence-backed canonical facts that software, AI agents, data exchanges, and supported crawlers can discover and consume through governed delivery surfaces.

HVAC remains the reference vertical and first factory proof. It is not the product identity and comprehensive HVAC coverage is not a prerequisite to revenue. The primary expansion unit is a useful, rights-approved dataset/data product; industries and verticals organize related schemas and behavior but do not require separate infrastructure stacks.

## Commercial direction

The platform should earn revenue from machine consumption of maintained data. Direct paid API access is the shortest currently supported path; API exchanges, MCP/agent access, bulk delivery, and supported paid-crawler arrangements are additional channels over the same canonical truth. No single marketplace, provider beta, or industry gates every other viable paid channel.

A dataset may launch when it truthfully covers a useful machine use case, has the required source and downstream rights, has an approved acquisition path, and passes the applicable quality/freshness/operational gates. Do not wait for an industry to be comprehensive or for a target record count. Progress is measured by useful machine queries, coverage of stated use cases, provenance, freshness, external consumption, paid conversion, retention, and contribution economics—not raw record count alone.

## Portfolio and factory strategy

After the first production source proves the factory, source discovery should span unrelated domains rather than remaining concentrated in HVAC. Prefer datasets with evidence of machine/developer demand, explicit commercial redistribution rights, supported bulk/API acquisition, authoritative provenance, stable identifiers, recurring updates, normalization/linkage opportunity, and poor existing machine access.

The second, third, tenth, and later compatible datasets should increasingly be configuration/mapping/validation work rather than new application architecture. Repeated source-specific code is evidence to improve a reusable boundary, but the platform must not be generalized speculatively before repeated real requirements justify it.

New real datasets still pass source, rights, quality, cost, acquisition, operational, and customer-value gates independently. Public availability, successful HTTP retrieval, `robots.txt`, a government host, or an API endpoint does not by itself establish commercial redistribution rights. Conversely, a permissive content licence does not by itself establish an approved automated acquisition method.

## Canonical delivery surfaces and hostnames

Use capability-based hostnames, not per-industry infrastructure hostnames:

| Capability | Canonical hostname / path |
| --- | --- |
| Public catalog, human pages, search and permitted crawler discovery | `https://data.aroqon.com/{vertical-or-dataset}/...` |
| Direct and exchange-backed API delivery | `https://api.data.aroqon.com/v1/{vertical-or-dataset}/...` |
| MCP / agent access | `https://mcp.data.aroqon.com/mcp` |
| Documentation | Prefer `https://data.aroqon.com/docs`; split to `docs.data.aroqon.com` only for a demonstrated operational reason |
| Bulk delivery | Add a dedicated hostname such as `downloads.data.aroqon.com` only if security, caching, entitlement, or delivery evidence justifies it |

`data.aroqon.com`, `api.data.aroqon.com`, and `mcp.data.aroqon.com` are subdomains of the existing `aroqon.com` zone; no new domain purchase is required. Cloudflare DNS/Worker Custom Domain configuration must be inspected before records are created. Do not create conflicting DNS records merely to reserve names.

HVAC and future domains belong in paths, schemas, source registries, rights scopes, entitlements, and configuration. Do not create `hvac-api`, `vehicle-api`, `hvac-mcp`, or equivalent per-industry infrastructure as the long-term architecture unless measured isolation requirements prove a shared capability surface insufficient.

Marketplace traffic may use provider-specific authentication/proxy integration, but it must converge on the same canonical query layer. A marketplace-specific hostname is not canonical architecture unless a concrete provider/security requirement makes it necessary.

## Rights and channel separation

One canonical truth does not mean one permission. Rights and entitlements remain independently enforceable for public web/indexing, free API, paid API, marketplace distribution, MCP/agent access, bulk/export, and crawler delivery/payment where implemented. A source or fact publishes only on surfaces for which the required rights matrix allows publication.

Crawler controls and paid-crawl mechanisms apply to the public data surface and do not replace API/MCP authentication or expand upstream source rights. Search discovery, training permissions, agent retrieval, and paid crawling are distinct policies.

## Deployment constraints

This direction does not authorize public DNS cutover, source activation, legal acceptance, credential exposure, or payment-destination changes. Existing private-canary, deployment, rights, security, and public-exposure gates remain in force.

Hostname normalization must not delay the current database/UA-002 path. Repository configuration may be prepared in parallel; provider mutations occur only when the existing deployment gates permit them.

## Agent behavior

Every material agent session must treat this document's direction as standing product context through `AGENTS.md` and the canonical checklist/plan references. Agents should not silently regress the project to an HVAC-only product, a RapidAPI-only business, or per-vertical infrastructure. Historical documents remain historical evidence; active documents that conflict with this direction must be marked superseded or amended rather than silently rewritten to imply the newer direction existed earlier.
