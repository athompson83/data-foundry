# federal-register-obligations: rights measurements, 2026-10-03

User-Agent `data-foundry-scout (data@mail.proviciency.com)`. Rights record: `docs/sources/federal-register-obligations-rights-record-20261003.md`.

| Check | Result |
| --- | --- |
| FR `documents.json`, RULE, 2025-10-01..2026-09-30, `per_page=1000` | 200, count 2,727, 3 pages (1.49 MB page 1). Monthly files are single page: Oct 2025 99, Dec 2025 232, Mar 2026 201. |
| FR fields, first 1,000 rules | `effective_on` 905, `dates` 992, `abstract` 992, `docket_ids` 908, `regulation_id_numbers` 590, `correction_of` 3, `cfr_references`/`citation`/`full_text_xml_url` 1,000 |
| eCFR `titles.json` | 200, up to date as of 2026-10-01 |
| eCFR `versions/title-40.json?part=84` | 200, 122 versions; `full/` returns 406 without `Accept-Encoding` gzip |
| eCFR `structure/2026-10-01/title-40.json` | 200, 9.4 MB |
| GovInfo `bulkdata/FR` and `2026/09/FR-2026-09-30.xml` | 200, 4,932,804 bytes, Vol. 91 No. 188 |
| FederalRegister.gov / eCFR.gov HTML and developer docs | redirect to `unblock.federalregister.gov` CAPTCHA; not used |
| GovInfo policies page | 200; § 105 notice quoted in the rights record |

Snapshot plan: 12 monthly FR rule-metadata files plus the GovInfo notice (not Socrata paging, which `snapshot-source.sh` assumes, so one request per month with brackets percent-encoded).
