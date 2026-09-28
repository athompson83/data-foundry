# Why `aircraft.csv` and `up01AUG.zip` are not committed here

The NTSB monthly `aircraft` table (extracted with `mdb-export` per
`../scripts/parse_ntsb_month.py`'s docstring) carries, for every one of its
163 rows this update, real owner/operator personal data: `owner_acft`,
`owner_street`, `owner_city`, `owner_state`, `owner_zip`,
`oper_individual_name`, `oper_name`, `oper_street`, `oper_city`, `oper_state`
and `oper_zip`. This is personal data — full names and home/business
addresses of real aircraft owners and operators — not a fact this dataset
publishes or a claim this repository makes; a Codex review on PR #72 caught
it before merge. `up01AUG.zip` is the source `.mdb`'s compressed form and
carries the same table, so it is excluded for the identical reason.

This does not remove the evidence: `../results/ntsb_extraction_rates.txt`
and `../results/model_candidate_join.txt` are derived, aggregate outputs
(field hit-rate counts, a date range, five hand-reviewed make/model
verdicts) that name no individual. `events.csv` and `narratives.csv` are
still committed — their fields (event location, free-text finding/cause
prose) are NTSB's own published factual findings, not owner/operator
contact records, matching how `cpsc_recent.json`'s ConsumerContact text was
excluded while CPSC's `Description`/`Title` prose stays
(see `../../eu-safety-gate/raw/NOTE-cpsc_recent.md`).

To reproduce: re-fetch `up01AUG.zip` (or the current month's equivalent)
from `https://data.ntsb.gov/avdata/FileDirectory/DownloadFile?fileID=...`
with the declared scout User-Agent, run `mdb-export ... aircraft` per the
script's docstring, and treat the result as personal data — do not commit
it to git or serve owner/operator fields from any published surface.
