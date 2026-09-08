# Data adapter contracts

The shared pipeline consumes immutable artifacts, source-native records and
vertical configuration. Adding an industry must not add business logic to a web,
API or MCP handler. A provider adapter acquires bytes; it never approves rights,
resolves identities or publishes facts.

## Acquisition boundary

Use the acquisition provider registry and the source's reviewed acquisition
policy. The adapter returns a bounded, ordered set of artifact receipts with
content hashes, MIME types, observed URLs, acquisition route, provider version
and source-stream membership. Credentials belong to a runtime secret binding;
they must never enter receipts, queues, logs or canonical fields.

The scheduled runner controls rights checkpoints, conditional requests, leases,
R2 persistence and the transaction that completes the run and inserts pending
ingestion work. Providers cannot independently mark a dataset fresh. A queue
message contains only a version and an opaque delivery UUID. The ingestion
runtime reloads the authoritative source and artifact metadata.

An unchanged response verifies existing data only after its prior artifact set
has successfully published. An upstream timestamp, a successful download and
canonical publication are separate observations. Report each accurately.

## Extraction boundary

`ExtractionProvider.extract(artifact, schema)` returns source-native records.
Each record needs a stable source key, artifact identity, ordinal, field values,
field locators, extractor version and extraction-quality signals. Missing,
ambiguous or malformed values are explicit issues, not invented replacements.
The caller supplies bytes; an extractor never fetches URLs, reads credentials,
merges entities, queries the canonical database or assigns publication rights.

| Format | Implementation and production qualification |
|---|---|
| JSON / CSV | Existing extractors are admitted by the compiled ingestion runtime, within the bounds below. Source selectors and mappings still require representative fixtures and rights review. |
| HTML / PDF | Existing local adapters remain available. Their dependencies, memory, CPU, extraction fidelity and deployment isolation require separate Cloudflare qualification before admission. |
| Browser acquisition | Browser Run and Crawl4AI remain swappable acquisition adapters. Respect the reviewed origin, navigation, credential and content-use policy; pass acquired artifacts through the same downstream boundaries. |
| Future formats | Add a versioned provider and extraction schema with fixtures, byte/record limits, locator semantics and failure tests. Do not relax shared publication gates to admit a format. |

## Processing and snapshot boundary

Production ingestion currently admits at most 16 artifacts, 1 MiB per artifact,
4 MiB per delivery and 1,000 source records. It checkpoints verified artifacts
and atomically promotes a bounded set of canonical candidates. Larger manifests
are refused and retain the previous valid dataset. These bounds are a source
qualification constraint; this release does not claim arbitrary-size streaming
or resumable canonical promotion across independent database transactions.

A complete snapshot must declare its source stream and include the entire
accepted artifact set before omitted records can retire. An incremental batch
does not authorize omission-based deletion. Keep raw bytes and immutable
historical revisions so corrections and runtime changes can be replayed with a
new processing identity. Never simulate a complete snapshot with a truncated
page or silently split one snapshot into independently complete sub-snapshots.

For a source above the admitted bounds, implement an explicit staging manifest,
bounded record parts, a completion barrier and atomic generation activation
before increasing its limits. Prove duplicates, out-of-order parts, interrupted
staging, missing parts, revocation and retirement semantics first.

## Vertical admission checklist

Every vertical supplies entity and relationship schemas, extraction mappings,
shared ingestion/lookup identifier rules, field normalization, quality and
resolution fixtures, source rights notes, filters, SEO policy and MCP intents.
Web, API, MCP, acquisition and ingestion bundles admit verticals independently.
The synthetic second vertical is a regression fixture, not public coverage.

Source acceptance also records permitted refresh frequency, conditional-request
support, upstream publication cadence, rate limits, representative field
coverage, schema-drift detection and measured cost within the operating budget.
Never infer resale, public indexing, MCP or bulk rights from download access.

See [source onboarding](source-onboarding.md), the
[industry template](../verticals/_template/README.md), and
[operator procedures](operations.md).
