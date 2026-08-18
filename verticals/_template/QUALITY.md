# Quality — `template`

> Replace this file. Doc 14 measures quality across nine dimensions, separately.
> A single blended "data quality" number hides exactly the failure you need to
> see.

## Quality dimensions (doc 14)

| Dimension | How it is measured here | Target | Current |
|---|---|---|---|
| Source authority | `authority_rank` spread across contributing sources | ≥1 source ≥80 per critical property | REPLACE_ME |
| Extraction accuracy | fixture extraction vs. golden records | 100% on fixtures | REPLACE_ME |
| Normalization accuracy | normalized join keys vs. golden | 100% on fixtures | REPLACE_ME |
| Entity-resolution accuracy | golden matches/non-matches | 0 false merges | REPLACE_ME |
| Completeness | critical-field coverage per entity | ≥92% | REPLACE_ME |
| Freshness | sources refreshed within cadence | ≥96% within 2× cadence | REPLACE_ME |
| Provenance coverage | published critical facts with evidence | ≥99% | REPLACE_ME |
| Relationship validity | orphan/cyclic edges | <0.05% orphans, 0 cycles | REPLACE_ME |
| Rights-policy coverage | sources with complete, current rights metadata | 100% | REPLACE_ME |

## MVP SLOs (doc 14)

- 99%+ provenance coverage on published critical facts.
- <0.5% known false-auto-merge rate, with the goal far lower.
- Critical sources refreshed within 2× intended cadence.
- 95%+ MCP correct-tool rate on the curated intent suite.
- **Zero production publication from RED or unreviewed sources.**

## Dataset health scorecard

| Metric | Target | Current |
|---|---|---|
| Source health | ≥97% | REPLACE_ME |
| Critical-field completeness | ≥92% | REPLACE_ME |
| Evidence coverage | ≥99.8% | REPLACE_ME |
| Freshness SLA met | ≥96% | REPLACE_ME |
| Entity resolution reviewed | ≥99% | REPLACE_ME |
| Orphan relationships | ≤0.05% | REPLACE_ME |
| Indexable-page quality pass | ≥98% | REPLACE_ME |
| MCP intent pass rate | ≥94% | REPLACE_ME |

## Declarative quality rules

Rules live in `entities/*.yaml` (`quality_rules`) and
`normalizers/fact-selection.yaml` (`consistency_checks`) — declarative, like
everything else in a vertical.

A failing rule **demotes** a fact; it never deletes one. Nothing in this model
discards a claim.

| Rule id | Type | Property | Severity | What it catches |
|---|---|---|---|---|
| REPLACE_ME | | | | |

## Source observability

Per doc 14, track per source: last successful fetch, HTTP/error rates, records
extracted, schema errors, parser drift, response latency, and **rights-review
expiration**. Alert on sudden record-count collapse or large structure changes —
a source that silently changes shape is more dangerous than one that fails.

## Known gaps

Be honest here. An undocumented gap becomes a surprise at exactly the wrong
moment.

| Gap | Impact | Mitigation | Owner |
|---|---|---|---|
| REPLACE_ME | | | |
