# Progress

## Current session — 2026-09-16 first-source decision reduced to one legal question

- PR #44 merged as `4e13cf68a295869bd8dfb95866848b98157d839a`, which is now **the only valid basis for UA-002 packet regeneration**. Verified as such immediately after the merge: exporting at `4e13cf6` against the real hosted ledger reproduces 33 / 26 / 7 and all ten documented checksums, worktree clean.
- The one review finding on #44 was correct and is fixed. My diagnostic advice led with "unset the credential and re-run", which is actively wrong for anything after the driver is created: `main` resolves the credential before `createPostgresDriver`, so unsetting it replaces a connection, auth, TLS or SQL failure with the unrelated "is required" error. Reordered narrowest-first, and it was also missing its most useful half — preflight findings are *returned*, not thrown, printing as `BLOCK <check>: <detail>`, so the redactor never sees them and every preflight condition is already fully legible.
- **Correction to my own earlier report: ENERGY STAR was not a new discovery.** The repository has carried it as a proposed source, deferred with the reason already correctly identified — *"partner-submitted field rights remain unknown"* — with a detailed review packet and a draft declaration held at `UNDER_REVIEW`/`UNREVIEWED`. What was new is the measured access posture and one piece of rights evidence.
- That evidence materially narrows the blocker. The packet recorded rights as effectively unstated (`licenseId: None`, empty `license`). Incomplete: each dataset's **federal Common Core metadata affirmatively attaches** `https://edg.epa.gov/EPA_Data_License.html` with EPA as publisher — identical on all six datasets checked. It still does not close the question, because the licence text (re-verified verbatim, unchanged) is scoped to data *"produced by the U.S EPA"* while brand, model, rating and connectivity fields are partner- or CB-submitted. **Human legal review is still required, on a much smaller question.**
- **DOE CCMS is not selectable on access, not rights.** Measured today with a descriptive agent, the edge returns **403 for `robots.txt` itself** — we cannot read the publisher's own machine-readable access policy without impersonating a browser, so any claim that crawling is permitted would have to be obtained by doing the thing whose permissibility is in question. Combined with the data.gov negative, no documented export or bulk mechanism exists that we can find.
- **The Australian register is no longer unqualified.** It was recorded as unreachable because `energyrating.gov.au` 403s; `data.gov.au` is a different host and serves fine (CKAN at `/data/api/3/...`, not `/api/3/...`). Two DCCEEW datasets — labelled and non-labelled — carry **CC-BY 3.0 AU with an explicit `license_url`**, which is a genuine commercial grant rather than a statement about copyright status. Both refreshed today with datestamped filenames; the air-conditioner CSV is **155 columns / 5.96 MB**, with registration number, submit status, grant and expiry dates, refrigerant, capacity results at H1/H2/H3 and TCSPF/HSPF by climate zone, plus DOCX data dictionaries. Its population is mandatory registration — the closer analogue to CCMS — but the market is AU/NZ.
- Recommended order, in [the decision sheet](docs/owner-actions/ua-001-first-source-decision-20260916.md): ENERGY STAR for the US slice conditional on counsel, then AU Energy Rating, whose rights are already clear if AU/NZ coverage sells. Nothing activated, no source contacted, the DOE inquiry still unsent.

## Earlier — 2026-09-16 UA-002 execution environment identified

- **UA-001 gained a documented alternative to CCMS, and a clean negative on the open data.gov question.** Enumerating all 112 data.gov sitemap shards — 559,455 URLs — establishes that **CCMS has no catalogue entry**; the only `ccms` match is an unrelated workers-compensation system. The catalogue's own API is unusable (`/api/3/action/*`, `/api/action/*`, `/api/1/*` and `/api/` all return a non-CKAN `{"detail":{},"message":"Not Found"}`, and its `robots.txt` still carries literal `# TODO` placeholder text), so the sitemap was the only route left and it worked.
- The same enumeration surfaced [ENERGY STAR certified products](docs/sources/energy-star-certified-products-qualification-20260916.md), published by the EPA on Socrata with `provenance: official`. It resolves the exact objection that stopped CCMS: measured today with a plain descriptive user agent, `robots.txt` (200) disallows only `/browse?*` query-parameter variants — not `/api/` or `/resource/` — and both the metadata and row endpoints return 200. No impersonation, no undocumented endpoint, documented CSV/JSON/XML distributions, and `rowsUpdatedAt` on the day of measurement. 31 HVAC-relevant datasets carry stable identifiers.
- The coverage figure is deliberately **not** quoted as a total. The naive sum across the 21 core certified datasets is 875,613, and it is wrong twice: *Central Air Conditioners* and *Mini-Split Air Conditioners* both return **0 rows** while reporting `publicationStage: published`, and *Air-Source Heat Pumps* and *Heat Pumps* report identical row counts and update timestamps but different column counts (48 vs 50), so they may overlap and must not be added. The distinct count is unestablished and is recorded as something to measure, not to assume.
- Two things are explicitly **not** resolved by this find. ENERGY STAR is a *voluntary* label and therefore a higher-efficiency **subset**, whereas CCMS is the *mandatory* database for regulated equipment — different populations, not substitutes. And its rights position is open: no `licenseId`, an empty `license` object, and "ENERGY STAR" is a registered certification mark with its own usage rules, so it needs its own rights determination rather than inheriting CCMS's. Nothing was activated.

- The database half is blocked on exactly one capability, now established by measurement rather than assumption: **a host with PostgreSQL egress to the project origin, running release `2063ea8`, with the `df_migration` password available to libpq without appearing in a command line.** Any ordinary developer machine with internet access and the password satisfies it. [Measurements](docs/evidence/ua002-execution-environment-20260916.md).
- Every alternative was checked, not assumed. `list_environments` returns exactly one environment and `get_session` confirms it is the one this session already runs in, so a sibling session is the same container by another name. The origin resolves IPv6-only (`2600:1f1c:825:9500:de6d:a3aa:4fb1:e23b`, no A record) against a container with zero IPv6 addresses. Raw TCP to the IPv4 Supavisor addresses was refused at the sandbox policy layer, so the restriction is policy rather than routing. A Vercel function was rejected on judgement — it would put the migration credential into a hosting provider nobody approved for that purpose.
- The hosted baseline was re-measured read-only and has not drifted: ledger `0001`-`0026`, 46 tables, 3 views, 57 functions, 0 `SECURITY DEFINER`, 0 functions carrying `proconfig`, `public` untouched at 7, six `df_*` roles all `NOLOGIN`, `df_ingestion` absent. That `proconfig` count is the measurement that keeps a search-path preflight out of the operator: `0027` is what sets it, so checking it today would raise 57 false blockers.
- The 26 applied ledger rows were read from the hosted database and compared against the release's own recomputation: **0 differing**. The hosted database and `2063ea8` agree exactly on everything already applied.
- The corrected documented sequence was then run end to end with that **real** hosted ledger — clean detached checkout at `2063ea8`, `--applied-ledger`, manifest written to `mktemp -d` outside the repository: **33 / 26 / 7** and all ten documented checksums reproduce. The operator run against it cleared packet parsing, the release-SHA guard and the clean-checkout guard, and stopped at exactly one line: the credential.
- The twelve durable-setting violations are unchanged (each of the six roles carries the forbidden all-databases `search_path` row and none carries the required per-database row). `postgres` is a member of `df_migration` with no admin option, which is the session `ua-002-provider-staging.sql` is written for — it is not an execution path, because the operator requires `session_user` and `current_user` to both equal `df_migration` and rejects `SET ROLE` by design.
- One operational detail that would have cost a cycle: the IPv4 Supavisor pooler must be used in **session mode (port 5432)**. Transaction mode on 6543 does not preserve the session state the runner asserts (`session_replication_role = origin`, `lo_compat_privileges = off`).
- No mutation was attempted. The management connector was re-measured as `supabase_read_only_user` with `transaction_read_only = on` and no `df_migration` membership; only reads were issued and its read-only posture is preserved.

