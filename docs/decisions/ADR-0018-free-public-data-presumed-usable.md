# ADR-0018 — Free public data is presumed usable

**Status:** Accepted by Product Owner, 2026-09-30

**Amends:** [ADR-0013](ADR-0013-evidence-based-rights-determination.md) (its "public availability alone is not a basis" clause). **Relates to:** `AGENTS.md` rule 1, `DATA_RIGHTS.md`, `docs/sources/pipeline/README.md`.

## Context

ADR-0013 lets an evidence-based determination decide rights, but only on four bases: a US government work, an open licence, published terms that expressly permit the use, or a private source's documented approval. A publisher that offers its data free of charge, but whose terms say nothing about reuse, therefore stayed `UNREVIEWED` and fail-closed. Many useful free APIs and downloads were blocked for that reason alone.

On 2026-09-30 the Product Owner changed the rule:

> If the API or data is available for free then we don't need any written permissions. We can operate under the assumption that they want this data used.

## Decision

A fifth determination basis, `FREE_PUBLIC_ACCESS`, is added. It applies when all of the following hold:

1. **Free.** The publisher offers the data free of charge, as an open API, a bulk download or public pages.
2. **Open access.** Getting it needs no login, account, paywall or CAPTCHA, and no technical control is bypassed. A free API key issued to anyone on request counts as open access; its rate limits are respected.
3. **Not expressly forbidden.** The publisher's published terms do not expressly forbid commercial use, redistribution or derived datasets. Terms that are silent, missing or unreadable no longer count against the source.

No written permission, licence or approval from the publisher is needed. The determination is still recorded in the usual way: the access evidence and a note of the terms checked, retrieved on a stated date, plus a decision for each surface. That record is our own evidence (rule 2), not a request for permission, and an agent writes it without owner involvement.

## What does not change

- **Express prohibition wins.** Terms that expressly forbid commercial reuse or redistribution (for example "personal, non-commercial use only") keep the source refused. Such publishers do not want their data used this way, so the Product Owner's assumption does not hold for them.
- **The prohibited list** (`packages/source-registry/src/prohibited-sources.ts`) still refuses its publishers in code.
- **No login, paywall or CAPTCHA bypass**, and robots rules and rate limits are respected.
- **Personal data** still needs its own handling decision before acquisition.
- **Images and third-party marks** are not cached or republished without their own rights (rule 9).
- **Each surface is still decided separately**, provenance still ANDs across contributors, and kill switches, `RED` and stale-review stops still apply. A source is downgraded the moment an express prohibition or a takedown request appears.
- **Crawler/payment settings never expand upstream rights** (ADR-0012).

## Consequences

- Free sources with silent terms can be prototyped and built without owner action.
- `tooling/lib/rights-determination.ts` accepts `FREE_PUBLIC_ACCESS`, which, like a § 105 federal work, may rest on the determination memo when there is no terms text to retrieve.
- The pipeline's `RED` verdict is now reserved for express prohibition, prohibited publishers, gated access and unresolved personal data. Unreadable or silent terms on free data are `AMBER`: permitted, with attribution and the hard stops above as conditions.
- The residual risk is a publisher objecting after the fact. The response is the existing one: engage the kill switch, record the objection and re-determine the source.
