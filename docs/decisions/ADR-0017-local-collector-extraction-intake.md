# ADR-0017 — Local collector: local-model extraction through a governed intake

**Status:** Accepted, 2026-09-28. Product Owner direction the same day: set up the Data Foundry Local Collector
(the goal document of 2026-09-28). It is to use Ollama with a free local model, starting with `qwen3.5:4b`, with
cloud inference and paid fallbacks disabled. It is to reuse the existing infrastructure, registry, rights controls,
parsers and publication path; preserve production refreshes; and never give the model database access or bypass
rights, review or production permissions.

**Relates to:** AGENTS.md rules 1–3, 5–7 and 10; ADR-0013 (evidence-based rights); ADR-0016 (consumer-product
recalls on the recalls Worker); [`docs/sources/cpsc-recalls-rights-record-20260927.md`](../sources/cpsc-recalls-rights-record-20260927.md).

## Context

- **The gap.** The consumer-product recall dataset's CPSC parser takes a model number only after an explicit
  "model" label (ADR-0016). On all 10,027 CPSC notices (2026-09-28), 6,698 have no indexed identifier. 3,642 of
  those print labelled product codes the parser does not read: item, style, SKU, part and catalog numbers,
  often in tables flattened into prose. Exact lookup by these codes is the dataset's main machine use case.
- **Deterministic rules alone are not enough.** A deterministic rule broad enough to read those tables is
  imprecise: on the dev split it reached 0.55 precision with 60 false positives, because serials, lots and UPCs
  sit in the same tables. A language model can tell the columns apart, but its output is untrusted.
- **What is deployed.** The Postgres-backed acquisition and ingestion Workers are not deployed. The live path for
  this dataset is the recalls Worker, with D1 and R2 (ADR-0016). It had no submission interface, so a new one is
  needed.

## Decision

1. **The model proposes; code decides, twice.**
   - The collector (`apps/local-collector`, Python standard library) asks a local Ollama model for
     `{value, label, field}` as schema-constrained JSON.
   - Every proposal is checked by deterministic acceptance rules: `packages/product-recall-structuring/src/identifier-candidates.ts`
     on the server, mirrored in `apps/local-collector/df_collector/validate.py` for local quarantine, with shared
     test vectors.
   - A value must be printed verbatim, on token boundaries, in an allowed field of the stored record (Title,
     Description, `Products[n].Name|Description|Model`). It must not be a date, year, phone number, measurement or
     check-digit-valid barcode.
   - It must be anchored by a product label (model, item, style, SKU, part, catalog, product, article or stock
     number), not by a lot, batch, serial, date-code, VIN, RN, UPC, model-year or recall label.
   - There is one narrow table rule. It accepts a cell when a product label precedes it in the sentence, no
     non-product label is within three words, and the value is not a range endpoint.
   - The server derives the label and the source field itself. The model's claims are hints.
2. **Single scheduling owner.** The recalls Worker's Cron remains the only acquirer and importer of CPSC and
   Health Canada. The collector reads Data Foundry's stored evidence through the authenticated API
   (`include=raw`). It never fetches the CPSC feed, so it cannot race or repeat the six-hourly sync. The collector
   owns only model extraction.
3. **Governed intake on the existing Worker.** The endpoint is `POST api.data.aroqon.com/v1/intake/product-recalls/identifiers`
   (migration `0004`), and it accepts only an **ingestion credential** (`dfi_…`, SHA-256 stored).
   - The credential is minted and revoked by an operator through `/admin/ingest-credentials`. It is scoped to
     listed sources, cannot read data, and is neither a customer key nor the admin token.
   - Submissions are refused when `COLLECTOR_INTAKE_OPEN` is not `"1"`, when the dataset kill switch is set, or
     when the source is listed in `INTAKE_WITHDRAWN_SOURCES`.
   - The submitted `raw_sha256` must equal the stored record's. The record is re-read from R2 and its digest
     verified; the checked text is never client-supplied.
   - Codes the agency parser already indexes are reported as duplicates. Everything else is inserted idempotently,
     keyed by notice, source bytes, extractor version and identifier key.
   - Each accepted candidate stores the extractor version, model and digest, prompt hash, credential and exact span.
   - Every request carries an `Idempotency-Key`, scoped to the credential. The key is reserved before any candidate is
     written: a replay returns the stored response, the same key with a different body is refused (409), and a key still
     being processed answers 503 so the client retries. The owning request refreshes its reservation before each
     notice and holds a random lease; a retry may take over only a reservation left unrefreshed for 120 s, and then
     replaces the lease, after which the earlier request can write neither candidates nor the response. Each row
     records the submission that wrote it; a submission that fails part-way is kept as a failed audit record (moved
     off its Idempotency-Key, so a retry is processed afresh), and its rows are never deleted, since a concurrent
     submission may already have replayed them.
