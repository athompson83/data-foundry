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
4. **P2 — exact-match filter missed wildcards.** Any of the first four fields may
   be `*`, so a stale `*:*:*:<login>:…` survived the filter and, being earlier in
   the file, still won.
5. **P2 — a cancelled prompt was destructive.** With stdin at EOF the password
   was empty, the block replaced a working credential with an empty-password
   entry, and it exited 0.
6. **P2 — a failed rewrite was still installed.** With a writable-but-unreadable
   `.pgpass`, `awk` failed, `mv` installed a file containing only the new entry,
   every unrelated credential was destroyed, and the block reported success.

All three of the later findings were reproduced against a live cluster before
any edit; see the sections below.

The database-side identity assertion is unchanged: the runner still requires
`session_user` and `current_user` to both be `df_migration` and refuses the run
otherwise. Certificate verification, the no-password-in-URL property, and every
existing migration and grant gate are untouched — the diff adds tests and edits
one operator document.

## Regression coverage added

Prose assertions alone would let the snippet drift from what it claims, so both
new files **execute** the artifact under test.

`tooling/test/ua002-credential-placement-doc.test.ts` (19 tests) extracts the
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
| `ua002-credential-placement-doc.test.ts` | doc at HEAD | 19 passed |
| `ua002-credential-placement-doc.test.ts` | doc at `8820914` (append-only) | **2 of 13 failed** |
| `ua002-credential-placement-doc.test.ts` | doc at `3b46ced` (exact-match, unguarded) | **4 of 18 failed** |
| `ua002-credential-placement-doc.test.ts` | doc at `29f142c` (ungated write) | **1 of 19 failed** |
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

## Fourth and fifth findings: wildcards, and the cancelled prompt

Both raised on `3b46ced`, both reproduced against a live PostgreSQL 16 cluster
with `scram-sha-256` before any edit.

**Wildcards.** libpq allows `*` in any of the first four fields, and a wildcard
counts as a match:

| `.pgpass` contents | Result |
| --- | --- |
| `*:*:*:pgowner:correct-horse` alone | **connects** |
| `127.0.0.1:5434:*:pgowner:correct-horse` alone | **connects** |
| stale `*:*:*:pgowner:OLD` first, exact entry second | **`password authentication failed`** |
| exact entry first, stale `*:*:*:pgowner:OLD` second | **connects** |

So dropping only the *exact* duplicate was not enough. The fix is ordering: the
new entry is written **first**, ahead of everything retained, which the last row
shows is sufficient. The wildcard is deliberately **kept** — it may be serving
the operator's other hosts, and deleting it would break connections this
procedure has no business touching. That was the obvious way to overcorrect.

**The cancelled prompt.** Running the `3b46ced` block with stdin at EOF against a
`.pgpass` holding a working credential:

```
BEFORE  <host>:5432:<database>:<login-name>:THE-OPERATORS-REAL-PASSWORD
block exit: 0
AFTER   <host>:5432:<database>:<login-name>:
```

Worse than the finding described: it destroyed a working credential, wrote an
empty password, and **reported success**. The block now requires `read` to
succeed and yield something non-empty before writing anything, and says when it
declines.

**Both fixes verified end-to-end on the same cluster.** With a stale wildcard and
an unrelated credential seeded, the new entry lands first, both existing lines
survive, and `psql` authenticates. With stdin at EOF, `.pgpass` is byte-identical
afterwards and the original credential still authenticates.

Four of the five tests added for these fail against the block at `3b46ced`. The
fifth — that a wildcard is preserved — passes on both, because the earlier
exact-prefix filter also left wildcards alone.

The cluster was destroyed afterwards. It held nothing but fictional passwords.

## Sixth finding: a failed rewrite was installed anyway

Raised on `29f142c`, reproduced before any edit. No database needed — the
failure is in the file handling.

A `.pgpass` holding two unrelated credentials was made writable but not readable
(mode 200) and the block run as a non-root user:

```
BEFORE  other.host:5432:otherdb:otheruser:UNRELATED-CREDENTIAL-1
        third.host:5432:db3:user3:UNRELATED-CREDENTIAL-2

awk: cannot open "…/.pgpass" (Permission denied)
~/.pgpass updated for <login-name> at <host>:5432/<database>
exit: 0

AFTER   <host>:5432:<database>:<login-name>:newpassword
```

Both unrelated credentials destroyed, and the block said it had succeeded. The
temporary file protected against a *partial* write but nothing checked whether
the rewrite had worked before installing it.

