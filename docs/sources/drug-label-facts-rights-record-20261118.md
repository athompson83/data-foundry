# Rights record — FDA drug label facts (`drug-label-facts`)

**Decision:** AMBER, permitted with conditions, for acquisition, storage, normalization, derivation and redistribution of structured facts extracted from FDA-published prescription drug labelling (Structured Product Labeling) on every surface, subject to the conditions below. Determined on 2026-11-18 under [ADR-0013](../decisions/ADR-0013-evidence-based-rights-determination.md) and [ADR-0018](../decisions/ADR-0018-free-public-data-presumed-usable.md). Legal bases: `OPEN_LICENSE` (openFDA publishes the dataset under a CC0 1.0 dedication "unless otherwise noted") together with `FREE_PUBLIC_ACCESS` (open API and bulk files with no login, paywall or CAPTCHA). The verdict is AMBER rather than GREEN because the openFDA terms carve out "copies of copyrightable works made available to the FDA by private entities", and label text is written by the sponsor; the product design below keeps to facts, short evidence spans and links.

`reviewed_by`: Data Foundry evidence-based determination (ADR-0013).

## Source

| | |
| --- | --- |
| Publishers | US Food and Drug Administration (openFDA drug label endpoint); US National Library of Medicine (DailyMed, the official SPL distribution) |
| Endpoints | `https://api.fda.gov/drug/label.json` (query API; bulk JSON listed at `https://api.fda.gov/download.json`: 14 partitions, about 1,788 MB zipped, export 2026-11-17), `https://dailymed.nlm.nih.gov/dailymed/services/v2/` (set id and version lookups), DailyMed release files under `https://dailymed-data.nlm.nih.gov/public-release-files/` (full `dm_spl_release_human_rx_part*.zip`, monthly, weekly and daily updates) |
| Reachability, 2026-11-18 | openFDA `meta.last_updated` 2026-11-17; 264,879 labels, 37,490 with `openfda.product_type` `HUMAN PRESCRIPTION DRUG` (declared User-Agent, no key). The DailyMed download page lists daily update files for 2026-11-16 and 2026-11-17. |
| Terms retrieved, 2026-11-18 | <https://open.fda.gov/terms/> (130,897 bytes, SHA-256 `b11f712bfb11d03319675fc04e6948133a83c57aa2913b7f18d3677d0209f723`); <https://www.nlm.nih.gov/web_policies.html> (43,526 bytes, SHA-256 `c8b7026b5c3fcfd1b0cb88755077f6a99a5f2159eecd42b0e7d1a5ad9b30ec55`). Every sentence quoted below was matched verbatim in the page as served; the wording is unchanged from the 2026-09-27 reading in [`research-2026-09-27.md`](pipeline/research-2026-09-27.md). |
| Evidence | [`pipeline/evidence/2026-11-18/druglabel_rights.py`](pipeline/evidence/2026-11-18/druglabel_rights.py) and its output `druglabel_rights.json` (9 requests) |

## Evidence, verbatim (2026-11-18)

openFDA terms of service:

- "Unless otherwise noted, the content, data, documentation, code, and related materials on openFDA is public domain and made available with a Creative Commons CC0 1.0 Universal dedication."
- "Some data on openFDA may not be public domain, such as copies of copyrightable works made available to the FDA by private entities."
- "FDA may make these works available under the fair use provision of the Copyright Act or as a result of regulatory directives. Therefore, your rights to use those works may be similarly limited."

openFDA API response metadata (`meta.disclaimer` on every drug label response): "Do not rely on openFDA to make decisions regarding medical care."

NLM web policies (DailyMed):

- "Works produced by the U.S. government are not subject to copyright protection in the United States"
- "Transmission or reproduction of copyrighted items (beyond that allowed by fair use as defined in the U.S. copyright laws) requires the written permission of the copyright holders."

## Measured copyright exposure (2026-11-18)

In the 100 newest prescription labels by `effective_time` (20261112 to 20261123), 14 carry a sponsor copyright notice ("All rights reserved", a © or a dated copyright line). By section, the notices sit in `how_supplied` (6), `storage_and_handling` (5), `information_for_patients` (4), unclassified sections (4) and `spl_medguide` (3). **None** is inside a section the product extracts facts from (boxed warning, contraindications, pregnancy, use in specific populations, drug interactions, dosage forms and strengths, indications and usage): 0 of 100. The same count on 2026-09-27, over a different sample of 100 labels, was also 14. Set ids are in `druglabel_rights.json`; no label text is committed.

