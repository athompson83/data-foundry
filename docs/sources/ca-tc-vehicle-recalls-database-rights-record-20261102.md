# Rights record — Transport Canada Vehicle Recalls Database (VRDB)

**Decision:** AMBER (attribution) for acquisition, storage, normalization, derivation and redistribution of the VRDB recall records on every surface, subject to the conditions below. Determined on 2026-11-02 under [ADR-0013](../decisions/ADR-0013-evidence-based-rights-determination.md) and [ADR-0018](../decisions/ADR-0018-free-public-data-presumed-usable.md). The basis is the Open Government Licence – Canada, which Transport Canada applies to the dataset on open.canada.ca, and free open access (no login, paywall or CAPTCHA).

## Source

| | |
| --- | --- |
| Publisher | Transport Canada |
| Endpoints | `https://opendatatc.tc.canada.ca/vrdb_full_monthly.csv` (full history); `https://open.canada.ca/data/dataset/1ec92326-47ef-4110-b7ca-959fab03f96d` (dataset record) |
| Reachability, 2026-11-02 | The full CSV answered HTTP 200, 204,132,096 bytes, 147,328 rows, 18,044 distinct recall numbers, recall dates 1975-01-01 to 2026-10-22 (`evidence/2026-11-02/tc_widening.json`). The sibling `vrdb_60days_daily.csv` is not needed once the full file is archived. |
| Terms retrieved | <https://open.canada.ca/en/open-government-licence-canada>, quoted verbatim in `candidates.yaml` (`ca-tc-vehicle-recalls-database`) |

## Evidence, verbatim

"You are free to: Copy, modify, publish, translate, adapt, distribute or otherwise use the Information in any medium, mode or format for any lawful purpose."

"If the Information Provider does not provide a specific attribution statement, or if you are using Information from several information providers and multiple attributions are not practical for your product or application, you must use the following attribution statement: Contains information licensed under the Open Government Licence – Canada."

## Reasoning

1. **Commercial use.** The licence permits any lawful purpose, including commercial redistribution.
2. **Personal data.** Rows describe vehicles, tires and child seats (make, model, units affected, recall text). No natural-person data was found in the 15 columns.
3. **Third-party material.** The recall text is Transport Canada's summary of a manufacturer notice; manufacturer campaign numbers are identifiers, not copied expression.
4. **Completeness.** The full CSV holds one row per recalled model, so archiving the whole file preserves every field the licence allows, including `COMMENT_ETXT`/`COMMENT_FTXT`, which are not yet served.

## Exact fields redistributed

All 15 columns: `RECALL_NUMBER_NUM`, `YEAR`, `MANUFACTURER_RECALL_NO_TXT`, `CATEGORY_ETXT/FTXT`, `MAKE_NAME_NM`, `MODEL_NAME_NM`, `UNIT_AFFECTED_NBR`, `SYSTEM_TYPE_ETXT/FTXT`, `NOTIFICATION_TYPE_ETXT/FTXT`, `COMMENT_ETXT/FTXT`, `RECALL_DATE_DTE`.

## Rights cells

| Operation | Channel | State |
| --- | --- | --- |
| ACQUIRE, STORE, CACHE, NORMALIZE, DERIVE | — | ALLOW |
| Public web, search index, free and paid API, RapidAPI, MCP, bulk export | all | ALLOW for the fields above. Each channel is still enabled by its own product decision. |

## Conditions

- Attribute "Contains information licensed under the Open Government Licence – Canada." and link the licence.
- Keep the dataset note that the VRDB excludes inconsequential or non-safety recalls; absence of a record is not evidence of safety.
- Serve bilingual text as published; where `COMMENT_FTXT` says "Translation not available", do not synthesise a translation.
- No Government of Canada logos.

**Re-review by:** 2027-11-02, or at once if the Transport Canada or OGL terms change.