## Earlier — 2026-09-16 UA-002 operator merged and bound to the release

- PR #42 merged as `2063ea8d72247a9b2643e1c690e37ab55ab14252` after six review rounds (`a75e75f` 3 findings, `7945930` 2, `f34697a` 3, `20ea79a` 2, `1754f33` 1, `d9b0e13` 1). Every finding was verified against the code, the migration SQL or the live hosted inventory before being accepted; all eleven threads are answered and resolved.
- The operator's preflight is fifteen read-only probes derived from the exporter's own SQL rather than a paraphrase, because a preflight that checks something subtly different from what the grant install raises on buys false confidence. It reports every blocker in one pass, and `--apply` executes a grant payload **rebuilt from the release** rather than the manifest's — the manifest's checksum hashes the SQL beside it and so proves nothing against an edit, and its verifier had no integrity binding at all.
- The dominant lesson of the review rounds was a failure mode worse than a missing check: **blocking on drift the pending migrations themselves repair**, which would make the catch-up impossible to start, since the runner refuses to apply while any finding exists. Three instances were found and excluded on measured grounds: function search paths (`0027` sets all 57, which would have produced 57 false blockers), the `SECURITY DEFINER` functions `0029` and `0033` replace with `INVOKER` definitions, and the acquisition ACL reshape.
- That third one arrived as a review finding proposing a check, and was declined with evidence rather than implemented. The hosted runtime-role private ACL is 200 entries (schema 5, relation 100, column 38, function 57); `LEGACY_RUNTIME_GRANTS_0028` is 199 (schema 5, relation 98, column 39, function 57). The difference is `0027` lines 56-58 revoking two relation grants and adding one column grant, so comparing the existing-object subset against that baseline before mutation would fire on three entries `0027` exists to repair.
- Artifacts regenerated from the merged release and re-verified: 33 repository migrations, 26 applied, 7 pending, `repositoryDigest` `8097711644f0b4ecdd91c21b2ba512b29bd4451597af4946f4bee6bf81871d8d`, six grant roles, 59 function signatures, 286 expected grants. All seven pending checksums match the Git objects at `2063ea8d72247a9b2643e1c690e37ab55ab14252`, and the rebuilt grant payload reproduces the exported manifest byte for byte across all three executable fields.
- The handover is now bound to that SHA and carries the exact direct-TLS command sequence with the values filled in. Nothing was executed against the hosted database; the management connector remains read-only.
- PR #43 merged as `5e263fc9326962de4e009b9047e5af1a04053df5`, closing three review findings on the handover. Two were P1s caused by the same mistake — documenting a command without executing it — and both were reproduced before being fixed: the export omitted `--applied-ledger`, so it produced `33 0 33` instead of `33 26 7` and would have flagged all 26 applied migrations as replays; and redirecting the manifest into the checkout created an untracked file that tripped the exporter's own clean-worktree guard (`?? ua002-packet.json`). Both now use `$(mktemp -d)` outside the repository.
- The third finding was a P2 on a claim, and measurement confirmed it: the table's checksums do **not** all follow from an identical `db/migrations/` tree. `upgradeFrom0028Sql` is 269,595 characters and embeds all 59 entries of `PRIVATE_FUNCTION_SIGNATURES` plus the 199-entry `LEGACY_RUNTIME_GRANTS_0028` baseline, neither of which lives under `db/migrations/`. The seven migration checksums and `repositoryDigest` do follow (`effectiveMigrations` hashes the migration SQL and the schema constant; `repositoryDigest` hashes only version, filename and checksum over those), so the document now splits the two cases and requires exact-SHA regeneration for the grant values.
- Artifacts regenerated from `5e263fc` after the merge, as the owner instruction requires before any live database work: 33 / 26 / 7, `repositoryDigest` `8097711644f0b4ecdd91c21b2ba512b29bd4451597af4946f4bee6bf81871d8d`, six roles, 59 signatures, 286 expected grants, `postMigrationGrants` checksum `b6c7e197aac427b21e232a988567b8d180ef6cc767a3e7cd691eb61febc8413c`, `upgradeFrom0028Checksum` `d73fe6718648ff459cb416d2b665496f841c4a430bc06647c6c55013dd04dd65`, and all seven pending migration checksums. All ten documented rows reproduce unchanged, which is the expected result for a documentation-only merge and is now recorded in the handover so either SHA can be used.
- One diagnosability trap is now documented rather than left to be rediscovered: once `DATA_FOUNDRY_MIGRATION_DATABASE_URL` is set, `migrationFailureMessage` redacts any error outside its safe-category allowlist to the bare sentence `Direct PostgreSQL migration failed.`, because a raw driver error can carry the connection string. Measured both ways on the merged release — the same failing run prints the full message and stack with the variable unset. Packet parsing, the release-SHA guard and the clean-checkout guard all run before the driver is created, so they can be diagnosed with no database at all.
- `UA-001`: an attempt to find a documented CCMS distribution on data.gov could not reach the catalogue API — `catalog.data.gov` serves its root but every `/api/3/action/*` call returns `{"detail":{},"message":"Not Found"}`, which is not CKAN's error envelope. That neither confirms nor rules out a documented distribution, and is recorded in the unsent inquiry draft as a reason to ask DOE rather than as a finding.

## Earlier today — 2026-09-16 direct-TLS operator, merged PR #41, and the remaining commercial decision

- PR #41 was marked ready, reviewed, corrected and merged as `0026b14b7ef0156519305fec756fae8fa083b169`. Codex raised three P1 findings and all three were correct: the paid-API rights bundle needs seven cells rather than six (`SURFACE_REQUIREMENTS.API_PAID` ANDs `SERVE_API_ACCESS`, `SELL_API_ACCESS` and an unconditional `REDISTRIBUTE_NORMALIZED`); the handover described `SET ROLE` where the runner requires connecting **as** `df_migration` and that role is `NOCREATEROLE`; and the topology needs six Hyperdrives, not five. Each was verified against the code before being accepted, fixed in `e996c25`, answered on its thread and resolved.
- The seven pending migration checksums were re-verified against the Git objects at the merged `main` SHA: 7 matched, 0 mismatched, and `db/migrations/` is unchanged between `eb7e998` and `0026b14`, so the prepared artefacts carry over intact.
- `tooling/scripts/ua002-direct-tls-operator.ts` is the new executable half of the handover, exposed as `pnpm ua002:operator`. Preflight is the default and mutation is opt-in behind `--apply`. It reads the credential only from `DATA_FOUNDRY_MIGRATION_DATABASE_URL`, never as an argument, and never prints it.
- The operator exists because of a specific failure mode rather than for tidiness. The migration runner's per-transaction guards check the session `search_path`, the role binding and the default ACL, but not durable role settings — and the grant packet raises on exactly those. Against the measured hosted state a naive run would have applied `0027`-`0033`, written seven ledger rows, and only then failed at the grant upgrade. Preflight therefore checks identity, session writability, durable settings for all seven roles, role existence and shape, the ledger marker and range, replay, and every checksum both pending and already applied — reporting all blockers in one pass, because the repairs need a privileged provider session anyway.
- Grant-upgrade failure rolls back and then *proves* the session recovered before reporting, rather than assuming PostgreSQL did it. 19 unit tests cover the blocked-run-mutates-nothing path, the apply ordering, and both rollback outcomes; the composed durable-setting probe was parsed against real PostgreSQL via PGlite before shipping. Full tooling suite: 37 files, 715 tests, passing.
- `UA-001` now separates **rights** from **acquisition method** as two approvals, recording the owner's decision that the undocumented, browser-user-agent-dependent endpoint is not to be used in production pending review or a supported path. The decision sheet gained exact-field, transformation, retention, refresh and downstream-channel sections, and a concise DOE access inquiry is drafted and deliberately unsent pending authorization.
- The remaining commercial decision is reduced to four questions with proposed values and rationale: keep the existing $0/$49/$149/$299 ladder, keep the hard stop rather than building metered overage, invoice manually monthly-in-arrears at Net 30 rather than building billing before there is demand, and offer the 100-request Evaluate tier only if `UA-001` returns `API_FREE` permission.

