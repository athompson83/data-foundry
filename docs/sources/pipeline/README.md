# Dataset expansion pipeline

Standing Product Owner direction (2026-09-27): keep expanding Data Foundry's data
types, databases and available data, categorise them, and do it with as little
owner involvement as possible. The business is finding **unstructured** public
data and structuring it deterministically, prioritising what is most useful to
**AI agents**.

This directory is the machine-readable pipeline that a scheduled agent session
advances every week. It sits *before* `docs/sources/proposed/` (draft source
declarations) and the vertical/dataset build itself.

| File | Purpose |
| --- | --- |
| [`candidates.yaml`](candidates.yaml) | Every candidate dataset: category, stage, rights verdict, scores, evidence and the single next action. Validated by `tooling/test/source-pipeline.test.ts`. |
| [`scout-routine.md`](scout-routine.md) | The scheduler: the routine's ID, cron and verbatim prompt. |
| `evidence/YYYY-MM-DD/` | Sample identifiers (`samples.json`), assessment scripts, their outputs, and `inputs.json` + `replay.sh`. The source responses themselves are preserved in the R2 evidence bucket, so every measurement can be re-run. |
| `research-2026-09-27-composites.md` | The composite-dataset round: the four datasets and their measured linkage. |
| `prototypes/<key>/` | The PROTOTYPED evidence for one candidate: report and `coverage.json`. |
| `research-YYYY-MM-DD.md` | The evidence record for a research round: quoted terms, measured counts, samples, extraction hit rates. |

## Datasets are composites

Product Owner direction (2026-09-27): "We need to make sure our datasets are
aggregates of several different sources of data. Find all related data
(including unstructured) and structure it for our purposes. Classify and
organize accordingly."

So a **dataset** is one entity type (a recall notice, an equipment model, a
product approval, a licensed business) assembled from several independent
**sources**, linked by deterministic join keys, with every fact carrying its
source. Each entry in `candidates:` is a source (a feed); each entry in
`datasets:` names its member sources, the join keys between them with the
match rate measured on real samples (`matched/total`), its classification
taxonomy and the agent questions only the aggregate answers.
`tooling/test/source-pipeline.test.ts` requires every dataset to have at least
two members from different hosts, no RED member, and at least one measured
cross-source join; a source past `PROTOTYPED` must belong to a dataset.

Linking rules, from the round-3 measurements
([`research-2026-09-27-composites.md`](research-2026-09-27-composites.md)):
each join key has a `mode`. `declared` joins (GTIN, licence number, UBI, a
cited approval number: an identifier that names the counterpart record) link
automatically, and only at the level that identifier names: a GTIN links a
notice to a product but never merges two recall events, which needs a cited
case number or review. Shared attributes such as a refrigerant designation
select nothing on their own (a rule applies only after filtering by end use,
equipment class, jurisdiction and date), so they are candidates. A marker that only says a counterpart exists (Health Canada's
"joint recall" note) narrows candidates but is not declared;
`candidate` joins (names, brands, model tokens, titles, phones) only propose a
link for review, never a merge (AGENTS.md rules 3 and 7). A dataset shows that its
members actually link through a join between independent publishers with at
least one match that is either `declared` or a `candidate` whose hand-check
(`reviewed: { correct, checked }`) confirmed at least one same-record match;
every candidate link is still reviewed before publication. Every member records
its `publisher` (independence compares publishers, not URL domains, since one
agency can serve a feed from several domains) and its source `format` (`free-text` when its facts must be extracted from prose or
documents, `structured` when they arrive as typed fields), independently of the
structuring task. A dataset combines both formats: it cannot advance to
`EVIDENCED` without at least one free-text member and one structured member.
Shared attributes such as an HVHZ flag, a code edition or a refrigerant are
filter evidence, never declared links. Round-3 match rates
are screening measurements; a member source is re-measured from archived
inputs before it reaches `EVIDENCED`.

## Stages

A candidate moves forward only on evidence, one stage at a time:

1. `DISCOVERED`: named, with a one-line thesis. Nothing measured.
2. `SCREENED`: reachable from our egress, record counts and update frequency
   measured, free-text fields identified.
