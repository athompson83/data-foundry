# PR #47 — local verification record

Recorded 2026-09-16, as the PR direction requires. Every command below was
executed in this environment; every result is its actual output, including the
failures.

## Why this record exists rather than only a CI link

While the pull request was a draft, **CI did not run on it at all.** All three
jobs in `.github/workflows/ci.yml` are gated on
`github.event.pull_request.draft == false`, so the runs created for `e177e2d`
([35156997717](https://github.com/athompson83/data-foundry/actions/runs/35156997717))
and `8820914` ([35158953798](https://github.com/athompson83/data-foundry/actions/runs/35158953798))
each reported **all three jobs `skipped`** — including `select required checks`,
which has no other condition. For that window this record was the only
verification signal available, which is why the whole `verify` job is reproduced
below rather than a subset.

The PR has since been marked ready for review under explicit owner
authorization, and CI runs on it normally again. The record stays because it
covers things CI does not: the pre-fix regression proofs, the live-libpq
reproduction, and the checks the workflow does not run.

## Hosted state of the exact-head run, inspected

[Run 35156090216](https://github.com/athompson83/data-foundry/actions/runs/35156090216)
on exact head `e031e4b`:

| Job | Conclusion | Completed |
| --- | --- | --- |
| select required checks | **success** | 22:10:49Z |
| migrations on real Postgres | **success** | 22:12:07Z |
| typecheck • test • migrations • vertical config | **success** | 22:24:19Z |

**The run object's own conclusion is `cancelled`, not `success`** — it was
superseded after all three jobs had already completed. The job conclusions are
the substance; the run-level `cancelled` reflects supersession, not a failure.

That supersession was my error: I pushed `e177e2d` at 22:18Z while the third
job was still running, having read a monitor event for the Postgres job as the
whole run finishing. The direction was to wait for the exact-head run to finish
and be inspected. It has now finished and is inspected, above.

## What the repair changed

Three review findings, each verified against primary evidence before any edit.
All three were in the same operator-facing block, and each was a way for a
documented procedure to fail while looking correct:

1. **P1 — invalid Supavisor login.** `.pgpass` and the connection URL hard-coded
   a bare `df_migration`, while `docs/evidence/ua002-execution-environment-20260916.md:165-166`
   already recorded that the pooler's role name is project-qualified. The IPv4
   fallback the same section recommends would have failed authentication.
2. **P2 — invalid `.pgpass` encoding.** `:` is the field separator and `\` the
   escape character in `.pgpass`; a valid password containing either was written
   as structure rather than data.
3. **P2 — append instead of replace.** libpq uses the first matching line, so a
   stale entry from an earlier password beat the correct one appended below it.
   Reproduced against a live cluster; see the section below.

The database-side identity assertion is unchanged: the runner still requires
`session_user` and `current_user` to both be `df_migration` and refuses the run
otherwise. Certificate verification, the no-password-in-URL property, and every
existing migration and grant gate are untouched — the diff adds tests and edits
one operator document.

## Regression coverage added

Prose assertions alone would let the snippet drift from what it claims, so both
new files **execute** the artifact under test.

`tooling/test/ua002-credential-placement-doc.test.ts` (13 tests) extracts the
documented `.pgpass` block from the handover and runs it verbatim under `bash`
with a throwaway `HOME`, then parses the result back with libpq's own rule
(unescaped `:` separates, `\` escapes the next character). Passwords used are
fictional strings chosen to contain the metacharacters — `pa:ss\wo:rd` and
`:\:\` — and no real credential is referenced.

`tooling/test/ci-postgres-readiness.test.ts` (5 tests) extracts the readiness
loop from the workflow and drives it against a stubbed probe replaying the
observed race: one success from the temporary `initdb` server, then that server
going away, then the real server. No container, no database, no network.

**Both were checked against the pre-fix revisions, because a regression test
that passes on the broken version proves nothing:**

| Test file | Against | Result |
| --- | --- | --- |
| `ua002-credential-placement-doc.test.ts` | doc at `e031e4b` (pre-fix) | **9 of 11 failed** |
| `ua002-credential-placement-doc.test.ts` | doc at HEAD | 13 passed |
| `ua002-credential-placement-doc.test.ts` | doc at `8820914` (append-only) | **2 of 13 failed** |
| `ci-postgres-readiness.test.ts` | `ci.yml` at `0620672` (socket probe) | **4 of 5 failed** |
| `ci-postgres-readiness.test.ts` | `ci.yml` at HEAD | 5 passed |

The tests that pass on both are the ones that were already true before the fix
(the block exists; the URL carried no password; the step fails closed).

## Third finding: the `.pgpass` write replaced an entry, it did not append

Raised on `8820914` and **reproduced against real libpq before any edit**, not
reasoned about from documentation.

A throwaway PostgreSQL 16 cluster with `scram-sha-256` password authentication
was started on port 5433, and `psql` was pointed at it through a `.pgpass` whose
contents were varied:

| `.pgpass` contents | Result |
| --- | --- |
| correct entry only | **connects** |
| stale entry first, correct entry second | **`password authentication failed`** |
| correct entry first, stale entry second | **connects** |

The middle row is exactly what the append-only procedure produced after a
password rotation: the operator follows the documented steps, gets a correct
entry appended below a stale one, libpq takes the first match, and the error
blames the credential rather than the file.

The block now drops any existing entry for the same host, port, database and
login with `awk`, writes through a temporary file in the same directory, and
`mv`s it into place. **Verified end-to-end against the same live cluster**, with
a stale entry and an unrelated credential both seeded first:

```
.pgpass BEFORE
  127.0.0.1:5433:postgres:pgowner:STALE-old-password
  other.host:5432:otherdb:otheruser:keep-me

.pgpass AFTER running the documented block
  other.host:5432:otherdb:otheruser:keep-me
  127.0.0.1:5433:postgres:pgowner:correct-horse
  mode 600, no temporary file left behind

psql using it -> pgowner
```

The stale entry is gone, the unrelated credential survives, and the connection
actually authenticates. The cluster was destroyed afterwards; it held nothing
but the fictional password above.

Two tests were added for it, and the stale-entry one fails against the
append-only block at `8820914`.

## The TCP readiness repair, verified locally

The loop was extracted from the workflow and driven with a stubbed `docker`
replaying fixed probe outcomes (`y` = probe succeeds) and a stubbed `sleep`:

| Probe sequence | Meaning | Result |
| --- | --- | --- |
| `y n n y y…` | init server answers once, shuts down, real server starts | `ready=true` after **5 probes** |
| `y y y…` | healthy from the start | `ready=true` after 2 probes |
| `y n y n…` | flickering, never two in a row | `ready=false` after 60 probes |
| `n n n…` | never ready | `ready=false` after 60 probes |

The first row is the repair working: the predecessor declared readiness on the
first success, at probe 1, and the next step then failed with *"the database
system is shutting down"*. Rows three and four confirm it still fails closed
rather than proceeding.

## Exact commands and results

### Full `verify`-job parity — every step, in workflow order

Run on `8820914`. The commit that followed changes only this record, `PROGRESS.md`,
one operator document and one tooling test file, so the narrowest relevant checks
were re-run for it rather than the whole job again (AGENTS.md: *"Run the narrowest
relevant local checks first, and broaden only when shared code, schemas,
migrations, security boundaries, or release behavior changed."*). On that head:
`pnpm typecheck` PASS, `pnpm vitest run tooling/test` PASS at **40 files / 758
tests**, markdown link check 114 links with the same 6 pre-existing breakages and
no new ones.

```
pnpm typecheck                                      PASS
pnpm test                                           PASS   224 files, 3510 tests
pnpm migrate:check                                  PASS
pnpm schemas:check                                  PASS
pnpm openapi:check                                  PASS
pnpm cloudflare:topology:check                      PASS
pnpm verticals:validate                             PASS
pnpm verticals:compile:check                        PASS
pnpm acquisition:check                              PASS
pnpm ingestion:check                                PASS
pnpm mcp:compile:check                              PASS
pnpm web:compile:check                              PASS
pnpm cloudflare:artifacts:check                     PASS
pnpm cloudflare:synthetic-ingestion:artifacts:check PASS
```

`pnpm lint` also passes. The 3510 total includes the 16 tests added here.

### Workflow YAML validation

```
.github/workflows/ci.yml   parsed OK — 3 jobs, 42 steps
```

### Shell syntax check of every workflow `run:` block

Each `run:` block was extracted, GitHub `${{ … }}` expressions substituted, and
checked with `bash -n`:

```
shell run-blocks syntax-checked: 37, failures: 0
```

### Markdown relative-link check

All 113 relative links across every tracked `.md` file were resolved against the
filesystem.

```
relative markdown links checked: 113
broken: 6
```

**All six are pre-existing and outside this PR's scope.** They are in
`docs/reference/platform-reference-20260903.md`, which this PR does not touch,
and all six are the same mistake — repository-root paths written inside a file
in `docs/reference/`, so they resolve to `docs/reference/docs/…`:

```
docs/decisions/ADR-0011-web-frontend-and-multi-industry-sites.md   (×2)
docs/decisions/ADR-0006-cloudflare-is-the-deployment-target.md
docs/evidence/alpha-lab-provider-reconciliation-20260831.md
docs/owner-actions/cloudflare-deployment.md
docs/owner-actions/revenue-readiness.md
```

Every target exists at the repository root, so the fix is to make each link
relative to the file (`../decisions/…`, `../owner-actions/…`). **Not applied
here** — it would widen a PR that is under review for something else. It is a
separate one-file change whenever wanted.

## What this does not verify

- **Nothing hosted.** No hosted migration was applied, no credential was
  created, requested or used, and no provider state was changed.
- **No real-Postgres job locally.** `migrations on real Postgres` is green on
  `e031e4b` in CI; the commits after it change only documentation and tests, but
  that job has not re-run because the PR is a draft.
- **Not a deployed-runtime proof.** Unchanged from the PR's own statement: no
  Cloudflare Worker, Queue, R2 or hosted database is exercised by any of this.
