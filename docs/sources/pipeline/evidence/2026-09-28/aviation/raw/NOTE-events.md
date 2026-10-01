# Why `events.csv` is not committed here

This is the NTSB monthly `events` table (one row per accident/incident:
date, time, location, coordinates, ZIP code, injury/fatality counts, and an
internal `lchg_userid`). It is not fabricated or synthetic: real
accident-level data. A Codex review on PR #72 found that, after
`aircraft.csv` and `narratives.csv` were already removed for identifying
people, `events.csv` still pinpoints a specific fatal accident (exact date,
time, ZIP code, coordinates, fatality count and NTSB event ID together are
enough to identify it, and the internal `lchg_userid` field is itself an
identifier). Per AGENTS.md rule 9 (personal-data exclusion), that must not
sit in a public git history as raw evidence.

Per AGENTS.md rule 10 (preserve raw evidence), it is archived in R2 instead
of dropped, alongside `aircraft.csv`, `narratives.csv` and `up01AUG.zip`:

- bucket: `data-foundry-raw-artifacts`
- key: `research/pipeline/2026-09-28/archive/evidence-2026-09-28-raw.tar.gz`
- see `../../archive/ARCHIVE.txt` for the current sha256 and full manifest.

`parse_ntsb_month.py` and `model_candidate_join.py` only read this file's
`ev_date` field (to compute the round's event-date range) and never any of
the identifying fields above, so no redacted fixture is committed either —
a fixture would need to preserve `ev_date` values, which are themselves
part of what makes a row identifiable when combined with the other fields.
To replay either script, download the tarball with the command above and
extract `aviation/raw/events.csv` next to this note, alongside
`aircraft.csv`, `narratives.csv` and `up01AUG.zip`.
