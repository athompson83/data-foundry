# Owner actions — repository governance

Three things this repository needs that **no tool available to automation here
can reach**. Each is stated as a checklist precise enough to execute without
further research, plus the exact evidence for why it is needed and how to verify
it afterwards.

Why automation cannot do these: GitHub access in this environment is through the
GitHub MCP server, which exposes no surface for rulesets, branch protection, or
repository security-and-analysis settings. Direct `api.github.com` calls are
intercepted by the environment proxy and return **HTTP 403** before reaching
GitHub. This is a **tool-surface gap, not a permission denial** — nothing here
establishes whether the account has the rights to make these changes.

---

## 1. Branch ruleset on `main`

### Evidence of the current state

`mcp__github__list_branches` reports `"protected": false` for `main` and for
every other branch. **[VERIFIED]** GitHub sets `protected: true` when either a
legacy branch-protection rule or an **active** ruleset restricts the branch.

**What that does not prove.** `protected: false` is silent about rulesets in
`disabled` or `evaluate` enforcement — those are excluded from the rule-listing
APIs and do not mark a branch protected. So the accurate statement is *no active
protection applies to `main`*, not *no ruleset object exists*. During review of
this pull request, a `GET /repos/athompson83/data-foundry/rulesets` call from an
environment with GitHub API access returned an empty list, which closes that gap
— recorded here as **corroborating evidence obtained during review**, not as
something this document's author verified directly.

Behavioural support: pull request #3 merged at 2026-08-22T00:03Z with **zero
approving reviews**, and #2 merged with a red `Vercel` status. That is
*supporting* evidence only — both were merged by the repository owner, who would
be able to bypass a ruleset anyway, so it cannot distinguish "no rule" from
"rule bypassed".

### Design intent

A solo maintainer must not be forced through a review requirement nobody can
satisfy. An "outside review required" rule on a one-person repository does not
add safety — it adds a bypass habit, and a bypass habit is worse than no rule.
So: **require the checks, require the pull request, require zero approvals.**
Raise the approval count on the day a second trusted maintainer exists, not
before.

### Checklist

`https://github.com/athompson83/data-foundry/settings/rules` → **New ruleset** →
**New branch ruleset**

| Setting | Value |
| --- | --- |
| Ruleset name | `main` |
| Enforcement status | **Active** |
| Bypass list | **Repository admin** (see §1a) |
| Target branches | Include **default branch** |

Rules to enable:

- [ ] **Restrict deletions** — blocks deleting `main`
- [ ] **Block force pushes** — blocks history rewrites on `main`
- [ ] **Require a pull request before merging**
  - [ ] Required approvals: **0**
  - [ ] **Require conversation resolution before merging**: ✅
  - [ ] Dismiss stale approvals: leave off while approvals are 0
- [ ] **Require status checks to pass**
  - [ ] Require branches to be up to date before merging: ✅
  - [ ] Add these two checks **by these exact names**, both from the
        `GitHub Actions` source:
    - `typecheck • test • migrations • vertical config`
    - `migrations on real Postgres`

### A correction worth making explicitly

These are **two** checks, not four. Four contexts appear on a pull request
because `.github/workflows/ci.yml` runs on both `push` and `pull_request`, so
each of the two jobs is reported twice. A ruleset asks for **job names**, and
there are two. Adding four names, or four copies, would create a required check
that never reports and would block every merge.

### Do NOT

- Do not require approvals above 0 until a second maintainer exists.
- Do not add `Vercel` or `CodeRabbit` as required checks. Neither is a repository
  gate; CodeRabbit is advisory and Vercel should be gone entirely (§3).
- Do not enable "Require signed commits" without first confirming that
  automation commits to this repository can be signed — it would silently break
  every agent-authored branch.

### 1a. About the admin bypass

Leaving **Repository admin** on the bypass list is deliberate and should be
written down rather than left implicit: with zero required approvals, the only
thing the ruleset stops an admin from doing is force-pushing or deleting `main`
by accident. The bypass exists for **recovery** — a corrupted `main`, a secret
committed by mistake — and for nothing else. Using it to skip a red check is the
thing it must never be used for, and it leaves an audit trail when used.

### Verify afterwards

`protected: true` is necessary and nowhere near sufficient: it says *something*
restricts the branch, not that the right thing does. It cannot tell you the
ruleset targets `main`, that every rule above is present, that enforcement is
`active` rather than `evaluate`, or who can bypass it.

So verify against the ruleset payload itself — and enumerate **completely**,
because a partial enumeration produces a confident false green:

- [ ] `GET /repos/athompson83/data-foundry/rulesets?includes_parents=true&per_page=100`
      — capture the list **before** creating anything, so "there was nothing
      here" is on the record. Two things this must not skip:
  - [ ] **Pagination.** Follow the `Link: rel="next"` header until it is absent.
        A ruleset on page 2 is a ruleset you did not check.
  - [ ] **Inherited organisation-level rulesets.** `includes_parents=true` is
        what surfaces them. A repository-scoped listing can be empty while an
        org ruleset governs the branch — and an org ruleset can also *add* a
        bypass actor that no repository payload mentions.