## Earlier today — 2026-09-16 UA-002 connector exception and first-source decision sheet

- Objective: execute the owner-approved `UA-002` database exception (management connector over HTTPS for the migration and grant-verification portion only), and advance the unblocked revenue tracks alongside it.
- Preconditions were verified before any mutation, in the order the exception required. The hosted baseline at `2026-09-16T16:16:23Z` matched the reviewed expected state **exactly, with no drift**: ledger `0001`-`0026` under marker `data-foundry:schema_migrations:v1`, 46 tables, 3 views, 57 functions, zero `SECURITY DEFINER`, zero non-owner objects, six `df_*` roles all `NOLOGIN` and non-privileged, `df_ingestion` absent, `public` untouched at 7 tables, and non-zero rows only in `api_route_keys` (14) and the ledger (26).
- The packet was regenerated against the merged release `eb7e998`: 33 repository migrations, 26 applied, 7 pending, `repositoryDigest` `8097711644f0b4ecdd91c21b2ba512b29bd4451597af4946f4bee6bf81871d8d`, `relevantInputsClean: true`, grants covering six roles, 59 function signatures and 286 expected grants. All seven pending checksums were then recomputed **independently of the exporter**, directly from the Git blobs at that SHA: 7 matched, 0 mismatched.
- The exception could not be executed. The management connector now authenticates as `supabase_read_only_user`, not `postgres` as in September. `SET LOCAL ROLE df_migration` failed with `ERROR: 42501: permission denied to set role "df_migration"`, and read-only probes confirmed two independent blocking layers: no `df_migration` membership (only `postgres` is a member) and `default_transaction_read_only = on` while `pg_is_in_recovery()` is `false` — deliberate configuration of a primary, not a standby artefact. Supabase's `read_only=true` MCP parameter produces exactly this identity and posture.
- The control was **not worked around**, because approval to use a connector is not approval to bypass a security control. No migration was applied, no grant changed, no role created; the only write attempted was the authorization probe, which failed closed. This is a capability limit, not a refusal, and the prepared work was handed over rather than abandoned — see [the write-path evidence](docs/evidence/ua002-connector-write-path-20260916.md) and [the handover](docs/owner-actions/ua-002-hosted-migration-handover.md), which sets out the direct-TLS run (the runbook's own canonical path, and the contained one) against re-enabling connector write mode (which would widen write authority across the whole project, including the unrelated application's `public` schema).
- `UA-001` advanced on the unblocked side. A fillable [rights decision sheet](docs/owner-actions/ua-001-doe-ccms-rights-decision.md) now states the minimum that earns revenue: **seven** operation/channel cells — `ACQUIRE`/`STORE`/`CACHE`/`NORMALIZE` on `INTERNAL_PROCESSING` plus `SERVE_API_ACCESS`, `SELL_API_ACCESS` and `REDISTRIBUTE_NORMALIZED` on `DIRECT_CUSTOMER_API` — with every other surface left `UNKNOWN` so it refuses by default. Seven and not six because `API_PAID` in `packages/rights-engine/src/surfaces.ts` is an AND-bundle whose redistribution requirement is unconditional; a six-cell decision would fail closed on every normalized API request.
- A second measurement found **real drift the first baseline did not cover**. Running the release's own durable-setting policy SQL read-only returned twelve violations: all six `df_*` roles carry a forbidden role-global (`setdatabase = 0`) `search_path` row and none carries the required current-database row. That SQL is embedded in the grant packet under `RAISE EXCEPTION`, while the migration runner's per-transaction guards check only the session search path, role binding and default ACL — so a direct-TLS run against the current state would apply `0027`-`0033`, write seven ledger rows, and only then fail at the grant upgrade. The operator sequence therefore checks durable settings before the first mutation. Repair belongs to the provider path: `df_migration` is `NOCREATEROLE` and can alter only its own settings.
- Codex raised three P1 findings on PR #41 and all three were correct: the paid-API bundle needs seven cells rather than six; the handover described `SET ROLE` when the runner requires connecting **as** `df_migration` and that role cannot create `df_ingestion`; and the topology needs six Hyperdrives, not five. All three are fixed.
- A material correction to the same-day source qualification: the DOE edge serves **only browser user agents**. `curl/8.5.0`, a bare `Mozilla/5.0` and a descriptive `data-foundry-research` token all returned 403; only a full Chrome UA string returned 200. The earlier "reachable with a plain descriptive user agent" cell was not reproducible and has been corrected in place.
- The query surface was confirmed from the shipped bundle: `POST` to `<solrUrl>select` with `wt=json` and `q`/`fq`/`fl`/`start`/`rows`/`sort`, the equipment-class facet is `Product_Group_s`, and CSV export is assembled client-side via `papaparse`. `solrUrl` itself is still not resolvable from published assets — the bundle carries only AjaxSolr's `http://localhost:8983/solr/` default — so the review packet's exact-endpoint cell still cannot be filled from public evidence.
- Those three facts together (browser-only edge, undocumented internal endpoint, bundle re-versioned the day before reading) are recorded as a reviewer decision rather than an engineering detail. Engineering's recommendation is to ask DOE for a supported bulk path before building a revenue-bearing pipeline on an endpoint the publisher never agreed to serve.

## Earlier the same day — 2026-09-16 machine-access channel reconciliation

