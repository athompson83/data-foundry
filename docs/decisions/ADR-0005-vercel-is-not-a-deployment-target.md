# ADR-0005 — Vercel is not a deployment target for this repository

**Status:** Accepted
**Date:** 2026-08-21
**Relates to:** AGENTS.md ("Implementation preferences" — Cloudflare), ADR-0004 (surfaces that do not exist yet)

## Context

A Vercel Git integration is connected to this repository and creates a fresh
deployment on every push. Every one of them fails, and each failure posts a red
`Vercel` commit status on the pull request that caused it.

The failure is not a defect in any commit. There is nothing here to deploy, and
there never has been. Taking inventory of the repository **as it stood before
this decision**:

- no `apps/` directory, though `pnpm-workspace.yaml` reserves the glob;
- no `vercel.json`, `next.config.*`, or any other framework configuration —
  the `vercel.json` this decision adds is not one, and turns deployment *off*;
- no web-framework dependency in any of the ten `package.json` files;
- no `.jsx`, `.tsx`, `.vue`, `.svelte` or `.astro` file anywhere;
- the two `.html` files in the tree are scraping fixtures;
- the root `build` script is `schemas:generate && typecheck`, and `tsconfig.json`
  sets `noEmit: true`, so the build writes JSON Schema files in place and emits
  no deployment output directory at all.

`git log --all --diff-filter=ADR` over those paths is empty, so no application
was deleted either. The integration was connected to a repository that has never
contained a deployable application.

Nor is Vercel the intended target. AGENTS.md names Cloudflare — "TypeScript for
web/API/MCP/Cloudflare services", "Cloudflare Streamable HTTP for new remote MCP
deployment". Before this decision, Vercel appeared exactly once in the whole
tree: in `SECURITY.md`'s *out-of-scope* list of third-party services. No ADR
adopted it, and this one does not either — it records the opposite.

The red status is therefore an artefact of a misconfigured integration. It is
not a required check — `main` has no branch protection, and PR #2 merged while
it was red — so it blocks nothing. But a status that is permanently red and
permanently ignored is worse than no status: it trains everyone reading the PR
to skip a failing check, which is the habit that hides the next real one.

## Decision

> Vercel is not a deployment target for this repository. Deployment surfaces,
> when they exist, target Cloudflare per AGENTS.md.
>
> `vercel.json` sets `git.deploymentEnabled: false`, so pushes create no
> deployment and post no status.

**`vercel.json` here is deploy suppression, not adoption.** Its presence would
otherwise read as exactly the opposite of this decision, which is why the
decision is written down.

## Rejected alternatives

**Add a placeholder application so the build succeeds.** This would manufacture
architecture to satisfy a status check — a web app nothing needs, deployed
nowhere anyone uses, maintained forever. The check exists to tell us whether the
thing we ship works; inventing a thing to ship so the check goes green inverts
that completely.

**Leave it red and explain it in each PR description.** Tried, for two pull
requests. It works only for as long as someone keeps explaining, and it spends
that explanation on every reader. A permanently red check is a broken window.

**Remove it from required status checks.** At decision time there was nothing to
remove: `main` was unprotected and the check was informational. `main` is now
protected by ruleset `21855694`; its required checks are repository CI checks,
not Vercel.

**Disconnect the Git integration in the Vercel dashboard.** This was the more
complete fix under the original evidence. Current governance evidence shows no
Data Foundry Vercel project or repository webhook; the remaining uncertainty is
whether GitHub App installation `122728140` still selects this repository. That
selection requires an owner sudo/passkey check in GitHub. `vercel.json` can be
deleted only after the check proves Data Foundry has no remaining App access.

## Consequences

- Pushes stop creating Vercel deployments, so no `Vercel` status is posted.
- Commit statuses are immutable per `(SHA, context)`, so the existing red
  statuses on already-pushed commits stay red. Only later commits are affected.
- Deployable surfaces now exist on Cloudflare under ADR-0006. That adoption does
  not make Vercel a target and does not by itself prove the legacy App lacks
  repository access.
