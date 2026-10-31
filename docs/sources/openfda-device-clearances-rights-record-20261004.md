# Rights record — openFDA device 510(k), PMA and classification (FDA device clearances)

**Decision:** GREEN for acquisition, storage, normalization, derivation, and redistribution of the openFDA `device/510k`, `device/pma` and `device/classification` records on every surface, subject to the conditions below. Determined on 2026-10-04 under [ADR-0013](../decisions/ADR-0013-evidence-based-rights-determination.md). The bases are the openFDA CC0 1.0 dedication and `PUBLIC_DOMAIN_US_GOVERNMENT_WORK` (17 U.S.C. § 105); [ADR-0018](../decisions/ADR-0018-free-public-data-presumed-usable.md) (`FREE_PUBLIC_ACCESS`) applies independently. No written permission is needed. The same terms underpin the live [openFDA enforcement rights record](openfda-enforcement-rights-record-20260926.md).

## Source

| | |
| --- | --- |
| Publisher | U.S. Food and Drug Administration (Center for Devices and Radiological Health) |
| Endpoints | `https://api.fda.gov/device/{510k,pma,classification}.json` (no key) and the bulk partitions listed by `https://api.fda.gov/download.json` (`https://download.open.fda.gov/device/...`). No login, key or CAPTCHA. |
| Reachability, 2026-10-04 | `download.json` 200. Export date 2026-10-02: 510(k) 176,223 records (one 237.82 MB zip), PMA 57,183 (21.10 MB), classification 7,094 (3.12 MB). Device adverse events (MAUDE) 26,136,889 records in 371 quarterly partitions (export 2026-09-28), not archived by this record. |
| Refresh | Weekly export dates observed (`export_date` 2026-10-02). |
| Terms retrieved | <https://open.fda.gov/terms/> 2026-10-04, page SHA-256 `8b12501c3c85266721f6e2220323922cbe86f2080a25eaf266a84b1c1fc4aae0`. |

## Evidence, verbatim

From openFDA "Terms of Service", Data Rights and Usage:

> Unless otherwise noted, the content, data, documentation, code, and related materials on openFDA is public domain and made available with a Creative Commons CC0 1.0 Universal dedication.

## Reasoning

1. **Copyright.** FDA staff records of clearance and approval decisions are § 105 works, and openFDA dedicates the API content to the public domain (CC0).
2. **Commercial use.** The terms state no limit on commercial use or redistribution. The endpoints are free and open.
3. **Personal data.** 510(k) and PMA records name applicants (companies) and contact names in some fields. Contact names, street addresses and telephone numbers are not redistributed.
4. **Third-party material.** The 510(k) summary PDFs on accessdata.fda.gov may reproduce applicant text or images. They are acquired only for deterministic extraction of identifiers and indications; the PDFs are not republished.
5. **Access.** The bulk partitions and the API only, identifying User-Agent, at most 2 requests a second.

## Exact fields redistributed

| Source | Fields |
| --- | --- |
| `device/510k` | `k_number`, `device_name`, `applicant`, `decision_code`, `decision_date`, `date_received`, `clearance_type`, `product_code`, `advisory_committee`, `advisory_committee_description`, `review_advisory_committee`, `statement_or_summary`, `third_party_flag`, `expedited_review_flag`, `openfda` (registration, `device_class`, `regulation_number`) |
| `device/pma` | `pma_number`, `supplement_number`, `applicant`, `trade_name`, `generic_name`, `product_code`, `decision_code`, `decision_date`, `date_received`, `advisory_committee`, `supplement_type`, `supplement_reason`, `ao_statement` |
| `device/classification` | `product_code`, `device_name`, `device_class`, `regulation_number`, `medical_specialty`, `definition`, `implant_flag`, `life_sustain_support_flag`, `third_party_flag` |
| Derived by Data Foundry | predicate K-numbers and indications for use extracted deterministically from summary PDFs; normalized applicant keys; the product-code and regulation-number join |

## Rights cells

| Operation | Channel | State |
| --- | --- | --- |
| ACQUIRE, STORE, CACHE, NORMALIZE, DERIVE | — | ALLOW |
| Public web, search index, free and paid API, RapidAPI, MCP, bulk export | all | ALLOW for the fields above. Each channel is still enabled by its own product decision. |

## Conditions

- Carry the attribution: "Source: U.S. Food and Drug Administration via openFDA. Structured by Data Foundry. Not endorsed by FDA." State the retrieval date.
- A clearance is not a recommendation: serve the decision and date only, with a note that FDA clearance does not mean a device is safe or effective for every use, and that the data must not be used for medical decisions.
- No contact names, street addresses or telephone numbers. No FDA seals or logos.
- Do not republish summary PDFs.

**Re-review by:** 2027-10-04, or at once if the openFDA terms change.
