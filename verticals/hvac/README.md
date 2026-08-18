# `hvac` — HVAC Equipment

The first vertical, and the Phase 1 proof that **a vertical is configuration and
data, not a fork of the app** (AGENTS.md rule 4).

Everything in this folder is YAML, JSON or Markdown. The only TypeScript is a
fixture generator and config tests. There is no `src/`, and that is the point.

> **Status: `DRAFT`.** All four sources are **synthetic** — fictional publishers
> on RFC 2606 reserved example domains. No real site is crawled. Doc 17's gate 4
> (source rights) is **not passed**, because no real source has been
> rights-reviewed. See [`RIGHTS.md`](RIGHTS.md) and
> `docs/verticals/hvac-niche-score.md`, which is held out-of-band with the rest
> of the product-strategy material and is not published in this repository.

## Why HVAC

Doc 17's strong signals, nearly all present at once: replacement and supersession
questions, certifications held in separate registries, technical specs buried in
PDFs, entities known by inconsistent identifiers, users searching model numbers
directly, and businesses currently paying staff to reconcile sources by hand.

**Weighted niche score: 4.38 raw, 3.38 after penalties.** Five of six
qualification gates pass. The one that does not is source rights — which is
exactly the constraint that keeps this vertical in `DRAFT`.

## The shape of the problem

One physical product, four sources, four spellings:

```text
acme-hvac-catalog       24ACC636A003     JSON, direct HTTP,      authority 85
coolsupply-distributor  24acc6-36a003    HTML, headless browser, authority 45
ahri-directory-export   24ACC6 36A003    CSV bulk file,          authority 95
acme-spec-sheets        24ACC636A003     PDF spec sheet,         authority 90
                            ↓
                        24ACC636A003     one canonical entity
```

Resolved deterministically on the normalized model number — no fuzzy matching,
no vector similarity (AGENTS.md rule 7).

And they disagree. On `seer2` for that model, the certification directory says
**14.3** while the manufacturer feed *and* the distributor both say **14.5**. The
certified value wins, because "direct authoritative source" is doc 04's criterion
1 and "corroboration" is criterion 4. **Two sources agree and still lose.** The
losing claim is retained with its evidence, because "why does your site say 14.3
when the brochure says 14.5?" has to have an answer.

## Contents

```text
hvac/
├── vertical.yaml            slug, entity types, predicates, ER thresholds
├── entities/
│   ├── equipment_model.yaml 12 properties, identity rules, 11 quality rules
│   ├── manufacturer.yaml    deliberately thin — an anchor, not a company profile
│   └── certification.yaml   a first-class entity, so certified and published
│                            ratings can coexist as distinct evidenced claims
├── relationships.yaml       manufactures · supersedes · certified_by · compatible_with
├── filters.yaml             13 filterable fields; only 4 combinations indexable
├── seo.yaml                 quality-gated indexability (rule 8), agent intents
├── mcp.yaml                 6 intent-shaped tools
├── sources/                 4 declarations, complete rights metadata (rule 1)
├── normalizers/             doc 06 layers 1-4 + source mappings + fact selection
├── fixtures/                4 native-format artifacts + generated PDF
│   └── golden/              27 entities, 171 facts, 26 relationships
├── tests/                   config and data validation, self-contained
└── [6 required docs]        README · DATA_DICTIONARY · SOURCES · RIGHTS · QUALITY · CHANGELOG
```

## Shared vocabulary

Other build waves code against these exact strings. **Renaming anything here is a
breaking change:** bump `schema_version`, record it in `CHANGELOG.md`, and expect
the golden files to move.

| Kind | Values |
|---|---|
| Entity types | `manufacturer` · `equipment_model` · `certification` |
| Alias types | `model_number` · `ahri_ref` · `manufacturer_sku` · `upc` · `series_name` |
| Predicates | `manufactures` · `supersedes` · `certified_by` · `compatible_with` |
| Properties | `product_type` · `cooling_capacity_btu` · `nominal_tonnage` · `seer2` · `eer2` · `hspf2` · `refrigerant` · `voltage` · `phase` · `stage_count` · `sound_level_db` · `weight_lb` |

`12000 BTU/h = 1 ton`, exact by definition.

## The fixture set

13 equipment models · 3 manufacturers · 11 certifications · 26 edges, described
from four angles with deliberate, documented messiness:

- **Same identifier, four formats** — casing, hyphens, spaces.
- **Same quantity, two units** — BTU/h in two sources, tons in two others, each
  derived into the other.
- **Asymmetric coverage** — every source is missing something another has. Four
  "only source" facts: supersession, `upc`, `ahri_ref`, certified ratings.
- **Two genuine conflicts** — resolved by authority, not by recency or majority.
- **A two-hop supersession chain** — `24ACA636A003` → `24ACB636A003` →
  `24ACC636A003`, crossing a refrigerant change. Stopping at hop one returns
  another discontinued model, which is the wrong-order scenario reproduced in
  test data.

## Running

```bash
pnpm verticals:validate                                    # CI gate: config + rights
npx vitest run --root verticals/hvac                       # vertical config tests
npx tsx verticals/hvac/fixtures/generate-acme-spec-pdf.ts  # regenerate the PDF
```

`tests/` is not yet picked up by `pnpm test`: root Vitest projects glob
`test/**/*.test.ts` within registered roots, and adding `verticals/hvac` to
`vitest.workspace.ts` is platform config a vertical does not own.

## Honest limitations

- **Every source is synthetic.** The rights machinery genuinely runs and
  genuinely passes; what it validates is our own test data.
- **`voltage` is at 46% coverage**, and it is a critical property, so **6 of 13
  models do not clear the indexability gate.** That is the gate working — the
  fix is a manufacturer source for the other two brands, not a lower threshold.
- **`compatible_with` has zero edges.** No source asserts compatibility and
  inference is forbidden. Compatibility questions are currently unanswerable,
  and answering them from spec similarity would fabricate a safety- and
  warranty-relevant claim.
- **Discontinued models hold no certification**, because directories drop
  withdrawn models. Correct data, not a join failure.