## Reasoning

1. **Permission.** The openFDA dataset is dedicated CC0 unless otherwise noted, and neither publisher's terms forbid commercial reuse or redistribution. Both are open with no login, paywall or CAPTCHA (ADR-0018).
2. **Third-party copyright.** Labelling is written by the sponsor and submitted to FDA under 21 CFR 201.56 and 201.57; FDA and NLM publish it by regulatory directive. The terms say rights in such copies "may be similarly limited", so the determination does not rest on CC0 for verbatim label text. It rests on the product shape: facts are not copyrightable expression, and each fact carries only a short evidence span (at most one sentence or one table row) with a link to the DailyMed label. Medication guides, patient package inserts and instructions for use, where sponsor notices concentrate, are excluded entirely.
3. **Personal data.** Labels name companies, not natural persons. No hard stop.
4. **Marks and images.** Proprietary drug names appear as identifying facts with the labeller named. Label images (carton and container artwork, structural formulae) are never cached or served (AGENTS.md rule 9).
5. **Medical context.** The openFDA disclaimer says not to rely on the data for medical care. Every surface repeats that the facts are a retrieval aid, not clinical advice, and links the current label.
6. **Rate limits and robots.** openFDA allows 240 requests a minute and 1,000 a day per IP without a key; acquisition uses the bulk JSON files and DailyMed release zips, not paged API crawling.

## Exact fields redistributed

| Field | Source |
| --- | --- |
| `set_id`, SPL `id` and version, `effective_time`, labeller (organisation) name, proprietary and established names, product type, route, application number, NDC product codes, RxCUI, UNII | openFDA label record and its `openfda` block; DailyMed set id |
| Boxed warning: present or absent, heading, typed risk statements, each with one evidence sentence | `boxed_warning` |
| Contraindications: typed items (condition, co-medication, hypersensitivity), each with one evidence sentence | `contraindications` |
| Pregnancy and lactation: risk summary classification and one evidence sentence each | `pregnancy`, `use_in_specific_populations` |
| Drug interactions: interacting agent, action (avoid, adjust dose, monitor), one evidence sentence or table row | `drug_interactions` |
| Dosage forms and strengths: typed form, strength and unit | `dosage_forms_and_strengths` |
| Indication headline (first sentence) | `indications_and_usage` |
| DailyMed label URL `https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=<set_id>` | derived |

Not redistributed: verbatim section text beyond the evidence span; medication guides, patient package inserts, instructions for use and patient counselling sections; `how_supplied` and `storage_and_handling` prose; label images; any bulk export of label text.

## Rights cells

| Operation | Channel | State |
| --- | --- | --- |
| ACQUIRE, STORE, CACHE, NORMALIZE, DERIVE | — | ALLOW. The raw label is archived as published in the access-restricted raw bucket (rule 10) and is never served. |
| `PUBLIC_WEB`, `SEARCH_INDEX` | web | ALLOW for the fields above. Indexable pages remain subject to rule 8. |
| `API_FREE`, `API_PAID`, `RAPIDAPI`, `MCP` | machine | ALLOW for the fields above with the attribution and disclaimer. `include=raw` is refused for this dataset, because the raw record is the sponsor's text. |
| `BULK_EXPORT` | bulk | ALLOW for facts, identifiers and evidence spans. Bulk verbatim label text is refused. |

Each channel is still enabled by its own product decision.

## Conditions and how each is met

| Condition | How the product meets it |
| --- | --- |
| Sponsor copyright in label text | Facts plus one-sentence evidence spans plus a DailyMed link. No verbatim sections, no `include=raw`, no bulk text. |
| Sections with sponsor notices | Medication guides, patient package inserts, instructions for use, how-supplied and storage sections are excluded from extraction and from every surface. |
| Not for medical decisions | Disclaimer on every response, page and bulk manifest: "Structured by Data Foundry from FDA-published labelling. Not endorsed by FDA or NLM. Not medical advice; consult the current label." |
| Attribution | "Source: FDA Structured Product Labeling via openFDA and DailyMed (US National Library of Medicine)." NLM asks for the phrase "Courtesy of the National Library of Medicine" where its government works are reproduced. |
| Currency | Daily DailyMed update files; each record shows its label `effective_time` and SPL version, and a superseded version is marked as such. |
| Images | Never acquired into served storage or republished. |

**Re-review by:** 2027-11-18 (`next_review_at`), or at once if the openFDA terms or the NLM web policies change.
