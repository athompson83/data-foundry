# Sources — `hvac`

> ## ⚠️ EVERY SOURCE IN THIS VERTICAL IS SYNTHETIC
>
> All four sources describe **fictional publishers** that do not exist. Their
> domains are RFC 2606 reserved example domains (`example.com`, `example.org`)
> which resolve nowhere. The fixtures were authored by the Data Foundry team as
> test data.
>
> **No real third-party site is crawled, fetched, or contacted by any of this.**
> Running the entire pipeline against these sources makes zero network requests
> to any real host.
>
> Nothing here describes any real company's data, terms, or rights posture. See
> `RIGHTS.md` for the full disclosure.

## Why synthetic

The purpose of this vertical in Phase 1 is to prove the **factory** — that four
genuinely dissimilar sources can be declared, acquired, extracted, normalized,
resolved and published through one configuration-driven pipeline with no
vertical-specific code.

Proving that needs sources chosen for their *differences*, with known-correct
expected output. Real sources would add a rights-review dependency and an
acquisition dependency to what is fundamentally a pipeline test, and would make
the golden files unverifiable — you cannot assert the correct answer for data
you do not control.

The rights metadata on these sources is therefore **real machinery exercised on
fictional inputs**. The gates genuinely run and genuinely pass. What they
validate is our own test data.

## Source inventory

| Key | Publisher (fictional) | Type | Authority | Format | Acquisition | Rights | Status | Cadence | Models |
|---|---|---|---:|---|---|---|---|---|---:|
| `acme-hvac-catalog` | Acme Climate Systems | MANUFACTURER | 85 | JSON API | `DIRECT_HTTP` | GREEN | ACTIVE | DAILY | 6 |
| `coolsupply-distributor` | CoolSupply Wholesale | DISTRIBUTOR | 45 | HTML | `BROWSER_RUN` | AMBER | ACTIVE | WEEKLY | 5 |
| `ahri-directory-export` | Federated HVAC Ratings Council | CERTIFICATION_BODY | 95 | CSV bulk | `BULK_FILE` | GREEN | ACTIVE | QUARTERLY | 11 |
| `acme-spec-sheets` | Acme Climate Systems | MANUFACTURER | 90 | PDF | `DIRECT_HTTP` | GREEN | ACTIVE | QUARTERLY | 3 |

### On the `ahri-directory-export` key

The key and the `ahri_ref` alias type are **shared-vocabulary strings agreed
across build waves**. They name the *shape* of a certification-directory source.
The publisher is a fictional body — **not** the real Air-Conditioning, Heating,
and Refrigeration Institute — and nothing in this vertical describes that
organization's data, directory or terms.

## Source families

Independence means a different organization with a different incentive. Two
feeds from one company are **one** family with two formats.

| Family | Sources | Uniquely provides |
|---|---|---|
| Manufacturer | `acme-hvac-catalog`, `acme-spec-sheets` | Supersession/lifecycle, electrical, acoustic, weight, SKU, series |
| Certification body | `ahri-directory-export` | Certified ratings, `ahri_ref`, cross-manufacturer coverage |
| Distribution channel | `coolsupply-distributor` | UPC barcodes, independent corroboration |

**Three families from four sources.** The three-family minimum is met exactly,
not exceeded.

## Deliberate dissimilarity

The four sources differ along every axis that matters, because a factory that
only handles one shape of source is not a factory:

| Axis | Spread |
|---|---|
| Format | JSON · HTML · CSV · PDF |
| Acquisition | direct HTTP · headless browser · bulk file · direct HTTP (binary) |
| Rights | GREEN ×3, AMBER ×1 |
| Authority | 45 → 95 |
| Cadence | daily · weekly · quarterly ×2 |
| Attribution | not required ×2, required ×2 |
| Image rights | none reusable ×3, reusable + cacheable ×1 |
| Capacity unit | BTU/h ×2, tons ×2 |
| Model formatting | canonical · lowercase-hyphenated · space-separated · canonical |
| Coverage | 3 → 11 of 13 models |

---

## Per-source notes

### `acme-hvac-catalog` — JSON API feed

- **What it is:** the manufacturer's structured product feed, six models.
- **Why we need it:** the **only** source that asserts supersession. Without it
  the vertical's highest-value question is unanswerable. Also the only source of
  `manufacturer_sku` and the primary source of electrical and stage data.
- **Quirks:** capacity in BTU/h only; refrigerant unhyphenated (`R454B`);
  electrical packed into one string (`208/230-1-60`); no sound level, no UPC, no
  certification reference.
- **Known conflicts:** publishes SEER2 `14.5` for `24ACC636A003` against the
  certified `14.3`. A marketing figure, and it loses — see Conflict A.
- **Deliberately not ingested:** `list_price_usd`, `image_url`,
  `lifecycle.status`, `lifecycle.discontinued_on`. Reasons in
  `normalizers/source-mappings.yaml`.
- **Failure mode:** if the `lifecycle` block disappears, supersession stops
  updating **silently** — the existing edges remain valid, so nothing errors.
  The extraction contract test must assert the field's presence, not merely its
  parseability.

