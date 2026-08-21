# Security Policy

## Reporting a vulnerability

**Do not open a public GitHub issue for a security problem.** An issue is
world-readable the moment it is filed, which turns a report into a disclosure
before anything can be fixed.

**GitHub Security Advisories** is the route:
[Report a vulnerability](https://github.com/athompson83/data-foundry/security/advisories/new).
It opens a private thread with the maintainers and becomes the advisory if one
is published.

**If you do not see a "Report a vulnerability" button** on
[the advisories page](https://github.com/athompson83/data-foundry/security/advisories),
that form is not open to you, and nothing you send through it will arrive. That
is a fault on our side, not yours. In that case:

1. Open a public issue containing **only** the sentence "I have a security
   report and need a private channel" — no version, no component, no reproduction,
   nothing that hints at the weakness. That much is not a disclosure.
2. Wait for a maintainer to open a private advisory thread and invite you to it.
3. Send the details **only** in that thread.

We would rather answer a bare request for a channel than have you either sit on
a finding or publish it because the private route silently failed.

> **Maintainer note.** Step 1 above exists because the advisory form depends on
> *Private vulnerability reporting* being enabled in this repository's settings
> (Settings → Advanced Security). It is worth knowing that the link tests clean
> for a maintainer whether or not the setting is on — a maintainer can always
> open a draft advisory — so clicking it yourself proves nothing about whether
> an outside reporter can. Verify the setting itself.

Please include enough to reproduce: affected version or commit, the component
(`packages/*`, `services/*`, `db/migrations`, tooling), what an attacker gains,
and the smallest input or sequence that demonstrates it. A proof-of-concept is
welcome; a working exploit against someone else's data is not.

## What to expect

- **Acknowledgement within 3 working days.** If you have not heard back in that
  time, assume the message went astray and try the other channel.
- **An assessment within 10 working days**, saying whether the report is
  accepted, what severity we think it carries, and a rough remediation timeline.
- **Credit in the advisory** if you want it, and none if you do not.

This is a small project without a paid bounty programme. We would rather say
that plainly than imply a reward that does not exist.

## Disclosure

We aim to ship a fix and publish an advisory within 90 days of a confirmed
report, sooner when the fix is small and the risk is high. If you plan to
disclose publicly, tell us when — we will not ask you to wait indefinitely, and
we would rather coordinate than be surprised.

Until an advisory is published, please keep the details between us and the
maintainers.

## Scope

**In scope**

- Platform code in `packages/`, `services/` and `tooling/`.
- Database schema and migrations in `db/`, including constraints that enforce a
  documented invariant.
- Anything that lets a caller bypass a trust control this repository claims to
  enforce: publishing a fact without evidence, publishing from a source whose
  rights classification forbids it, clearing a queued human review
  automatically, altering an append-only audit trail, or reaching the raw
  database handle from an application-layer surface.
- Exposure of staff reviewer identities or internal editorial notes through a
  public query, API, MCP, export or frontend surface.

**Out of scope**

- Third-party services this repository integrates with (Cloudflare, Supabase,
  Vercel, GitHub). Report those to the vendor.
- Findings that require an attacker to already control the machine running the
  pipeline, the database, or the object store.
- Vulnerabilities in the *content* of a third-party source we acquire. Tell the
  publisher; tell us too if our handling of it is unsafe.
- Denial of service through unbounded local input (a deliberately enormous
  fixture, say) where the only affected party is the operator running it.
- Missing hardening that is not exploitable on its own, unless you can show the
  step that makes it exploitable.

## Supported versions

The project is **pre-1.0 and pre-beta**. There are no released versions and no
long-term support branches: security fixes land on the default branch, and that
branch is the only supported thing to run.

| Version | Supported |
| --- | --- |
| default branch (`main`) | ✅ |
| any tag or fork | ❌ |

There is no production deployment of this repository serving customer data at
the time of writing, and the shipped vertical is `status: DRAFT` with synthetic
fixture data. If that changes, this section changes with it.

## What this policy is not

It is not an inventory of known weaknesses. Unfixed issues are tracked
privately and are not enumerated here — publishing a list of open holes helps
attackers considerably more than it helps users.
