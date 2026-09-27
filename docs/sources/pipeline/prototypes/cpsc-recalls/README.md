# Prototype — cpsc-recalls

Deterministic structuring of every CPSC recall in the Recall API into the shared product-recall schema
(`packages/product-recall-structuring`, parser `product-recall-structuring@1`).

- **Snapshot:** full Recall API list, 2026-09-27, 10,027 recalls (1973-06-08 to 2026-09-24), archived in R2 at
  `research/pipeline/2026-09-27-composites/cpsc_all.json` (27,695,909 bytes, SHA-256 `864f678c…69f9cf`).
- **Runner:** `pnpm exec tsx tooling/prototypes/cpsc-recalls.ts <snapshot>`. 0 errors over all 10,027 records.
- **Golden tests:** `packages/product-recall-structuring/test/structuring.test.ts`, on verbatim CPSC and Health Canada text.

## Field coverage (`coverage.json`)

| Field | Hits | Notes |
| --- | --- | --- |
| `published_on` | 10,027 / 10,027 | `RecallDate` |
| `title_firm` | 8,470 / 10,027 | "X Recalls …", "CPSC, X Announce …", "… Recalled by X" |
| product type | 6,904 / 10,027 | CPSC `Products[].Type` (empty on older notices) |
| `units.us` / `units.canada` | 8,335 / 1,299 | Each figure is assigned to the country named after it |
| `identifiers.model_numbers` | 3,329 / 10,027 | Only tokens after an explicit "model" label |
| `identifiers.gtins` | 473 / 10,027 | `ProductUPCs` plus description, GS1 check digit required, stored as GTIN-14 |
| `hazard.classes` | 9,514 / 10,027 | 21 classes |
| `remedy.classes` | 8,231 / 10,027 | 10 classes |
| `trade_facets` | 901 / 10,027 | Round-3 keyword rules (appliance, HVAC, plumbing and water heating, electrical, building products) |
| `cross_references.hc` | 371 / 10,027 | Health Canada notices cited in `Inconjunctions`; 342 resolve to a consumer-product notice in the Health Canada index (343 citations) |

## Precision

- **Model numbers:** 26/30 on a fresh seeded sample (`random.seed(20260927)`). A notice counts as correct only when
  every extracted token is a model number of the recalled product.
  - One error, a wattage ("rated at 1875 watts"), was fixed after the measurement; a golden test covers it.
  - The other three are numeric parts of multi-word model names ("CEROS 550", "MS 192 T", "600 PRO RMK 155"). They
    stay a known limitation: exact lookup of the full name misses, and the fragment may also match unrelated notices.
- Development samples before that measurement found the anchor matching inside fused words ("Modelsl-0332") and
  "Model Years" being read as models. Both are fixed and covered by golden tests.

## Exclusions

`ConsumerContact` and `Images` are never read. The rights record is `docs/sources/cpsc-recalls-rights-record-20260927.md`.