4. **Publication is a separate gate.**
   - Accepted candidates are served only while `EXTRACTED_IDENTIFIERS_OPEN` is `"1"`, and only against each
     notice's current bytes.
   - They appear as `extracted_identifiers`, with method `local-model-proposal+deterministic-verification`, and as
     the lookup match kind `extracted_model`. They are never mixed into the agency parser's `identifiers`.
   - Only rows from a **publishable extractor build** are served: the exact extractor version, model name, full model
     digest, prompt hash and generation settings (`num_ctx`, `think`, and `num_thread` when overridden, reported by
     the collector; an override not benchmarked is stored but never served), and the inference runtime
     (`ollama/<version>`, re-read around every notice; output that straddles an upgrade is discarded) listed in
     `PUBLISHABLE_EXTRACTORS` (`apps/recalls-worker/src/intake.ts`), each with its benchmark.
     Output from any other build is stored as evidence but never served, and rows are keyed by the whole build, so
     one build never shadows another. A CI test requires the collector's own build to be on that list.
   - The build also includes the **extraction-behaviour fingerprint** (`EXTRACTION_BEHAVIOUR_SHA256`,
     `tooling/scripts/extraction-behaviour.ts`). It covers the acceptance rules in both languages (with the helpers they import, which CI checks), the extractor's
     schema, truncation and prompt assembly, the model options and the generation defaults. The collector sends its
     own fingerprint with every submission; each accepted row records it (`behaviour_sha256`) and the accepting
     Worker's (`rules_sha256`), and publication requires both to be the benchmarked one, so output from an older or
     newer collector build is kept but never served. CI fails when any of those
     files changes, until the benchmark is re-run and the constant and entry are updated in a reviewed change.
     `--score-only` suffices for a rules-only change; a prompt, schema or option change needs a full run. The
     collector computes the same fingerprint (`df_collector/behaviour.py`, pinned to the Worker's by CI) and keys its
     local build by it, so a rules change re-extracts every notice rather than leaving them unpublished.
   - The gate opens only when the pre-registered bar in
     [`apps/local-collector/benchmark/QUALITY_BAR.md`](../../apps/local-collector/benchmark/QUALITY_BAR.md) is met on
     held-out data.
   - Operators withdraw a whole extractor version with `/admin/extractions/withdraw`. Rows are kept for audit, and
     `/admin/extractions/restore` reverses the withdrawal.
5. **Local-only inference.**
   - The Ollama URL must be loopback. Cloud tags and models without local weights are refused. The model build is
     pinned by ID (`qwen3.5:4b`, `2a654d98e6fb`, Q4_K_M, Apache-2.0, weights layer
     `sha256:81fb60c7daa80fc1123380b98970b320ae233409f0f71a72ed7b9b0d62f40490`).
   - There is no fallback provider. The Windows installer sets `OLLAMA_NO_CLOUD=1` and proves a cloud model
     request is refused.
6. **Policy comes from the registry.** `apps/local-collector/policy/sources.json` is compiled from
   `candidates.yaml`, the rights record and the platform prohibited-source list (`pnpm collector:policy`). CI
   fails when it is stale. The collector and its model cannot edit it.
7. **Driven by the live catalog.** The API root lists each served dataset with its `registry` key and stats path.
   The collector reads it daily and joins it with the compiled registry (every dataset, and every source's
   acquisition status: `task`, `permitted-no-adapter` or `blocked` with reasons) into a capture plan. The plan
   covers hosted datasets' members and expansion sources from composites that share a member. A task runs only
   while its source belongs to a hosted dataset. Newly seen sources stay candidates, and adapters arrive by
   reviewed PRs. Product Owner direction, 2026-09-28: "This tool will need to be able to see what types of data
   we are hosting on Data Foundry (and refresh as needed) and then seek out and capture that data."
8. **Model choice.** Free local models only: `qwen3.5:4b` (default, benchmarked), or OpenAI's open-weight
   `gpt-oss:20b` (Apache-2.0, about 14 GB of RAM, `think: "low"`) once it passes the same benchmark. OpenAI's hosted
   API is paid and is not used. Product Owner, the same day: "We can also set it up with any OpenAI free models as
   needed."
9. **Unattended, with no lasting local copy.** Product Owner, 2026-09-28: "Make sure this stays on an autonomous
   run. It should get a large load of data into our database without keeping it locally after the work is done."
   - Every stop condition recovers by itself, and a refused credential is retried hourly.
   - Local notice text exists only while a notice is queued. Acknowledged uploads and final candidates are deleted
     at once, keeping only counts. `purge` removes the rest when the work is done.
   - The canonical copy is always Data Foundry's R2 evidence and D1 rows.
10. **Operation on the owner's Windows computer.** A per-user Scheduled Task starts the collector at logon (no wake
   timers, no power-setting changes). Start, Stop and Status launchers are provided. The dashboard is at
   `127.0.0.1:8765` only, with CSRF, origin and host checks. SQLite (WAL) holds only checkpoints and the outbox;
   it is not a second canonical store.

## Consequences

- Dataset #2 through #N extraction tasks reuse the collector, the intake pattern and the gate. Each needs its own
  task, acceptance rules, benchmark and bar.
- Production enablement needs, in order:
  1. the merged PR, then migration `0004` on D1 after a Time Travel bookmark (`enable-production.sh --migrate`). This
     comes before the deploy because the `Deploy recalls Worker` workflow refuses a pending migration. The migration only
     adds tables, so the Worker already live is unaffected;
  2. a deploy of the merge commit through that workflow, the only deployment path;
  3. an ingestion credential minted with `ADMIN_TOKEN` (`enable-production.sh --finish`);
  4. `COLLECTOR_INTAKE_OPEN = "1"`;
  5. only after the held-out bar is met, `EXTRACTED_IDENTIFIERS_OPEN = "1"`.
- Existing tables, keys, prices, sales gates and hostnames are unchanged. Migration `0004` adds tables only.
- Collection depends on the owner's computer being awake and online. Serving does not.