- Objective: reconcile the owner's corrected business direction — Data Foundry as a supplier of machine-readable data, with agent and crawler monetization as core channels rather than deferred features — against live primary evidence, and select the minimal supported paid-machine release path.
- Live hosted database, read directly through the authenticated management connector at `2026-09-16T13:42Z`: ledger `0001`-`0026`, 46 tables, 3 views, 57 functions, zero `SECURITY DEFINER`, `df_ingestion` absent, all `df_*` roles `NOLOGIN` with no password, relation grants 25 each for `df_edge`/`df_web`/`df_mcp`/`df_acquisition` plus column grants (11/11/16), shared `public` schema unchanged at 7 tables, and no rows beyond the migration-seeded `api_route_keys` (14) and the ledger. The release at `af9fc68` carries `0033`, six roles and 286 expected grants, so the hosted target is seven migrations, one role and the grant upgrade behind.
- The pending export was built and validated against that live ledger: 7 packets (`0027`-`0033`), 286 expected grants, 59 function signatures, six roles including `df_ingestion`.
- The hosted catch-up did not proceed. Direct TLS was unreachable on three independently measured grounds: no migration credential in the environment, an IPv6-only direct origin against a container with no IPv6 stack, and IPv4 pooler endpoints timing out behind an HTTPS-only proxy. The runbook states the manifest's `liveUseAuthorized: false` does not authorize connector execution and directs stopping rather than substituting a connector. The September connector application of `0001`-`0026` was covered by a recorded owner preauthorization; nothing covers `0027`-`0033`. The work stopped rather than being worked around.
- Channel capability was established from official provider documentation and the implemented model, not from previous assistant claims: `API_ACCESS_TIERS` is `API_FREE`, `API_PAID`, `RAPIDAPI`, `MCP` and `API_BILLING_SOURCES` is `DIRECT`, `RAPIDAPI`, `NONE`. There is no paid-crawler access tier, rights surface or billing source in the application model.
- Cloudflare Pay Per Crawl verified 2026-09-16 as **closed beta** with no self-serve enablement. Identity is Web Bot Auth request signatures plus verified-bots registration, never a `User-Agent`. The flow is `HTTP 402` with `crawler-price`, a retry carrying `crawler-exact-price` or `crawler-max-price`, and a charged 2xx carrying `crawler-charged`; Cloudflare is Merchant of Record and distributes earnings. WAF and Bot Management block rules take precedence over charging, so a crawler refused before the charging flow earns nothing. Since 2026-06-16 price may be set dynamically from the origin, which corrects the earlier internal assumption that pay per crawl involves no Worker code.
- Selected minimal path: the **direct `API_PAID` API billed `DIRECT`** is the shortest supported route to a paid machine request. It needs no third-party enrollment, marketplace agreement or beta admission — only deployment, an approved source and a published price. RapidAPI and pay per crawl remain live channels behind their own external enrollments; neither blocks the first release.
- Records updated: `docs/evidence/machine-access-channel-capability-20260916.md` (new), `docs/sources/hvac-first-source-qualification-20260916.md` (new), the pay-per-crawl and channel-table sections of `docs/owner-actions/revenue-readiness.md`, the deployment runbook's pay-per-crawl item, an amendment to ADR-0006, and `PROJECT_CHECKLIST.md` (`UA-002` re-measured, release target realigned, `UA-008` added for beta admission).
- `UA-002` credential paths exhausted, not merely asserted: only TCP 443 leaves this container (`1.1.1.1:443` open, `:53` blocked; the Supavisor host answers on 443 but times out on 5432 and 6543). The blocker is therefore network reachability, not credential custody — no secret store or credential bridge can make the PostgreSQL wire protocol reachable from here. The only database path over 443 is the management API, which the runbook forbids for application migrations. This reduces to a two-option owner decision: record an exception for the connector path as was done in September, or run the direct-TLS procedure from an environment that has both the credential and 5432 egress.
- `UA-001` advanced in parallel. DOE CCMS is reachable (200) and structurally acquirable — a Solr-backed JSON API with `fq` filtering, `start`/`rows` pagination and exact `numFound`, which permits a slice that is complete in its own terms rather than a truncated class. Upstream refresh is approximately two weeks; scope is current basic models submitted within the past year; provenance is manufacturer self-certification with accuracy disclaimed and no legal significance, so absence is not discontinuation and this is never independent certification. `energyrating.gov.au` refused the same automated client (403) and could not be qualified. Recommendation: advance DOE CCMS, let the Australian register lapse to unqualified. Rights remain entirely the reviewer's.
- Direct paid path verified against the release: 61 tests pass across `api-keys` and `usage-events`, including the closed `API_PAID`/`DIRECT` invoice predicate that keeps marketplace events structurally out of the invoice projection. What remains is a price, an invoicing mechanism, terms and a deployment.
- Production impact: none. No provider, credential, DNS, schema, rights, listing or billing mutation occurred. The Cloudflare and Stripe interfaces were not authorized in this session, so this account's zone settings, bot rules, plan level, beta admission and product state remain unverified.
- Next dependency order is unchanged in substance: owner credential activation (`UA-002`) unblocks deployment and the private canary; the source rights decision (`UA-001`) unblocks real data; a price and invoicing decision plus `UA-007` unblock the first direct sale. `UA-004` and `UA-008` open the additional channels afterwards.

## Current session — 2026-09-08 revenue platform implementation

- Objective: implement the accepted HVAC-first RapidAPI launch plan, reusable across industries with regular refresh and a $300/month operating ceiling.
- Baseline: live main 0ae6c7aeb2dee70ce380663cb438d5e1d047b634, README-only PR29 and zero open issues. Work is isolated on codex/revenue-platform-20260908. Four pre-existing original-checkout changes were preserved and integrated in this worktree; no original checkout was reset.
- Current release shape: six ordinary Workers and database roles, six reduced capability targets plus credential-free harness (thirteen core bundles), and one separately built synthetic ingestion phase using isolated Queue/DLQ/artifact storage. Migrations extend through0033; 59 private functions,51 tables and286 exact runtime grants. The historical hosted inventory remains26 migrations/five staged roles/200 grants; it was not re-certified or changed.
- Pipeline: acquisition completion inserts an immutable processing identity transactionally; opaque UUID messages, independent five-minute outbox recovery, database-clock leases/fences, bounded verified JSON/CSV artifacts, atomic canonical promotion, retained revisions and 304 verification. A NOT_MODIFIED run may reuse only a matching FETCHED run whose completion and freshness both precede its own claim, preventing overlapping work from borrowing a future artifact. Source permissions are checked during processing and delivery. The production path imports no fixture filesystem or PDF graph.
- Operations: 1–8760-hour optional source interval (12 hours only where reviewed terms permit); separate acquisition/verification/publication observations; closed production telemetry; immutable operator action history, replay/backfill/pause/resume/retraction/revocation/account closure; durable incident and failure/recovery email states. Alerts default off; unknown sends never automatically repeat.
- Foundation/customer work: one compiled identifier contract for ingestion and exact lookup, synthetic second-industry proof, /hvac canonical pages and old-path redirects, useful filters/pagination, honest coverage/pricing, fail-closed listing/approved-policy/contact configuration, TypeScript/Python examples and rights-filtered selected-fact evidence. Unreviewed query-bearing evidence URLs are omitted while artifact identities/hashes remain.
- Source/commercial work: fresh source documentation assessment, bounded initial data dictionary, pricing/cost envelopes, three-partner trial criteria, unsent outreach copy and reviewable customer policy drafts. No source was approved/acquired, no agreement accepted, no marketplace billing/listing configured and no customer contacted.
- Prior native local evidence (before migration0032): all31 migrations apply; exact legacy199-to286 grant upgrade and complete postcondition verifier pass, including same-count ACL drift refusal and unchanged ledger. Restricted df_ingestion publishes61 synthetic facts with61 evidence rows, ignores duplicates and rejects ten mutation/capability probes, including function execution after PUBLIC access is revoked. These are disposable local controls, not hosted/TLS/Hyperdrive/backup evidence.
- Verification records: docs/evidence/revenue-platform-implementation-20260908.md, docs/evidence/identifier-and-buyer-verification-20260908.md and docs/evidence/ingestion-postgres-control-20260908.md. Candidate-wide checks and exact-head hosted CI/reviews belong to the implementation PR evidence; a later SHA requires fresh applicable verification before release designation.
- Material repairs found in review: missing real-role sequence/lock privileges, absent legacy ACL upgrade, operator UUID-case idempotency and audit TRUNCATE bypass, query-bearing evidence URL leakage, malformed UTF-8 acceptance and unqualified multi-target source ordering.
- Production impact: none. No provider, credential, DNS, real-source, billing or outreach mutation occurred. Existing containment/credential/source/marketplace/public-cutover gates remain; approved retention and verified alert/support contact are now explicitly UA-007.
- Next dependency order: owner containment (UA-006) and source/policy decisions (UA-001/007); agent-run recovery/provider staging after secure activation (UA-002); private capability and synthetic ingestion proof; owner marketplace agreements/payouts (UA-004), live subscription/limits/cancellation; action-time public cutover (UA-005). First actual external payment plus useful access, scheduled real refresh/recovery and budget evidence remain the revenue milestone.
- Source qualification limits:16 artifacts,1 MiB each,4 MiB total,1,000 records,10,000 affected entity/property pairs per delivery (including retirements and dependent facts) and one acquisition target per source. Larger complete snapshots, target partitions, HTML/PDF runtime qualification, approved-policy erasure, independent provider outage/spend alerts and later paid channels are not claimed complete.

