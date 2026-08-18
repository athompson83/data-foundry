# Fixtures — `hvac`

The golden data the Phase 1 proof runs on.

> **SYNTHETIC TEST DATA.** Every company named here is fictional and every domain
> is an RFC 2606 reserved example domain. No real site is contacted. See
> [`../RIGHTS.md`](../RIGHTS.md).

## Files

| File | Source | Format | Models | Acquisition path exercised |
|---|---|---|---:|---|
| `acme-catalog.json` | `acme-hvac-catalog` | JSON | 6 | Direct HTTP against a JSON API |
| `coolsupply-listing.html` | `coolsupply-distributor` | HTML | 5 | **Headless browser** — specs are injected client-side |
| `ahri-export.csv` | `ahri-directory-export` | CSV | 11 | Bulk file with a `#` preamble |
| `acme-spec.pdf` | `acme-spec-sheets` | PDF | 3 | Text-layer extraction from a real PDF |
| `generate-acme-spec-pdf.ts` | — | script | — | Generates the PDF with `pdf-lib` |
| `golden/` | — | JSON | 13 | Expected canonical output |

The PDF's script and its output are **both committed**: the script is the
reviewable artifact (a PDF cannot be read in a diff), the output means the tests
need no build step.

```bash
npx tsx verticals/hvac/fixtures/generate-acme-spec-pdf.ts
```

## What this set is designed to prove

A clean fixture set is worthless — it proves the pipeline works on data that
would never need a pipeline. Every piece of messiness below is deliberate.

### 1. The same entity from four angles

13 models, 3 manufacturers, 11 certifications. No source covers everything; the
coverage runs 3, 5, 6 and 11 models respectively, and every source is missing
something another has.

### 2. The same identifier, four spellings

```text
acme-catalog.json        24ACC636A003
coolsupply-listing.html  24acc6-36a003
ahri-export.csv          24ACC6 36A003
acme-spec.pdf            24ACC636A003
                             ↓  uppercase, strip separators
                         24ACC636A003
```

`ahri-export.csv` goes further and formats model numbers **differently per
manufacturer within the same file** — spaces for Acme, plain for Northwind,
hyphenated for Borealis. Realistic, and the main workout for identifier
normalization. Borealis is the interesting case: `BTW-C2036` normalizes to
`BTWC2036`, so the join key differs visibly from every source spelling.

### 3. The same quantity in two units

Capacity is published in **BTU/h** by the manufacturer feed and the certification
export, and in **tons** by the distributor and the spec sheets. Each is derived
into the other (`12000 BTU/h = 1 ton`, exact), and `acme-spec.pdf` publishes
*both* on the same page — which is what lets the conversion be validated against
published data rather than trusted.

### 4. Asymmetric coverage

Four facts exist in exactly one source each. They are the entire argument for
maintaining four dissimilar sources:

| Fact | Only source |
|---|---|
| Supersession / `replaced_by` | `acme-hvac-catalog` |
| `upc` | `coolsupply-distributor` |
| `ahri_ref` and certified ratings | `ahri-directory-export` |
| `sound_level_db` (reliably) | `acme-spec-sheets` |

### 5. Two genuine conflicts

**Conflict A — `seer2` on `24ACC636A003`:**

| Source | Value | Authority |
|---|---:|---:|
| `ahri-directory-export` | **14.3** | 95 ← wins |
| `acme-hvac-catalog` | 14.5 | 85 |
| `coolsupply-distributor` | 14.5 | 45 |

**Two sources agree on 14.5 and still lose.** Corroboration is doc 04's criterion
4 and cannot outvote authoritative source at criterion 1. A majority vote or a
confidence average gets this backwards. The two agreeing sources are also not
independent — the distributor transcribes manufacturer data, so their agreement
is one claim counted twice.

**Conflict B — `sound_level_db` on `24ACC648A003`:** 72 dB published on the spec
sheet beats 69 dB re-keyed by the distributor, 90 to 45. The ordinary case.

Both losing claims are retained with full evidence.

### 6. A supersession chain, not a single edge

```text
24ACA636A003  →  24ACB636A003  →  24ACC636A003
 (R-410A)          (R-410A)         (R-454B)
 discontinued      discontinued     current
```

Two hops, and **the two-hop answer is the only correct one** — stopping at the
first hop returns another discontinued model, which is the wrong-order scenario
reproduced in test data. The chain also crosses a refrigerant change, so the
replacement is not a drop-in.

The two discontinued models appear in **no** certification export, because
directories drop withdrawn models. That is correct data, not a join failure.

### 7. Traps that must NOT fire

- `24ACC636A003` and `24ACB636A003` differ by one character, share a
  manufacturer and a capacity, and **will** be proposed as a merge by blocking.
  Merging them destroys the replacement lookup.
- `24ACC636A003` and `NWA1436AC1` share capacity, type, refrigerant and similar
  SEER2 — a specs-only composite key would match them. Different manufacturers.
- **No source asserts compatibility.** `compatible_with` must produce zero
  edges; any edge is a fabricated safety-relevant claim.

All three are recorded in `golden/entities.json` and `golden/relationships.json`.

## Golden records

`golden/` is the contract: 27 entities, 171 facts (169 ACTIVE + 2 SUPERSEDED),
26 relationships. Losing claims are included deliberately — a golden file that
records only winners tests half the system.

Golden files change only when the canonical model changes, **never to make a
failing test pass**, and the reason goes in `../CHANGELOG.md`.
