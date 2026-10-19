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
  Existing credentials are not changed by the code. Fresh provisioning now names both source
  scopes. Upgrade the installed credential's scope before starting the two-task collector:
  `source_not_allowed` is an acknowledged refusal, so a later token replacement alone does
  not replay those documents. Automated review identified and closed the old CPSC-only
  provisioning path; the installed credential's guarded update is a separate release step.
- The catalog-derived plan becomes `task: 2`, `permitted-no-adapter: 1`, `blocked: 24`.
  FDA is the remaining permitted source without a local extraction adapter. Hosted CPSC/HC
  agency acquisition continues to belong to the Worker's scheduled sync.

## Local verification

- `pnpm install --frozen-lockfile --prefer-offline`: pass, pinned lockfile unchanged.
- `pnpm typecheck`: pass.
- `pnpm collector:policy:check` and `pnpm ingestion:check`: pass.
- Documentation closeout: `pnpm exec vitest run tooling/test/cloudflare-deployment-doc.test.ts tooling/test/private-canary-provenance-doc.test.ts --maxWorkers=2 --silent`: **23/23 pass**; `git diff --check` passes.
- The first complete Linux CI attempt passed every collector/HC check but exposed an existing
  date-dependent retirement fixture: its second fixed October 18 slot was `NOT_DUE` after
  the first acquisition recorded today's database observation time. The fixture now spaces
  slots from database time by more than the configured refresh interval; production freshness
  checks are unchanged. `pnpm exec vitest run tooling/test/operations-retirement.test.ts --maxWorkers=2`:
  **13/13 pass**, independently re-run and reviewed. Failure run: `39267175579`.
- `PYTHON=python PYTHONUTF8=1 pnpm exec vitest run apps/recalls-worker/test packages/product-recall-structuring/test tooling/test/local-collector.test.ts -t '^(?!.*passes its Python unit tests)' --maxWorkers=2 --silent`:
  **337 pass, one explicitly excluded Windows-incompatible legacy Python-suite wrapper**, 14 files.
- `PYTHONUTF8=1 python -m unittest tests.test_health_canada` from `apps/local-collector`:
  **11/11 pass**, including reader → extraction → durable outbox, native spans, independent cursors/leases,
  source controls, shared allowance, legacy wait recovery and source-aware working-copy purge recovery.
  Independent review found that overdue pending jobs and expired leases could bypass a restored wait.
  The new regression failed on both paths before repair; authenticated data requests now check the
  shared hold before request counting, credential access or network I/O, including after run-now.
  Startup also reschedules legacy pending jobs to the recovered reset time.
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
Final candidate: 118 tests, **the same 60 errors / one failure**.
These are SQLite file handles still open when legacy temporary directories are deleted, including
the existing purge assertion. Without UTF-8, the base also misreads a non-breaking-space vector.
The new tests explicitly close their SQLite handles and pass natively. No full native Windows
suite pass is claimed. The required complete Linux CI run remains a separate release gate.

## Protected release and production proof

