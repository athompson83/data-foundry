# Prototype — health-canada-consumer-product-recalls

Deterministic structuring of Health Canada's consumer-product recalls and alerts, from the Open Government Licence
open-data index, into the shared product-recall schema (`packages/product-recall-structuring`, parser
`product-recall-structuring@1`).

- **Snapshot:** `HCRSAMOpenData.json`, 2026-09-27: 34,131 records, of which 5,206 are "Consumer product safety" (last
  updated 1995-01-01 to 2026-09-24). Archived in R2 at `research/pipeline/2026-09-27-composites/hc_open.json`
  (15,719,914 bytes, SHA-256 `9879b641…73cb68`).
- **Runner:** `pnpm exec tsx tooling/prototypes/health-canada-consumer-product-recalls.ts <snapshot>`. 0 errors over
  all 5,206 in-scope records.
- **Golden tests:** `packages/product-recall-structuring/test/structuring.test.ts`.

## Field coverage (`coverage.json`)

| Field | Hits | Notes |
| --- | --- | --- |
| `updated_on`, `product_category` | 5,206 / 5,206 | Index fields |
| product name | 1,299 / 5,206 | `Product` is filled only on recent records |
| `hazard.text` / `hazard.classes` | 3,295 / 3,592 | `Issue` verbatim; classes also read the title |
| `remedy.classes` | 1,284 / 5,206 | From "What you should do", which is not republished |
| `joint_with.cpsc` | 352 / 5,206 | The joint-recall marker: candidate evidence, never a link |
| `identifiers.model_numbers` | 59 / 5,206 | The index rarely names models; the linked CPSC notice carries them |
| `trade_facets` | 338 / 5,206 | Same rules as CPSC |

## Linking

- A Health Canada notice links to a CPSC notice only when the CPSC notice cites its URL (a declared citation).
- Of the 352 notices with a joint marker, 302 are linked that way in this snapshot. The other 50 stay unlinked: the
  marker says a counterpart exists but does not name it.

The rights record is `docs/sources/health-canada-consumer-product-recalls-rights-record-20260927.md`.