- Follow-up integration: PR #30 merged as `eed284599ab9a2bf1892039705eb294a0e99fbd1` after hosted run34254514199 passed both required jobs for `2ba6ad8b4833253f1ba782071b7b2cdaf63d70ac`. PR #29 then reconciled the README presentation onto that operational baseline and merged as `1fb406c8f91540bde1beb5b678e6953365de4768`. Migration0032 exposes all current alias source memberships through the existing view without granting raw-history access. Production promotion scopes its work to affected entity/property pairs; a small update beside10,001 unrelated entries passes. Search pages are always noindex and remain outside sitemaps.
- Follow-up checks: the final sequential suite passed3,450/3,450 in220 files (397.90 seconds); all14 type/schema/runtime/topology checks and all14 build profiles passed. Hosted run34254514199 passed its full job in13m50s and its real-PostgreSQL job in1m14s. The README reconciliation's documentation-scoped protected run34256317967 passed; its real-PostgreSQL job was correctly skipped.
- Delayed304 repair: PR30 comment3959304808 is covered at both completion boundaries. The test first claims the304, then completes a matching FETCHED run; the304 is refused because that artifact became available after the claim boundary. A separate raw terminal-update regression proves the database guard also refuses the same bypass. Migration0033 reasserts that fence in the terminal guard and pins its function search path. Focused acquisition, migration, packet and runtime-grant controls passed; the final sequential suite passed3,450/3,450 in220 files (397.90 seconds), followed by all14 configuration checks and all14 build profiles. The exact candidate's protected checks passed before merge. No deployment or revenue claim is made.
- UA-006 disposition: the Product Owner affirmatively cleared provider containment on 2026-09-08. This record is sanitized: it stores no item, credential, identifier, browser state, or security detail. Frozen `origin/main` was `bc6d8f060153853d8c8d79087775fec99c1805a1`; its local sequential suite passed3,450/3,450 in220 files (1,402.43 seconds), private-canary/synthetic-ingestion topology gates passed, and thirteen core plus the separate synthetic-ingestion artifact builds passed. Its credential-free migration packet reports33 migrations and six runtime roles. The worktree contains no direct-TLS migration/runtime credential. On 2026-09-09 Wrangler authenticated and a read-only Cloudflare inventory confirmed only the preserved ordinary usage Queue/DLQ pair and raw-artifact bucket, with no Hyperdrives; direct-TLS inspection, migrations, grant upgrade, credential activation, new queues/buckets, and the route-less canary remain precisely blocked at UA-002's owner-controlled secure-entry interface. No provider mutation occurred.
## Prior-session record

Everything below is preserved historical context. Its five-Worker topology and
earlier SHA/provider observations do not override the current six-role plan,
current checklist or fresh primary evidence.

## Historical state through the prior session

- Product: Data Foundry
- Lifecycle stage: Alpha Lab schema staged / protected main / pre-deployment
- Control-graph node: `PROTECTED_MAIN -> EXTERNAL_DEPLOY`
- Current milestone: bind the staged Alpha Lab schema to the five Workers
  through owner-provisioned credentials and Hyperdrives, prove the first lawful
  Cloudflare canary, and open the first rights-admitted source and revenue
  channel without implying that a real HVAC dataset is cleared
- Release authority: the live 40-character `origin/main`. Integration PR
  [#19](https://github.com/athompson83/data-foundry/pull/19) is merged; PRs
  #13–#17 are closed as superseded after path, patch, ancestry, and behavioral
  reconciliation. Dependency follow-up PR #21 removes the remaining `esbuild`
  advisory from the post-integration lockfile. PR #22 merged the closeout tree
  as `9c917c0f708352dfb79861110023145eb23806e3`, including migrations
  `0025`–`0026`, exact alias evidence, bounded surface-catalog authorization,
  one request-wide query snapshot, and database-free request pre-routing.
  Its exact head `501b33d08fafe5cdf1c9c0c9877f0b38b4b265c0` passed hosted run
  `33352124668`, both automated reviews, and sealed security scan
  `24b34cd2-2f8d-40ae-bfd2-f4460daa419f`. Every later commit, including
  documentation-only, creates a new repository SHA and requires fresh exact-SHA
  local, hosted-CI, review, and ruleset evidence before it can be designated for
  provider action. The Alpha Lab isolation branch merged as
  `290df1342094433e92978ec97eb37cc02fc4eb50`; PR #24 (`/docs` page names the
  API contract) merged as `5dde773a4b64a8e004ca429706100399a678cf74`.
  PR #26 then merged normally as
  `02e90d70d0000d21c7f9b070b4e1b2e1d5dd7493` from reviewed head
  `8a43b7f7600fef10c1b26f0281a4c087f8610373` after both required
  checks, both automated reviews, and all review threads were clean. That merge
  does not authorize a hosted migration or deployment; those retain separate
  containment, credential, exact-SHA, and provider gates.
- Repository state alone designates no Worker release candidate.
- The required source gate
  is six route-less private-canary Worker artifacts: five reduced targets and
  one harness. The canary path also requires the five dedicated 14-day queues
  `data-foundry-private-canary-usage-events`,
  `data-foundry-private-canary-usage-events-dlq`,
  `data-foundry-private-canary-events`, `data-foundry-private-canary-dlq`, and
  `data-foundry-private-canary-quarantine`; none may repurpose the ordinary
  usage Queue/DLQ pair.
- Preview: none verified
- Production: no Data Foundry Cloudflare deployment exists. The Aroqon zone is
  active/full, but `data.aroqon.com` currently returns Vercel `404: NOT_FOUND`.
- Database target: shared Alpha Lab Supabase project `fgxinxaqkwoqyywdgobs`.
  The private `data_foundry` schema now carries all 26 ledgered migrations,
  migration-owner ownership, the `PUBLIC` revoke, and the historically verified
  200-grant runtime matrix for five staged `NOLOGIN` roles. The same hosted
  snapshot records `df_migration` as `NOLOGIN`; it is not yet the controlled
  direct login required by the current migration runner. Repository migration
  `0027` pins all 57 function search paths and narrows acquisition access to the
  199-grant matrix; repository migration `0028` adds the four justified rights-
  path indexes. Both remain pending hosted authorization and application at a
  newly reviewed exact SHA. It holds no source, entity, fact, tenant, or
  credential rows.
  See the [2026-09-02 hosted migration evidence](docs/evidence/alpha-lab-hosted-migration-20260902.md).

## Latest Session — Local Clone, Windows Test Repair, and E2E

- Populated the previously empty local checkout from `origin/main` at merge
  commit `0ae6c7a` on branch `local-test`; installed the pinned pnpm lockfile
  dependencies with `pnpm install --frozen-lockfile`.
- Fixed the Windows-only architecture-boundary test failure caused by using a
  URL pathname without decoding `%20` in a workspace path. Both boundary
  suites now use Node `fileURLToPath`.
- Focused verification passed: 2 files / 10 tests. The local factory E2E proof
  passed: 1 file / 34 tests. The repeated full local suite passed: 202 files /
  3,246 tests. `pnpm build` passed schema generation and TypeScript typecheck.