`chmod` and `mv` are now chained onto the rewrite succeeding, and the temporary
file is removed when it fails. Verified: with the same unreadable file the block
declines, says *"~/.pgpass left unchanged: could not rewrite it."*, both
credentials survive and no temporary file is left; the ordinary path still
writes the new entry first, keeps the unrelated entry, and lands at mode 600.

The test stands in for the permission denial with a failing `awk`, because the
suite runs as root and root can read a mode-200 file. It fails against `29f142c`.

## A pattern worth stating rather than burying

Six findings, four review rounds, one shell snippet — and **CI was green for
every one of them**. The checks that gate this repository do not reach a
procedure written in prose, which is why these tests execute the block instead
of asserting its text.

Each finding was real and each fix was verified, but the shape of the artifact is
the problem: a pasteable shell block that mutates a credential file has many
failure modes and no natural place to handle them. The structural answer is to
extract it into a tested script that the document references, with
`set -euo pipefail` and real error paths. That is not done here — it is a larger
change than these findings call for and would widen a pull request already under
review — and it is recorded as the owner's call.

## Resolution: a dedicated password file, verified against the real runner

Six findings on one inline shell block, four review rounds, CI green throughout.
Each was real and each fix was verified, but they share one cause: the procedure
mutated `~/.pgpass`, a file the operator owns and other tools use. Ordering
rules, wildcard precedence, metacharacters, cancelled input and failed rewrites
are all consequences of editing someone else's file in place.

The block is replaced by `tooling/scripts/ua002-migration-pgpassfile.sh`, which
writes **one file this project owns** and never reads, rewrites or removes
`~/.pgpass`. The class is gone by construction rather than case by case.

### Alternate-file support was confirmed through the real runner first

This design is only valid if the migration runner honours a password file at
all, so that was measured before adopting it — not inferred. `tooling/scripts/migrate.ts`
connects with `pg`, whose client consults `pgpass` only when the connection
carries no password, and `directPostgresTlsConfig` sets none.

A throwaway PostgreSQL 16 cluster with `scram-sha-256` and certificate-verified
TLS was started, and `createPostgresDriver` itself was called against it:

| Case | Result |
| --- | --- |
| `~/.pgpass` holds the password, URL carries none | **connects** |
| no password file at all (control) | fails — `client password must be a string` |
| `PGPASSFILE` names an alternate file | **connects** |
| `PGPASSFILE` correct while `~/.pgpass` holds a **wrong** password | **connects** |

The control rules out a false positive, and the last row proves the alternate
file is genuinely the one consulted rather than coincidentally agreeing with
`~/.pgpass`.

### The helper, end-to-end against the same cluster

Run with a decoy `~/.pgpass` containing a deliberately wrong password:

```
helper printed:
  export PGPASSFILE='…/.data-foundry/ua002.pgpass'
  export DATA_FOUNDRY_MIGRATION_DATABASE_URL='postgresql://pgowner@127.0.0.1:5435/postgres'

connect through the real runner -> CONNECTED as pgowner
decoy ~/.pgpass afterwards      -> byte-identical
secret in the helper's stdout   -> none
```

The cluster was destroyed afterwards and held nothing but fictional passwords.

### Acceptance conditions, and where each is pinned

`tooling/test/ua002-migration-pgpassfile.test.ts` (14 tests), no database needed:

| Condition | How it is covered |
| --- | --- |
| Cancelled or empty input performs no update | EOF and empty-string cases; existing file byte-identical |
| File operation failures prevent success reporting | `mktemp`, `chmod`, `mv` each stubbed to fail: non-zero, no `export` printed, existing file intact |
| Unrelated credentials unchanged | `~/.pgpass` seeded and asserted byte-identical; structurally never opened |
| Temporary material cleaned up | Directory listing asserted to hold only the target, on success and on each failure |
| Secrets absent from arguments, history, logs | `--password` refused outright; password read from a prompt; stdout and stderr asserted not to contain it |
| Non-zero status without killing the operator's shell | Separate process; exit status asserted greater than zero |
| Existing authentication, identity and TLS checks intact | The runner is untouched; the handover still names the `session_user`/`current_user` assertion as the check |

`tooling/test/ua002-credential-placement-doc.test.ts` (7 tests) now asserts only
that the document points at the helper and does not reintroduce a second,
untested procedure — including a guard that no snippet writing to `~/.pgpass`
reappears.

## Seventh finding: the caller's environment, which owning the file does not fix

Raised against `46abc2f`, after `417ed14` had already replaced that block. It
splits into two halves that land differently, which is worth separating rather
than answering as one.

**The status half was already resolved structurally.** The block the finding
targets no longer exists — `unset df_pw` and the `awk` filter both appear zero
times in the document at `417ed14`. The helper exits non-zero on every failure
path, measured on the current head:

