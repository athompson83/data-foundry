# Data rights

**The MIT licence in `LICENSE` covers the platform code in this repository. It
does not, and cannot, license data.**

That distinction is the whole point of this file. A repository that ships an
MIT `LICENSE` and a pile of acquired data implies that both are MIT. For data
gathered from third-party publishers, that implication is false, and it is
false in a way that is expensive for whoever believes it.

## What MIT covers

Everything under `packages/`, `services/`, `tooling/`, `db/`, `schemas/` and
`.github/` — the source code, the migrations, the generated JSON Schema
exports, the CI configuration and the documentation describing them. Take it,
fork it, sell what you build with it. That is what the licence says and we mean
it.

## What MIT does not cover

| Asset | Governed by |
| --- | --- |
| Source artifacts (fetched HTML, PDFs, CSV, JSON) | The publisher's terms, plus applicable copyright and database rights |
| Images and other media referenced or cached | The rights holder's terms; see AGENTS.md rule 9 |
| Normalized records and canonical facts derived from those artifacts | The upstream terms as they apply to derivatives, plus our own terms for the compilation |
| Exports, dataset snapshots and API responses | The commercial terms of the offering they are served under |
| Vertical fixture data in `verticals/*/fixtures/` | See "Fixture data" below |

**Nothing in the MIT licence grants you any right to third-party data that this
software acquires, normalizes, stores or serves.** Running this code against a
publisher's site does not create a licence to that publisher's content. Whether
you may acquire it, keep it, republish it, or build a commercial product on it
is a question about *that publisher's terms and the law where you operate* —
not about this repository's licence.

## How rights are tracked here

Rights are not an afterthought bolted onto the data. The accepted Option B
model in ADR-0010 stores immutable, evidence-backed decisions in a sparse rights
matrix keyed by exact operation, channel, publisher/source identity, and any
applicable scope dimensions. Customer-facing and acquisition surfaces evaluate
their exact required bundle at one explicit instant. A missing cell is
`UNKNOWN`/`NO_GRANT`, never implied permission.

Every source declaration also carries the legacy classification below. These
values remain useful inventory/risk metadata and additional hard stops:

| Class | Meaning | May reach a published surface |
| --- | --- | --- |
| `GREEN` | Inventory says the broad source review found no legacy blocker | Only with an effective exact matrix bundle |
| `AMBER` | Inventory says conditions or narrower scope require attention | Only with an effective exact matrix bundle and satisfied conditions |
| `RED` | Reviewed; publication is not permitted | ❌ |
| `UNREVIEWED` | Nobody has looked | ❌ |

`RED`, `UNREVIEWED`, a kill switch, stale review, or other source hard stop is
refused even if a matrix decision appears positive. `GREEN`/`AMBER` and legacy
booleans never create an `ALLOW` and never let one surface imply another. An
ordinary narrower `ALLOW` cannot override a sticky `DENY`; only the explicit,
independently evidenced strict-narrow exception relationship in ADR-0010 can.

Migration 0014 deliberately created no publisher mapping, terms version,
rights decision, or `ALLOW` from existing declarations. Each legacy source
received only a `REVIEW_REQUIRED` assessment. Rights are also an AND across
every provenance contribution: one permissive source cannot launder a blocked
contributor.

A source's rights record is a statement about *that source*. It says nothing
about any other source, and re-classifying one does not re-classify its
neighbours.

## Fixture data

`verticals/hvac/` ships synthetic data. The publishers, the domains
(RFC 2606 reserved `example.com` / `example.org`) and the equipment are
fabricated, and we wrote every byte of it. Those fixtures are covered by the
MIT licence along with the code, and running the full pipeline against them
contacts no real host.

The rights classifications in `verticals/hvac/RIGHTS.md` are true statements
about our own test data. They are **not** claims about any real manufacturer,
distributor or certification body, and must not be read as a summary of anyone
else's terms. `verticals/hvac/RIGHTS.md` says this at greater length; read it
before drawing any conclusion about a real organisation.

## Before any dataset is published commercially

This section is a gate, not a wish list. Before a dataset built with this
platform is offered for sale or redistribution:

1. Every contributing source is rights-reviewed and classified — no
   `UNREVIEWED` source or hard stop in the lineage of any published fact.
2. Every contributing source resolves an effective exact matrix decision for
   every operation/channel in the intended surface bundle. Absence is refusal;
   public web, indexing, direct API, RapidAPI, MCP, and bulk export do not imply
   one another.
3. Attribution obligations are honoured on every surface that carries the data:
   pages, API responses, MCP results and bulk exports alike.
4. This file is superseded by, or accompanied by, a published dataset licence
   stating the terms customers receive — which will not be MIT, and which must
   not silently claim more than the upstream terms allow us to grant.
5. Image rights are settled separately (rule 9): the right to state a
   specification is not the right to republish a photograph of the product.

Until all five hold, a vertical stays `status: DRAFT` and does not publish.
`verticals/hvac` is `DRAFT` today for exactly this reason: zero real sources
have an effective reviewed publication/commercial bundle.

## If you use this code

You are responsible for the rights posture of the data *you* acquire with it.
The platform gives you the machinery to record, enforce and audit that posture.
It cannot give you permission you do not have, and a green CI run is not a
licence.

## Questions

Rights questions about a specific source belong in that vertical's `RIGHTS.md`.
Questions about this file, or about data we publish, go to the maintainers —
see `SECURITY.md` for contact routes.
