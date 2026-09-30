# ADR-0013 — Evidence-based rights determination replaces the named-human-reviewer gate

**Status:** Accepted by Product Owner, 2026-09-26

**Relates to:** ADR-0010 (rights-grant matrix), `AGENTS.md` rule 1, `DATA_RIGHTS.md`, `docs/source-onboarding.md`, `PROJECT_CHECKLIST.md` `UA-001`.

## Context

Until now a source could reach a customer surface only after a *named human rights reviewer* approved it (`UA-001`). In practice that gate held every real source at zero for more than a month. No one was available to act as that reviewer, and a counsel packet cannot be answered by engineering. As a result the platform had a complete rights *engine* but no rights *decisions*, and so no revenue.

When asked to name a reviewer on 2026-09-26, the Product Owner changed the rule instead:

> We don't need human approval, just a logical decision based on what's available and public. If a private source has approval documentation or an approval process we can use that as well.

## Decision

A source may receive rights decisions when a **documented, reproducible rights determination** shows the intended use is permitted. The determination replaces the named human approver. It does **not** replace the rights engine, the exact-cell grant matrix, provenance ANDing, kill switches, or any other gate in ADR-0010.

A determination is valid only when it is committed to the repository as a source-review record under `docs/sources/` and it states all of the following:

1. **Legal basis**, one of:
   - `PUBLIC_DOMAIN_US_GOVERNMENT_WORK`: the data is a work of the United States Government (17 U.S.C. § 105), published by a federal agency, with no contrary restriction in the agency's published terms.
   - `OPEN_LICENSE`: a published licence that permits commercial redistribution and derivative works (for example CC0, CC-BY-4.0, ODC-BY, OGL), with its attribution text recorded.
   - `PUBLISHED_TERMS_PERMIT`: the publisher's published terms expressly permit the intended commercial use and redistribution.
   - `DOCUMENTED_APPROVAL`: for a private source, a written licence, contract or the publisher's own documented approval process, stored as evidence (a reference, not the secret).
2. **Evidence**: the terms, licence or policy URL, retrieval date and, where the text was retrieved, a content digest. Where the text could not be retrieved from the build environment, say so. The determination must then rest on a basis that does not depend on that text, such as § 105 for a federal work.
3. **Intended surfaces**: each `PUBLIC_WEB`, `SEARCH_INDEX`, `API_FREE`, `API_PAID`, `RAPIDAPI`, `MCP` and `BULK_EXPORT` cell, decided separately, with the reason. One permitted surface never implies another.
4. **Hard stops checked**: personal data, third-party marks or images, embedded third-party content, rate limits and robots rules, and anything that would make an otherwise-public work non-redistributable. Any unresolved hard stop keeps the affected cells refused.
5. **Attribution and disclaimers** that every carrying surface must render, including "not endorsed by the agency" wording for government sources.
6. **Review expiry**: `next_review_at` no later than 12 months out. A source is re-determined when its terms change.

`reviewed_by` records the *determination* (for example `Data Foundry evidence-based determination (ADR-0013)`), not a human identity. The engine's stale-review, kill-switch, `RED` and `UNREVIEWED` stops continue to apply unchanged.

## What does not change

- **Unknown is still refusal.** Without a valid determination a source stays `UNREVIEWED` and fail-closed.
- **Public availability alone is not a basis.** "It is on the internet" is not one of the four bases. A public website with restrictive terms, or with no terms and no licence, does not qualify. *Amended 2026-09-30 by [ADR-0018](ADR-0018-free-public-data-presumed-usable.md): data a publisher offers free, with no login, paywall or CAPTCHA, is presumed usable under a fifth basis, `FREE_PUBLIC_ACCESS`, unless its terms expressly forbid commercial reuse or redistribution. Restrictive terms still refuse.*
- **Private sources** need `DOCUMENTED_APPROVAL`. Scraping a private site whose terms are silent is not permitted by this ADR.
- **Personal data** still needs its own handling decision before acquisition.
- **Crawler/payment settings never expand upstream rights** (ADR-0012).
- Any source may be downgraded to `RED`, or have its kill switch engaged, the moment contrary evidence appears.

## Consequences

- `UA-001` stops being owner-only for sources that meet one of the four bases, and becomes routine engineering work: write the determination and record the grants.
- Earlier NO_GO commercial research still stands on its *commercial* merits. This ADR changes who may decide rights, not whether a dataset is worth selling.
- The first source family determined under this ADR is the US federal vehicle data (NHTSA vPIC, NHTSA Recalls, EPA/DOE fueleconomy.gov); see `docs/sources/vehicles-federal-rights-determination-20260926.md`.
