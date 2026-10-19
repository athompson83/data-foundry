# Health Canada capture adapter — 2026-10-19

## Scope and source baseline

Implement the permitted Health Canada local capture adapter on canonical `main` base
`d179f736f40f944d0602666207c025d0850a0ebb`, preserving the older dirty attached checkout.
The existing `data-foundry-recalls` Worker, D1 database `84acdedd-4d3e-457e-9bdc-3b118590e172`
and `data-foundry-raw-artifacts` bucket remain the acquisition/storage/intake path.
The pre-change provider read-back served source `0c59ad08` / version `f424ca25` at 100%.
Both identifier publication gates were `0`; the intake was `1`.

The adapter reads only Data Foundry's stored open-index evidence (`agency=HC`, `include=raw`).
Only `Title` and `Product` can supply identifiers. It neither fetches recall pages nor reads the
excluded advice/contact field into the model prompt. The existing source rights determination
and LIVE registry stage are unchanged.

## Implemented boundaries

- `health-canada-product-identifiers@1/prompt-1` has a separate prompt, build identity and
  behaviour fingerprint. The bounded model engine and deterministic code/label rules are shared.
- Source cursors, queue/build transitions, task leases and source stop controls are independent.
  One resident model worker, the outbox, resource caps and API allowance remain shared. A wait
  recorded by the older single-source collector is preserved on upgrade.
- The intake checks credential source scope, task/source consistency, current raw digest and
  R2 bytes independently, re-derives labels and records native HC field names/spans. Replays,
  stale bytes, excluded fields, source holds and wrong credentials have regression coverage.
- HC has **no publishable extractor entry**. Even an open general publication gate cannot
  publish this build. A separate HC held-out benchmark and reviewed entry are still required.
  No credential scope is expanded by the code change.
- The catalog-derived plan becomes `task: 2`, `permitted-no-adapter: 1`, `blocked: 24`.
  FDA is the remaining permitted source without a local extraction adapter. Hosted CPSC/HC
  agency acquisition continues to belong to the Worker's scheduled sync.

## Local verification

- `pnpm install --frozen-lockfile --prefer-offline`: pass, pinned lockfile unchanged.
- `pnpm typecheck`: pass.
- `pnpm collector:policy:check` and `pnpm ingestion:check`: pass.
- `PYTHON=python PYTHONUTF8=1 pnpm exec vitest run apps/recalls-worker/test packages/product-recall-structuring/test tooling/test/local-collector.test.ts -t '^(?!.*passes its Python unit tests)' --maxWorkers=2 --silent`:
  **337 pass, one explicitly excluded Windows-incompatible legacy Python-suite wrapper**, 14 files.
- `PYTHONUTF8=1 python -m unittest tests.test_health_canada` from `apps/local-collector`:
  **10/10 pass**, including reader → extraction → durable outbox, native spans, independent cursors/leases,
  source controls, shared allowance, legacy wait recovery and source-aware working-copy purge recovery.
- `python benchmark/run_benchmark.py --sample benchmark/data/sample.json --gold benchmark/data/gold.json --out benchmark/data --score-only`:
  CPSC stored predictions re-score unchanged: held-out 38 true positives / zero false positives,
  0/18 negative-notice false positives. The exact CPSC request fingerprint remains
  `64c509db6e2f46842a4e3c5a3f7ccb44d021e9cc3a1ce8dfb3f804edee294963`.
  Only the common engine's source fingerprint changes in the report. No new inference or HC
  publication qualification is claimed from that re-score.
- `pnpm exec wrangler deploy --dry-run --outdir ../../.tmp/hc-capture-worker` from `apps/recalls-worker`:
  pass; temporary owned artifacts removed after inspection.
- Real local `qwen3.5:4b`, exact model digest `2a654d98e6fba55d452b7043684e9b57a947e393bbffa62485a7aac05ee4eefd`,
  `ollama/0.40.6`, 8192 context / four CPU threads: the synthetic `Item number AB-123. Lot 998877.`
  smoke yields only `AB-123` in native field `Product`, label `item`. **Synthetic smoke, not a benchmark.**
- Isolated loopback dashboard in Chrome: the HC stop/re-enable buttons affect only HC; both tasks
  remain in the plan. No console errors; at 375×812, viewport and document widths both equal 375.
  The test tab/server were closed; the installed collector was not used for this UI test.

### Existing Windows test limitation

With UTF-8 enabled, unchanged canonical base: 107 Python tests, **60 errors / one failure**.
Candidate before the final source-control test addition: 115 tests, **the same 60 errors / one failure**.
These are SQLite file handles still open when legacy temporary directories are deleted, including
the existing purge assertion. Without UTF-8, the base also misreads a non-breaking-space vector.
The new tests explicitly close their SQLite handles and pass natively. No full native Windows
suite pass is claimed. The required complete Linux CI run remains a separate release gate.

## Release boundary

At this source checkpoint, local implementation is qualified; protected PR/main CI, provider release
and installed-collector read-back remain to be recorded. Prices, billing, publication gates,
acquisition schedules and current credentials have not changed. Productive collection still obeys
the installed read key's existing monthly allowance; no forced request, upgrade or purchase is used.
