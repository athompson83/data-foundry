# Screening brief (2026-10-03 daily scout round)

You screen ONE data type for Data Foundry (repo /home/user/data-foundry). Read AGENTS.md rules and
docs/sources/pipeline/README.md (Stages, Rights gate) first. Data type = one entity type assembled from >=2
independent publishers' sources, at least one free-text.

Do real live measurement with curl/python from this container. Always send the header
`User-Agent: data-foundry-scout (data@mail.proviciency.com)`. Be polite (no more than ~2 req/s, small samples; never
bulk-download >50MB). Do not use API keys or log in. If a source needs a key, blocks us, or its terms are unreadable
or forbid redistribution: record it as PARKED (RED/UNKNOWN) with the reason, do not work around it.

Record ONLY what you measured. For every candidate member measure: reachability (HTTP status), record count, newest
record date / update cadence, identifier fields, free-text fields, and the published terms (quote verbatim, with URL,
>=40 chars, from a page you actually fetched; paste the quote exactly as it appears). Judge rights GREEN (public
domain/CC0/express commercial permission), AMBER (permitted with conditions you list) or RED/UNKNOWN (park).
Then, for the dataset, pull >=20 real records from each of two members and attempt a measured cross-source link
(declared join = an identifier naming the counterpart record e.g. registration number, FIPS, case number, GTIN;
names/titles/brands only `candidate` and must be hand-checked, report correct/checked). Report honest numbers,
including zero matches.

Write everything under docs/sources/pipeline/evidence/2026-10-03/<dataset-key>/ :
  - screen.py (or .sh): the script(s) you ran; results.json: the measured output (small; <200KB; trim samples);
  - notes.md: the research write-up for this data type: per source a heading, measured facts, verbatim quoted terms with URLs,
    rights verdict and conditions, linkage results, scores reasoning, and what is PARKED/REJECTED and why.
  - snippet.yaml: ready to paste. Contains `candidates:` (one entry per member screened, incl. PARKED ones) and, only
    if the dataset passes (>=2 non-RED members from different publishers/hosts and >=1 measured join between independent
    members that is declared with matched>0, or candidate with reviewed.correct>0), a `datasets:` entry.
    Follow the exact schema in tooling/test/source-pipeline.test.ts and the style of existing entries in
    docs/sources/pipeline/candidates.yaml (keys kebab-case; candidate fields: key,name,category,structuring
    (identifier-extraction|eligibility-criteria|obligation-timeline|event-extraction|normalization),format
    (free-text|structured),publisher,stage (SCREENED, or PARKED),rights,sources[https urls],scores{agent_demand,
    rights_clarity,acquisition_ease,structuring_value,freshness,low_onboarding_cost,poor_existing_access 1-5},terms,
    conditions (required when AMBER and not PARKED), evidence: [docs/sources/pipeline/research-2026-10-03.md],
    next_action (>=10 chars)). Every dataset member key must be a candidate key; dataset needs key,name,category,entity,
    stage SCREENED,description,sources,join_keys,taxonomy,agent_questions,scores,evidence,next_action.
    Use single-quoted YAML strings for anything with colons/quotes. category is lower-case letters with single hyphens.
    Do not edit candidates.yaml or any shared file; the orchestrator merges. Do not git commit.
Keep the final reply under 200 words: dataset key, verdict per member, linkage numbers, and file paths.
Candidate keys must not collide with existing ones (grep candidates.yaml).
