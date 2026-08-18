# Rights — `template`

> Replace this file. AGENTS.md rule 1: **no source without rights metadata;
> unreviewed/RED sources must not publish.** This document is the human-readable
> record behind the machine-enforced gate in `sources/*.yaml`.

## Classification summary

| Source | Classification | Publishable? | Commercial | Redistribution | Derivative normalization | Attribution | Reviewed | Next review |
|---|---|---|---|---|---|---|---|---|
| `example-source` | UNREVIEWED | ❌ | ❌ | ❌ | ❌ | — | never | — |

Classifications (doc 13; the code model writes doc 13's `YELLOW` as `AMBER`):

- **GREEN** — clear commercial reuse/redistribution rights, or public
  domain/open licence compatible with planned use.
- **AMBER** — facts probably usable, but terms, database rights, images,
  attribution or redistribution scope still need legal/business review.
  Publishable, but never silently.
- **RED** — explicit restrictions or unresolved risk. Not ingested for
  commercial publishing.
- **UNREVIEWED** — no decision on record. **The absence of a decision is not
  permission.**

## Gates

Two gates, and they are not the same gate. A source can legitimately be ACTIVE
for internal analysis while remaining unpublishable.

**Activation gate** (doc 13) — required before `status: ACTIVE`:

- a classification that is not RED or UNREVIEWED;
- a current human rights review (named reviewer + date, not lapsed);
- an approved acquisition method;
- satisfiable attribution configuration;
- a provenance retention policy;
- image caching only where images are actually reusable.

**Publish gate** — everything above, plus: redistribution allowed, commercial
use allowed, derivative normalization allowed, kill switch disengaged.

## Image rights (AGENTS.md rule 9)

| Source | Images reusable | Cache to R2 | Display modes | Attribution |
|---|---|---|---|---|
| `example-source` | ❌ | ❌ | none | — |

Default posture is *record the URL, copy nothing*. Copying bytes into R2 is
republication and requires its own decision. Where photo rights are
unavailable, generate visualizations from the structured facts instead.

## Provenance retention (AGENTS.md rule 10)

| Source | Retain artifacts | Retention | Legal hold |
|---|---|---|---|
| `example-source` | ✅ | indefinite | ❌ |

## Personal data

State whether any source carries personal data, and if so the lawful basis, the
minimized field set, and the correction/deletion path. If none do, say that
plainly.

## Synthetic source disclosure

**If this vertical's sources are synthetic, this section must say so in
unambiguous language**, because the rest of this document reads like a set of
legal assertions and a reader must not mistake fabricated policy for a real
rights review.

State plainly:

1. which sources are synthetic and which (if any) are real;
2. that the publishers named are fictional and the domains are RFC 2606
   reserved example domains;
3. that **no real third-party site is crawled** by these fixtures;
4. that the rights metadata describes our own test data, licensed to us because
   we authored it — not a claim about any real company's terms.

## Takedown and suspension

- **Source kill switch:** `kill_switch_engaged: true` in the source YAML.
  Overrides every other setting immediately.
- **Media kill switch:** per media asset.
- **Entity unpublish:** removes the page from index and sitemap; the entity
  stays queryable internally.
- **Export exclusion / MCP-API exclusion:** follow the publish gate
  automatically.
- **Legal hold:** preserves internal evidence even when retention would
  otherwise expire.

Never silently rewrite history. Corrections follow the doc 13 flow: reported →
triaged → source checked → correction or dispute → republished → audit record.
