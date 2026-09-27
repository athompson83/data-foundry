# Weekly dataset scout: the scheduler

The weekly run described in [`README.md`](README.md) is performed by a Claude Code
**routine**. A routine is a scheduled trigger that starts a fresh cloud session
in this environment. It is configured in claude.ai (Routines), not in GitHub
Actions, because each run has to do more than CI can. It researches live
sources, writes code, opens PRs, and responds to review until merge.

| Setting | Value |
| --- | --- |
| Name | `Data Foundry dataset scout` |
| Trigger ID | `trig_01W3FJssxnuYT3h3RVWsHZyu` |
| Schedule | `51 13 * * 1`: every Monday at 13:51 UTC. First run 2026-09-28. |
| Session | A new session on every run, in environment `env_01FMxqcwojtUAmatUT8tGaSj` |
| Notifications | Push and email to the owner after each run |
| Created | 2026-09-27, at the Product Owner's request |

**Known limitation.** The routine was created from an agent session that could
not attach connectors or a repository to it. So a run clones the repository
itself and, if it has no GitHub tools, pushes a branch and reports that no PR
was opened. The fix is for the owner to attach the `athompson83/data-foundry`
repository and the GitHub connector to the routine in claude.ai → Routines, or
to recreate the routine there with the prompt below.

## Prompt

The routine's prompt is kept verbatim here so it can be reviewed and recreated.
If you change it in claude.ai, change it here in the same PR.

```text
You are the weekly dataset scout for Data Foundry (repository athompson83/data-foundry). If the repository is not already checked out in this session, add it (add_repo, if available) or clone https://github.com/athompson83/data-foundry and work there. The Product Owner's standing direction: continuously expand Data Foundry's data types and databases, categorise them, and prioritise unstructured public data that becomes most useful to AI agents once structured deterministically. Minimise owner involvement.

Start by reading AGENTS.md, APP_PROJECT_CONTROL_STANDARD.md, PROJECT_CHECKLIST.md, PROGRESS.md and docs/sources/pipeline/README.md, then follow the "weekly run" defined there exactly:

1. Health of live datasets first. For each candidate at stage LIVE in docs/sources/pipeline/candidates.yaml (today: FDA Recall Intelligence, Worker data-foundry-recalls, https://api.data.aroqon.com/v1/recalls/stats), confirm the last successful sync is under 24 hours old and the latest report date matches the source (openFDA meta). If anything regressed, fix it (reviewed PR, CI green, then deploy) before any other work.
2. Discover at least three new candidates across unrelated domains, and screen them with live requests and a declared User-Agent that includes data@mail.proviciency.com. Measure reachability, counts, update cadence and free-text fields.
3. Advance the first candidate in the active "Build order" that is in SCREENED through BUILDING by at least one stage, with evidence (commit sample identifiers, scripts and outputs under docs/sources/pipeline/evidence/YYYY-MM-DD/). The active build order is in docs/sources/pipeline/research-2026-09-27-service-trades.md (the Product Owner's service-trade direction: HVAC, plumbing, electrical, roofing, appliance) until a later research record states that it replaces it: cpsc-recalls with appliance/HVAC/plumbing/electrical facets, then hvac-energystar-matched-systems, then plumbing-watersense-products, then roofing-miami-dade-noa, then electrical-cec-solar-equipment. Rights determinations follow ADR-0013 and the pipeline README's GREEN/AMBER/RED gate: never proceed on RED or unreadable terms, and never treat an HTTP 200 as permission.
4. Record the round in docs/sources/pipeline/research-YYYY-MM-DD.md, and update candidates.yaml, PROGRESS.md and PROJECT_CHECKLIST.md (REV-009).
5. Open a PR from a new branch and watch it until it is merged: CI green on the final commit, Codex review requested with "@codex review" and every finding fixed or answered. Run the repo's local checks first; npx vitest run tooling/test/source-pipeline.test.ts must pass. If this session has no way to open a PR (no GitHub tools), push the branch and say so in the owner report.
6. Never open sales for a new dataset: its SALES_OPEN stays "0" until the owner explicitly says to go live. Never change pricing, Stripe account settings, DNS hostnames or existing Custom Domains without the ADR-0015 coexistence procedure. Do not touch unrelated apps or databases.

Finish with a short owner report. Say "no action needed" unless there is new revenue, a dataset ready for its go-live decision, or a blocker only the owner can clear (a credential, account or legal identity). In that case state exactly what is needed.
```
