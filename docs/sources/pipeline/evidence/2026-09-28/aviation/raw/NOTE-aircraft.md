# Why `aircraft.csv` and `up01AUG.zip` are not committed here

Both hold the NTSB monthly `aircraft` table's real owner-identifying fields
(`owner_acft`, `owner_street`, `owner_city`, `owner_state`, `owner_zip`,
`oper_individual_name`, `oper_street`, `oper_city`, `oper_state`,
`oper_zip`, ...) for accident-involved private aircraft — real names and
home addresses, not fabricated or synthetic. A Codex review on PR #72 found
this: per AGENTS.md rule 9 (personal-data exclusion), that must not sit in a
public git history even as raw evidence, and `up01AUG.zip` is the source
`.mdb`'s zip, so it embeds the same table.

Unlike the same round's dropped `eu-safety-gate/raw/cpsc_recent.json` (see
`../../eu-safety-gate/raw/NOTE-cpsc_recent.md`), this data is not redundant
with anything else already archived in this system, so AGENTS.md rule 10
(preserve raw evidence) still applies — it is archived in R2 instead of
dropped:

- bucket: `data-foundry-raw-artifacts`
- key: `research/pipeline/2026-09-28/archive/evidence-2026-09-28-raw.tar.gz`
- 1,570,317 bytes, sha256 `52a5ddef3ed37efbfa7375bf7bc3d1c69f7d343579db7b0481662ecb3b5b1d2b`
- round-trip verified: upload, then `wrangler r2 object get
  research/pipeline/2026-09-28/archive/evidence-2026-09-28-raw.tar.gz --remote`
  reproduces the same sha256, then the test copy was deleted.

The tarball also holds a complete, redundant copy of this round's other raw
inputs (`events.csv`, `narratives.csv`, the five Federal Register JSON
responses, and the EU Safety Gate XML files), which stay committed directly
here since none of them carry personal data. Per-file sizes and hashes for
everything in the tarball are in `../../archive/ARCHIVE.txt`.

To replay `parse_ntsb_month.py` or `model_candidate_join.py`, download the
tarball with the command above and extract `aviation/raw/aircraft.csv` and
`aviation/raw/up01AUG.zip` next to this note.
