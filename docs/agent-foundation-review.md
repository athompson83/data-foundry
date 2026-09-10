# Data Foundry foundation adoption — 2026-09-10

Reviewed base: `52a98ac2ce730198360c2f33ad31221bf6dd94e4` (`main`). Read existing AGENTS.md, package manifest, and branch metadata; root CLAUDE.md was absent.
Original guidance remains byte-for-byte at `docs/agents/operating-reference-2026-09-10.md` (blob `ab85c213b1df4b5730758c208c6162b73e4e22e1`).

This policy-only change adds a lean shared entry point and Claude import, preserving Cloudflare ADR-0006, pnpm, canonical query architecture, source rights/provenance, and existing release scope. No code, dependencies, workflows, migrations, canonical standard, existing checklist/progress status, secrets, or platform settings changed.

NOT_RUN in this session: frozen install/build/test, source-to-query smoke, PostgreSQL checks, fresh-agent loading, deliberate-failure detection, CI routing/failure propagation, and hosted release checks. Local cloning was unavailable because this execution environment could not resolve github.com. Command definitions are not execution evidence.

Next foundation acceptance: run the existing pnpm checks with isolated PostgreSQL and synthetic approved/unapproved source fixtures, then prove the runtime query/export path. Keep source-rights and provider activation decisions separate from technical passing checks. No launch or revenue readiness is claimed.
