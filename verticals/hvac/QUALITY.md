# Quality — `hvac`

Doc 14 measures quality across nine dimensions **separately**. A single blended
"data quality" number would hide the one thing this vertical most needs to see:
that coverage is excellent on certified ratings and poor on electrical data, and
that those two facts have completely different fixes.

All "current" figures are measured from `fixtures/golden/` — the fixture set, not
a production system.

## Quality dimensions (doc 14)

| Dimension | Measured how | Target | Current (fixtures) |
|---|---|---|---|
| Source authority | ≥1 source with `authority_rank` ≥80 per critical property | 100% of critical properties | **83%** — 5 of 6. `nominal_tonnage` is covered at 90 (spec sheets) but only for 3 models; elsewhere it is derived or comes from authority 45 |
| Extraction accuracy | Fixture extraction vs. golden records | 100% on fixtures | Pending pipeline |
| Normalization accuracy | Normalized join keys vs. golden | 100% on fixtures | **100%** — verified by `tests/normalization.test.ts` |
| Entity-resolution accuracy | Golden matches and negative judgments | 0 false merges | **0 false merges** across 3 recorded negative judgments |
| Completeness | Critical-field coverage per entity | ≥92% | **91.0%** — 71 of 78 critical facts (13 models × 6) |
| Freshness | Sources refreshed within cadence | ≥96% within 2× cadence | n/a — fixtures are static |
| Provenance coverage | Published facts with evidence | ≥99% | **100%** — 171 of 171 facts carry ≥1 evidence reference |
| Relationship validity | Orphan and cyclic edges | <0.05% orphans, 0 cycles | **0 orphans, 0 cycles** across 26 edges |
| Rights-policy coverage | Sources with complete, current rights metadata | 100% | **100%** — all 4 pass the activation gate |

## Dataset health scorecard

| Metric | Target | Current |
|---|---|---|
| Source health | ≥97% | n/a (static fixtures) |
| Critical-field completeness | ≥92% | **91.0%** ⚠️ below target |
| Evidence coverage | ≥99.8% | **100%** |
| Freshness SLA met | ≥96% | n/a |
| Entity resolution reviewed | ≥99% | **100%** (27 of 27 entities deterministically resolved) |
| Orphan relationships | ≤0.05% | **0%** |
| Indexable-page quality pass | ≥98% | **54%** ⚠️ — see below |
| MCP intent pass rate | ≥94% | Pending eval harness |

### The two numbers below target, and why neither is a bug

**Critical-field completeness 91.0% vs. a 92% target.** Exactly one property
causes the shortfall: `voltage`, present on 6 of 13 models. Only the manufacturer
source family publishes electrical data and the fixture set holds a manufacturer
feed for Acme alone. All 7 missing values belong to Northwind and Borealis. The
fix is one more source family, not a threshold change.

**Indexable-page quality pass 54% vs. a 98% target.** Seven of thirteen models
clear the `entity_detail` gate. This metric is *supposed* to be near 100% in a
mature vertical, and it is not, because the same `voltage` gap fails six pages.

Both numbers are reported honestly rather than adjusted. The gate is a coverage
instrument: it converts a source gap into a visible, specific, actionable number.
Lowering `min_total_facts` from 8 to 6 would show 100% indexable tomorrow and
publish six thinner pages — the exact failure AGENTS.md rule 8 exists to prevent.

## MVP SLOs (doc 14)

| SLO | Target | Status |
|---|---|---|
| Provenance coverage on published critical facts | 99%+ | ✅ 100% |
| Known false-auto-merge rate | <0.5% | ✅ 0% |
| Critical sources refreshed within 2× cadence | — | n/a (fixtures) |
| MCP correct-tool rate on curated intent suite | 95%+ | Pending harness; 6 intents × 5 prompts defined in `seo.yaml` |
| **Production publication from RED/unreviewed sources** | **zero** | ✅ zero — no RED or UNREVIEWED source exists |

## Declarative quality rules

All rules are declarative — `entities/*.yaml` (`quality_rules`) and
`normalizers/fact-selection.yaml` (`consistency_checks`). No vertical-specific
code implements any of them.

**A failing rule demotes a fact; it never deletes one.**

