# Data Foundry Local Collector

A small, resumable collector that runs on the operator's own computer and adds evidence-backed facts to Data
Foundry. A free local model (Ollama, `qwen3.5:4b`) **proposes** facts from unstructured notice text.
Deterministic code, then the server, **decide** whether to accept them. Decision record:
[ADR-0017](../../docs/decisions/ADR-0017-local-collector-extraction-intake.md).

Python 3.11+ standard library only. There is no paid inference, no cloud model and no paid search.

## First task: product identifiers in CPSC recall notices (`cpsc-product-identifiers@1`)

The coverage gap is measured on all 10,027 CPSC notices (2026-09-28). The agency parser indexes model numbers only
after an explicit "model" label, so 6,698 notices have no indexed identifier. Of those, 3,642 print labelled codes
such as item, style, SKU, part or catalog numbers, e.g. "The recalled item number is SA904".

```text
Data Foundry API root (live catalog: which datasets are hosted) → capture plan (registry policy)
Data Foundry API (stored CPSC evidence, include=raw)  ← the recalls Worker stays the only CPSC acquirer
  → local evidence copy (content-addressed) + retrieval log
  → cheap prefilter (label word + digit code), else "skipped" without a model call
  → local model proposes {value, label, field} as schema-constrained JSON
  → local pre-check (validate.py, the server's rules mirrored), invalid output quarantined
  → SQLite outbox (Idempotency-Key)
  → uploader process → POST /v1/intake/product-recalls/identifiers (ingestion credential)
  → server: credential scope, kill switch, source withdrawal, raw_sha256 = stored bytes,
            R2 evidence re-read and digest-checked, acceptance rules re-run, label derived, idempotent insert
  → served as `extracted_identifiers` and lookup kind `extracted_model` only while EXTRACTED_IDENTIFIERS_OPEN = "1"
  → collector reads each accepted notice back through the authenticated customer API and marks it queryable
```

Counts are kept separately: fetched → queued/skipped → extracted/quarantined → locally accepted → server
accepted/replayed/duplicate/rejected → publicly queryable. An acknowledged upload is not publication.

## Scheduling ownership

| Work | Owner |
| --- | --- |
| CPSC and Health Canada acquisition, import, six-hourly sync | the recalls Worker's Cron (unchanged) |
| Model extraction of CPSC notice text | this collector |

The collector reads Data Foundry's stored evidence, not the CPSC feed, so it never races or repeats the cloud
import. It backfills once through the API cursor in bounded pages (25 notices each, one page per due job). After
that it reads only `changed_since` its watermark, every six hours. A notice is re-extracted only when its stored
bytes (`raw_sha256`) or the extractor version change.

## Safety properties

- **Local model only.** The Ollama URL must be loopback. Cloud tags (`*:cloud`, `*-cloud`) are refused. The model
  must be in the local store with local weights and the pinned ID `2a654d98e6fb`. Requests use
  `temperature: 0`, `think: false`, a JSON schema and a bounded `num_predict`. There is no fallback provider.
  `install.ps1` sets `OLLAMA_NO_CLOUD=1` and proves the server refuses a cloud model.
- **Hostile text.** Notice text is data. The model has no tools. A proposal survives only if it is printed
  verbatim in the stored record and passes the acceptance rules. The server re-decides everything.
- **Secrets split.** The main process (source reader + model) holds only a read API key. The uploader child
  process alone reads the ingestion credential, which can submit candidates and nothing else. Neither is a
  database credential or a Cloudflare token.
- **Network.** https only. Host allowlist from the compiled policy. The platform's prohibited-domain list applies.
  DNS is resolved once and must be public unicast (no loopback, private, link-local/metadata, CGNAT, multicast), and
  the connection is pinned to that address. Every redirect hop is re-checked. Size, time and content-type limits,
  Retry-After, per-host intervals, robots.txt for source hosts, and an identifying User-Agent apply throughout.
