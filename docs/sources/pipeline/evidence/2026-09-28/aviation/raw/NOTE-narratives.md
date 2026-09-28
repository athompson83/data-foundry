# Why `narratives.csv` is not committed here

This is the NTSB monthly `narratives` table (free-text finding/cause fields
for the same events as `aircraft.csv`). It is not fabricated or synthetic:
real accident-investigation narratives, including detailed autopsy
findings, toxicology results, named prescription medications and disease
history for specific pilots and passengers. A Codex review on PR #72 found
that even with `aircraft.csv`'s owner/operator names and addresses already
removed (see `NOTE-aircraft.md`), this file still identifies people: each
narrative row carries the same event's NTSB event ID, tail number, exact
date and location, which is enough to re-identify the specific person the
medical findings describe. Per AGENTS.md rule 9 (personal-data exclusion),
that must not sit in a public git history as raw evidence.

Per AGENTS.md rule 10 (preserve raw evidence), it is archived in R2 instead
of dropped, alongside `aircraft.csv` and `up01AUG.zip`:

- bucket: `data-foundry-raw-artifacts`
- key: `research/pipeline/2026-09-28/archive/evidence-2026-09-28-raw.tar.gz`
- sha256 `6cf2e0906c9d2b66f2d7656c149079e570a59f3721591c509a1b63d13e4186ae`
- round-trip verified: upload, then `wrangler r2 object get
  research/pipeline/2026-09-28/archive/evidence-2026-09-28-raw.tar.gz --remote`
  reproduces the same sha256, then the test copy was deleted.

`parse_ntsb_month.py` only reads this file's row count, never its content,
so no redacted fixture is committed either — there is nothing for a
fixture to usefully stand in for here. To replay it, download the tarball
with the command above and extract `aviation/raw/narratives.csv` next to
this note, alongside `aircraft.csv` and `up01AUG.zip` (see
`NOTE-aircraft.md`).
