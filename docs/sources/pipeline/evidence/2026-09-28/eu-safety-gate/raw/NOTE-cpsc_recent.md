# Why `cpsc_recent.json` is not committed here

The live CPSC sample used by `../scripts/brand_candidate_join.py` and
`../scripts/gtin_join.py` was fetched 2026-09-28 from
`https://www.saferproducts.gov/RestWebServices/Recall?format=json&RecallDateStart=2024-01-01&RecallDateEnd=2026-09-28`
with the declared scout User-Agent, exactly as documented in `gtin_join.py`'s
docstring. It is not committed to git: `tooling/test/repository-policy.test.ts`
refuses any tracked file outside its allowlist that names a domain on
`PROHIBITED_SOURCES` (`packages/source-registry/src/prohibited-sources.ts`).
This CPSC sample's real, verbatim `ConsumerContact`, `Remedies` and
`Description` fields legitimately name four of the HVAC-manufacturer domains
on that list as manufacturer dealer/remedy URLs (one is a substring match
inside an unrelated seller's own, differently-spelled domain) — real CPSC
text, not a fabricated rights claim or a fetch target, but the policy test
cannot tell the difference and rightly refuses to guess. (Deliberately not
spelling the domains out here either, so this note itself doesn't need
adding to that test's allowlist — see `docs/sources/prohibited-sources.md`
for the actual list.)

A Codex review on PR #72 correctly rejected an earlier version of this note,
which reasoned this file was redundant with the production
`data-foundry-recalls` Worker's own R2 archival and dropped it entirely: the
production Worker's archived responses aren't identified by key/hash as
*this exact* input, and "re-fetch the URL above" points at mutable live
data, so a later replay could get different counts than the published
`0/151` (`gtin_join.py`) and `15/223` (`brand_candidate_join.py`)
measurements. This exact file (re-fetched once more to confirm
byte-for-byte stability — same sha256 as the very first fetch this round)
is preserved in R2 instead, per AGENTS.md rule 10:

- bucket: `data-foundry-raw-artifacts`
- key: `research/pipeline/2026-09-28/archive/evidence-2026-09-28-raw.tar.gz`
- see `../../archive/ARCHIVE.txt` for the current sha256 and full manifest
  (this tarball was rebuilt again to add this file back in).

To replay `gtin_join.py`/`brand_candidate_join.py` against the exact
published measurements, download the tarball and extract
`eu-safety-gate/raw/cpsc_recent.json` next to this note.
