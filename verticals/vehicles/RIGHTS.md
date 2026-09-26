# Rights — `vehicles`

AGENTS.md rule 1: **no source without rights metadata; unreviewed sources must
not publish.** Rights are decided by a committed, evidence-based determination
under [ADR-0013](../../docs/decisions/ADR-0013-evidence-based-rights-determination.md).
Determinations for the two mapped sources were **written on 2026-09-26** from
captured evidence. They are **not yet recorded** (`pnpm rights:record`) and the
source YAMLs are **not yet activated**, so everything below is still
fail-closed.

## Classification summary

| Source | YAML classification | Determination | Customer surfaces | Internal processing | Next review |
|---|---|---|---|---|---|
| `nhtsa-recalls` | UNREVIEWED | [`nhtsa-recalls.yaml`](../../docs/sources/determinations/nhtsa-recalls.yaml): `PUBLIC_DOMAIN_US_GOVERNMENT_WORK` | all seven `ALLOW` | all `ALLOW` | 2027-09-26 |
| `epa-fueleconomy-vehicles` | UNREVIEWED | [`epa-fueleconomy-vehicles.yaml`](../../docs/sources/determinations/epa-fueleconomy-vehicles.yaml): `PUBLISHED_TERMS_PERMIT` | all seven **`UNKNOWN`** (refused) | `ACQUIRE`/`STORE`/`CACHE` `ALLOW` | 2027-09-26 |
| `nhtsa-vpic` | UNREVIEWED | none (not mapped). The vPIC FAQ supports § 105 | — | — | — |

Every source is `status: UNDER_REVIEW` (not acquirable), `approved: false`,
and absent from `acquisition.yaml`. `tests/shape-ingest.test.ts` proves the
pipeline refuses the committed declarations. The human-readable record is
[`docs/sources/vehicles-federal-rights-determination-20260926.md`](../../docs/sources/vehicles-federal-rights-determination-20260926.md).

## Why EPA is not § 105

fueleconomy.gov is administered by Oak Ridge National Laboratory, a DOE
contractor. Its only terms page (`/feg/ORNL-disclaimer.htm`, "Copyright
Status") says the documents on the server "may be freely distributed and used
for non-commercial, scientific and educational purposes."

ADR-0013's § 105 basis requires no contrary restriction in the agency's
published terms. This is one, for every commercial surface. The EPA
determination therefore rests on those published terms. It grants only
internal acquisition, storage and caching, and leaves every customer surface
`UNKNOWN`.

Lifting that requires one of two things:

- the same data from an EPA-hosted § 105 publication; or
- written approval from the fueleconomy.gov maintainers or EPA.

Both are routine engineering work.

## Remaining steps to activation

1. `POSTGRES_URL=... corepack pnpm rights:record -- --file docs/sources/determinations/<key>.yaml --dry-run`,
   then without `--dry-run`, per source.
2. Update the source YAML: `rights_classification`, `commercial_use_allowed`
   and related booleans consistent with the determination, reviewed fields,
   status, acquisition approval and `authority_rank`. Do this in a reviewed PR.
3. Only then add `acquisition.yaml` targets. For NHTSA, first resolve the
   two-archive snapshot gap (QUALITY.md).

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

No source supplies images and none are acquired. fueleconomy.gov's vehicle
photographs belong to the manufacturers or Ward's and are never fetched.

## Provenance retention (AGENTS.md rule 10)

| Source | Retain artifacts | Retention | Legal hold |
|---|---|---|---|
| all | ✅ | indefinite | ❌ |

## Personal data

None in the mapped fields. NHTSA `NOTES` and the remedy text carry
manufacturer customer-service and NHTSA hotline **business** phone numbers,
not personal data. `NOTES` stays excluded anyway. EPA's My MPG web service
(per-driver data) is not used.

## Fixture disclosure

The fixtures are **real samples**: verbatim rows of the files captured on
2026-09-26, with the source URL and archive SHA-256 in each banner. They are
committed as source evidence for tests. The shape test activates the two
mapped sources **only in a temporary copy**, with synthetic
internal-processing grants, exactly as the HVAC harness does. No
customer-surface grant exists anywhere. The EPA rows are used here for
internal testing, which the fueleconomy.gov terms permit ("scientific and
educational purposes").

## Takedown and suspension

Unchanged from the platform: `kill_switch_engaged`, entity unpublish, export /
API / MCP exclusion through the publish gate, legal hold. A downgrade to `RED`
the moment contrary evidence appears (ADR-0013).