- **Policy.** `policy/sources.json` is compiled from `docs/sources/pipeline/candidates.yaml`, the rights record and
  `packages/source-registry` (`pnpm collector:policy`; CI fails if it is stale). Unknown, disabled, RED or
  malformed fails closed. The local kill switch can only remove permission.
- **Durability.** Job leases (15 min) are recovered after a crash. Backoff uses jitter, with a retry ceiling,
  dead-letter and refused states. An outbox row is deleted only 30 days after the server's acknowledgement is
  recorded. A lost response is resent with the same Idempotency-Key and answered from the server's stored response.

## Unattended operation and local retention

The collector is built to run unattended, and to leave nothing on the computer once Data Foundry holds it.

**Unattended.** Every stop condition resolves on its own, except a revoked credential, which still retries hourly:

| Condition | What happens |
| --- | --- |
| Local model down | It waits and retries, with backoff |
| A notice the model keeps failing on | Dead-lettered after 3 attempts; the queue moves on |
| Network or 5xx errors, 429 / Retry-After, the daily request cap | Jobs back off and retry, then dead-letter at the ceiling |
| A cap reached (disk, free space) | It pauses, then resumes by itself once the sweep or the drain clears it |
| Ingestion credential refused | Uploads pause and are retried hourly, so a fixed credential resumes without anyone touching it |
| Dataset withdrawn from the live catalog | The task idles and the catalog is re-read hourly, so collection resumes when the dataset returns |
| Restart | The catalog is re-read at start-up, and work resumes from the saved cursor and outbox |

Only the pause button and the kill switch need a person to undo them.

**Retention.** Data Foundry's R2 evidence is the canonical copy, and the server re-reads it for every candidate:

- A notice's text is written locally only while it waits for the model, and deleted as soon as it is extracted or
  dead-lettered. Skipped notices are never written.
- An upload is deleted the moment the server acknowledges it. A resend is answered from the server's stored
  response.
- Candidate values are deleted once their outcome is final: rejected, a duplicate, verified queryable, or
  unverified after 7 days.
- A sweep runs every minute and also removes files orphaned by a crash.
- What stays is notice ids and hashes (so nothing is extracted twice), running counts, and bounded logs.

When the work is done:

```bash
python -m df_collector stop
python -m df_collector purge                       # refuses while uploads are still owed to Data Foundry
python -m df_collector purge --everything          # also deletes state, secrets and config
python -m df_collector purge --everything --remove-model   # and removes the model from Ollama
```

## Limits (defaults; editable in the dashboard or `collector.json`)