- [PR #111](https://github.com/athompson83/data-foundry/pull/111) merged as
  `4b3fe7e9cb4f1ecdb1988807549a49ad6217cbe3` after the final independent review and resolved
  provisioning finding. Candidate [CI 39278825179](https://github.com/athompson83/data-foundry/actions/runs/39278825179)
  and [exact-main CI 39283641283](https://github.com/athompson83/data-foundry/actions/runs/39283641283)
  pass **5,336 tests / 266 files**. Main real-Postgres, migrations, generated contracts and build gates pass.
  Hosted queued/stale status reads delayed the release; all gates eventually completed. No speculative
  failed-job rerun or required-gate bypass was used. Superseded candidate runs are not qualification evidence.
- [Guarded deployment 39287044697](https://github.com/athompson83/data-foundry/actions/runs/39287044697)
  serves version `827ec2ab-33a9-4eb5-8ef6-84c10b296da3` at 100%, independently read back through Cloudflare.
  Deployment annotations name the exact main source. Uploaded bundle SHA-256
  `c9c43b24858f2688b2bbaa7c4818ff1d3b99f4da41ab92a101fe1f98fef5ff89` matches the local dry-run bundle.
  Original D1 `84acdedd-4d3e-457e-9bdc-3b118590e172` and R2 `data-foundry-raw-artifacts` bindings remain.
  No migration or new infrastructure. Intake is 1; both identifier-publication flags remain 0.
- [Fresh production acceptance 39288106508](https://github.com/athompson83/data-foundry/actions/runs/39288106508)
  passes **35 checks / 14 internal metered requests**, including durable screening reopen/deletion,
  missing/unissued key rejection, exact metering and fixture revocation with subsequent 401/401/401.
  Independent D1 read confirms `acceptance-20260928` is suspended with zero active keys.
  This is technical acceptance, not paid demand or a real customer purchase.

## Credential admission and HC wiring

The existing locally matched `owner-windows-collector` credential
`ic_bcc85ab8-b572-42bf-908c-189561f398ea` was extended before the updated collector started.
The guarded update matched its ID, the locally verified token SHA-256, exact old scope
`["cpsc-recalls"]` and non-revoked status. Exactly one row changed to
`["cpsc-recalls","health-canada-consumer-product-recalls"]`; an independent read confirms that scope
and active status. No new owner key, read/admin scope or local credential-file change.
No plaintext credential appears in this evidence.

The bounded HC wiring probe submitted **empty candidates** against current notice `hc-82806`, raw SHA-256
`15d6fefdec1c928d0cfb74a01a3061fed20a159d3c4319851fb4ed66dc835e7d`, with the native HC extractor metadata.
It uses the ordinary collector User-Agent and 64-hex idempotency contract, refuses redirects and sends the
existing ingestion token only to the exact HTTPS intake host. HTTP 200 reports `checked`, zero accepted,
replayed and rejected candidates, `publishable_build=false` and `published=false`.
D1 submission **7** durably stores that response (zero candidate items). No synthetic fact was written
and no customer read allowance was used. This proves live wiring/current R2 evidence, not productive
HC inference, held-out quality or publication.

## Installed Windows acceptance

The old process stopped gracefully, clean canonical main fast-forwarded to `4b3fe7e`, and the existing
**Data Foundry Local Collector** scheduled task restarted with its original action/working directory.
Verified collector PID **8** and uploader PID **3208** are `pythonw.exe`, with uploader parent 8 and the
expected module/data directory. Local Ollama reports **0.40.6** and the pinned model digest; no current error.

Actual local status and read-only SQLite acceptance confirm:

- **2 tasks / 1 permitted-no-adapter / 24 blocked**, with CPSC and HC independently enabled.
- Independent source cursors preserved; HC has not consumed a source page.
- The legacy wait at `1792133450.0558267` plus `1357751` seconds was restored as
  `allowance_until=1793491201.0558267` (November 1 UTC). All four source read/verify jobs are pending
  at or beyond that time with attempts 0. No run-now or forced authenticated data request was used.
- Normal startup refreshes only the public catalog/stats: local daily request count **6→9**.
  These three public requests do not use the customer key or its monthly allowance.
- Output remains **8 extracted / 8 skipped**, 25 local accepted proposals, **12 server accepted /
  13 agency duplicates**, zero queryable, six historical acknowledgements and no owed outbox.
- Every resource limit and configuration/credential file is preserved. Private before/after checksums
  prove `collector.json`, `secrets/read-api-key` and `secrets/ingest-token` are byte-for-byte unchanged.
  SQLite/output assertions and source-task checks pass; no secret values are printed.

Rollback: stop the collector before changing admission; use previous Worker version
`f424ca25-6e4e-44e5-bf6c-763f49d5506f` / source `0c59ad08`, restore the old CPSC-only scope and prior
collector source before restarting. Preserve D1/R2, all local evidence/cursors/outbox and the allowance wait.
There is no schema migration to undo. No rollback was needed.

## Owner-facing session report

1. **Verdict:** COMPLETE for the requested HC adapter implementation, deployment and installed acceptance.
   The wider productive-collector milestone remains incomplete.
2. **Checklist snapshot:** REV-012 stays IN_PROGRESS. Adapter/source intake/provisioning, protected release
   and installed two-task acceptance completed. Zero checklist items added, reopened or promoted to DONE;
   the status-table denominator is unchanged (18 DONE of 51 rows; 23 IN_PROGRESS, 4 BLOCKED,
   3 DEFERRED, 2 NOT_STARTED, 1 SUPERSEDED). Current benchmark and permitted productive publication
   remain next under REV-012. See `PROJECT_CHECKLIST.md`.
3. **Progress:** started with HC permitted-no-adapter and installed 1/2/24; ends with the existing Worker
   and installed collector serving the reviewed implementation and plan 2/1/24. Local/protected CI,
   production authenticated acceptance, D1 scope/receipt and installed read-back are recorded separately.
   Existing infrastructure, pricing and publication gates are preserved. See `PROGRESS.md`.
4. **Problems found/fixed:** multi-source purge rewind, restored-wait bypass before key/network access,
   date-dependent retirement fixtures and CPSC-only provisioning. Meaningful regressions passed;
   independent review is clear and the GitHub provisioning finding is resolved. Existing Windows-only
   legacy SQLite cleanup failures remain disclosed; the complete Linux suite passes.
5. **Required user actions:** None. No purchase, upgrade, new owner credential or further approval is required
   for this bounded delivery.
6. **Recommended next steps (agent-owned, REV-012):** qualify the current local runtime and HC on their
   appropriate held-out benchmark, then prove a permitted productive cycle when allowance is available.
   Serving inferred identifiers still requires the separately reviewed exact-build publication gates.
7. **Repository/evidence:** canonical installation is `C:/Users/Adam/data-foundry`, with released
   application source `4b3fe7e`. The `codex/health-canada-closeout` change updates documentation only;
   it does not change the deployed bundle. The older dirty `C:/Users/Adam/Documents/ChatGPT/Data Foundry`
   checkout is preserved. Branch/worktree cleanup requires successful merge and proof of identical
   merged trees; archive recoverably and preserve all installed collector state.
