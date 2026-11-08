# Rights record — CMS National Average Drug Acquisition Cost (NADAC)

**Decision:** GREEN for acquisition, storage, normalization, derivation and redistribution of the NADAC weekly pharmacy acquisition prices on every surface, subject to the conditions below. Determined on 2026-11-08 under [ADR-0013](../decisions/ADR-0013-evidence-based-rights-determination.md) and [ADR-0018](../decisions/ADR-0018-free-public-data-presumed-usable.md). The basis is that the Centers for Medicare & Medicaid Services publishes the tables as open data and labels them public domain, with no login, paywall or CAPTCHA.

## Source

| | |
| --- | --- |
| Publisher | Centers for Medicare & Medicaid Services (CMS), data.medicaid.gov |
| Endpoints | `https://data.medicaid.gov/api/1/datastore/query/<dataset id>/0/download?format=csv` for each yearly table 2013 to 2026 and First Time NADAC Rates; metadata at `https://data.medicaid.gov/api/1/metastore/schemas/dataset/items/<dataset id>` |
| Reachability, 2026-11-08 | The 2026 table answered HTTP 200 with the CSV header `NDC Description, NDC, NADAC Per Unit, Effective Date, Pricing Unit, Pharmacy Type Indicator, OTC, Explanation Code, Classification for Rate Setting, Corresponding Generic Drug NADAC Per Unit, Corresponding Generic Drug Effective Date, As of Date`; metastore `modified` 2026-11-03. The 2026-11-07 round counted 1,328,578 rows with newest effective date 2026-10-28 (`evidence/2026-11-07/nadac.json`). |
| Licence field read | Metastore `license` of the 2026 table: `https://www.usa.gov/publicdomain/label/1.0/` (2022 to 2026 tables); the 2013 to 2021 tables carry `https://www.usa.gov/government-works` (US government works). |

## Reasoning

1. **Commercial use.** US government works and the public-domain label place no restriction on commercial reuse or redistribution.
2. **Personal data.** Rows are drug packages and prices (NDC, description, per-unit cost). No natural-person data.
3. **Third-party material.** Prices are CMS survey results; drug names and NDCs are identifiers. No third-party prose.
4. **Completeness.** Every yearly table is archived whole, with its metadata, so all twelve columns are preserved in R2 even where not yet served.

## Exact fields redistributed

All twelve columns listed above, for all yearly tables 2013 to 2026 and the First Time NADAC Rates table.

## Rights cells

| Operation | Channel | State |
| --- | --- | --- |
| ACQUIRE, STORE, CACHE, NORMALIZE, DERIVE | — | ALLOW |
| Public web, search index, free and paid API, RapidAPI, MCP, bulk export | all | ALLOW for the fields above. Each channel is still enabled by its own product decision. |

## Conditions

- Attribute "Centers for Medicare & Medicaid Services, National Average Drug Acquisition Cost (data.medicaid.gov)" and show the `As of Date` of each price.
- State that NADAC is an average acquisition cost survey benchmark, not a price any pharmacy is guaranteed to pay, and not medical or pricing advice.
- Do not imply CMS endorsement.

**Re-review by:** 2027-11-08, or at once if the CMS licence label changes.
