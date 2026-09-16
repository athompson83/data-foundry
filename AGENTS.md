# Data Foundry — shared agent entry point

## Authority and discovery

- `APP_PROJECT_CONTROL_STANDARD.md` remains canonical standing delivery authority. Read it, this file, `PROJECT_CHECKLIST.md`, and the current `PROGRESS.md` handoff; reconcile claims against GitHub, Cloudflare/runtime, and the actual database target.
- The prior detailed guidance is preserved unchanged in `docs/agents/operating-reference-2026-09-10.md`. Applicable rules remain binding; paths inside that reference are repository-root-relative. Load relevant sections and directory-scoped instructions on demand.
- Use existing plans and ADRs for product requirements, architecture, and release authority. Do not create another constitution, parallel roadmap, or generic SaaS scaffold.
- Work on one valuable end-to-end milestone with explicit non-goals. Repair relevant blockers/invariant violations; record unrelated cleanup without silently enlarging the release.

## Product and architecture boundaries

- Convert lawfully acquired artifacts into canonical, evidence-backed vertical knowledge products served through human pages, API, MCP, and bulk exports.
- Preserve the sequence: approved source → artifact → extraction → normalization → entity resolution → validation → provenance → canonical query layer → consumer surfaces.
- Deployment remains Cloudflare under ADR-0006. General Vercel authority does not change that architecture. Reuse canonical Cloudflare/Postgres infrastructure and appropriate isolated targets.
- Acquisition, extraction, normalization, resolution, canonical storage, and query are separate layers; web/API/MCP are interfaces, not competing business-logic owners.
- Preserve TypeScript/Python responsibilities, Postgres canonical storage, R2 artifacts, Parquet/JSONL exports, and the established remote MCP transport.
- No source without rights metadata; unreviewed/RED sources cannot publish. No published critical fact without source lineage. Retain raw evidence needed to explain or reprocess facts.
- Entity merges must be auditable and reversible; never silently let an LLM merge identities. Exact identifiers take precedence over semantic similarity.
- Verticals are schema/configuration, not separate app forks. Each needs schemas, predicates, normalization, source registry, filters, indexability, MCP intents, quality rules, golden fixtures, and rights notes.
- Acquisition providers remain replaceable adapters. Preserve image rights, quality/demand-gated indexability, and one canonical query layer for web/API/MCP parity.
- Do not add Kubernetes, dedicated graph/search infrastructure, arbitrary customer ETL, a generalized workflow builder, many MCP tools, or per-vertical repos without measured need.

## Reproducible work and executable evidence

- The manifest specifies `pnpm@9.15.4` and Node `>=22`. Use `corepack pnpm install --frozen-lockfile`; reconcile the actual Node pin across local, CI, and hosting rather than inventing one from the range.
- Existing commands include `corepack pnpm run build`, `typecheck`, `test`, `schemas:check`, `openapi:check`, `verticals:validate`, and `cloudflare:topology:check`.
- `lint` currently runs the same TypeScript check as `typecheck`; do not count identical work as two independent assurances.
- Select relevant ingestion/acquisition/source-record/credential PostgreSQL checks from the manifest for affected paths. Confirm the target is disposable or explicitly authorized before any database operation; `migrate` is a mutation, not a harmless verification alias.
- Preserve schema compatibility, source extraction fixtures, entity-resolution goldens, provenance, rights, metadata/indexability, and API/MCP parity tests.
- Ordinary tests use synthetic data and disposable services without Production credentials, acquisition charges, or paid-provider calls. Keep authorized live checks and source-rights decisions separate.
- Prove a complete approved-source-to-query/export path, including denied publication for unapproved sources and evidence/freshness handling. An adapter, compiled profile, or passing unit test alone does not prove live ingestion or publishability.
- Never add placeholder setup/doctor/smoke scripts, suppress failures, or silently skip required work. When changing verification, demonstrate that a deliberate failure is detected.
- Document variable names, consuming component, environment, public/server-only classification, and validation method—not secret values.

## Economical CI and platform controls

- Run focused local checks before coherent pushes; broaden for shared schemas/contracts, security, migrations, dependencies, toolchain, workflow, or agent-policy changes.
- Diagnose complete failing logs before reruns. No speculative pushes or empty commits; allow at most one evidence-supported transient retry.
- Ordinary prose-only routing needs an explicit allowlist. Agent/release policy and executable documentation are not automatically harmless Markdown.
- Preserve required workflows and gates. When changing routing, test selection and an always-evaluated final gate that rejects failed, cancelled, or missing required work.
- Avoid duplicate push/PR work, unnecessary matrices/artifacts, and unrelated database/deployment jobs. Cancel superseded PR validation, not blindly deployments or migrations.
- Preserve least privilege, immutable action references, untrusted/privileged separation, rights/provenance/migration/security gates, and canonical project ownership.
- A merge can trigger deployment. Check actual branch rules, deployment triggers, environment scopes, target identifiers, release authority, and recovery readiness before merging; repository text is not platform enforcement.

## Compact memory and handoff

- Track implemented, wired, locally verified, hosted verified, and released separately. Record exact SHA, commands/results, environment, and evidence; distinguish fixtures from real provider/database/runtime results.
- Keep `PROJECT_CHECKLIST.md` evidence-linked and `PROGRESS.md` a concise current handoff. Archive history without deleting evidence or overwriting existing launch blockers.
- Follow the canonical closeout report: actual work and verification, unresolved blockers, genuine owner-only actions, and next smallest task. Do not mark source rights, provider activation, marketplace setup, or release gates complete from documentation changes.
- Use existing skills selectively, one implementer and a separate review pass by default, with isolated databases/ports/credentials for parallel work. Confirm guidance loading and real command discovery in fresh Codex/Claude sessions.

Policy-only adoption evidence: `docs/agent-foundation-review.md`.
