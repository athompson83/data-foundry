# Progress

## Current State

- Product: Data Foundry
- Lifecycle stage: MVP implementation / pre-deployment
- Control-graph node: `INSPECT -> IMPLEMENT_GOVERNANCE -> VERIFY -> PUBLISH_PR`
- Current milestone: Integrate and deploy the first lawful, revenue-capable HVAC vertical
- Branch: `codex/adopt-project-control-standard-20260826`
- PR: Not created at the time of this closeout-file update
- Preview: None verified
- Production: Not deployed
- Database target: Local PGlite/real-Postgres checks only; canonical hosted target not configured in repository evidence

## Latest Session

### Objective

Adopt the App Project Control Standard without duplicating detailed roadmaps or overstating work that exists only in open pull requests.

### Completed

- Inspected `AGENTS.md`, README, package scripts, ADRs, owner-action runbooks, repository branches, open PRs, open issues, and the current `main` history.
- Added the canonical `APP_PROJECT_CONTROL_STANDARD.md` supplied by the Product Owner.
- Added an evidence-based executive `PROJECT_CHECKLIST.md` that links to existing detailed sources.
- Added this concise current-state handoff.
- Updated `AGENTS.md` with startup, fix-as-found, canonical-infrastructure, deployment-target, closeout, and owner-action rules.
- Searched for generic Codex/Claude prompt templates; none exist in the repository, so none were deleted.

### Checklist Changes

- Added 7 Foundation, 9 MVP, 4 Beta, and 6 Production items.
- Recorded completed foundations separately from open-PR work.
- Recorded three genuine owner-action boundaries and linked the existing runbooks.

### Problems Found and Fixed

- Governance was mission-focused but did not require sessions to reconcile or update an executive checklist and handoff. The new control files and `AGENTS.md` routing close that gap.
- The repository had detailed operational documents but no single release rollup. `PROJECT_CHECKLIST.md` now summarizes without replacing them.
- Repository documentation on `main` predates five open PRs. The checklist marks those capabilities `IN_PROGRESS`, not `DONE`, preventing branch work from being reported as shipped.

### Verification

- Documentation link and repository-policy checks: pending final local verification.
- Exact-candidate Git/hosted checks: pending commit and push.

### Deployment / Database Activity

- No deployment, database migration, provider project creation, or production change was performed.

## Blockers

- Rights model and partner-field ownership decisions block lawful real-source publication and paid API release.
- Canonical Cloudflare account/zone/routes, queue/DLQ, Hyperdrive, and hosted Postgres connectivity are not evidenced as configured.
- PRs #13–#17 remain open and draft; their work is not on `main`.

## Risks

- Open PRs overlap in schema, rights, auth/metering, and web documentation; merge order and rebasing must preserve exact-candidate evidence.
- `main` is behind substantial verified branch work, so status claims must always distinguish merged from proposed behavior.
- The repository still advertises a Vercel homepage even though ADR-0006 makes Cloudflare the deployment target; removal depends on verifying/disconnecting the legacy integration.
- No real source has completed legal/rights approval, and no legal counsel review is recorded.

## Required User Actions

See `PROJECT_CHECKLIST.md` items `UA-001` through `UA-003`. No routine coding or testing work is assigned to the Product Owner.

## Recommended Next Steps

1. Agent-owned: publish and merge this governance migration (`FOUNDATION-005`).
2. Agent-owned: reconcile/rebase and merge compatible PRs in dependency order, beginning with #14, then #15; separately decide #13, #16, and #17 based on review evidence (`MVP-001`, `MVP-003`–`MVP-006`).
3. Owner-owned: approve the rights model/partner-field decisions (`UA-001`, `MVP-001`).
4. Agent-owned with owner-provided platform access: configure canonical Cloudflare/Postgres isolation, deploy Preview, and execute browser/API/queue/database E2E (`FOUNDATION-006`, `BETA-001`, `BETA-002`).
5. Agent-owned: close verified findings, remove the obsolete Vercel path after provider confirmation, and clean only branches proven to have no unique work (`BETA-004`, `PROD-005`).

## Production Impact

None. Governance/documentation only; production is not deployed.

## Previous Session Summary

`main` at session start was `6db77e0388fb9bab4bd6ea79dada6f853a1809ac`, containing merged PRs #11 and #12. Five draft PRs (#13–#17) contained refresh policy, usage-schema/rights corrections, API auth/metering, a proposed rights-grant ADR, and the public web surface. No open standalone GitHub issues were found.
