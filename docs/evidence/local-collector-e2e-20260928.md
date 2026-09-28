# Local collector: end-to-end verification, 2026-09-28

Environment: this session's cloud container (4 vCPU x86_64, 15.7 GB RAM, no GPU, Linux). It is **not** the
owner's Windows computer. Ollama 0.34.4 ran with `OLLAMA_NO_CLOUD=1` on `127.0.0.1:11434`, using `qwen3.5:4b`
(ID `2a654d98e6fb`, Q4_K_M, Apache-2.0, weights `sha256:81fb60c7…0490`). The recalls Worker ran from this branch
under `wrangler dev --local` (workerd), with local D1 and R2 on 127.0.0.1:8787.

No production resource was written. Production was only read: the API root, stats and the CPSC/Health Canada public
feeds, for the snapshot.

## Setup: a faithful local replica

- **Snapshot.** All 10,027 CPSC notices were read in 29 RecallDate windows (2 s apart, identified User-Agent),
  plus the Health Canada open-data index. The counts match production (CPSC 10,027, Health Canada 5,206).
- **Load.** Loaded with the production bulk-load script (`tooling/scripts/product-recalls-bulk-load.ts`),
  migrations `0001`–`0004`, and evidence bundles in local R2.
- **Stats.** The local `/v1/product-recalls/stats` equals production's (GTIN 1,562, model 11,243 distinct keys).
- **Credentials.** A local Growth-plan customer key served as the collector's read key. An ingestion credential
  was minted through `POST /admin/ingest-credentials` (ADMIN_TOKEN).
- **Gates.** `COLLECTOR_INTAKE_OPEN=1` and `EXTRACTED_IDENTIFIERS_OPEN=0`, as the change ships.

## Results

| Check | Evidence |
| --- | --- |
| Loopback only | Listening sockets: 8765 (dashboard), 11434 (Ollama) and 8787 (Worker), all on `127.0.0.1` |
| Cloud refused | `POST /api/chat` with `gpt-oss:120b-cloud` → `{"error":"ollama cloud is disabled: remote model is unavailable"}`. The collector also refuses cloud tags and models without local weights (unit tests) |
| Catalog-driven | The collector read the API root, mapped `product-recalls` to `consumer-product-recalls-north-america`, and built the plan: 1 source with a task, 2 permitted without an adapter, 24 blocked (members plus expansion sources) |
| Source → candidate → accepted | Within 105 s of start, 5 uploads were acknowledged: 8 accepted, 3 duplicates of agency facts. Spot-checked: every accepted value is a real SKU printed in the notice, e.g. `cpsc-26794` SKU “LDQMFJ8D-BR/-CM/-WH/-BK/-NA”, `cpsc-26782` three product SKUs |
| Accepted ≠ published | Gate closed: `GET /v1/product-recalls/cpsc-26794` (customer key) had no `extracted_identifiers`, and `lookup?code=LDQMFJ8D-BK` returned 0 matches. D1 held 11 accepted rows from 6 submissions |
| Authenticated API result | Gate opened locally (held-out bar met, see `apps/local-collector/benchmark/RESULTS.md`). The same notice returned 5 `extracted_identifiers`, each with `source_field`, span, extractor version, model and weights digest. `lookup?code=ldqmfj8d-bk` returned `cpsc-26794`, `matched_on: [{kind: "extracted_model", value: "LDQMFJ8DBK"}]` |
| Collector read-back | The verify job, triggered through the dashboard's Run-now (CSRF plus same-origin), marked 11 identifiers publicly queryable |
| Replay without duplicates | All 13 acknowledged outbox rows were reset to pending (simulating lost acknowledgements) and resent with the same Idempotency-Keys. All 13 were answered from the stored response (`idempotent_replay`). Extracted rows stayed at 16. Resending one batch under a new key gave 5 × `replayed` and still 16 rows (16 distinct) |
| Recovery after interruption | `kill -9` on both the main process and the uploader mid-extraction. `status` reported not running (stale pid detected). After restart it resumed from the saved backfill cursor with 0 duplicate document rows, and extraction and uploads continued |
| Refusal after policy withdrawal | (1) `INTAKE_WITHDRAWN_SOURCES=cpsc-recalls`: the next upload was refused as `source_not_allowed` and nothing was stored. (2) Credential revoked: 401 `invalid_ingest_credential`; the uploader paused itself and kept the row pending. (3) Dataset kill switch: the API root dropped `product-recalls`, and after its catalog refresh the collector idled with "cpsc-recalls is not a member of any dataset Data Foundry hosts now" and made 0 extractions in the next 60 s |
| Graceful stop | `df_collector stop` returned in 3.1 s; no process was left running |
| Production untouched and healthy | At 17:11 UTC the production stats read CPSC 10,027 and Health Canada 5,206, last successful syncs 12:17 UTC (FDA 12:17). The next scheduled run is 18:17 |

## Final collector counters (run stopped deliberately)

- **Notices:** 31 extracted, 270 skipped (no label or code, so no model call), 399 still queued.
- **Candidates, local:** 44 accepted, 27 rejected.
- **Candidates, server:** 16 accepted, 24 duplicates of agency facts, 2 rejected during the withdrawal test, and 2
  not yet submitted (pending after the revocation).
- **Publicly queryable:** 11.

## Not verified here

- **The Windows install.** `install.ps1` and `uninstall.ps1` parse cleanly under PowerShell 7.4, but the Scheduled
  Task, `winget` and desktop shortcuts need the owner's Windows computer.
- **A production deploy.** The session has no Cloudflare credentials.
- **Elapsed stability.** The run lasted minutes, not days.
