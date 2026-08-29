# Rights — `hvac`

## ⚠️ Read this first: every source in this vertical is synthetic

**The rights statements in this document and in `sources/*.yaml` describe
fictional publishers and data we authored ourselves. They are not, and must not
be read as, claims about any real company's terms.**

Specifically, and in plain language:

1. **All four sources are fabricated.** Acme Climate Systems, CoolSupply
   Wholesale and the Federated HVAC Ratings Council do not exist. Neither do
   Northwind Air Systems or Borealis Thermal Works, the manufacturers named in
   the fixture data.
2. **All domains are RFC 2606 reserved example domains** (`example.com`,
   `example.org`). They cannot resolve to a real host, by standard. This is
   deliberate: it makes "no real site is contacted" a property of the data
   rather than a promise about the code.
3. **No real third-party site is crawled, fetched, rendered or contacted by
   these fixtures.** The full pipeline can run against this vertical and issue
   zero network requests to any real host. The four fixture artifacts are files
   on disk, and the PDF is generated locally by a committed script.
4. **The data is licensed to us because we wrote it.** The GREEN and AMBER
   classifications below are true statements about our own test data. They carry
   no information whatsoever about the rights posture of any real HVAC
   manufacturer, distributor or certification body.
5. **No rights claim is made about any real organization.** In particular,
   `ahri-directory-export` is a shared-vocabulary key naming the *shape* of a
   certification-directory source. Its publisher is a fictional body — **not**
   the real Air-Conditioning, Heating, and Refrigeration Institute — and nothing
   here describes that organization's directory, data or terms.

**Consequence:** the source-rights condition for leaving `DRAFT` — that every
real contribution has effective exact acquisition/publication/commercial matrix
decisions and no source hard stop — is **NOT MET** for this vertical. No real
source has an effective reviewed publication/commercial bundle. Synthetic
sources passing a rights gate proves the gate works; it proves nothing about the
market. This is why `vertical.yaml` carries `status: DRAFT`, and it is recorded
here rather than argued around.

---

## Legacy synthetic classification summary

| Source | Class | Legacy publish field | Legacy commercial field | Legacy redistribution field | Legacy derivative field | Attribution | Reviewed | Next review |
|---|---|:---:|:---:|:---:|:---:|---|---|---|
| `acme-hvac-catalog` | GREEN | ✅ | ✅ | ✅ | ✅ | not required | 2026-07-02 | 2027-07-02 |
| `coolsupply-distributor` | **AMBER** | ⚠️ with warning | ✅ | ✅ | ✅ | **required** | 2026-07-02 | 2027-01-31 |
| `ahri-directory-export` | GREEN | ✅ | ✅ | ✅ | ✅ | **required** | 2026-07-02 | 2027-07-02 |
| `acme-spec-sheets` | GREEN | ✅ | ✅ | ✅ | ✅ | not required | 2026-07-02 | 2027-07-02 |

