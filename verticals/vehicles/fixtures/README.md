# Fixtures — `vehicles`

> **SYNTHETIC SHAPE FIXTURE — replace with captured artifacts before activation.**
>
> Nothing in this directory was downloaded from EPA, DOE or NHTSA. The build
> environment's network policy blocks every vehicle source host, so these files
> were written by hand to mirror the column names and file shapes **believed**
> to be used by the real artifacts. Every make (Examplar Motors, Fixture
> Automotive, Placeholder Motor Works), model, EPA id, campaign number and
> value is fictional. None describes a real vehicle or a real recall.

## Files

| File | Mirrors | Shape | Rows |
|---|---|---|---|
| `epa-vehicles.csv` | fueleconomy.gov `vehicles.csv` | comma-delimited, header row, 25 of the real file's ~80 columns | 12 configurations |
| `nhtsa-flat-rcl.csv` | NHTSA `FLAT_RCL.txt` | **tab**-delimited, **no header** (column order declared in `normalizers/source-mappings.yaml` `parsing.columns`), 29 columns | 7 campaign × model-year rows |
| `golden/*.json` | — | expected canonical output of the real pipeline | 30 entities, 262 facts, 29 edges |

Both files open with `#` banner lines. The mappings skip leading `#` lines
(`skip_lines_matching: "^#"`); that is harmless on the real files, whose first
characters are a header name or a numeric id. The NHTSA file carries a `.csv`
extension only because the fixture harness binds fixtures to sources by
extension; the real artifact is a zipped `.txt`.

## What the set exercises

1. **One model year from both agencies.** Six model years appear in both
   files and resolve to one entity each on the composite `make_model_year` key.
2. **Spelling differences that must meet.** EPA writes `Examplar Motors` /
   `Roadster`; NHTSA writes `EXAMPLAR MOTORS` / `ROADSTER`. EPA's base model
   `PM-3` and NHTSA's `PM3` normalize to one key.
3. **Codes that must stay apart.** `PM-3`, `PM-30` and `PM-300` are three
   different models; `PM-3 2021` and `PM-3 2022` are two model years.
4. **Asymmetric coverage.** `Quanta 2021`, `PM-3 2021` and `PM-30 2022` exist
   only at EPA (no recall); `PM-300 2022` exists only at NHTSA (no EPA
   configuration and no `model_name`).
5. **Correct absence.** The electric `Voltline` has no `cylinders`/`displ`;
   conventional vehicles have no `atvType`.
6. **One campaign, several rows.** `20V901000` and `21V903000` each span two
   model years and resolve to one campaign entity with two `recall_affects`
   edges.
7. **Controlled vocabulary.** EPA `drive` strings map to canonical terms.

There is **no contested fact**: the two agencies' properties are disjoint
except `model_year`, on which they agree by construction. A real conflict case
(for example NHTSA and EPA disagreeing on a model name) should be added from
captured files, not invented.

## Before activation

Replace both files with captured artifacts (or faithful excerpts of them),
check every column listed under *Unverified source assumptions* in
`../SOURCES.md`, re-derive the goldens from the captured excerpt, and record the
change in `../CHANGELOG.md`.
