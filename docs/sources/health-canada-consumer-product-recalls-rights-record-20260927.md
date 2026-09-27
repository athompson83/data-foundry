# Rights record — Health Canada consumer-product recalls (open-data index)

**Decision:** AMBER, conditions met, for acquisition, storage, normalization, derivation, free and paid direct API access, public pages and redistribution of normalized data. Determined on 2026-09-27 under ADR-0013 and the Product Owner's standing instruction: "I fully approve any available dataset that you find as long as you logically identify that there are no restrictions." Next review: 2027-03-27, or immediately if the dataset's licence on open.canada.ca changes.

## Source

| | |
| --- | --- |
| Publisher | Health Canada (Government of Canada) |
| Dataset | "Recalls and Safety Alerts", <https://open.canada.ca/data/en/dataset/d38de914-c94c-429b-8ab1-8776c31643e3>. CKAN `license_id`: `ca-ogl-lgo` (Open Government Licence – Canada), checked through the open.canada.ca API on 2026-09-27 |
| Resource | `https://recalls-rappels.canada.ca/sites/default/files/opendata-donneesouvertes/HCRSAMOpenData.json`, one of the dataset's listed resources |
| Scope | Only records with `Organization` = "Consumer product safety". Snapshot of 2026-09-27: 5,206 of 34,131 index records, last updated 1995-01-01 to 2026-09-24. SHA-256 `9879b64121511ea77bcf434de625b68c4e2a0d5c2545bce3c7cb34536573cb68` (15,719,914 bytes), archived at `data-foundry-raw-artifacts/research/pipeline/2026-09-27-composites/hc_open.json` and in `research/pipeline/2026-09-27/inputs-r2.tar.gz` |
| Refresh | The whole file every six hours |
| Licence | <https://open.canada.ca/en/open-government-licence-canada> (version 2.0), retrieved 2026-09-27 |

## Evidence, verbatim from the licence, retrieved 2026-09-27

> The Information Provider grants you a worldwide, royalty-free, perpetual, non-exclusive licence to use the Information, including for commercial purposes, subject to the terms below.

> You are free to: Copy, modify, publish, translate, adapt, distribute or otherwise use the Information in any medium, mode or format for any lawful purpose.

> You must, where you do any of the above: Acknowledge the source of the Information by including any attribution statement specified by the Information Provider(s) and, where possible, provide a link to this licence. If the Information Provider does not provide a specific attribution statement, or if you are using Information from several information providers and multiple attributions are not practical for your product or application, you must use the following attribution statement: Contains information licensed under the Open Government Licence – Canada.

> This licence does not grant you any right to use: Personal Information; third party rights the Information Provider is not authorized to license; the names, crests, logos, or other official symbols of the Information Provider; and Information subject to other intellectual property rights, including patents, trade-marks and official marks.

> This licence does not grant you any right to use the Information in a way that suggests any official status or that the Information Provider endorses you or your use of the Information.

## Conditions and how each is met

1. **Attribution.** Health Canada specifies no statement of its own, so the default applies. Every Health Canada notice page, the dataset page, the footer, the terms and the API `attribution` object say "Contains information licensed under the Open Government Licence – Canada" and link the licence.
2. **Personal information.** The "What you should do" field carries contact details (telephone numbers, email addresses and occasionally a person's name). It is read only to derive remedy classes and the joint-recall marker. It is never served on a page or in the structured record, and `include=raw` removes it. The remaining fields describe products and hazards.
3. **Third-party rights and marks.** No images, logos or crests are acquired. Brand names in product titles are used only as facts identifying the recalled product.
4. **Non-endorsement.** Pages, docs, terms and API responses state that Data Foundry is not affiliated with or endorsed by Health Canada or the Government of Canada.
5. **Canada.ca page terms.** The canada.ca terms restrict commercial reproduction of *site pages*. We never fetch or copy recall pages: only the open-data resource, which is licensed under the OGL. Pages link to the notice URL instead.

## Exact fields redistributed

| Field | Served as |
| --- | --- |
| `NID`, `Title`, `URL`, `Product`, `Issue`, `Category`, `Recall class`, `Last updated`, `Archived` | Verbatim (`source_id`, `title`, `url`, `products[].name`, `hazard.text`, `product_category`, `recall_class`, `updated_on`, `archived`) |
| Derived | `hazard.classes`, `remedy.classes` (from "What you should do"), `joint_with` (the joint-recall marker, as candidate evidence only), `trade_facets`, `identifiers.model_numbers` (from Title/Product), and linked notices (from CPSC's declared citations) |

Not served: `What you should do`, and every record of another organisation (medical devices, drugs, food and vehicles are outside this dataset).

## Rights cells

| Operation | Channel | State |
| --- | --- | --- |
| ACQUIRE, STORE, CACHE, NORMALIZE, DERIVE | — | ALLOW |
| SERVE_API_ACCESS, SELL_API_ACCESS, REDISTRIBUTE_NORMALIZED | DIRECT_CUSTOMER_API | ALLOW, with attribution |
| Public web | — | ALLOW. Health Canada notice pages are served `noindex`: the index fields alone are thin (rule 8) |
| RapidAPI, MCP, bulk export | — | Rights-permitted with attribution but **not enabled** |

## Kill switch

`PRODUCT_RECALLS_KILL_SWITCH = "1"`, shared with CPSC. See the CPSC record.
