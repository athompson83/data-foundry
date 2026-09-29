---
title: "FDA Recall API: openFDA enforcement reports, structured"
description: "What openFDA enforcement reports contain, which fields Data Foundry extracts from their prose, and a real request to the recall API, with its limits."
publishedAt: "2026-09-27"
updatedAt: "2026-09-29"
author: "Data Foundry"
dataset: fda-recalls
---

FDA publishes food, drug and medical-device recalls as enforcement reports, and openFDA serves those reports as JSON under a CC0 public-domain dedication. The catch is that the fields you would filter on are prose: which states a product went to, which lots are affected, which barcode is on the pack. Data Foundry's FDA Recall Intelligence API parses that prose with deterministic rules and returns lots, GTINs, NDCs, states, quantities and reasons as fields. Every record carries its provenance, and the verbatim FDA record is one parameter away.

This piece shows what the source looks like, what we extract, one real request, and where the parser stops.

## What is an FDA enforcement report?

When a firm recalls a product, FDA classifies the recall (Class I is the most serious, then II and III) and publishes an enforcement report. openFDA exposes them at three endpoints, one per product type: `food/enforcement.json`, `drug/enforcement.json` and `device/enforcement.json` on `api.fda.gov`.

Each report has a recall number, status, classification, the recalling firm and its address, key dates, and several free-text fields. Here is part of a real one, recall `H-1331-2026`, exactly as openFDA returns it:

```json
{
  "recall_number": "H-1331-2026",
  "status": "Ongoing",
  "classification": "Class I",
  "recalling_firm": "EURO FOODS GROUP USA NJ INC",
  "product_description": "Crown Farms Dried Suri Cut, 200 gm, in plastic pack, 25 packages per box, keep frozen",
  "product_quantity": "53 boxes",
  "reason_for_recall": "The firm imported and distributed dried ribbon fish that was not properly eviscerated prior to drying.",
  "distribution_pattern": "The adulterated product was distributed to the following states: VA, NY, NJ, MI",
  "code_info": "BATCH NO: 130 EF, 146 EF SERIAL NUMBER: 5055192640140 PRODUCT CODE: 28DSUM",
  "report_date": "20260916"
}
```

Everything a warehouse or pharmacy system needs to match against its stock is in `code_info` and `distribution_pattern`, as one string each.

## What does Data Foundry structure from it?

The parser is plain code, not a model, and it is conservative: a code is reported only when an explicit marker, a recognised layout or a valid check digit supports it.

| From FDA text | Structured field | Rule |
| --- | --- | --- |
| `distribution_pattern` | `distribution.us_states`, `countries`, `nationwide_us`, `international` | US states and territories as USPS codes; countries as ISO 3166-1 alpha-2 codes |
| `product_quantity` | `quantity.items`, `total`, `unit` | Amounts and their units |
| `code_info`, `more_code_info`, `product_description` | `codes.gtins` | UPC, EAN, GTIN and UDI-DI values with a valid GS1 check digit, normalised to 14 digits |
| the same | `codes.ndcs` | National Drug Codes in a recognised segment layout, normalised to 5-4-2 |
| the same | `codes.lots`, `serial_numbers`, `model_numbers` | Only after an explicit marker such as "Lot", "Batch" or "Serial" |
| the same | `codes.expiration_dates` | Only after an expiry phrase such as "Exp" or "Best by" |
| `reason_for_recall` | `reason.classes`, `allergens`, `pathogens` | Reason classes, the nine major allergens and named pathogens |

Every lot, GTIN, NDC, serial and model number goes into an exact-match index, so a lookup is a key match rather than a text search.

## What does a request look like?

Ask for one recall by its FDA number. Data requests need a key in the `Authorization` header:

```bash
curl "https://api.data.aroqon.com/v1/recalls/H-1331-2026" \
  -H "Authorization: Bearer $DATA_FOUNDRY_KEY"
```

The response below is trimmed to the fields discussed here; `…` marks what was cut.

