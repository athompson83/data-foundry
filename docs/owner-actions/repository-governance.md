# Owner actions — repository governance

Last verified: 2026-08-30.

This runbook separates controls already applied and verified from the one
remaining account-level action. Do not create a second `main` ruleset: update
ruleset `21855694` if the policy changes.

## Verified GitHub configuration

| Control | Verified state |
| --- | --- |
| Default branch | `main`; protected |
| Branch ruleset | `21855694` (`main`), branch target, `active`, includes `~DEFAULT_BRANCH`, no exclusions |
| History protection | Branch deletion and non-fast-forward updates are blocked |
| Pull requests | Required; zero approvals; review-thread resolution required; no extra unattributed-change approval |
| Required checks | Strict/up-to-date policy; `typecheck • test • migrations • vertical config` and `migrations on real Postgres`, both bound to GitHub Actions App ID `15368` |
| Recovery bypass | Repository owner user ID `169842419`, `always`; recovery only, never a release shortcut |
| Private vulnerability reporting | Enabled |
| Dependabot | Vulnerability alerts and automated security updates enabled |
| Secret scanning | Secret scanning and push protection enabled |
| Repository webhooks | Empty (`[]`) |

The optional secret-scanning non-provider patterns and validity checks were
disabled at this snapshot. They are not substitutes for the repository's own
secret-free configuration checks and are not release gates currently recorded
in `SECURITY.md`.

## Reverify each release candidate

Repository settings are not exact-SHA release evidence. After every candidate
push:

1. Read the complete ruleset payload and confirm the fields above still match:

   ```powershell
   gh api repos/athompson83/data-foundry/rulesets/21855694
   gh api repos/athompson83/data-foundry/branches/main
   ```

2. Require both named GitHub Actions checks on the exact PR head. A green run on
   an older commit does not certify a new candidate.
3. Inspect the weekly rule-suite results, match the suite to the repository,
   ref, and exact `after_sha`, then require the suite's top-level result to be
   `pass`, never `bypass`:

   ```powershell
   gh api "repos/athompson83/data-foundry/rulesets/rule-suites?time_period=week&per_page=100"
   ```

4. Merge without an admin/bypass option. Reverify the resulting `main` SHA and
   its hosted checks before treating it as a deployment candidate.

The owner bypass exists only for recovery from an incident such as a corrupted
branch or committed secret. Routine red or pending checks must not be bypassed.

## Remaining owner-only Vercel access check

The following is verified:

- the connected Vercel team has no Data Foundry project;
- the repository has no webhook;
- recent Data Foundry commits have no Vercel status;
- the Vercel GitHub App installation exists as installation `122728140`.

The exact repository selection for that installation remains unverified. GitHub
requires an owner sudo/passkey confirmation before showing its configuration;
the current automation credential cannot complete that independent
authentication ceremony or expand its own `read:user` scope.

Owner action:

1. Open <https://github.com/settings/installations/122728140> and complete the
   GitHub sudo/passkey prompt.
2. Inspect **Repository access**.
3. If `athompson83/data-foundry` is selected, remove only that repository. If
   the installation has access to all repositories, change the selection only
   after checking the impact on other Vercel-managed repositories.
4. Record the resulting repository-selection state without recording tokens or
   credentials.

This action blocks only obsolete-Vercel hygiene. It does not block protected
merge, Cloudflare deployment, rights-model operation, or synthetic-data runtime
verification.

Keep `vercel.json` until the installation check proves Data Foundry has no
remaining Vercel repository access. Delete it in a separately verified cleanup
change only after that proof; absence of a Vercel project alone is insufficient.
