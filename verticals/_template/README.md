# `_template` — vertical scaffold

The starting point for every vertical. Copy it, do not reference it:

```bash
cp -r verticals/_template verticals/<your-slug>
```

`_template` is skipped by `pnpm verticals:validate` (see
`validateAllVerticals`), so it can carry placeholder values. Your copy is not
skipped, and will not pass until it is genuinely filled in.

## The one rule that shapes everything here

**A vertical is configuration and data, not a fork of the app** (AGENTS.md rule
4). Every file in this scaffold is YAML, JSON or Markdown. There is no
`src/`, and that is deliberate.

If you reach a point where expressing something requires platform TypeScript,
stop. That is a signal the platform's config schema is too narrow. Extend the
platform's *generic* schema so every vertical benefits, and record the gap.
Never add a vertical-specific code path — a fork that starts as "just one
field" is how the platform stops being a factory.

## Contents

```text
_template/
├── vertical.yaml            root manifest: slug, status, entity types, ER thresholds
├── entities/                one file per entity type: properties, units, identity, quality rules
├── relationships.yaml       graph predicates and integrity rules
├── filters.yaml             filter metadata driving UI + API docs + SEO facets (doc 04)
├── seo.yaml                 indexability policy, canonical URLs, structured data, agent intents (doc 07)
├── mcp.yaml                 Shared six-tool MCP selection and server identity
├── sources/                 one file per source, each with COMPLETE rights metadata (rule 1)
├── normalizers/             declarative rules, doc 06 layers 1-4 + source mappings + fact selection
├── fixtures/                source artifacts in native formats
│   └── golden/              expected canonical output
├── tests/                   config/data validation
├── README.md                this file
├── DATA_DICTIONARY.md       every property: type, unit, source coverage
├── SOURCES.md               what each source is and why it exists
├── RIGHTS.md                rights posture and publish gates
├── QUALITY.md               quality rules, SLOs, known gaps
└── CHANGELOG.md             schema and data changes
```

The six Markdown files are required by doc 11 and their absence is a validator
failure, not a style note.

## Build order

Working in this order means each step is verifiable before the next depends on
it:

1. **Score the niche first.** `docs/verticals/<slug>-niche-score.md` using doc
   17's weighted model and its six qualification gates. A vertical that fails a
   gate should not be built — say so rather than rationalizing a pass.
2. **`vertical.yaml`** — slug, entity types, predicates. The shared vocabulary
   everything else keys off.
3. **`entities/` + `relationships.yaml`** — the canonical model.
4. **`sources/`** — declare sources with complete rights metadata. This is a
   gate, not paperwork: an unreviewed source cannot publish, so a vertical whose
   sources are all UNREVIEWED has no product.
5. **`fixtures/`** — real artifacts in native formats, deliberately messy.
6. **`normalizers/`** — rules that turn 5 into the canonical model of 3.
7. **`fixtures/golden/`** — expected output, including losing claims.
8. **`filters.yaml`, `seo.yaml`, `mcp.yaml`** — the consumer surfaces.
9. **The six docs**, then `pnpm verticals:validate` until green.

## Definition of done

- `pnpm verticals:validate` passes.
- Every source has complete rights metadata and every `ACTIVE` source passes the
  activation gate.
- Fixtures contain at least one genuine cross-source conflict, and the golden
  files record how it resolves.
- No indexable page class exists without a quality gate.
- `DATA_DICTIONARY.md` documents every property with type, unit and source
  coverage.

- Identifier fixtures prove read/write equivalence from the declared operation
  chain, including Unicode and prefix rules, and prove distinct structural
  codes stay distinct. Shared query code must not add industry-specific cases.
- Ingestion, edge, web and MCP compiled artifacts carry the same identifier
  specification. Bundle admission and real source activation require separate
  review; a synthetic portability fixture grants neither.

## Optional buyer offer

`product.yaml` supplies buyer-facing title, audience, lookup entity type, coverage,
limitations, proposed plans and an optional RapidAPI listing URL. The lookup type
must exist in the entity schema. Leave the listing null and availability prelaunch
until an actual listing and operating policies are approved. The compiler validates
HTTPS RapidAPI listing shape; a syntactically valid URL is not proof of a live listing.
No offer field bypasses vertical publication, source rights or indexability gates.
Set `seo.url_prefix` to the canonical industry path, and use `legacy_url_prefixes`
for permanent redirects from previous paths. Compile web and MCP artifacts together.

Optional `terms_policy` and `privacy_policy` each require `{ approved: true,
url: https://... }`; `support_contact` requires `{ approved: true, email: ... }`.
Omit them until authorized documents and a monitored contact exist. Availability
`available` requires all three plus the listing. Approval here is an explicit
reviewed declaration, not a claim the compiler has independently reviewed law.