| Limit | Default |
| --- | --- |
| Disk used by evidence + state | 2,048 MB, then pause |
| Minimum free disk | 5,120 MB, then pause |
| Queued notices | 500 (reading pauses) |
| Outbox | 200 (extraction pauses) |
| Data Foundry API requests per UTC day | 400 (25 notices each, so the 10,027-notice backfill takes about a day; metered on the read key's plan) |
| Response size | 16 MB |
| Simultaneous model extractions | 1 |
| Per-host interval | 2 s |
| Browser sessions | 0 (no task needs a browser) |

Measured on a 4-core CPU with no GPU: a median of 12 s per notice sent to the model (p95 about 50 s). The full backfill
therefore takes on the order of a day of CPU time on such a machine. Throughput on your computer is shown in the
dashboard.

## What it collects: the live catalog

The collector does not keep its own list of datasets. Every day (and at start-up) it reads Data Foundry's live API
root, `GET https://api.data.aroqon.com/`. That lists each dataset being served with its registry key and stats path.
The collector joins it with the compiled registry policy into a **capture plan**, shown in the dashboard. The plan
covers each hosted dataset's member sources, plus *expansion* sources: members of composite datasets that share a
member with it, such as EU Safety Gate, UK OPSS or ACCC for the recall datasets. Each source gets one status:

| Status | Meaning |
| --- | --- |
| `task` | The collector captures it now (today: `cpsc-recalls` → `cpsc-product-identifiers@1`) |
| `permitted-no-adapter` | Rights and stage permit acquisition, but an adapter and intake must be built by a reviewed change |
| `blocked` | With the reason: no rights record, before PROTOTYPED, RED, or a prohibited host |

A task runs only while its source belongs to a dataset the live catalog lists. If a dataset is withdrawn, its tasks
stop. A catalog that is missing or more than 7 days old counts as unknown, and the tasks wait.

The plan does not grant permission. Moving a source from `blocked` to `permitted`, or adding an adapter, happens
through the registry and a reviewed pull request (the daily scout's job). The collector and its model never add one
themselves.

## Choosing a model

Both options are free, run locally in Ollama, and have no cloud or paid inference:

| Model | License | Download | RAM while loaded | Status |
| --- | --- | --- | --- | --- |
| `qwen3.5:4b` (default) | Apache-2.0 | 3.4 GB | ~4–5 GB | Benchmarked; pinned `2a654d98e6fb` |
| `gpt-oss:20b` (OpenAI open-weight) | Apache-2.0 | 12.9 GB | ~14 GB | Supported, not yet benchmarked |

To try `gpt-oss:20b` on a computer with 16 GB of free RAM or more:

1. Run `ollama pull gpt-oss:20b`.
2. Run the benchmark with `--model gpt-oss:20b --think low` on both splits.
3. If it meets `benchmark/QUALITY_BAR.md` and beats the default, set `model`, `model_digest` (its `ollama list` ID)
   and `"think": "low"` in `collector.json`.

The server records the model and digest on every accepted candidate, so the two models' output stays
distinguishable and can be withdrawn separately. OpenAI's hosted API is paid and is not used. Ollama `*-cloud`
models are refused.

## Install on Windows

```powershell
cd <checkout>\apps\local-collector\windows
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

The installer:

1. measures CPU, RAM, GPU (via `nvidia-smi`) and disk;
2. installs Python and Ollama with `winget` if they are missing;
3. sets `OLLAMA_NO_CLOUD=1` and the loopback `OLLAMA_HOST`, then pulls and pins the model;
4. runs `doctor` and asks for the two secrets (either can be skipped);
5. registers a per-user **Scheduled Task** at logon, which restarts after a crash and never wakes the computer;
6. adds desktop shortcuts: **Start**, **Stop**, **Status** and **Dashboard** (`http://127.0.0.1:8765/`).

It changes no sleep or power setting. Collection stops while the computer sleeps, shuts down or is offline, and
resumes from its checkpoints. The hosted API keeps serving regardless.

Secrets needed:

- `read-api-key`: a Data Foundry customer key (`rcl_live_…`) on a plan with enough monthly requests (Developer or
  above for the full backfill);
- `ingest-token`: an ingestion credential (`dfi_…`) minted by an operator with
  `POST /admin/ingest-credentials?label=<name>&sources=cpsc-recalls` (ADMIN_TOKEN). It is shown once and revoked
  with `/admin/ingest-credentials/revoke?id=`.

## Commands

```bash
python -m df_collector [--data-dir DIR] init|doctor|run|stop|status|pause|resume|kill|unkill
python -m df_collector set-secret read-api-key   # value read from stdin/prompt, never echoed
python -m benchmark.run_benchmark --sample S --gold G --out DIR --split dev|heldout [--score-only]
python -m unittest discover -s tests -t .        # also run by `pnpm test` (tooling/test/local-collector.test.ts)
```

## Benchmark

See [`benchmark/RESULTS.md`](benchmark/RESULTS.md) and the pre-registered [`benchmark/QUALITY_BAR.md`](benchmark/QUALITY_BAR.md).
The gold labels were produced blind to model output, following [`benchmark/ANNOTATION_GUIDELINES.md`](benchmark/ANNOTATION_GUIDELINES.md).