| Rule id | Type | Property | Severity | Catches |
|---|---|---|---|---|
| `capacity_tonnage_consistency` | cross_property | capacity ↔ tonnage | error | A unit-conversion error, or two sources describing different units. Validated against real published pairs on 3 models |
| `capacity_in_range` | range | `cooling_capacity_btu` | error | Misparsed thousands separators (`36,000` → `36`) |
| `tonnage_in_range` | range | `nominal_tonnage` | error | BTU value landing in the tonnage property |
| `seer2_in_range` | range | `seer2` | error | Column misalignment in CSV extraction |
| `eer2_in_range` | range | `eer2` | error | Same |
| `hspf2_in_range` | range | `hspf2` | error | Same |
| `seer2_exceeds_eer2` | cross_property | `seer2`, `eer2` | warning | **Swapped SEER2/EER2 columns** — the single most likely CSV extraction error, and invisible to range checks alone |
| `hspf2_only_on_heat_pumps` | conditional_presence | `hspf2` | error | Distinguishes correct absence from missing data |
| `model_number_format` | regex | `model_number` alias | error | A garbage join key, which silently creates a duplicate entity |
| `phase_is_one_or_three` | enum | `phase` | error | Misparsed electrical notation |
| `sound_level_plausible` | range | `sound_level_db` | warning | Transcription errors in the low-reliability source |
| `certified_capacity_matches_model` | cross_entity | across `certified_by` | error | **A certification joined to the wrong model** — the highest-consequence resolution error possible here |
| `no_supersession_cycles` | acyclic | `supersedes` | error | Two models each replacing the other |
| `supersession_within_manufacturer` | same_related_entity | `supersedes` | error | A competitor cross-reference mislabelled as supersession |
| `every_model_has_a_manufacturer` | required_edge | — | error | Orphaned models from a failed brand resolution |

## Entity resolution evaluation

| Metric | Target | Current |
|---|---|---|
| Auto-merge precision | ≥99.5% | 100% (27/27 correct) |
| True-duplicate recall | ≥95% | 100% |
| **False merge rate** | **<0.5%** | **0%** |
| False non-match rate | <5% | 0% |
| Escalated to human review | — | 0 (no case fell below the deterministic threshold) |

Doc 14: *"Optimize for extremely low false merges."* In this vertical a false
merge is not a cosmetic defect — merging `24ACB636A003` into `24ACC636A003`
would make "what replaces the discontinued unit?" answer with itself, and an
installer would order a unit that no longer exists.

Three negative judgments are recorded in `fixtures/golden/entities.json` and are
durable (doc 06): once decided, a pair is never re-proposed.

1. `24ACC636A003` ↔ `24ACB636A003` — one generation character apart, same
   capacity, same manufacturer. Blocking *will* propose this. Hard conflicts on
   `refrigerant` and `seer2` block it.
2. `24ACB636A003` ↔ `24ACA636A003` — the same trap one step earlier.
3. `24ACC636A003` ↔ `NWA1436AC1` — identical capacity, type and refrigerant,
   similar SEER2. Different manufacturers. Demonstrates why `manufacturer_slug`
   is the first element of every composite key.

## Extraction contract tests

Per doc 14, every connector needs fixtures and expected records, and *"a source
change must fail loudly if required fields disappear."*

| Source | Must fail loudly if | Blast radius |
|---|---|---|
| `acme-hvac-catalog` | `lifecycle.replaced_by` disappears | **Silent.** Existing edges stay valid, so nothing errors — supersession simply stops updating. Presence must be asserted, not just parseability |
| `coolsupply-distributor` | rendered spec table is empty | Loses the only UPC source; must fail rather than record nulls |
| `ahri-directory-export` | any column renamed | **Highest.** Every certified rating at once |
| `acme-spec-sheets` | text layer missing (scanned PDF) | Loses all sound and weight data; must fail rather than fall back to OCR, which is not an approved acquisition method |

## Source observability

Per doc 14, track per source: last successful fetch, HTTP/error rates, records
extracted, schema errors, parser drift, latency, and **rights-review
expiration**.

Alert on sudden record-count collapse or large structure changes. Two
vertical-specific alerts matter more than the generic ones:

- **`ahri-directory-export` row count drops sharply** — the export legitimately
  drops discontinued models, so a *small* decline is normal and a large one is a
  format change. The distinction is the alert.
- **`coolsupply-distributor` rights review lapses 2026-01-31** — the earliest
  expiry of the four, and the only AMBER source. When it lapses the source stops
  passing the gate and stops publishing, by design.

## Known gaps

| Gap | Impact | Mitigation | Owner |
|---|---|---|---|
| **All sources synthetic** | Doc 17 gate 4 not passed; vertical cannot leave DRAFT | Rights review on ≥3 real families | Platform team |
| **`voltage` at 46% coverage** | 6 of 13 models fail the indexability gate | Manufacturer source for Northwind and Borealis | Platform team |
| `sound_level_db` at 46%, low reliability | Facet not indexable; values from the distributor confidence-capped at 0.55 | Manufacturer spec sheets for more models | Platform team |
| No `compatible_with` edges | Compatibility questions unanswerable | Correct today — inference is forbidden. Needs a source that asserts matched systems | Platform team |
| Discontinued models have no certification | Cannot show certified ratings for superseded units | Correct — directories drop them. Would need historical export retention, which is why retention is indefinite | Platform team |
| Vertical tests not in `pnpm test` | `tests/` runs only when invoked directly | `verticals/hvac` must be added to `vitest.workspace.ts`, which is platform config and not owned by a vertical | Platform team |
| No lifecycle-status property | Cannot filter "discontinued only" without walking the graph | Deliberate — the `supersedes` edge encodes it. Revisit only if query patterns demand it | Platform team |