- [ ] Cross-check with `GET /repos/athompson83/data-foundry/rules/branches/main`,
      which resolves everything that actually applies to `main` from every
      source. Note its documented blind spot: it omits rules from rulesets in
      `disabled` or `evaluate` enforcement, so it complements the ruleset
      listing rather than replacing it.
- [ ] After creating it, re-list with `includes_parents=true` and then
      `GET /repos/athompson83/data-foundry/rulesets/{id}` **for every ruleset in
      that listing whose target matches `main`** — not only the one you just
      made. Each ruleset carries its own target, enforcement, rules and
      `bypass_actors`, so an inherited organisation ruleset can add a bypass
      actor that your new repository ruleset never mentions. Checking only your
      own ruleset verifies your intent, not the branch's actual protection.
      Confirm for each of them, field by field:
  - [ ] **Target matching.** `target: "branch"`, and
        `conditions.ref_name.include` contains `~DEFAULT_BRANCH` (or
        `refs/heads/main`) with nothing in `exclude` that cancels it. A ruleset
        that targets `~ALL` and excludes `main`, or targets a pattern that does
        not match, is active and irrelevant.
  - [ ] **Enforcement mode.** `enforcement: "active"` — **not** `"evaluate"`,
        which reports without blocking and is indistinguishable from active in
        every UI summary, and not `"disabled"`.
  - [ ] `rules` contains `deletion`, `non_fast_forward`, `pull_request` (with
        `required_approving_review_count: 0` and
        `required_review_thread_resolution: true`), and
        `required_status_checks` naming **both** job names exactly
  - [ ] **`strict_required_status_checks_policy: true`.** This is the
        "branches must be up to date before merging" control, and it is a
        *required* parameter of the rule — so it is always present, and the
        thing to catch is it being present and `false`. Left `false`, a green
        check from a commit that never saw the current `main` satisfies the
        rule: the checks passed against an older tree, and the merge result was
        never tested. Absent entirely means a malformed payload, not a default.
  - [ ] **Bind each required check to its source.** Every
        `required_status_checks[].integration_id` must be the **GitHub Actions
        App ID**. A check entry with no `integration_id` is satisfied by
        *anything* that can put a matching context on the commit — a commit
        status (`statuses: write`) or a check run created by an installed
        GitHub App (`checks: write`). Both paths are real here: our two required
        checks are Actions **check runs**, not commit statuses, which is why a
        commit-status-only reading of this rule would predict our own CI could
        never satisfy it. So an unbound entry requires only that *something*
        posted a green context with the right name — not that our CI ran. If you
        deliberately want any source to satisfy it, record that decision here
        rather than leaving the field absent unintentionally.
  - [ ] **First, confirm you can even see `bypass_actors`.** GitHub returns it
        only to a caller with **write access to the ruleset**: *"To prevent
        leaking sensitive information, the bypass_actors property is only
        returned if the user making the API request has write access to the
        ruleset."* A read-only token therefore produces a payload with the field
        **missing**, which is indistinguishable from a ruleset with no bypass
        actors unless you look for the difference. Treat an absent
        `bypass_actors` as **verification failed / inconclusive**, never as an
        empty list, and re-run the call with a credential that has write access
        before ticking anything below. This is the single most likely way this
        checklist produces a false green.
  - [ ] **Every bypass actor, by type.** `bypass_actors` is a list of typed
        entries, and each type is a different set of people: `OrganizationAdmin`,
        `RepositoryRole` (which role id?), `Team`, `User` (an individual, by
        numeric `actor_id`), `Integration` (a GitHub App — this is how a bot
        silently gains bypass), and `DeployKey` (whose `actor_id` must be
        `null`).
  - [ ] **And `bypass_mode` on each**, because the three modes are not degrees
        of the same thing:
        - `always` — bypasses everywhere;
        - `pull_request` — bypasses only on pull requests. Valid on **branch**
          rulesets only, and **not applicable to `DeployKey`**;
        - `exempt` — **the one to look hardest at.** The rules are not run for
          that actor at all, and **no bypass audit entry is created**. An
          `always` bypass at least leaves a trace; an `exempt` actor leaves the
          ruleset looking untouched precisely when it was not enforced.

        An unnoticed entry is the difference between a rule and a decoration.
- [ ] Open a throwaway pull request **from an account that is not on the bypass
      list**, and confirm it cannot merge while checks are pending. If no such
      account exists, record explicitly that the check was performed as an admin
      and that no bypass was used — an untested rule verified by someone who can
      ignore it is not a tested rule.
