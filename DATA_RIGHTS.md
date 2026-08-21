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

Rights are not an afterthought bolted onto the data; they are a required field
on every source declaration, and the platform fails closed without them
(`AGENTS.md` rule 1). Every source carries a classification:

| Class | Meaning | May reach a published surface |
| --- | --- | --- |
| `GREEN` | Reviewed; use, redistribution and derivation permitted on the recorded terms | ✅ |
| `AMBER` | Reviewed; permitted with conditions — attribution, a warning, or a narrower scope | ⚠️ with its conditions honoured |
| `RED` | Reviewed; publication is not permitted | ❌ |
| `UNREVIEWED` | Nobody has looked | ❌ |

`RED` and `UNREVIEWED` are refused at the write boundary and again at the read
boundary, so an unreviewed source cannot become a published value by accident
or by a caller forgetting to check. Attribution requirements travel with the
source and are carried through to the surfaces that display its data.

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
   `UNREVIEWED` sources in the lineage of any published fact.
2. The commercial terms of each `GREEN`/`AMBER` source actually permit the use
   being made, including the derivative and redistribution question, in writing.
3. Attribution obligations are honoured on every surface that carries the data:
   pages, API responses, MCP results and bulk exports alike.
4. This file is superseded by, or accompanied by, a published dataset licence
   stating the terms customers receive — which will not be MIT, and which must
   not silently claim more than the upstream terms allow us to grant.
5. Image rights are settled separately (rule 9): the right to state a
   specification is not the right to republish a photograph of the product.

Until all five hold, a vertical stays `status: DRAFT` and does not publish.
`verticals/hvac` is `DRAFT` today for exactly this reason: zero real sources
have been rights-reviewed.

## If you use this code

You are responsible for the rights posture of the data *you* acquire with it.
The platform gives you the machinery to record, enforce and audit that posture.
It cannot give you permission you do not have, and a green CI run is not a
licence.

## Questions

Rights questions about a specific source belong in that vertical's `RIGHTS.md`.
Questions about this file, or about data we publish, go to the maintainers —
see `SECURITY.md` for contact routes.
