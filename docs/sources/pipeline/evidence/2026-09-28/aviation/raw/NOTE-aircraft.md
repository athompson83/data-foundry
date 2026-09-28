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
- sha256 `6cf2e0906c9d2b66f2d7656c149079e570a59f3721591c509a1b63d13e4186ae`
- round-trip verified: upload, then `wrangler r2 object get
  research/pipeline/2026-09-28/archive/evidence-2026-09-28-raw.tar.gz --remote`
  reproduces the same sha256, then the test copy was deleted.

A later Codex review found `narratives.csv` also identifies people (see
`NOTE-narratives.md`) and belongs in this same archive, not committed
directly; a further review found the archive's Federal Register JSON copies
had gone stale after they were re-fetched in full (`per_page=1000`) to fix
an unrelated pagination bug. This tarball was rebuilt to include the
current `narratives.csv` and the current, complete Federal Register JSON
files, replacing the original upload at the same key (the sha256 above is
for the current, rebuilt tarball). The tarball still also holds a complete,
redundant copy of this round's other raw inputs (`events.csv`, the five
Federal Register JSON responses, and the EU Safety Gate XML files), which
stay committed directly here since none of them carry personal data.
Per-file sizes and hashes for everything in the tarball are in
`../../archive/ARCHIVE.txt`.

To replay `parse_ntsb_month.py` or `model_candidate_join.py`, download the
tarball with the command above and extract `aviation/raw/aircraft.csv`,
`aviation/raw/narratives.csv` and `aviation/raw/up01AUG.zip` next to this
note.
