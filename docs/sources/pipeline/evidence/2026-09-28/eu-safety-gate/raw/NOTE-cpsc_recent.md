# Why `cpsc_recent.json` is not committed here

The live CPSC sample used by `../scripts/brand_candidate_join.py` and
`../scripts/gtin_join.py` was fetched 2026-09-28 from
`https://www.saferproducts.gov/RestWebServices/Recall?format=json&RecallDateStart=2024-01-01&RecallDateEnd=2026-09-28`
with the declared scout User-Agent, exactly as documented in `gtin_join.py`'s
docstring. It is not committed to git, for two independent reasons:

1. `tooling/test/repository-policy.test.ts` refuses any tracked file outside
   its allowlist that names a domain on `PROHIBITED_SOURCES`
   (`packages/source-registry/src/prohibited-sources.ts`). This CPSC sample's
   real, verbatim `ConsumerContact`, `Remedies` and `Description` fields
   legitimately name four of the HVAC-manufacturer domains on that list as
   manufacturer dealer/remedy URLs (one is a substring match inside an
   unrelated seller's own, differently-spelled domain) — real CPSC text, not
   a fabricated rights claim or a fetch target, but the policy test cannot
   tell the difference and rightly refuses to guess. (Deliberately not
   spelling the domains out here either, so this note itself doesn't need
   adding to that test's allowlist — see `docs/sources/prohibited-sources.md`
   for the actual list.)
2. It would be redundant even if the test allowed it: CPSC's raw evidence is
   already fully preserved by the production `data-foundry-recalls` Worker's
   own ingestion (`apps/recalls-worker/src/product-sync.ts` archives every
   raw response to R2 by SHA-256 before parsing — see
   `research-2026-09-28.md` §3). This file was only ever a same-day
   convenience copy for the join scripts above, not a new source's
   irreplaceable evidence under AGENTS.md rule 10.

To reproduce: re-fetch the URL above (or any later CPSC window) with the
declared User-Agent and save it as `cpsc_recent.json` next to this note
before re-running the two scripts.