Classifications (doc 13; the code model writes doc 13's `YELLOW` as `AMBER`) are
inventory/risk metadata and additional hard stops, not grants:

- **GREEN** — the synthetic inventory review records no broad legacy blocker.
- **AMBER** — the synthetic inventory records conditions, warnings, or narrower
  scope. It is not permission for any matrix surface.
- **RED** — explicit restrictions or unresolved risk. Not ingested for
  commercial publishing.
- **UNREVIEWED** — no decision on record. **The absence of a decision is not
  permission.**

### Why one source is AMBER

`coolsupply-distributor` is AMBER on purpose, so the vertical exercises the
middle tier rather than declaring everything GREEN and never testing the
warning path. A real distributor catalogue would raise two questions this
synthetic stand-in only gestures at: the listing terms attached to a wholesale
catalogue, and the *sui generis* database right in a compiled catalogue under
EU/UK law.

For this synthetic fixture, AMBER exercises the legacy warning path and carries
a warning downstream only after the exact requested surface is separately
permitted. Its attribution is required and configured, so the inventory gate
passes; had `text` been left null while `required: true`, the source would fail
activation — a required attribution with no credit line is a misconfiguration,
not "no attribution needed".

## Gates

Two gates, and they are **not** the same gate. A source can legitimately be
ACTIVE for internal analysis while remaining unpublishable.

### Activation gate — required before `status: ACTIVE`

Enforced by `evaluateSourceActivationGate`, run by `pnpm verticals:validate` on
every source declaring `ACTIVE`:

| Condition | acme-catalog | coolsupply | ahri-export | acme-spec |
|---|:---:|:---:|:---:|:---:|
| Classification not RED/UNREVIEWED | ✅ | ✅ | ✅ | ✅ |
| Current human rights review | ✅ | ✅ | ✅ | ✅ |
| Acquisition method approved | ✅ | ✅ | ✅ | ✅ |
| Attribution satisfiable | ✅ | ✅ | ✅ | ✅ |
| Provenance retention configured | ✅ | ✅ | ✅ | ✅ |
| Image policy consistent | ✅ | ✅ | ✅ | ✅ |

All four pass. **Validated mechanically, not asserted here** — the validator
re-runs this table on every CI run.

### Publish gate — required before anything reaches web/API/MCP/exports

Everything above, plus redistribution allowed, commercial use allowed,
derivative normalization allowed, image attribution satisfiable, and the kill
switch disengaged.

All four synthetic declarations pass this legacy gate;
`coolsupply-distributor` passes **with an AMBER warning** attached. That result
does not create any ADR-0010 surface `ALLOW`; exact current decisions still
govern every acquisition, page, index, API, MCP, and export request.

## Attribution obligations

| Source | Required | Credit line |
|---|:---:|---|
| `acme-hvac-catalog` | ❌ | — |
| `coolsupply-distributor` | ✅ | "Listing data courtesy of CoolSupply Wholesale (synthetic test source)." |
| `ahri-directory-export` | ✅ | "Certified ratings data from the Federated HVAC Ratings Council directory (synthetic test source)." |
| `acme-spec-sheets` | ❌ (data) / ✅ (images) | "Dimensional drawings © Acme Climate Systems (synthetic test source)." |

Any page, API response, MCP result or export carrying a fact from an
attribution-required source must render its credit line. Since
`ahri-directory-export` supplies the certified ratings on nearly every entity,
in practice **almost every page in this vertical carries an attribution**.

## Image rights (AGENTS.md rule 9)

| Source | Images reusable | Cache to R2 | Display modes | Attribution |
|---|:---:|:---:|---|---|
| `acme-hvac-catalog` | ❌ | ❌ | none | — |
| `coolsupply-distributor` | ❌ | ❌ | none | — |
| `ahri-directory-export` | ❌ | ❌ | none | — |
| `acme-spec-sheets` | ✅ | ✅ | `THUMBNAIL`, `INLINE` | required |

Default posture is **record the URL, copy nothing**. Copying bytes into R2 is
republication and needs its own decision.

Exactly one source grants reusable image rights, so the permissive branch of the
rule-9 machinery is genuinely exercised rather than merely declared off
everywhere. The inconsistent combination — caching enabled without reuse rights —
fails both gates with `IMAGE_POLICY_INCONSISTENT`.

Where photo rights are unavailable, `seo.yaml` sets
`fallback_to_generated_visualizations: true`: pages render charts built from the
structured facts instead. For a spec dataset that is also better evidence than a
marketing photograph.

## Provenance retention (AGENTS.md rule 10)

| Source | Retain | Retention | Legal hold | Reasoning |
|---|:---:|---|:---:|---|
| `acme-hvac-catalog` | ✅ | indefinite | ❌ | Daily feed; the historical series is the supersession record |
| `coolsupply-distributor` | ✅ | 730 days | ❌ | Rendered HTML is bulky and re-fetched weekly; two years explains any published fact |
| `ahri-directory-export` | ✅ | indefinite | ❌ | Each quarterly export **is** the product for "what was this rated at in 2024" |
| `acme-spec-sheets` | ✅ | indefinite | ❌ | Superseded spec sheets are usually deleted by publishers and are the only evidence for their values |

## Personal data

**None.** `personal_data_present: false` on all four sources. This vertical
describes manufactured equipment. No source carries names, contacts, addresses
or any other personal data, and none should be introduced — doc 13 is explicit
that people-data niches should not be chosen merely because the data is
accessible.

## Takedown and suspension

| Mechanism | Where |
|---|---|
| Source kill switch | `kill_switch_engaged: true` — overrides everything immediately |
| Media kill switch | Per media asset |
| Entity unpublish | Removes from index and sitemap; stays queryable internally |
| Export exclusion | Follows the publish gate automatically |
| MCP/API exclusion | Surface-bound QueryModel rights gates plus MCP/API negative controls |
| Legal hold | `provenance_retention.legal_hold` — preserves evidence past retention |

**Never silently rewrite history.** Corrections follow doc 13's flow: reported →
triaged → source checked → correction or dispute → republished → audit record. A
corrected fact is a new fact version whose predecessor stays in the table.

## AI-generated transformations

AI normalization does not erase source rights. Nothing in this vertical uses an
LLM to *create* facts: normalization is deterministic rules, and LLM adjudication
is limited to recommending entity-resolution decisions it may never execute
(`may_execute_merge: false`, AGENTS.md rule 3). The legal status of transformed
data still depends on the source terms, and that remains a governance decision
rather than a technical assumption.

## What must happen before real ingestion

1. Identify at least three real, materially independent source families.
2. Complete a rights review for each, with a **named human** reviewer, immutable
   terms/evidence, exact matrix decisions, and a next-review date.
3. Confirm every intended acquisition/publication/commercial bundle is
   effective at the release instant; absence remains refusal.
4. Review the two risks that recur in this vertical: bulk-reuse terms on
   certification directory exports, and database rights over compiled
   distributor catalogues in the EU/UK.
5. Use exactly “Manufacturer-reported, as filed with US regulators” for the
   general regulatory-filing product claim.
6. Only then move `vertical.yaml` from `DRAFT` to `ACTIVE`.

Until every one of these is done, this vertical publishes nothing.