- No hosted CI, provider, database, deployment, rights, billing, DNS, or
  source state changed. This local branch is not a release candidate.
- Repeat validation on 2026-09-03 reproduced no failures: focused boundary
  tests 10/10, factory E2E 34/34, full suite 3,246/3,246, and build/typecheck
  passed again.

## Latest Session — Protected-Main PR #26 Release-Boundary Merge

- Reconciled every PR #26 review thread and extended the
  same shared PostgreSQL 16 policy across the direct migration runner,
  connector packets, runtime-grant installer/verifiers, five direct role
  probes, and every route-less private-canary target. The merged implementation
  rejects unsafe role posture, memberships, role/database settings, effective
  parameter and large-object privileges, FDW/server access, ownership, all-
  database `CREATE`, and `CONNECT` to any other live non-template database.
- Direct migrations now require `df_migration` to be a controlled direct
  `LOGIN NOINHERIT` session/current user with exactly one current-database
  durable `search_path=data_foundry, pg_catalog, extensions` row and no global
  role settings. The configured and resolved live path is checked before the
  first broader policy query and before/after every pending migration.
- Generated provider packets recheck migration-role durable/default/external
  state before and after each migration, prove `current_user=df_migration`
  around migration SQL, and refuse quoted as well as unquoted shared-`public`
  qualification. Drift rolls back before both the ledger insert and any later
  migration. Exact reviewed Git migration bytes remain the trusted computing
  base; these controls do not claim to sandbox a malicious provider admin.
- Negative controls cover neighboring default permissions independently,
  effective privileges inherited through `PUBLIC`, PostgreSQL 16 parameter and
  large-object catalogs, exact extension membership, unmanaged and shared
  object ownership, foreign tables, search-path poisoning, role escape, and
  cross-database reachability. Tests directly assert the non-generic extension
  and numeric shared-ownership branches so a broader rejection cannot mask
  them. The disposable PostgreSQL CI job applies and cleans each mutation and
  preserves only allowlisted error signatures in mode-`0600` captures.
- Repository-only verification is green. Exact PR head
  `8a43b7f7600fef10c1b26f0281a4c087f8610373` passed
  protected run `33697035331`, including disposable TLS PostgreSQL 16, and
  both automated reviews found no remaining issue. A clean checkout of merge
  commit `02e90d70d0000d21c7f9b070b4e1b2e1d5dd7493` passed TypeScript, 202
  files / 3,244 tests, 28 ordered idempotent migrations, generated
  schema/OpenAPI/runtime checks, topology, and eleven PGlite-free Worker
  artifacts. Protected-main push run `33698213600` also passed both required
  jobs. None of this is live provider evidence.
- No provider, source, rights, billing, DNS, or deployment state changed. The
  hosted target still needs `UA-006`, a secure `df_migration` credential with
  the exact current-database `data_foundry, pg_catalog, extensions` search path,
  a read-only cross-database topology result, pending
  migrations `0027`–`0028`, `postMigrationGrants.verificationSql`, five distinct
  runtime-role credentials with that same exact current-database search path,
  `postMigrationGrants.postCredentialVerificationSql`, a successful five-path
  `pnpm runtime-roles:postgres:check`, five cache-disabled Hyperdrives, five
  separate 14-day private-canary queues, both required R2 buckets, and the
  private canary before any public deployment.

## Previous Session — Hosted Private-Schema Migration and Grant Activation

- Applied the exact `db/migrations/` set (tree shared by PR #26 head `93a668b`
  and `main` `5dde773`) to the Alpha Lab target through the exporter's attested
  connector packets, each submitted as one multi-statement query that
  PostgreSQL runs as a single implicit transaction; demonstrated by a rollback
  probe and by every object being owned by the migration owner through
  `SET LOCAL ROLE`, not assumed from client documentation. Direct TLS Postgres
  is unreachable from the automation container, so the connector path was used
  under the owner's explicit production-provisioning preauthorization and is
  recorded as a documented deviation from the runbook's direct-TLS preference.
- Verified: ledger `0001`–`0026` with exporter-matching checksums, 46 tables,
  3 views, 57 functions, every object owned by the migration owner, zero
  `SECURITY DEFINER` functions, the `PUBLIC` pseudo-role removed from the
  private schema and its objects, and the exporter's 200-grant runtime
  verification block passing. The shared `public` schema ACL and table count
  are unchanged.
- Staged, not activated: the five runtime roles have database `CONNECT`,
  schema `USAGE`, and object grants but no password and no `LOGIN`. Assigning
  credentials and creating the five cache-disabled Hyperdrives is owner-only
  (`UA-002`). Zero Hyperdrive configurations and no Data Foundry Worker exist.
- Provider advisories after migration: the pre-existing `public.automation_runs`
  RLS error belongs to the unrelated Alpha Lab application and was left for the
  owner; 57 `function_search_path_mutable` warnings on `data_foundry` functions
  were observed. Repository migration `0027` implements the forward fix, but it
  has not been applied or reverified on the hosted target; no warning closure is
  claimed.
- Latest redacted Cloudflare evidence at 2026-09-02T14:46Z records the standard
  usage model and the ordinary usage Queue/DLQ pair at 14-day retention, with
  zero Data Foundry Workers, Hyperdrives, R2 buckets, hostname record, or route.
  The earlier same-day raw-bucket observation is historical and superseded.
- The FK-advisor review justifies exactly four rights-path indexes in repository
  migration `0028`. The other 31 INFO notices are non-blocking and deferred to
  post-traffic `EXPLAIN`/advisor monitoring rather than speculative indexes.
- Merged PR #24 (`/docs` page names the API contract) as `5dde773`. The hosted
  `0001`–`0026` application predates repository migrations `0027`–`0028`; any
  pre-continuation SHA-specific canary or exporter evidence remains historical
  only and cannot authorize the pending hosted work.
- Data and revenue remain gated exactly as before: `hvac` is `DRAFT` with four
  synthetic fixture sources, ENERGY STAR is deferred and unreviewed, RapidAPI
  enrollment is owner-only (`UA-004`), and no Stripe product or listing exists.
  No source acquisition, publisher contact, listing, or billing change was made.

## Session 2026-08-31 — Alpha Lab Isolation and Provider Reconciliation (historical, superseded where noted)

- Corrected the data boundary: Data Foundry is a private `data_foundry` schema
  inside Alpha Lab, not part of Valor. Real-Postgres operational commands now
  default to that private schema; legacy `public` use is explicit only.
- Hardened migrations to preflight the private schema and `extensions` access,
  refuse legacy Data Foundry public installations, and retain an independent
  schema-scoped migration ledger.
- Made the disposable real-Postgres CI service create the same `extensions`
  namespace before private-schema migration, preserving the production guard
  instead of weakening it for a generic PostgreSQL container.
- Hardened Cloudflare Hyperdrive usage: each Worker invocation owns and closes a
  fresh client; every private-schema operation uses and verifies a transaction-
  local search path; snapshot setup is constrained and serialized so a pooled
  transaction cannot inherit another Alpha Lab consumer's path.
- Added regression coverage across the canonical store, migration runner,
  ingest CLI, and all five Worker lifecycle roots.
