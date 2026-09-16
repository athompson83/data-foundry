# DOE CCMS access inquiry — prepared, **not sent**

Status: **draft awaiting owner authorization.** Nothing has been sent to DOE, no
contact has been made, and no identity has been asserted on the project's behalf.
This file exists so that authorizing the contact is a yes/no decision rather than
a drafting exercise.

## Why this is worth sending

Three measured facts, from
[the source qualification record](hvac-first-source-qualification-20260916.md):

1. The edge serves only browser user agents — `curl/8.5.0`, a bare `Mozilla/5.0`
   and a descriptive `data-foundry-research` token all returned 403.
2. The Solr endpoint is internal and not named in any published asset; the
   shipped bundle carries only AjaxSolr's `http://localhost:8983/solr/` default.
3. The front-end bundle is cache-busted with a timestamp and was re-versioned the
   day before it was read, so field names, parameters and the endpoint can move
   without notice.

A fourth observation, added 2026-09-16: an attempt to find a documented CCMS
distribution on data.gov could not reach the catalogue API at all.
`catalog.data.gov` serves its root normally, but every `/api/3/action/*` call
returned `{"detail":{},"message":"Not Found"}` — not CKAN's own error envelope, so
that API has moved or changed. **This neither confirms nor rules out a documented
distribution**; it only means the cheapest way to check was unavailable, which
makes asking DOE directly more attractive rather than less.

A letter converts all of this from standing risk into a fact. The alternative is a
revenue-bearing pipeline resting on an interface the publisher never agreed to
serve, which can break silently between two-week refresh cycles.

## Where it would go

`https://www.regulations.doe.gov/ccms/help/help-and-contact-information`, the
publisher's own contact route. No other address is proposed, and no individual is
named.

## Draft — to be sent only on explicit authorization

> **Subject:** Supported bulk or API access to the Compliance Certification
> Database
>
> Hello,
>
> We are building a commercial product that would republish selected appliance
> and equipment certification values, with attribution and with your accuracy and
> legal-significance disclaimers carried through to end users.
>
> We would rather use a supported access path than scrape the public search
> interface. Three questions:
>
> 1. Is there a documented bulk download, export mechanism or API for the
>    certification data — or a supported way to request periodic extracts? We
>    looked for a data.gov catalogue entry and could not reach that API, so we may
>    simply have missed it.
> 2. If not, is automated querying of the public interface acceptable to you, and
>    at what request rate? We would identify ourselves with a descriptive user
>    agent and honour any limits you set.
> 3. Are there attribution or disclaimer requirements you would want us to apply
>    to republished values, beyond the accuracy and no-legal-significance
>    statements already on the database home page?
>
> We are happy to work to whatever constraints you prefer, including not using
> the public interface at all.
>
> Thank you,
> *[sender name and organisation — to be supplied by the owner]*

## What this draft deliberately does not do

- It does not claim permission, imply an existing relationship, or assert that
  any prior contact occurred.
- It does not ask DOE to grant redistribution rights. That is a separate legal
  question this letter cannot settle and should not muddy.
- It does not commit to a request rate, a launch date or a product name.
- It leaves the sender's identity blank. Engineering must not assert an identity
  on the project's behalf.

## If the owner declines to send it

That is a coherent choice, and it leaves two options, both already recorded in
the qualification record: proceed on the public endpoint with the durability and
method risk explicitly accepted, or treat CCMS as corroboration only and find a
source that publishes a supported interface. What is **not** available is
treating the question as answered because nobody asked it.
