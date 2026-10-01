# Rights record — ENERGY STAR Model Index and UPC Codes (EPA open data)

**Decision:** GREEN for acquisition, storage, normalization, derivation, and redistribution of the factual fields below, on every surface, subject to the conditions below. Determined on 2026-09-30 under [ADR-0013](../decisions/ADR-0013-evidence-based-rights-determination.md). The basis is `PUBLIC_DOMAIN_US_GOVERNMENT_WORK`, and [ADR-0018](../decisions/ADR-0018-free-public-data-presumed-usable.md) (`FREE_PUBLIC_ACCESS`) applies independently. No written permission is needed.

## Source

| | |
| --- | --- |
| Publisher | U.S. Environmental Protection Agency, ENERGY STAR program |
| Endpoints | `https://data.energystar.gov/resource/8wj2-sec8.json` (ENERGY STAR Certified Products Model Index) and `https://data.energystar.gov/resource/8edu-y555.json` (ENERGY STAR Certified Products UPC Codes), the Socrata open-data API. No login, key or CAPTCHA. |
| Size, 2026-09-30 | Model Index: 1,796,876 models in 47 product categories (Central Air Conditioners and Air Source Heat Pumps 1,751,701). UPC Codes: 38,993 rows. |
| Refresh | The API reports `X-SODA2-Truth-Last-Modified: Wed, 30 Sep 2026 13:30:27 GMT`, and the program updates it at least daily. |
| Licence | <https://edg.epa.gov/EPA_Data_License.html>, retrieved 2026-09-30T14:31Z, SHA-256 `deff40a15da6593a56f4c3bf4a975b1430c809635d382da95cb9dbd3da4ef052`. The dataset metadata (`/api/views/8wj2-sec8.json`) names this licence and "U.S. Environmental Protection Agency" as publisher. |

## Evidence, verbatim

From the EPA data licence:

> Unless otherwise specified, all data produced by the U.S EPA is by default in the public domain and is not subject to domestic copyright protection under 17 U.S.C. § 105.

## Reasoning

1. **Copyright.** The listing is compiled and published by EPA, a US federal agency. The factual fields (brand, model number, category, dates, markets, UPC) are facts in any case.
2. **Commercial use.** The licence places no limit on commercial use. The data is offered free through an open API with no account, which also satisfies ADR-0018.
3. **Partner-filed values.** Model numbers and UPCs are filed by manufacturers but published by EPA as program data. Only factual identifiers are redistributed, never partner marketing text or images.
4. **Marks and endorsement.** The ENERGY STAR name and mark are registered marks. The name is used only descriptively ("listed in EPA ENERGY STAR data as of <date>"). The logo is never shown, and nothing implies EPA endorsement.
5. **Personal data.** None. Every field describes a product or a partner company.
6. **Access.** The documented open-data API with an identifying User-Agent, paged requests and at least 2 s between requests.

## Exact fields redistributed

| Dataset | Fields |
| --- | --- |
| Model Index | `pd_id`, `energy_star_partner`, `product_category`, `product_type`, `brand_name`, `model_name`, `model_number`, `additional_model_information`, `upc`, `date_available_on_market`, `date_certified`, `markets`, `energy_star_model_identifier`, `meets_most_efficient_criteria` |
| UPC Codes | `pd_id`, `product_program_category`, `product_type`, `brand_name`, `model_name`, `model_number`, `upc`, `energy_star_model_identifier`, `meets_most_efficient_criteria` |
| Derived by Data Foundry | normalized brand and model keys, check-digit-valid GTINs, category taxonomy, listing status (`listed` / `no longer listed`), links to recalls (declared GTIN links only; brand and model links go to review) |

## Measured on 2026-09-30

- Every one of the 1,796,876 rows carries `brand_name`, `model_number`, `model_name`, `date_certified`, `date_available_on_market`, `energy_star_model_identifier` and `energy_star_partner`. `markets` is missing on 1 row. `upc` is present on 12,282 rows.
- UPC Codes: all 38,993 rows carry a UPC. 37,686 (96.65%) pass the GTIN check digit. Of the failures, 952 are 11-digit codes, most likely UPC-A with the leading zero dropped, and 88 are 10-digit. Only check-digit-valid GTINs may link automatically.

## Rights cells

| Operation | Channel | State |
| --- | --- | --- |
| ACQUIRE, STORE, CACHE, NORMALIZE, DERIVE | — | ALLOW |
| Public web, search index, free and paid API, RapidAPI, MCP, bulk export | all | ALLOW for the fields above. Each channel is still enabled by its own product decision. |

## Conditions

- Label facts "listed in EPA ENERGY STAR data as of <date>". A model absent from a later snapshot is "no longer listed", not "never certified".
- No ENERGY STAR logo, and no implied EPA endorsement. The attribution below is shown on every carrying surface.
- Sync at least daily while served.

## Attribution carried

"U.S. EPA ENERGY STAR certified-product data via data.energystar.gov. Not affiliated with or endorsed by EPA."

**Re-review by:** 2027-09-30, or at once if the licence page or dataset metadata changes.