- Historical observation: `aroqon.com` was active/full with no Data Foundry
  Workers, Hyperdrives, Queues, or R2 buckets, and the account appeared Workers
  Free. The Queue/R2/plan assertions are superseded by the 2026-09-01/09-02
  redacted evidence: the account uses the standard usage model and the ordinary
  14-day Queue/DLQ pair exists. The 2026-09-02T14:46Z refresh found zero Data
  Foundry Workers, Hyperdrives, or R2 buckets and supersedes an earlier same-day
  raw-bucket observation. No Worker, route, Hyperdrive, or live binding proof
  exists. The configured Vercel project has
  disconnected Git and no viable deployment, so it is not a rollback target.
  The [redacted 2026-08-31 provider reconciliation](docs/evidence/alpha-lab-provider-reconciliation-20260831.md)
  records the read-only observations and excludes provider identifiers and
  credentials.
- Fresh local evidence: `typecheck`; focused schema/Worker tests (78); the full
  Vitest suite (189 files, 2,969 tests); migration, generated-schema/OpenAPI,
  topology, vertical/runtime, and all-five-Worker artifact checks all pass.
  Source readiness at `2026-08-31T20:22:08.032Z` is correctly `NOT_READY`:
  HVAC has zero real sources and no effective surface grants.
- No Cloudflare, Vercel, Supabase, DNS, billing, source-rights, or production
  data mutation was made.

## Protected-Main Implementation State

PR #19, the PR #21 dependency repair, and the PR #22 closeout are on protected
`main`. The bullets below describe that merged tree; repository-ready still does
not mean deployed or commercially publishable.

- Corrected Option B is accepted and implemented. Exact effective rights-matrix
  decisions authorize each operation/channel surface independently. Missing,
  stale, automated-only, or otherwise ineffective permission refuses.
- Legacy `GREEN`/`AMBER` classifications and permission booleans are inventory
  metadata and additional hard stops only. Migrations created no `ALLOW`.
- Historical queries select one exact immutable fact and recursive contribution
  graph at `policy.at`, while source status, terms, and surface grants are
  evaluated at the response/export `asOf`. A current successor is never
  substituted for the selected historical fact.
- REST and MCP await Cloudflare Queue acceptance before returning a metered
  success. Missing/rejected enqueue returns an opaque retryable 503. Only the
  later Postgres persistence remains asynchronous and idempotent.
- Scheduled acquisition uses migrations 0017, 0019, and 0020 with immutable
  versioned receipts and fenced recoverable execution leases. Pre-migration
  terminal rows remain contract v1; every new or reclaimed claim is contract v2
  and requires ordered `INITIAL`, `PRE_PROVIDER`, `PRE_TRANSPORT`, and
  `PRE_PERSISTENCE` authorization within the current attempt before R2
  persistence or `NOT_MODIFIED` freshness. Unexpected orchestration failures
  that escape expected terminal handling release still-owned claims; expired
  attempts rotate tokens on the same slot row. Only a winning claimant receives
  the current fencing token; active/terminal duplicate observations and
  diagnostic/freshness reads physically omit it. Direct and provider
  transports enforce finite response, record, pagination, cursor, diagnostic,
  and cumulative-artifact bounds without partial persistence.
- Offline entity resolution uses one driver-managed transaction executor for
  manufacturer, entity, alias, judgment, and evidence writes. A transactional
  failure rolls the batch back. No usable strong identifier is instead a
  fail-closed zero-claim result whose provenance revision can still finalize,
  so a refresh does not leave the superseded record falsely current.
- Re-ingestion now supersedes a logical source record's current immutable
  revision rather than mutating or deleting provenance. Migrations `0021`–
  `0023` preserve historic evidence, record a one-way supersession link, make
  source-record lifecycle explicit (`PROVISIONAL` versus `FINALIZED`), and make
  each entity/fact/relationship lineage cite its exact artifact. The persisted
  `source-record-evidence@3` fingerprint covers the exact resolved entity and
  manufacturer targets, accepted alias claims and locators, fact projections,
  resolution audit, and relationship dispositions/endpoints/writer. An exact
  replay does not churn `updated_at`; any evidence, target or mapping-semantic
  change appends a successor instead of retaining stale evidence.
- Migration `0023` adds append-only alias claims and authority epochs. It
  deliberately creates no authority claim for a legacy alias. Resolution and
  search read only claim-backed current aliases; entity and relationship
  surfaces require current `FINALIZED` supporting evidence. A refresh without
  a usable strong identifier still finalizes a zero-claim successor, withdraws
  the prior source-only identity from customer surfaces, and creates no phantom
  manufacturer while preserving immutable history.
- Migration `0025` binds every source-record alias claim to its exact immutable
  `ALIAS` entity-evidence row. A claim without that link—and every legacy row
  for which the repository cannot prove the link—stays outside resolution and
  search. The ingest pipeline records the claim and evidence in one pinned
  transaction, so the alias's source is included in the surface-rights AND.
- Every customer-facing query operation uses a fresh read-only repeatable
  snapshot and request-local authorizer. Compound REST, MCP, public-web, search,
  facet, relationship, and comparison flows cannot reuse authorization from an
  older contribution set or observe a mid-operation alias commit. REST parses
  all matched-route inputs before acquiring that snapshot; the web Worker
  rejects methods, malformed targets, `robots.txt`, and unmatched paths before
  loading the database-backed deployment.
- Migration `0024` requires explicit source-stream membership and
  `full_snapshot` versus `incremental` refresh semantics. Complete snapshots
  retire omitted current records atomically with append-only artifact evidence;
  incremental streams do not. Unknown legacy membership is revoked rather than
  inferred, then restored only by a rights-admitted reingest.
- Rights-backed readiness exists and requires canonical `--as-of` plus either a
  named-environment live database or a schema/digest-validated qualified
  snapshot. YAML/fixture metadata alone never proves a current grant.
- RapidAPI is a thin authenticated proxy into the canonical edge Worker, with a
  generated OpenAPI contract and disjoint `RAPIDAPI/RAPIDAPI` usage. Those rows
  are excluded from direct invoices.
- The fail-closed credential provisioner admits exactly `API_PAID/DIRECT`,
  `RAPIDAPI/RAPIDAPI`, and `MCP/NONE` for one tenant and one vertical. File
  delivery is POSIX-only, owner-only and outside the worktree; marketplace
  delivery goes to the repository-pinned Wrangler entry point through the
  validated edge manifest, a sanitized child environment, and an explicit empty
  env file. Reserved and `workers.dev` marketplace hosts are refused. It creates
  no rights grant, plan, invoice or source approval.
- MCP is a deployable, one-vertical, custom-bearer MCP 2026-07-28 surface with
  exact `MCP/NONE` analytics. It is not OAuth or anonymous; no live deployment
  is verified.
- The final Cloudflare topology is five Workers: edge, web, usage-consumer,
  acquisition-worker, and mcp-worker. Deployment validation requires every
  exact manifest to name the same canonical 32-hex `account_id`.

## Source and Product Truth

- HVAC remains `DRAFT`. All four registered sources are synthetic fixtures.
- No real HVAC source has an effective reviewed publication/commercial bundle.
- The proposed ENERGY STAR source is `DEFERRED`, `UNDER_REVIEW`, `UNREVIEWED`,
  unapproved, outside the runtime registry, and has no grant. Do not sign,
  promote, acquire, publish, contact, or initiate publisher outreach.
- The only approved general product wording for regulatory-filing values is:
  “Manufacturer-reported, as filed with US regulators”. Do not broadly call
  filings certified, verified, approved, or regulator-determined unless exact
  provenance genuinely supports that narrower statement.

## Deployment and Revenue State

- The PR #19 integration, PR #21 dependency repair, and PR #22 closeout are on
  protected `main`. Repository-ready does not mean deployed or commercially
  publishable; the live deployment and real-source gates remain independent.
- RapidAPI enrollment, proxy-secret configuration, plans, payout setup, live
  route, and real subscriber proof remain external.
