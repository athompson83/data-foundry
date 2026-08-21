# `hvac` — HVAC Equipment

The first vertical and the Phase 1 proof that **a vertical is configuration and data, not a fork of the app** (AGENTS.md rule 4).

Everything in this folder is YAML, JSON or Markdown except fixture/configuration support code. There is no vertical-specific application implementation, and that is intentional.

> **Status: `DRAFT`.** All four current sources are **synthetic** fictional publishers on RFC 2606 reserved example domains. No real site is crawled. The source-rights machinery is exercised end to end, but commercial source-rights validation is not considered proven until real external sources have been reviewed and approved. See [`RIGHTS.md`](RIGHTS.md).

## Why HVAC is useful as the factory proof

The fixture deliberately combines several difficult data problems that the platform must solve generically:

- replacement and supersession relationships;
- certification data held separately from manufacturer/distributor data;
- technical specifications represented in multiple source formats;
- entities known by inconsistent identifiers;
- exact model-number lookup requirements;
- conflicting values that must be retained and adjudicated rather than silently collapsed.

The business/niche scoring framework is maintained out-of-band and is not part of this public repository.

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

Resolution is deterministic on the normalized model number — no fuzzy matching and no vector similarity (AGENTS.md rule 7).

The sources also disagree. For the fixture model's `seer2` value, the certification directory says **14.3** while the manufacturer feed and distributor say **14.5**. The certification value wins because source authority outranks corroboration in the configured fact-selection policy. **Two sources agree and still lose.** The losing claim remains attached to its evidence so the trust layer can answer why the canonical value differs from another source.

## Contents

```text
hvac/
├── vertical.yaml            slug, entity types, predicates, ER thresholds
├── entities/
│   ├── equipment_model.yaml equipment properties, identity and quality rules
│   ├── manufacturer.yaml    deliberately thin anchor entity
│   └── certification.yaml   first-class certification entity
├── relationships.yaml       manufactures · supersedes · certified_by · compatible_with
├── filters.yaml             schema-driven filter definitions and indexability hints
├── seo.yaml                 quality-gated indexability and agent intents
├── mcp.yaml                 intent-shaped MCP tool declarations
├── sources/                 four synthetic source declarations with rights metadata
├── normalizers/             deterministic normalization and source mappings
├── fixtures/                native-format artifacts plus generated PDF fixture
│   └── golden/              expected canonical entities, facts and relationships
├── tests/                   vertical configuration/data validation
└── required docs            README · DATA_DICTIONARY · SOURCES · RIGHTS · QUALITY · CHANGELOG
```

## Shared vocabulary

Other platform components code against these declared strings. Renaming them is a schema change: update `schema_version`, record the change in `CHANGELOG.md`, and expect golden fixtures to move.

| Kind | Values |
|---|---|
| Entity types | `manufacturer` · `equipment_model` · `certification` |
| Alias types | `model_number` · `ahri_ref` · `manufacturer_sku` · `upc` · `series_name` |
| Predicates | `manufactures` · `supersedes` · `certified_by` · `compatible_with` |
| Properties | `product_type` · `cooling_capacity_btu` · `nominal_tonnage` · `seer2` · `eer2` · `hspf2` · `refrigerant` · `voltage` · `phase` · `stage_count` · `sound_level_db` · `weight_lb` |

`12000 BTU/h = 1 ton`, exact by definition.

## Fixture characteristics

The fixture set contains 13 equipment models, 3 manufacturers, 11 certifications and 26 relationship edges described from four source perspectives with deliberate messiness:

- **Same identifier, four formats** — casing, hyphens and spaces.
- **Same quantity, multiple representations** — BTU/h and tons.
- **Asymmetric coverage** — each source omits information another source contains.
- **Genuine conflicts** — resolved by configured authority rather than recency or simple majority.
- **A two-hop supersession chain** — ensuring replacement traversal cannot stop at the first discontinued successor.

## Running

The HVAC vertical is registered in the root Vitest workspace, so its tests run as part of the repository suite.

```bash
pnpm test
pnpm verticals:validate
npx vitest run --project hvac
npx tsx verticals/hvac/fixtures/generate-acme-spec-pdf.ts
```

If the local Vitest CLI uses a different project selector after dependency upgrades, `pnpm test` remains the authoritative repository-level command.

## Honest limitations

- **Every source is synthetic.** The rights machinery genuinely runs; it currently validates controlled fixture declarations rather than contracts/terms for external publishers.
- **`voltage` coverage is intentionally incomplete**, and it is a critical property, so some models do not clear the indexability gate. The intended fix is better source coverage, not lowering the quality threshold.
- **`compatible_with` has zero fixture edges.** No source asserts compatibility and inference is forbidden. Compatibility answers should remain unavailable rather than being fabricated from specification similarity.
- **Some discontinued models have no certification relationship** because the fixture models the reality that directories may drop withdrawn products. Missing relationships are not automatically treated as join failures.

## Phase 2 exit condition

This vertical should not be considered commercially validated until at least one genuinely external source has:

1. passed rights review for the intended acquisition, normalization, commercial use and redistribution behavior;
2. been acquired through a real provider adapter;
3. produced immutable raw evidence with provenance;
4. survived extraction/normalization/entity resolution without fixture-specific code;
5. been refreshed incrementally without duplicating or losing evidence;
6. produced canonical output whose conflicts and verification status can be explained to a customer.
