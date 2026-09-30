# Gold annotation guideline: product identifiers in CPSC recall notices

Task `cpsc-product-identifiers@1`. For each notice, list every **product identifier** that the notice
itself presents as identifying the recalled product (or a recalled variant of it).

## Include

A code printed in the notice and labelled, or clearly presented, as one of:

| label | Examples of the label in the text |
| --- | --- |
| `model` | model, model number, model no., model # |
| `item` | item, item number, item no., item # |
| `style` | style, style number, style # |
| `sku` | SKU, SKU number |
| `part` | part number, P/N |
| `catalog` | catalog / catalogue number, cat. no. |
| `product` | product number, product code, article number, reference number, stock number |

- Copy each identifier **verbatim**, exactly as printed (same case, hyphens, spaces inside the code), one entry
  per identifier. Expand nothing: for "models 100, 200 and 300" record `100`, `200`, `300`.
- For a range written as "1234 through 1240", record only the endpoints as printed (`1234`, `1240`).
- The identifier must contain at least one digit and at least three letters or digits.
- If the same identifier appears twice, record it once.

## Exclude (these are negatives)

- lot, batch, date or production codes; serial numbers and serial ranges; VINs;
- UPC, EAN or GTIN barcodes (the dataset captures them separately);
- RN, CA, WPL, registration or certification numbers; recall or release numbers; CPSC/Health Canada numbers;
- phone numbers, addresses, prices, dates, years (including "Model Year 2021"), sizes, measurements, capacities,
  quantities, wattages, voltages;
- product names that contain a number but are not presented as a code (e.g. "Ranger XP 1000" in running text
  with no model/item/style/SKU/part/catalog/product label);
- anything you are unsure of: record it under `ambiguous` instead, with a one-line reason.

## Output

```json
{ "cpsc-15034": { "identifiers": [{ "value": "SA904", "label": "item" }], "ambiguous": [] } }
```

A notice with no qualifying identifier gets `"identifiers": []`. The annotator must not see any model output.