```json
{
  "data": {
    "recall_number": "H-1331-2026",
    "category": "food",
    "classification": "I",
    "status": "Ongoing",
    "firm": { "name": "EURO FOODS GROUP USA NJ INC", "city": "Totowa", "state": "NJ", … },
    "dates": { "initiated": "2026-08-01", "classified": "2026-09-04", "reported": "2026-09-16", "terminated": null },
    "distribution": {
      "nationwide_us": false,
      "international": false,
      "us_states": ["MI", "NJ", "NY", "VA"],
      "countries": [],
      …
    },
    "quantity": { "items": [{ "value": 53, "unit": "boxes" }], "total": 53, "unit": "boxes" },
    "codes": {
      "gtins": ["05055192640140"],
      "ndcs": [],
      "lots": ["130EF", "146EF"],
      "serial_numbers": ["5055192640140"],
      "model_numbers": [],
      "expiration_dates": []
    },
    "reason": { "classes": [], "allergens": [], "pathogens": [] },
    "provenance": {
      "source": "openfda-enforcement",
      "source_url": "https://api.fda.gov/food/enforcement.json?search=recall_number:%22H-1331-2026%22",
      "parser_version": "recall-structuring@2",
      "raw_sha256": "…",
      …
    }
  },
  "attribution": {
    "source": "U.S. Food and Drug Administration enforcement reports via openFDA (https://open.fda.gov)",
    "license": "CC0 1.0 Universal (public domain) — https://open.fda.gov/license/",
    "disclaimer": "…"
  }
}
```

Three things happened to `code_info`. "130 EF" became the lot `130EF`, because a short letter suffix separated by a space belongs to the code before it; lookups ignore internal spaces for the same reason. The 13 digits FDA labelled as a serial number are kept as a serial, and they also appear as a GTIN, because they end in a valid EAN-13 check digit. The parser reports both readings rather than guessing which one the firm meant.

To go the other way, from a code on a shelf to its recalls, use the lookup endpoint. It tries every exact reading of the code (GTIN, NDC, lot, serial, model) and says which one matched:

```bash
curl "https://api.data.aroqon.com/v1/recalls/lookup?code=130EF" \
  -H "Authorization: Bearer $DATA_FOUNDRY_KEY"
```

Its results include `H-1331-2026` with `"matched_on": [{ "kind": "lot", "value": "130EF" }]`, plus `total_matches` and `truncated` so you know whether you saw everything. The same record is public at [its recall page](/recalls/H-1331-2026), and every parameter is in the [API documentation](/docs).

## Where does the parser stop?

The example shows two limits honestly. `PRODUCT CODE: 28DSUM` is not captured in any field, because "product code" is not one of the markers the parser trusts. And `reason.classes` is empty: "not properly eviscerated" matches none of the reason-class rules. Derived fields can be incomplete like this, so every response can include the verbatim FDA record: add `include=raw`, and the API serves it only after checking it against the stored SHA-256 (`raw_sha256`).

Freshness has two parts. We check openFDA every six hours, but how recent the newest report is depends on when FDA publishes. `GET https://api.data.aroqon.com/v1/recalls/stats` needs no key and reports both. On 2026-09-29 it showed 87,503 recalls (29,461 food, 17,986 drug, 40,056 device), a latest FDA report date of 2026-09-23 in each category, and 164,170 distinct GTINs, 22,597 NDCs and 1,591,751 lots in the index.

The data is not medical, legal or regulatory advice. Do not rely on it to make decisions regarding medical care, and confirm against FDA's own recall notice before acting.

## Is openFDA alone enough?

Sometimes. openFDA is free, official and needs no account, and if a text search over its fields answers your question, use it directly. What it does not do is split `code_info` into lots, GTINs and serials, or `distribution_pattern` into states, which is what a stock or listing match needs. That parsing is the work this API does.

## Attribution, rights and plans

Recall data: U.S. Food and Drug Administration enforcement reports via [openFDA](https://open.fda.gov), dedicated to the public domain under [CC0 1.0](https://open.fda.gov/license/). openFDA asks that users credit it, and we do on every page and in every data response. Data Foundry is not affiliated with or endorsed by FDA.

The Evaluate plan is free for 100 requests a month; paid plans are $49, $149 and $299 a month for 5,000, 25,000 and 75,000 requests. A plan stops at its allowance with HTTP 429 and never bills overage, and `/v1/recalls/stats` and `/v1/account` do not count. Keys come from [the pricing section](/#pricing).
