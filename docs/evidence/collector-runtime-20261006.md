# Collector runtime verification — 2026-10-06

## Scope and isolation

Work was performed in an isolated clone under the Codex task workspace, starting at PR #90 head
`4f5d0da79bd673bea0812e502d47c83c996386fd`, based on main
`0f4949c3ea7f5b9dadd37034692e9d3eb91309a2`. The primary checkout was left untouched.
PR #88 and the separately publication-blocked paid-path candidate were not combined, released or retried.

The candidate's recalls manifest is identical to main: intake is open, extracted-identifier publication is closed.
The denied gate-opening hunk present in PR #90 was removed before publication of this repair.

## Actual Windows runtime

Read-only process/PID-file checks and the existing loopback dashboard confirm collector PID 13280 and uploader
PID 30412. The dashboard answers at `http://127.0.0.1:8765/api/status`. Neither process was replaced or duplicated.

At 2026-10-06 14:53 UTC, the status was `waiting for the request allowance`, with read and verify jobs pending,
last allowance events retrying after 3600 seconds. Counts: 8 extracted notices, 8 skipped, 25 locally accepted
candidates, 12 server-accepted identifiers, 13 agency duplicates, 6 acknowledged submissions, 0 queryable.
Those are prior output totals, not new records collected during this session. The existing read key is the
Evaluate plan described in the September 30 progress entry (100 requests/month).

No credential value was read, copied, logged, created or rotated. No subscription, paid service, persistent
access, resource limit, rights or publication permission was expanded.

## One real bounded catalog cycle

The existing dashboard's `run-now` action ran only catalog job 1. Its normal CSRF/origin checks were used without
logging the CSRF value. The existing source reader fetched the keyless API root and its two stats endpoints.

- Daily request counter: 33 before, 36 after — exactly three requests, within the existing 400/day cap.
- Completed catalog timestamp: 2026-10-06 14:58:22 UTC; event kind `catalog`.
- Hosted datasets: FDA Recall Intelligence and North American Consumer Product Recalls.
- Source freshness: FDA 12:17:26.433 UTC, CPSC 12:17:28.566 UTC, Health Canada 12:17:35.844 UTC, October 6.
- Capture plan: 1 executable CPSC identifier-extraction task, 2 permitted sources without adapters, 24 blocked.
- Read and verification work still waits on the API's 429 allowance response. No forced retry of that denied work.

This is a live catalog refresh and capture-plan output. It is not a productive extraction/upload cycle, a
Crawl4AI live-source qualification or a new published dataset. Collection resumes under the existing job policy
when the existing credential has available allowance; the gate must not be bypassed.

Ollama answers `/api/version` with 0.35.0. The publication allowlist is pinned to benchmarked `ollama/0.34.4`;
output from another runtime remains stored and unserved until that exact build is benchmarked and admitted.

## CI root cause and repair

CI run `37389577647` on PR #90 head failed only the workflow policy assertion requiring exactly one standalone
`pnpm ingestion:check`: the command had been wrapped in a multiline diagnostic script. Its job logs report
5,213 other tests passing; the independent disposable-Postgres job passed.

The repair keeps the standalone check and adds a separate failure-only diagnostic step, conditioned on that
specific check's failure and ending in `exit 1`. Regression assertions preserve every original verification
command, scope guard and failure requirement. The adapter source change also changes the generated ingestion
implementation identity; the stale artifact was regenerated rather than relaxing the identity check.

## Local verification

Pinned pnpm 9.15.4 dependencies installed from the frozen lockfile into the isolated clone. Node 24.19.0;
required hosted CI retains its Node 22 configuration. Commands below use installed entrypoints because this
restricted shell did not resolve the pnpm executable shims.

- `node node_modules/vitest/vitest.mjs run tooling/test/ci-workflow.test.ts tooling/test/ingestion-implementation.test.ts packages/acquisition/test/crawl4ai.test.ts packages/acquisition/test/conformance.test.ts` — 102/102 pass (20 workflow, 4 implementation, 22 adapter, 56 conformance).
- With existing Python 3.12 and `PYTHONUTF8=1`, `node node_modules/vitest/vitest.mjs run tooling/test/local-collector.test.ts -t 'publishes only|fingerprints every|allowlists|re-scores'` — 5/5 selected tests pass; 8 explicitly unselected.
- From `apps/local-collector`, `python -X utf8 -m unittest tests.test_collector.NetworkGuard tests.test_collector.FetchBehaviour tests.test_collector.LocalModelOnly tests.test_collector.ModelOutput tests.test_validate` — 16/16 pass, including shared acceptance vectors.
- `node node_modules/typescript/bin/tsc -p tsconfig.json` — pass.
- `node node_modules/tsx/dist/cli.mjs tooling/scripts/compile-ingestion-runtime.ts --check` — pass after regeneration.
- `node node_modules/tsx/dist/cli.mjs tooling/scripts/local-collector-policy.ts --check` — pass.

The full native Windows Python fixture suite was also attempted. It fails on existing SQLite handles left open
when temporary fixture directories are removed, plus default-codepage fixture decoding; it is not counted as
passing. Portable TypeScript assertion paths and CRLF stdout were repaired without changing acceptance rules,
model behavior, publication fingerprints or fixture cleanup protections. Required hosted Linux CI remains the
full-suite and real-Postgres release gate.

No provider deployment or productive live extraction cycle is claimed by this record. Exact hosted CI, merge,
deployment and runtime evidence must be read from the corresponding runs before release claims are made.