```
mktemp fails -> exit 1, no `export` on stdout
chmod  fails -> exit 1, no `export` on stdout
mv     fails -> exit 1, no `export` on stdout
cancelled    -> exit 1
```

Being a separate process is what makes that possible without `errexit`
terminating an interactive shell — the objection that stood twice against the
inline form.

**The stale-environment half survived the redesign, and is the first finding on
this procedure that did.** The helper prints exports for the operator to run, so
a failure prints none — but `PGPASSFILE` or `DATA_FOUNDRY_MIGRATION_DATABASE_URL`
exported by an *earlier* attempt stays live in that shell, and the next
migration command would use it silently. Owning the password file does nothing
about the caller's environment.

The helper now names both variables on every failure path, and the handover
tells the operator to clear them before starting, stating plainly that the
helper cannot do it for them. A test asserts the warning on a cancelled prompt
and on an `mv` failure.

The first six findings were all consequences of mutating `~/.pgpass`, and the
redesign made them impossible. This one is about a different thing, and no
amount of care inside the helper would have reached it.

## Eighth finding, P1: an interrupted run installed a world-readable password file

Raised against `417ed14`, on the helper itself rather than on the document. It
is the most serious defect found in this pull request, and the redesign
introduced it.

`trap cleanup EXIT INT TERM` ran a handler that removed the temporary file and
**returned**. A handler that returns does not end the script: the shell resumes
where it left off. So a `SIGINT` arriving after `mktemp` produced this sequence —
handler deletes the temporary file, script carries on, the redirection
*recreates* it under the ambient umask, and `mv` installs it.

Reproduced deterministically by stubbing `chmod` to signal the script and then
succeed, under the common `umask 022`:

```
script exit: 0
INSTALLED FILE MODE: 644
contents: h:5432:d:l:SECRET-PASSWORD
-rw-r--r--
```

A **world-readable file containing the migration password**, installed while the
script reported success. A handler that cleans up and returns is worse than no
handler at all.

Two changes. The signal handlers now clean up, clear the `EXIT` trap and exit
(130 for `INT`, 143 for `TERM`), while `EXIT` keeps the ordinary cleanup for
every other way out. And `umask 077` is set at the top, so no path that creates
the file — including one that recreates it — can depend on the caller's umask.

Same reproduction after the fix:

```
script exit: 130
no file installed
leftovers: (none)
```

and an ordinary run under `umask 022` still lands at mode 600 in a 700
directory.

Two tests cover it. The interruption test fails against `417ed14`. The
umask-independence test passes against both, because `mktemp` and the explicit
`chmod` already produced 600 on the *ordinary* path — only the interrupted path
ever reached the ambient umask, and saying so is more useful than counting it as
new coverage.

## Ninth round: four findings, one of them procedural rather than mechanical

All four raised against `ab12e4c` and all four reproduced before any edit.

**P1 — the helper does not exist at the release the procedure checks out.** The
execution sequence ran `git checkout 2063ea8…` and then reached for the helper.
Verified directly:

```
$ git cat-file -e 2063ea8:tooling/scripts/ua002-migration-pgpassfile.sh
fatal: path '…' exists on disk, but not in '2063ea8'
```

So the documented command would have failed with *"No such file or directory"*
at exactly the point the credential had to be placed. This is the first finding
in this series about the **procedure as a whole** rather than about the
credential mechanism, and no amount of testing the helper in isolation would
have caught it.

The password file lives outside the checkout and does not depend on the revision
checked out, so the credential step now comes **first**, with the reason stated.
A test asserts the ordering by index rather than by prose, and will keep holding
when the document is rebound to a release that does contain the helper.

**P2 — later blocks overwrote the password-free URL.** Two blocks re-exported
`DATA_FOUNDRY_MIGRATION_DATABASE_URL='...'` "from the secret store", which would
have replaced the helper's password-free URL with a secret-bearing one and
bypassed `PGPASSFILE` entirely — undoing the whole point of the redesign further
down the same document. Both now say the value is already set and must not be
re-exported. A test forbids the placeholder returning.

**P2 — the emitted exports broke on a quoted path.** The operator is told to run
them verbatim, and a `HOME` such as `/home/o'connor` produced
`export PGPASSFILE='/tmp/o'connor-…'` — an unterminated string. Now emitted with
`printf %q`. The test asserts what the exports *evaluate* to rather than how they
are spelled, which is the property that actually matters.

**P2 — a directory target succeeded.** `mv source directory` moves the source
*into* it and returns 0, so with the target already a directory the helper
reported success while `PGPASSFILE` pointed at a directory and the password sat
in a randomly named file inside:

