# Rights — `vehicles`

AGENTS.md rule 1: **no source without rights metadata; unreviewed sources must
not publish.** Rights are decided by a committed, evidence-based determination
under [ADR-0013](../../docs/decisions/ADR-0013-evidence-based-rights-determination.md).
**No determination exists for any vehicles source yet.** Everything below is
fail-closed.

## Classification summary

| Source | Classification | Publishable? | Commercial | Redistribution | Derivative normalization | Attribution | Reviewed | Next review |
|---|---|---|---|---|---|---|---|---|
| `epa-fueleconomy-vehicles` | UNREVIEWED | ❌ | ❌ | ❌ | ❌ | required (drafted) | never | — |
| `nhtsa-recalls` | UNREVIEWED | ❌ | ❌ | ❌ | ❌ | required (drafted) | never | — |
| `nhtsa-vpic` | UNREVIEWED | ❌ | ❌ | ❌ | ❌ | required (drafted) | never | — |

Every source is `status: UNDER_REVIEW` (not acquirable), `approved: false`,
and absent from `acquisition.yaml`. `tests/shape-ingest.test.ts` proves the
pipeline refuses the committed declarations.

## Expected basis and what is missing

**Expected basis:** `PUBLIC_DOMAIN_US_GOVERNMENT_WORK` (17 U.S.C. § 105) for all
three: they are publications of U.S. EPA, U.S. DOE and NHTSA. That is an
expectation, not a determination. ADR-0013 requires, per source, a file under
`docs/sources/determinations/<source-key>.yaml` stating:

1. the basis, with the federal-work reasoning;
2. evidence: the agency terms/policy URLs, retrieval dates and content digests
   — or, where retrieval fails, an explicit statement that the basis rests on
   § 105 alone;
3. each surface cell (`PUBLIC_WEB`, `SEARCH_INDEX`, `API_FREE`, `API_PAID`,
   `RAPIDAPI`, `MCP`, `BULK_EXPORT`) decided separately;
4. hard stops checked: personal data (the NHTSA `NOTES` field is excluded
   pending this check), third-party marks (make names are used as factual
   identifiers, not branding), embedded third-party content, rate limits and
   robots rules (not yet retrieved);
5. attribution and a "not endorsed by the agency" disclaimer (drafted in each
   source's `attribution_requirement`);
6. `recheck_at` within 12 months.

`docs/sources/vehicles-federal-rights-determination-20260926.md`, named in
ADR-0013 as the first determination, **has not been written**: the build
environment could not retrieve the terms (`UA-009`). Then run
`pnpm rights:record` per source, update the source YAML (classification,
reviewed fields, approval), and only then consider `acquisition.yaml` targets.

## Government-source cautions

- **Manufacturer-reported content.** Recall text is the manufacturer's Part
  573 report; EPA figures are label values mostly from manufacturer testing.
  Both sources are `REGULATORY_FILING`, and no surface may present the values
  as an agency finding, certification or endorsement.
- **Model-year granularity.** A recall at model-year level does not establish
  that a particular vehicle is affected; every carrying surface must say so
  (product.yaml limitations).
- **VINs.** A VIN a customer submits is customer input. The VIN surface needs
  its own privacy/retention decision before it exists.

## Image rights (AGENTS.md rule 9)

| Source | Images reusable | Cache to R2 | Display modes | Attribution |
|---|---|---|---|---|
| all | ❌ | ❌ | none | — |

No source supplies images and none are acquired.

## Provenance retention (AGENTS.md rule 10)

| Source | Retain artifacts | Retention | Legal hold |
|---|---|---|---|
| all | ✅ | indefinite | ❌ |

## Personal data

None in the mapped fields. NHTSA `NOTES` is excluded until checked.

## Synthetic fixture disclosure

The fixtures are **synthetic**: fictional makes (Examplar Motors, Fixture
Automotive, Placeholder Motor Works), fictional ids, campaign numbers and text,
authored by the Data Foundry team. They are not EPA, DOE or NHTSA data and make
no claim about any real vehicle. The shape test activates the two mapped
sources **only in a temporary copy** with synthetic internal-processing grants,
exactly as the HVAC harness does; no customer-surface grant exists anywhere.

## Takedown and suspension

Unchanged from the platform: `kill_switch_engaged`, entity unpublish, export /
API / MCP exclusion through the publish gate, legal hold. A downgrade to `RED`
the moment contrary evidence appears (ADR-0013).
