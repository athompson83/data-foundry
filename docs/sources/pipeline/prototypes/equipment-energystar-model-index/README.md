# Prototype — equipment-energystar-model-index

Deterministic structuring of the EPA ENERGY STAR Certified Products Model Index (`data.energystar.gov` dataset
`8wj2-sec8`) and UPC Codes (`8edu-y555`) into one `equipment_model` shape (`packages/equipment-model-structuring`,
parser `equipment-model-structuring@1`).

- **Rights:** [rights record](../../../equipment-energystar-model-index-rights-record-20260930.md), GREEN (§ 105; ADR-0018).
- **Snapshot:** taken by `tooling/scripts/snapshot-source.sh equipment-energystar-model-index` (paged `$limit/$offset`
  by `pd_id`). The 2026-09-30 run took 3 m 24 s: `model-index.csv` 525,964,568 bytes, 1,796,876 rows (all `pd_id`
  unique, so the paging had no gaps or overlaps); `upc-codes.csv` 5,974,880 bytes, 38,993 rows. Packed, 25,676,229
  bytes. **Pending:** the R2 copy made by the `Archive source snapshot` workflow, whose object key, bytes and SHA-256
  go into `coverage.json` before the source is marked `PROTOTYPED`.
- **Runner:** `pnpm exec tsx tooling/prototypes/equipment-energystar-model-index.ts <model-index.csv> <upc-codes.csv>`.
  **0 errors over all 1,796,876 rows**, 0 duplicate source ids, 58 s.
- **Golden tests:** `packages/equipment-model-structuring/test/energy-star.test.ts` (verbatim rows; patterns, GTIN
  check digits, markets, dates, and fail-closed errors).

## Field coverage (2026-09-30 snapshot)

| Field | Hits of 1,796,876 | Notes |
| --- | --- | --- |
| `source_id`, `brand_key`, `model_name`, `product_type`, `date_certified`, `date_available` | all | |
| `model_key` | 1,796,875 | One Computers row files its model number as ` ---` |
| `model_is_pattern` | 1,576,700 | Families filed with `*`, `?` or `#` placeholders; they propose links, never match exactly |
| `markets` / Canada | 1,796,875 / 1,644,779 | 48 rows name a market outside the five mapped ones; kept verbatim |
| `gtins` | 11,719 | Check-digit-valid GTINs from the model's own `upc` plus the UPC Codes dataset |
| `rejected_upcs` | 886 | Codes that fail the GS1 check digit as printed (including 11-digit codes); kept for audit, never linked |
| `most_efficient` | 71,602 | ENERGY STAR Most Efficient |

Trades: HVAC 1,767,921; electronics 7,745; appliance 7,500; electrical 6,727; commercial food 3,709; plumbing 2,350;
lab 894; building envelope 30.

The UPC Codes dataset names 14,685 distinct `pd_id`s, of which 11,710 are in the Model Index. The other 2,975 are
not listed there now; they are kept in the snapshot and are candidates for the "no longer listed" status.

## Linking

Only `source_id` and check-digit-valid GTINs link automatically. GTIN against CPSC recall UPCs measured 0/1,462 on
2026-09-27 (screening); brand and model keys and patterns only propose review links (AGENTS.md rules 3 and 7).