- [ ] `GET /repos/athompson83/data-foundry/rulesets/rule-suites?time_period=week`
      afterwards — **set `time_period` explicitly.** It defaults to `day`, which
      returns only the past 24 hours; allowed values are `hour`, `day`, `week`,
      `month`. A verification run the morning after the throwaway pull request
      would come back empty from the default and read as "no evaluation
      happened". If you use a window other than `week`, record which. A 200 with
      *some* suites in it is still not evidence. Correlate one to the pull
      request you just opened before believing anything:
  - [ ] Follow pagination (`per_page`, `page`, and the `Link` header) — the
        suite you want may not be on page 1.
  - [ ] Match it on **repository**, the evaluated **`ref`**, and **`after_sha`**.
        `after_sha` is the head commit the evaluation ran against; on a
        `synchronize` it is the new head of the source branch, which is what
        makes it the right key rather than a timestamp or ordering.
  - [ ] Then `GET .../rulesets/rule-suites/{id}` for that suite and read its
        **top-level `result`**, which is one of `pass`, `fail`, or `bypass`.
        Require `pass`. A suite exists whether the rules passed, failed, or were
        bypassed, so its presence proves evaluation happened and nothing about
        the outcome — and `bypass` is the outcome that looks most like success
        from a distance, because the merge went through.
  - [ ] Read `rule_evaluations` and `evaluation_result` **as well as, not
        instead of, `result`.** Both fields carry the same value set, except
        that `evaluation_result` may also be `null`; GitHub's reference does not
        define how the two relate. Since the relationship is undocumented,
        gate on `result === "pass"` and treat any disagreement between the two
        as unverified rather than deciding which one to believe.

---

## 2. Private vulnerability reporting

### Current state — **[UNKNOWN, and it must stay recorded as unknown]**

This could not be determined. The setting lives under repository
security-and-analysis, which the GitHub MCP server does not expose, and direct
API calls are blocked by the environment proxy (HTTP 403).

**It is not "disabled". It is not "enabled". It is unverified.** Anyone reporting
either state from this session would be reporting a guess.

The one indirect signal, from `SECURITY.md` work on PR #3: the advisory form
tests clean for a maintainer whether or not the setting is on, because a
maintainer can always open a draft advisory. So a maintainer clicking their own
link proves nothing about whether an outside reporter can use it. That is why
`SECURITY.md` now documents a fallback path.

### Checklist

`https://github.com/athompson83/data-foundry/settings/security_analysis`

- [ ] Find **Private vulnerability reporting**
- [ ] Record what it says **before** changing it — the current state is the
      answer to a question this report had to leave open
- [ ] Enable it
- [ ] Verify: open `https://github.com/athompson83/data-foundry/security/advisories`
      **in a logged-out browser or a private window**. If PVR is on, a
      "Report a vulnerability" button is visible to a non-maintainer. Logged in
      as the owner, it is visible either way — which is exactly the trap.
- [ ] Once confirmed, `SECURITY.md`'s fallback path can be simplified. Leave it
      in place until then.

---

## 3. Vercel disconnection

### What is verified, and what is not

**[VERIFIED]** No Vercel project on the connected account targets this
repository. `mcp__Vercel__list_projects` for team
`team_KtruzpkA1rj2lx7LjFz6cGCM` ("paramedicine101-9167's projects", plan `pro`)
returns exactly one project — `proficiencyai`, linked to
`athompson83/proficiencyai`. `mcp__Vercel__get_project` for `data-foundry` on
that team returns **404 Not Found**.

**[VERIFIED]** No `Vercel` commit status appears on recent heads. At
`4028315` the combined status is a single context, `CodeRabbit / success`.

**[UNKNOWN]** Whether the **Vercel GitHub App still has repository access** to
`athompson83/data-foundry`, and whether any deploy hook survives. Neither the
Vercel MCP surface nor the GitHub MCP surface exposes app installations.

### Why this distinction is being laboured

Absence of a status is not evidence of disconnection. `vercel.json` sets
`git.deploymentEnabled: false`, which by itself is enough to make deployments —
and therefore statuses — stop appearing. A muted integration and a removed
integration look identical from the outside, and only one of them has actually
had its repository access revoked.

So: the missing status is consistent with disconnection, and **does not
demonstrate it**. The 404 above is a stronger signal than the missing status,
because it says no project exists to deploy from — but a GitHub App installation
with repository access can outlive the project that motivated it.

### Checklist

- [ ] `https://vercel.com/dashboard` — confirm no project is linked to
      `athompson83/data-foundry` under **any** scope, including personal scopes
      not returned by the API token used here
- [ ] If one exists: **Settings → Git → Disconnect**
- [ ] `https://github.com/settings/installations` → **Vercel** → **Configure**
      → confirm `data-foundry` is **not** in the repository-access list; remove
      it if it is
- [ ] `https://github.com/athompson83/data-foundry/settings/hooks` — confirm no
      Vercel webhook remains
- [ ] Report back which of these were found, so the record says what was true
      rather than what was assumed

### Only after that is confirmed

Then, and not before:

1. Delete `vercel.json`.
2. Amend `docs/decisions/ADR-0005-vercel-is-not-a-deployment-target.md` — it
   already anticipates this exact step and says the file can be deleted and the
   ADR amended once the dashboard disconnection is done.
3. Run the full verification suite.
4. Open a focused pull request for that change alone.

Doing it earlier would remove the suppression while the integration was still
connected, and the red statuses would come straight back.
