---
title: "Check a lot number, GTIN or NDC against FDA recalls"
description: "How to match one scanned or typed code to FDA food, drug and device recalls with one API call, and what a match, a miss and a truncated answer each mean."
publishedAt: "2026-09-29"
author: "Data Foundry"
dataset: fda-recalls
---

To check a code against FDA recalls, send it to `GET /v1/recalls/lookup?code=<code>` on the Data Foundry recall API. The call tries every exact reading of the code (GTIN, UPC or UDI-DI, NDC, lot, serial and model number) and returns each recall that names it, newest first, with the reading that matched. A match tells you which recall to read. A miss does not tell you the product is safe.

Recalls are declared for specific production runs, so the code you match on matters as much as the product name. This piece shows what the call does with each kind of code, what the response tells you, and where an empty answer can still be wrong.

## Why match on a code instead of a product name?

A recall applies to particular lots, not to everything a firm ever sold. Names are also unreliable: the same product ships under several names and pack sizes. A check digit, an NDC or a lot number is exact, so a lookup is a key match rather than a text search.

The catch is where the codes live. openFDA publishes FDA's enforcement reports as JSON, and the lots, barcodes and NDCs sit inside free-text fields such as `code_info` and `product_description`. FDA's [openFDA documentation](https://open.fda.gov/apis/drug/enforcement/) says the drug enforcement data covers publicly releasable records from 2004 to the present and is updated weekly. Its search syntax is `search=field:term`, and one call returns at most 1,000 records. Splitting the text into searchable codes is the part you have to build yourself, or get from an API that has already done it.

## What does the lookup do with the code you send?

It reads the same string every way that is valid, then looks for exact matches:

| You send | Readings it tries | Rule |
| --- | --- | --- |
| 8 to 14 digits (UPC, EAN, GTIN, UDI-DI) | GTIN, padded to 14 digits | Only if the GS1 check digit is valid. An 8-digit UPC-E is also expanded to UPC-A and checked |
| An NDC, hyphenated or 11 digits | Package NDC (5-4-2) and its product NDC | A product NDC also finds recalls that list only some of its packages |
| Anything else, up to 64 characters | Lot, serial and model number | Spaces are ignored and letters upper-cased, so `130 EF` and `130ef` both become `130EF` |

The response lists every reading it tried under `interpreted_as`. That is useful when a code is ambiguous: a 13-digit string that is a valid EAN-13 is tried as a GTIN and also as a serial number, and each match says which reading hit.

## What does a request look like?

Data requests need a key in the `Authorization` header. The Evaluate plan is free.

```bash
curl "https://api.data.aroqon.com/v1/recalls/lookup?code=130EF" \
  -H "Authorization: Bearer $DATA_FOUNDRY_KEY"
```

The fields to read in the response:

| Field | What it tells you |
| --- | --- |
| `data[].matched_on` | Which reading matched, as a `kind` (`gtin`, `ndc`, `lot`, `serial`, `model`) and the `value` |
| `data[].recall` | The full structured recall: number, classification, status, firm, dates, states, quantity, codes and reason, with provenance |
| `total_matches` | The exact number of recalls that name the code |
| `truncated` | `true` when there are more matches than the response carries |
| `complete_results` | Ready-made `/v1/recalls?...` paths that page through every match |
| `interpreted_as` | Every reading of your code that was tried |

The lookup returns at most 100 recalls per call, 10 if you add `include=raw`. When `truncated` is `true`, follow `complete_results` instead of assuming the first page is everything.

The recall used in [our openFDA walk-through](/articles/fda-recall-api-openfda-enforcement-structured) is public: [H-1331-2026](/recalls/H-1331-2026) lists lots `130EF` and `146EF` and the GTIN `05055192640140`. A lookup for `130EF` is a lookup for that lot. It is not a lookup for that product, and the difference is the next section.

## What does a match actually mean?

Read the recall, do not stop at the match. A lot code is only unique within a manufacturer. A short code such as `130EF` can name an unrelated product at another firm, so compare `product_description` and the recalling firm with what is in your hand before you act on it. A GTIN match is stronger, because it identifies the product, but a recall can still cover only some lots of that GTIN. Compare the lot too.

## What does no match mean?

Less than you would like. Three reasons a real recall can come back empty:

1. **The code was never extracted.** The parser reports a code only when an explicit marker, a recognised layout or a valid check digit supports it. Data Foundry measured the extraction over all 87,356 records on 2026-09-26: lots for 31 to 51 percent of records, GTIN, UPC or UDI for 31 to 37 percent of food and device records, and NDC for 51 percent of drug records ([ADR-0015](https://github.com/athompson83/data-foundry/blob/main/docs/decisions/ADR-0015-first-paid-dataset-fda-recalls-on-d1.md)). The rest of the text is still in the record, but it is not in the code index.
2. **FDA had not published it yet.** openFDA is updated weekly, and a recall reaches the enforcement report only after FDA classifies it.
3. **The firm wrote the code differently.** Lookups match exact codes, so a lot with a different separator or an extra prefix will not match a shorter one.

For the first case, the API can search the text as well: `GET /v1/recalls` takes a free-text `q` and other filters, and every response can include the verbatim FDA record with `include=raw`. Treat "no known recall" as "no recall found in this index", and say that to your own users.

## How fresh is the answer?

The source is checked every six hours, but the newest report can only be as recent as FDA's own publication. [`/v1/recalls/stats`](https://api.data.aroqon.com/v1/recalls/stats) needs no key. On 2026-09-29 it showed 87,503 recalls (29,461 food, 17,986 drug, 40,056 device), the latest FDA report dated 2026-09-23 in every category, a last successful sync at 12:17 UTC that day, and 164,170 distinct GTINs, 22,597 NDCs and 1,591,751 lots in the index.

## Is openFDA on its own enough?

If you can search the field yourself, yes, and it costs nothing. openFDA allows 240 requests a minute per IP address, and 1,000 requests a day without a key, or 120,000 a day with a free one ([openFDA authentication](https://open.fda.gov/apis/authentication/)). What it does not give you is a lot, GTIN or NDC as a field. That parsing, and the exact-match index over it, is what this API adds.

## Limits, attribution and plans

This is data lookup, not medical, legal or regulatory advice. Do not rely on it for decisions about medical care, and confirm against FDA's own recall notice before acting.

Recall data: U.S. Food and Drug Administration enforcement reports via [openFDA](https://open.fda.gov), dedicated to the public domain under [CC0 1.0](https://open.fda.gov/license/). Data Foundry is not affiliated with or endorsed by FDA.

The Evaluate plan is free for 100 requests a month. Paid plans are $49, $149 and $299 a month for 5,000, 25,000 and 75,000 requests, and one key covers every dataset. A plan stops at its allowance with HTTP 429 and never bills overage. Keys come from [the pricing section](/?utm_source=data-foundry-articles&utm_medium=organic&utm_campaign=check-lot-gtin-ndc-fda-recalls#pricing), and the parameters are in the [API documentation](/docs).