### `coolsupply-distributor` — HTML product pages, headless browser

- **What it is:** a wholesaler's catalogue, five models spanning all three
  manufacturers.
- **Why we need it:** the **only** source of UPCs. A low-authority source
  holding a high-precision identifier — which is exactly why low-authority
  sources are worth the trouble.
- **Quirks:** specs injected client-side, so a plain GET returns empty cells and
  the source cannot be acquired over `DIRECT_HTTP` at all; capacity in tons;
  model numbers lowercased and hyphenated; category buried in the marketing
  title; no EER2, HSPF2, phase, stage count or weight.
- **Known conflicts:** lists `69 dB` for `24ACC648A003` against the
  manufacturer's published `72 dB`. Loses on authority, 45 to 90 — Conflict B.
  Its `sound_level_db` reliability is consequently demoted to 0.30.
- **Deliberately not ingested:** `.spec-item-no` (the distributor's own
  `CS-######` inventory code — source-scoped, and **not** a manufacturer SKU),
  `.spec-price`.
- **Failure mode:** a layout change silently empties the spec selectors.
  Rendered-DOM extraction must fail loudly on an empty spec table rather than
  recording nulls, or the catalogue quietly loses its only UPC source.

### `ahri-directory-export` — CSV bulk file

- **What it is:** a certifying body's quarterly export, 11 models across all
  three manufacturers.
- **Why we need it:** the authority for certified performance and the **only**
  source with cross-manufacturer coverage — the backbone of comparison. Sole
  source of `ahri_ref`.
- **Quirks:** a `#` provenance preamble above the header row; **model-number
  formatting varies by manufacturer within the same file** (spaces for Acme,
  plain for Northwind, hyphenated for Borealis), which is the main workout for
  identifier normalization; empty HSPF2 cells for air conditioners, which is
  correct absence rather than missing data; no electrical, acoustic, weight or
  UPC data.
- **Coverage behaviour:** **discontinued models are dropped from every export.**
  The two superseded Acme units therefore have no certification at all, and
  back-filling them from an older export without saying so would assert a
  currently-valid certification that does not exist.
- **Known conflicts:** wins Conflict A on SEER2 against two agreeing sources.
- **Failure mode:** a column rename breaks every certified rating at once. This
  is the highest-blast-radius source in the vertical and warrants the strictest
  extraction contract test.

### `acme-spec-sheets` — PDF specification sheets

- **What it is:** engineering spec sheets, one page per model, three current
  Acme units. Generated by `fixtures/generate-acme-spec-pdf.ts` with a real text
  layer.
- **Why we need it:** the **only** source of `sound_level_db` for Acme, and the
  only source publishing tonnage and BTU/h side by side — which lets the
  `12000 BTU/h = 1 ton` conversion be *validated* against published data rather
  than trusted. Specifications buried in PDFs are worth acquiring precisely
  because PDFs resist everyone.
- **Authority note:** ranked 90 against the same publisher's JSON feed at 85. A
  spec sheet is a checked engineering document; the catalogue feed is generated
  from a merchandising system. Same publisher, different reliability — which is
  why authority is per-source, not per-publisher.
- **Quirks:** thousands separators (`36,000 BTU/h`); unit suffixes on every
  value; the combined electrical notation; model number only in the page
  heading; no efficiency ratings at all.
- **Known conflicts:** wins Conflict B on sound level.
- **Failure mode:** text-layer extraction only — no OCR path is approved. A
  scanned or re-typeset sheet would need its own acquisition decision with
  different accuracy characteristics.

## Conflicts across sources

| # | Entity | Property | Claims | Winner | Decided by |
|---|---|---|---|---|---|
| A | `24ACC636A003` | `seer2` | 14.3 (cert) vs 14.5 (mfr + distributor) | **14.3** | `authoritative_source` |
| B | `24ACC648A003` | `sound_level_db` | 72 dB (spec sheet) vs 69 dB (distributor) | **72** | `authoritative_source` |

Conflict A is the instructive one: **two sources agree and still lose to the one
that disagrees**, because corroboration is doc 04's criterion 4 and cannot
outvote authoritative source at criterion 1. The two agreeing sources are also
not independent — the distributor transcribes manufacturer data, so their
agreement is one claim counted twice.

Both losing claims are retained with full evidence and are queryable through
`get_spec_evidence`.

## Adding a real source

1. Check the family against the three-family minimum — does it add an
   *independent* family, or a second feed of one we already have?
2. Complete a rights review with a **named human** reviewer. Doc 13: the absence
   of a decision is not permission.
3. Declare it in `sources/<key>.yaml` with complete rights metadata. Start at
   `status: PROPOSED`.
4. Add a fixture in its native format, and extend `fixtures/golden/` with what it
   should produce — including any new conflicts.
5. Map it in `normalizers/source-mappings.yaml`. **This should be the only
   normalizer file you touch.** If layers 1–4 need changing, the source has
   introduced new domain vocabulary and the canonical model is changing:
   `CHANGELOG.md` entry and `schema_version` bump.
6. Run `pnpm verticals:validate`.
