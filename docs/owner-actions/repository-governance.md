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

So verify against the ruleset payload itself:

- [ ] `GET /repos/athompson83/data-foundry/rulesets` — capture the list **before**
      creating anything, so "there was nothing here" is on the record
- [ ] After creating it, `GET /repos/athompson83/data-foundry/rulesets/{id}` and
      confirm, field by field:
  - [ ] `target: "branch"` and the condition includes `~DEFAULT_BRANCH`
  - [ ] `enforcement: "active"` — **not** `evaluate`, which reports without
        blocking and looks identical from the outside
  - [ ] `rules` contains `deletion`, `non_fast_forward`, `pull_request` (with
        `required_approving_review_count: 0` and
        `required_review_thread_resolution: true`), and
        `required_status_checks` naming **both** job names exactly
  - [ ] `bypass_actors` contains only what you intended — an unnoticed bypass
        entry is the difference between a rule and a decoration
- [ ] Open a throwaway pull request **from an account that is not on the bypass
      list**, and confirm it cannot merge while checks are pending. If no such
      account exists, record explicitly that the check was performed as an admin
      and that no bypass was used — an untested rule verified by someone who can
      ignore it is not a tested rule.
- [ ] `GET /repos/athompson83/data-foundry/rulesets/rule-suites` afterwards to
      confirm the ruleset actually evaluated against that pull request

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
