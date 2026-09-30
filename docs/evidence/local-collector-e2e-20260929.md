# Local collector: end-to-end re-verification, 2026-09-29

This re-runs the full path on the final PR head (`0565658`), after all review fixes. The earlier run
([2026-09-28](local-collector-e2e-20260928.md)) predates them. It ran in the same kind of environment: a cloud Linux
container (4 vCPU, 15.7 GB RAM, no GPU), **not** the owner's Windows computer.

No production resource was written. Production was only read, through the public CPSC and Health Canada feeds used for
the snapshot.

## Setup

- **Model.** Ollama 0.34.4 with `OLLAMA_NO_CLOUD=1` on `127.0.0.1:11434`, running `qwen3.5:4b` (digest
  `2a654d98e6fba55d…`), the benchmarked build. `doctor` reported the model, the runtime, the policy (the
  `cpsc-product-identifiers@1` task: enabled, GREEN, stage BUILDING, nothing refused) and both secrets present.
- **Snapshot.** All 10,027 CPSC notices, read in 15 RecallDate windows 2 s apart, and the Health Canada open-data
  file (5,206 in scope). Both counts match production.
- **Load.** The production bulk-load script, migrations `0001`–`0004` applied locally, and evidence bundles in local
  R2. Everything ran with `--local` and its own `--persist-to` directory.
- **Worker.** This branch's Worker under `wrangler dev --local` on `127.0.0.1:8787`.
- **Credentials.** A local Growth-plan customer key, issued by `/admin/reissue-key`, served as the collector's read
  key. An ingestion credential was minted by `/admin/ingest-credentials` for `cpsc-recalls` only.
- **Gates.** Intake open. Publication was first closed, as the change ships, then opened locally.

A local-setup finding, not a product defect: with only `API_ORIGIN` set, `wrangler dev` rewrote the request host to
the configured route, so `/` answered HTML and the collector correctly refused it (`unexpected content-type
'text/html'`). Setting `--local-upstream 127.0.0.1:8787` fixed the local routing. The collector retried the catalog
by itself and needed no change.

## Results

| Check | Evidence |
| --- | --- |
| Loopback only | Listening sockets 8765 (dashboard), 8787 (Worker) and 11434 (Ollama), all on `127.0.0.1` only |
| Catalog-driven | After reading the API root, the collector mapped `product-recalls` to `consumer-product-recalls-north-america` and began the CPSC backfill from the newest notice |
| Source → accepted | First acknowledged uploads about 90 s after the model loaded: 5 accepted and 2 duplicates of agency facts. For `cpsc-26794`, SKUs `LDQMFJ8D-BK/-BR/-CM/-NA/-WH` were accepted from `Description` |
| Accepted ≠ published | With publication closed, `GET /v1/product-recalls/cpsc-26794` (customer key) returned no `extracted_identifiers` |
| Authenticated API result | With publication opened on the local Worker, the same request returned the identifiers. Each carried `method: local-model-proposal+deterministic-verification`, the source field and span, the extractor version, the model and full digest, the prompt hash, the generation settings, `behaviour_sha256` `6b6ead48…` and the runtime. `lookup?code=ldqmfj8d-bk` returned `cpsc-26794`, with `matched_on: extracted_model LDQMFJ8DBK` |
| Retention | The outbox table stayed empty: acknowledged uploads are deleted, and `acked` is only a counter. Notice text on disk was the waiting backlog only, 0.1–0.4 MB |

## Unattended run

After the start command, the collector ran with no input. It was sampled every five minutes:

| UTC | Extracted | Queued | Skipped (no label or code) | Server: accepted | Server: agency duplicates | Outbox rows | Notice text on disk |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 22:06 | 9 | 57 | 34 | 5 | 5 | 1 pending | 0.1 MB |
| 22:11 | 21 | 89 | 65 | 25 | 21 | 0 | 0.2 MB |
| 22:16 | 36 | 123 | 91 | 27 | 34 | 0 | 0.3 MB |
| 22:21 | 44 | 151 | 130 | 48 | 40 | 0 | 0.4 MB |

- **Throughput.** About 145 notices an hour were extracted, plus the notices skipped without a model call.
- **Local database at 22:21 UTC.** 48 accepted identifiers across 9 notices.

## Not verified here

- **The Windows install (UA-017).**
- **A production deploy.** The `Deploy recalls Worker` workflow is blocked on the `production` environment's
  `CLOUDFLARE_API_TOKEN`, which contains a line break (UA-015). This session also has no Cloudflare credentials.
