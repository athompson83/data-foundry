# Why `<pictures>` blocks are stripped from the tracked detail XML files

`detail_10000322.xml`, `detail_10000323.xml` and `detail_10000324.xml` are
EU Safety Gate notification detail responses. Each notice can carry a
`<pictures>` element with one or more `<picture>` elements holding a live
image URL (`https://ec.europa.eu/safety-gate-alerts/public/api/notification/image/<id>`).

This dataset's own recorded rights condition in `candidates.yaml`
(`eu-safety-gate-alerts`) says: "Do not republish the `<pictures>` image
URLs or images (supplied by national authorities/traders; not
[rights-cleared for redistribution])." A Codex review on PR #72 found the
three files above still carried every `<pictures>` block from the original
live fetch (40, 97 and 86 blocks respectively), which committing to a
public repository republishes, in violation of that condition and AGENTS.md
rule 9 (respect image rights).

Every `<pictures>...</pictures>` block is replaced with a self-closing
`<pictures/>` in the three committed files. Nothing else in the files
changed: `parse_weekly_reports.py` never reads the picture field, and
re-running it against the redacted files reproduces the exact same
`eu_records_sample.json` and `results/extraction_rates.txt` (223/223
records, same field hit rates) as before this fix.

The complete, unredacted original responses (image URLs included) are
preserved in R2, not discarded, per AGENTS.md rule 10:

- bucket: `data-foundry-raw-artifacts`
- key: `research/pipeline/2026-09-28/archive/evidence-2026-09-28-raw.tar.gz`
- see `../../archive/ARCHIVE.txt` for the current sha256 and manifest — note
  that the three `eu-safety-gate/raw/detail_*.xml` hashes listed there are
  for the original, unredacted files (as archived), which will no longer
  match the redacted files committed here; that mismatch is expected and
  is why this note exists.
