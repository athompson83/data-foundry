# Prohibited sources

Some sources are not a rights question we get to answer.

The rights review in `docs/source-onboarding.md` is the general mechanism, and
it works because the answer is genuinely open: a human reads the terms and
records what they permit. For a small number of publishers the answer is not
open. A declaration saying `GREEN` does not make it so — it makes the
declaration wrong.

So these refusals live in **platform code**, at
`packages/source-registry/src/prohibited-sources.ts`. A denylist stored in
`verticals/<slug>/sources/*.yaml` would be defeated by editing the file it lives
in, which is exactly the move it exists to prevent. Changing this list is a code
change, in a diff, in a pull request.

## What is refused, and where

`prohibitedSourceFor(domain)` matches the host itself and everything under it,
on **whole labels only** — `aircarrier.com` is an unrelated publisher and is not
refused. The check runs in two gates:

- `evaluateSourceActivationGate` — so a prohibited source cannot become `ACTIVE`,
  **and** so `evaluateAcquisitionGate` inherits the refusal. This is what keeps a
  prohibited publisher off the network, not merely off the published surface.
- `evaluateSourcePublishGate` — so nothing derived from one can reach a surface.

It surfaces as `SOURCE_PROHIBITED`, classified as a rights blocker, so it throws
the same `RightsViolationError` as any other rule-1 violation.

| Domain | Publisher | Why |
| --- | --- | --- |
| `ahridirectory.org` | AHRI | Certification Directory is offered for individual look-up; automated copying, bulk ingestion, redistribution and derived-dataset construction are outside that, and unlicensed |
| `ahrinet.org` | AHRI | Same terms, same absence of a reuse grant |
| `carrier.com` | Carrier Global Corporation | Manuals, images, parts data and specification documents are copyrighted works with no reuse grant |
| `trane.com` | Trane Technologies | as above |
| `lennox.com` | Lennox International | as above |
| `lennoxpros.com` | Lennox International | as above, and behind authentication, which no acquisition policy here may defeat |
| `york.com` | York (Johnson Controls) | as above |
| `daikin.com` | Daikin Industries | as above |
| `daikincomfort.com` | Daikin Comfort Technologies | as above |

Every entry carries a `reason` and a `liftedBy`. A prohibition with no stated
route out is indistinguishable from an unexplained veto, and will eventually be
deleted by someone who cannot tell which it was.

## This is a backstop, not a rights engine

The list names publishers **already known** to be prohibited. A source it does
not name is not thereby permitted — it is merely unreviewed, and the rights
review still has to happen. Nobody should read an empty result from
`prohibitedSourceFor()` as approval.

## Redirects, and the one path this does not cover

A redirect is a second request to a host the gate never saw. The gate checks the
URL it is given; the ambient `fetch` defaults to following, so a permitted
source answering `302 Location: https://www.carrier.com/…` would have had the
client contact a prohibited host — and then store the bytes under the original
URL, attributing one host's content to another.

`HttpAcquisitionProvider` now passes `redirect: 'manual'` and **refuses** any
3xx other than 304, naming the host it was asked to contact. The refusal is not
"that destination is prohibited" but "the gate has not seen this URL", so a
redirect to an innocuous host is refused too. Following safely would mean
re-running the whole gate per hop — rights, robots, scope, rate limit, policy
snapshot — and that machinery lives in the base class, not the provider. Until
it exists, refusing is the honest behaviour.

**The residual, stated rather than glossed.** `BrowserRunAcquisitionProvider`
and `Crawl4AIAcquisitionProvider` do not fetch the target themselves. They POST
the target URL to a remote service — Cloudflare's API, or a Crawl4AI host — and
that service performs the retrieval. Our own request goes only to the service.
**Whether the remote service follows a redirect to a prohibited host is outside
this process and outside this control.** Neither provider can close that gap
from here; it would need the service to expose a no-follow option, or a
post-hoc check on the final URL the service reports. Both providers are
fixture-backed in every current test and neither is wired into a production
composition root, so nothing exercises the gap today — but it is a gap, and it
should be closed before either is used against a real source.

## Two exclusions the list cannot enforce

The initial exclusions include two that are about **claims**, not about hosts.
No domain check can catch them, and pretending otherwise would be worse than
saying so plainly:

**Scraped manufacturer content without affirmative reuse authority.** The domain
list covers the five manufacturers named so far. It cannot cover the sixth. The
control here is the rights review itself: a manufacturer source with no recorded
grant fails the gate on `RIGHTS_REVIEW_MISSING_OR_LAPSED` and
`REDISTRIBUTION_NOT_ALLOWED` long before it reaches a domain check.

**Replacement, supersession, compatibility and cross-reference claims.** These
are the highest-value and highest-risk assertions in this vertical — "part A
replaces part B", "this coil matches that condenser". They are also the ones
most likely to be inferred rather than sourced. **No such claim may be published
unless it comes from a rights-cleared authoritative source and carries evidence
pointing at that source.** Rule 3 (no silent LLM merges) and the evidence
requirement in `canonical-store` are the mechanism: a relationship without
evidence cannot be written in the same transaction as its claim, so it cannot be
published. A cross-reference the model *believes* is not a cross-reference the
platform may state.

## Test fixtures used to assert the opposite

Before this control existed, the repository's own model of a *"fully-compliant"*
source was, in `packages/source-registry/test/fixtures.ts`, an AHRI entry on
`ahridirectory.org` — `GREEN`, `ACTIVE`, commercial use and redistribution
granted, with a fabricated `reviewed_by`. `carrier.com` appeared the same way.
Nothing was ever fetched: the tests are fixture-backed and make no network
requests. But a public repository asserting a fabricated rights posture about
named real organisations is wrong on its own terms, and those fixtures are
exactly what someone would copy when writing their first real declaration.

They now use the same reserved domains as the `hvac` vertical
(`ratings-directory.example.org`, `catalog.acme-climate.example.com`) with
clearly fictional publishers. The real domains survive in exactly one place:
the prohibition list and the tests that prove it works.
