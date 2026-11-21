# Prototype — equipment-energystar-model-index

Deterministic structuring of the EPA ENERGY STAR Certified Products Model Index (`data.energystar.gov` dataset
`8wj2-sec8`) and UPC Codes (`8edu-y555`) into one `equipment_model` shape (`packages/equipment-model-structuring`,
parser `equipment-model-structuring@1`).

- **Rights:** [rights record](../../../equipment-energystar-model-index-rights-record-20260930.md), GREEN (§ 105; ADR-0018).
- **Snapshot:** archived by the `Archive source snapshot` workflow (run 36878079058, 2026-10-01) at
  `data-foundry-raw-artifacts/research/pipeline/snapshots/equipment-energystar-model-index/2026-10-01/snapshot.tar.gz`
  (25,677,258 bytes, SHA-256 `e3a5c579…1b17f7`, verified by read-back). It holds `model-index.csv` (525,964,568
  bytes, 1,796,876 rows, all `pd_id` unique, read in pages by `pd_id`), `upc-codes.csv` (5,993,199 bytes, 39,108 rows),
  both datasets' metadata, the EPA licence page and `manifest.json`.
- **Runner:** `pnpm exec tsx tooling/prototypes/equipment-energystar-model-index.ts <model-index.csv> <upc-codes.csv>`.
  **0 errors over all 1,796,876 rows**, 0 duplicate source ids, 58 s.
- **Golden tests:** `packages/equipment-model-structuring/test/energy-star.test.ts` (verbatim rows; patterns, GTIN
  check digits, markets, dates, and fail-closed errors).

## Field coverage (2026-10-01 archived snapshot)

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

Of the `pd_id`s named in the UPC Codes dataset, 11,711 are in the Model Index. The others are not listed there now; they are kept in the snapshot and are candidates for the "no longer listed" status.

## Linking

Only `source_id` and check-digit-valid GTINs link automatically. GTIN against CPSC recall UPCs measured 0/1,462 on
2026-09-27 (screening); brand and model keys and patterns only propose review links (AGENTS.md rules 3 and 7).

Evidence round: [research 2026-10-01](../../research-2026-10-01.md); an independent Python assessment over the same archive
reproduces the GTIN (11,719), rejected-UPC (886), pattern and market counts.