- The Aroqon Cloudflare zone is active/full. Latest redacted evidence shows the
  standard usage model and exactly the ordinary 14-day Queue/DLQ pair, with no
  Data Foundry Worker, route, Hyperdrive, or R2 bucket. The next deployment
  proof is the
  route-less, service-bound private canary; any public canary or
  `data.aroqon.com` cutover requires separate later authorization.
- The configured Vercel project has disconnected Git. Its production domain
  returns `404: NOT_FOUND` and historic deployments fail for a missing `public`
  output directory; it is not a viable rollback path.
- GitHub `main` is protected by active ruleset `21855694`; its two strict
  required checks are bound to GitHub Actions. Private vulnerability reporting,
  Dependabot vulnerability/security-update controls, secret scanning, and push
  protection are enabled, and repository hooks are empty. Only the Vercel App's
  sudo-gated repository selection remains an owner-only governance check; it
  does not block protected merge or Cloudflare deployment.
- Protected `main` upgrades the production PDF parser to `unpdf@1.8.1`, removing
  the legacy `canvas` / `node-pre-gyp` / vulnerable `node-tar` install chain
  behind all twelve Dependabot advisories discovered on the prior
  default-branch lockfile. The dependency follow-up also updates `esbuild`,
  removing the remaining development-tool advisory. Parsed-lockfile regression
  coverage and `pnpm audit --audit-level moderate` keep those dependency
  repairs executable rather than documentary.
- Public production requires `PUBLIC_CACHE_MODE=no-store`; the runtime rejects
  `cache` in production because request-time rights checks cannot revoke an
  object already retained by a browser or intermediary. Shared caching is a
  later engineering capability only after cache keys and invalidation follow
  exact rights lifetimes. Provider purge and stale-object probes remain live
  incident checks because the repository does not control every provider rule.
- Public sitemap work is keyset-paged and subject to one validated raw-page
  budget per request, shared across all verticals and segments for the global
  index. Capacity exhaustion returns an opaque, non-cacheable retryable 503
  without partial XML; malformed and configuration-impossible shard aliases do
  no query work. A provider-level rate limit still requires live configuration
  and verification.

## Verification

- Focused test-first repair cycles cover post-transport rights revocation,
  exact historical selection, recursive contributors, bulk refusal, pinned
  reconciliation transactions and advisory locks, source-record currentness,
  alias epochs/claims, identifier-less successors, bounded provider input,
  Queue privacy/idempotency, bounded sitemap work, and credential-delivery
  refusal/compensation paths, plus removal of the vulnerable transitive
  `node-tar` chain.
- PR #22 exact head `501b33d08fafe5cdf1c9c0c9877f0b38b4b265c0`
  passed the complete 183-file/2,926-test Vitest suite, typecheck/build, all 26
  ordered and idempotent migrations, generated schema/OpenAPI/runtime drift
  checks, vertical/acquisition checks, repository Cloudflare topology, all five
  Worker artifact checks, disposable PostgreSQL 16
  replay/reconciliation/concurrency gates, and the moderate-level dependency
  audit. Hosted run `33352124668` passed the protected ruleset checks. Sealed
  security scan `24b34cd2-2f8d-40ae-bfd2-f4460daa419f` closed 32/32
  worklist rows across all 65 changed files and 10/10 surfaces with zero
  findings, candidates, deferred items, or suppressions. PR #22 merged normally
  as `9c917c0f708352dfb79861110023145eb23806e3`.
- Repository topology centralizes production endpoint classification, rejects
  loopback/unspecified endpoints and plaintext protected values, and keeps
  deployment-only fields out of tracked templates. Deployment-mode validation
  additionally requires five ignored exact manifests with one canonical
  `account_id`. It is expected to refuse safely until those external manifests
  and resources exist.

## Blockers

- A provider-side containment result (`UA-006`) is required before any provider
  deployment or new credential-bearing migration/recovery action. Use only the
  affected provider's normal security/audit controls; do not reopen the prior
  browser state, reveal the item, or rotate unrelated credentials.
- Hosted Alpha Lab private-schema and grant proof is recorded; no Data Foundry
  Worker deployment, Hyperdrive, or live Queue/DLQ/R2 integration proof is.
- `df_migration` and the five runtime roles are staged `NOLOGIN` without
  passwords. Pending direct migrations wait on the controlled migration-login
  credential and canonical database-scoped path; every Worker database binding
  waits on its own secure credential and Hyperdrive (`UA-002`).
- The current PostgreSQL policy refuses effective `CONNECT` to any other live
  non-template database and `CREATE` on every database. No current hosted
  inventory proves that cluster boundary yet; a non-empty result is an explicit
  owner/provider topology blocker rather than a condition automation may
  normalize on the shared project.
- The current public data hostname is a Vercel 404, not a Data Foundry runtime.
- Secure `df_migration` credential entry with the exact current-database
  `data_foundry, pg_catalog, extensions` search path, the pending exact-SHA
  migrations, `postMigrationGrants.verificationSql`, then secure activation of
  all five runtime-role credentials, each distinct and using that same exact
  current-database search path,
  `postMigrationGrants.postCredentialVerificationSql`, a successful five-path
  `pnpm runtime-roles:postgres:check`, five cache-disabled Hyperdrives, five
  separate private-canary queues with 14-day retention, and the absent
  raw-artifact and canary receipt buckets are needed in that order before the
  route-less canary can run. Preserve and reverify the standard usage model and
  ordinary 14-day Queue/DLQ pair; never reuse that ordinary pair for any
  private-canary path.
- Public sitemap rate limiting and its ordinary-crawler bypass policy have not
  been configured or verified on the canonical Cloudflare account.
- No real HVAC source has the required exact grants and human rights review.
- RapidAPI and MCP have no live external-channel proof.

## Required User Actions

See `PROJECT_CHECKLIST.md` `UA-001` through `UA-006`. The immediate external
gates are provider-side containment (`UA-006`), rights review (`UA-001`), secure
role/Hyperdrive entry (`UA-002`), RapidAPI enrollment (`UA-004`), and separately
authorized public hostname confirmation (`UA-005`). Filling the schema with
real data depends entirely on `UA-001`: ENERGY STAR remains deferred and
unreviewed, and its review packet's open `[REVIEWER]` questions are the owner's
to answer; automation must not sign, acquire, publish, or contact the publisher.

## Production Impact

The merged Alpha Lab isolation change (`290df13`) governs runtime schema
selection and Hyperdrive transaction isolation/lifecycle. Merged PR #26
tightens migration/runtime-role safeguards, regression coverage, and deployment
documentation only; it made no hosted mutation. The preceding
session performed the hosted private-schema migration and grant activation
described above and merged PR #24. Neither session performed a Worker
deployment, credential creation, source acquisition, publisher contact,
listing, or billing change, and neither touched the shared `public` schema.

## Previous Session Summary

Protected `main` combines usage accounting/auth, corrected Option B rights,
public web, RapidAPI, scheduled acquisition/readiness, MCP, the private-canary
topology, and final runtime least-privilege/export hardening in dependency order
through migration `0028`. Hosted migrations `0027`–`0028` remain pending
separate exact-SHA authorization and application. Earlier
review repairs add a last
practical pre-persistence rights checkpoint, exact historical authorization,
one-client resolution transactions, `source-record-evidence@3`, claim-backed
alias epochs/currentness, identifier-less successor handling, a fail-closed
credential provisioner, bounded provider-controlled input and surface
authorization, recoverable server-clock acquisition leases with
non-owner capability redaction, request-bounded keyset sitemap enumeration,
same-account deployment validation, and non-actionable HVAC source research
consistent with the owner decisions.