3. `EVIDENCED`: terms or licence quoted verbatim with URL, about 20 or more live
   samples pulled, and deterministic-extraction hit rates measured, with the
   sample identifiers, scripts, outputs and a replayable R2 input archive committed
   under `evidence/`. Scored.
4. `RIGHTS_DETERMINED`: an ADR-0013 evidence-based rights record is written
   (`docs/sources/<source>-rights-record-YYYYMMDD.md`), listing the exact fields
   to be redistributed and the attribution and conditions.
5. `PROTOTYPED`: a deterministic parser runs over the full snapshot with 0
   errors, with golden tests and measured field coverage. The evidence is
   `prototypes/<key>/README.md` plus `prototypes/<key>/coverage.json`: the
   package, golden tests, runner (`tooling/prototypes/<key>.ts`), the snapshot
   archived in R2 with byte counts and SHA-256, per-field hits, and hand-checked
   precision where it was measured.
6. `BUILDING`: storage, sync, API/MCP surface and billing, in a reviewed PR.
7. `LIVE`: deployed, reconciled to the source, and hosted acceptance passed.
   Selling stays gated by `SALES_OPEN` per dataset.
8. `PARKED`: stopped, with the reason recorded. May be reopened when the
   reason changes.

## Rights gate (no owner action needed)

The Product Owner pre-approved any dataset where the agent can logically show,
from evidence, that there are no restrictions (instruction of 2026-09-26). The
determination follows ADR-0013's evidence-based method, so no named human
reviewer is needed:

- **GREEN**: public domain, CC0, or terms that expressly permit commercial
  redistribution. The agent writes the rights record and proceeds.
- **AMBER**: permitted, with conditions such as attribution, freshness,
  third-party copyright carve-outs or personal-data exclusions. The agent may
  proceed only if the product design satisfies every condition, and the rights
  record says how each one is met.
- **RED**: forbidden, unreadable or unverified terms. The candidate is parked.
  A `200` is not permission.

## Scoring

Each criterion is scored 1–5; the total is out of 35. The ranking is judgement
applied to evidence. It is not itself a measurement.

- `agent_demand`: questions agents need answered that are hard today.
- `rights_clarity`
- `acquisition_ease`: a documented API or bulk export, no crawling.
- `structuring_value`: how much deterministic structure we add beyond what the
  source already provides. This is the core of the business.
- `freshness`: update cadence.
- `low_onboarding_cost`: reuse of the live D1/R2/Worker/Stripe stack.
- `poor_existing_access`: whether competitors or free alternatives serve the
  same need well.

## Categories

Datasets are categorised by domain (`home-services`, `health`, `product-safety`, `regulatory`,
`security`, `finance`, `transport`, `trade`, …) and by the structuring they
perform: `identifier-extraction`, `eligibility-criteria`, `obligation-timeline`,
`event-extraction`, `normalization`. Public paths follow ADR-0012:
`api.data.aroqon.com/v1/<dataset>`.

## The weekly run

A scheduled Claude Code routine does the following, starting a fresh session
each week. Its schedule, trigger ID, prompt and known limitation are recorded
in [`scout-routine.md`](scout-routine.md):

1. Reads this README, `candidates.yaml`, `AGENTS.md`, `PROJECT_CHECKLIST.md`
   and `PROGRESS.md`.
2. Re-verifies the live datasets:
   - the sync ran;
   - the latest source date is current;
   - the source totals still reconcile.

   It fixes any regression before doing anything else.
3. Discovers at least three new candidates across unrelated domains, and
   screens them, including new sources for the existing datasets and the
   linkage between them.
4. Advances the first candidate in the active research record's **build order**
   by at least one stage, with evidence, provided it is in `SCREENED`–`BUILDING`.
   The build order weighs cost and time to revenue as well as the score. The
   active build order is in
   [`research-2026-09-27-composites.md`](research-2026-09-27-composites.md):
   the first eligible member source of the first composite dataset, until a
   later record states that it replaces it.
5. Records a `research-YYYY-MM-DD.md`, updates `candidates.yaml`, and opens a
   PR. Merging follows the normal gates: CI green and independent review clean.
6. Reports to the owner only:
   - new revenue;
   - a dataset ready for its `SALES_OPEN` decision;
   - a blocker that needs a credential, account or legal identity.