```
exit: 0
files inside the directory: 1  ->  h:5432:d:l:SECRET
```

Directory targets are now rejected outright — `mv -T` would also cover it but is
not portable. After the fix: exit 1, nothing written inside.

All five tests added for this round fail against `ab12e4c`.

## Tenth round: pinning the helper, and proving the whole path end to end

### How the release and the helper are pinned

The migration release stays at `2063ea8`. Moving it was the other option and was
rejected: that SHA is woven through this document's packet exports, checksums and
grant values, and changing it would require regenerating and re-verifying all of
them for a reason that has nothing to do with migrations.

The helper instead travels with **this document**. The sequence copies it out of
the checkout the operator is reading from — an immutable reviewed revision,
named by no branch and by no commit that refers to itself — records its SHA-256,
and re-verifies that digest after the release is checked out, when the tree no
longer contains the file:

```bash
cp tooling/scripts/ua002-migration-pgpassfile.sh "$UA002_DIR/"
shasum -a 256 "$UA002_DIR/ua002-migration-pgpassfile.sh" | tee "$UA002_DIR/helper.sha256"
…
git checkout 2063ea8d72247a9b2643e1c690e37ab55ab14252
shasum -a 256 -c "$UA002_DIR/helper.sha256"
"$UA002_DIR/ua002-migration-pgpassfile.sh" --check
```

### The complete documented path, exercised

Run in an isolated checkout against disposable PostgreSQL 16 with
`scram-sha-256` and certificate-verified TLS, through **`createPostgresDriver`
itself**. The release checkout was simulated by deleting the helper from the tree
at the point the real `git checkout` would remove it, and a decoy `~/.pgpass`
holding a different credential was present throughout:

```
step 0: helper preserved, digest 479856ec86c95450b1af1541…
step 1: export PGPASSFILE=…/.data-foundry/ua002.pgpass
        export DATA_FOUNDRY_MIGRATION_DATABASE_URL=postgresql://pgowner@127.0.0.1:5436/postgres
simulate checkout: helper files left in tree: 0
step 2: shasum -c -> OK
        --check   -> environment is ready
real migration driver -> CONNECTED as pgowner
decoy ~/.pgpass -> byte-identical
```

So the instructions can be followed as written, and the credential they produce
authenticates through the code the operator will actually run. Nothing hosted was
touched; the cluster was destroyed and held only fictional passwords.

### `--check`, so missing settings stop the procedure

`--check` verifies `PGPASSFILE` and `DATA_FOUNDRY_MIGRATION_DATABASE_URL` are
set, that the password file exists, is a regular file and is owner-only, and
that the URL carries no password. It exits non-zero on each, so a chained
procedure stops instead of reusing settings from an earlier attempt. It is
invoked after the checkout and again before the preflight.

### Destination and quoting hardening

Directories were already rejected; symlinks pointing at directories are now
rejected with their own message, `mv -T` is used where supported (probed, since
BSD `mv` has no equivalent), and the destination is re-checked immediately
before the move because the first check and the move are not atomic.

The emitted exports were tested by evaluating them in a separate shell with a
path containing spaces, a path containing a single quote, and a path containing
`$(touch EXECUTED)`. Values come back exactly, and the marker file is never
created — no command from the path is executed.

Five of the tests added this round fail against `9deefb1`. Two pass against both:
the space and quote cases, because `printf %q` landed in the previous round. One
more passes there only because `--check` was an unknown argument at that
revision and the helper died on it — a coincidental pass, not coverage.

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

## Correction: branch-candidate evidence already exists

I previously said the sanitized verification evidence was waiting on the merge,
because `workflow_dispatch` only resolves against a workflow file on the default
branch. That conflated the **trigger** with the **artifact**. The evidence step
runs in the real-Postgres job on every run, including pull-request runs, so
passing evidence already existed on the branch.

Read back from
[run 35165734258, job 105026309326](https://github.com/athompson83/data-foundry/actions/runs/35165734258/job/105026309326),
emitted 2026-09-17T00:15:48Z for `29f142c`:

- `kind: disposable-postgres-e2e-integration-proof`, `overall: "pass"`
- all **ten** stages `success`, individually listed
- both pinned fixtures `pinnedDigestMatches: true`
  (`acme-catalog.json`, `ahri-export.csv`)
- `gitSha` pinned to the exact head

**What it is:** branch-candidate disposable-PostgreSQL integration evidence.
**What it is not:** completed full CI for that head, review approval, a merge, a
`workflow_dispatch` run, or anything hosted. Only the dispatch trigger needs
`main`; the artifact never did.
