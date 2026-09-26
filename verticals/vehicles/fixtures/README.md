# Fixtures — `vehicles`

> **REAL SAMPLE captured 2026-09-26.** Both files are verbatim rows of the
> publishers' files. The only change is CRLF → LF, forced by `.gitattributes`.
> Each file opens with `#` banner lines naming the source URL and the SHA-256
> of the downloaded archive. The mappings skip those lines
> (`skip_lines_matching: "^#"`). The complete files and their manifests are
> described in `docs/sources/evidence/vehicles/`.

## Files

| File | Taken from | Rows | Source line numbers in the member |
|---|---|---|---|
| `epa-vehicles.csv` | `https://www.fueleconomy.gov/feg/epadata/vehicles.csv.zip`, SHA-256 `fd9132961f2aff95464b9671aec025ecd886092521aa8855e79f77717a45ec0f`, member `vehicles.csv` | the real 84-column header + 28 rows | 1 (header), 29985, 31726–31728, 32518–32520, 32693, 32696, 32697, 32876, 33826, 33827, 33937, 33953, 33955, 34095, 34101, 34109, 34116, 34196, 34204, 36289, 36294, 36713, 36714, 39752, 39753 |
| `nhtsa-flat-rcl.csv` | `https://static.nhtsa.gov/odi/ffdd/rcl/FLAT_RCL_POST_2010.zip`, SHA-256 `306e4fb488c45e184d0dc79a786c9e8062029d634e3590ced869fd26ba2cac95`, member `FLAT_RCL_POST_2010.txt` | 16 rows: 13 vehicle (`V`) rows and 3 non-vehicle rows (`E`, `T`, `C`) | 508, 50003, 50597, 51334, 51335, 55906, 63467, 65189, 80569, 95409, 147016, 157343, 160132, 168803, 174067, 220072 |
| `golden/*.json` | — | expected canonical output of the real pipeline, regenerated with `VEHICLES_UPDATE_GOLDENS=1` | 57 entities, 580 facts, 51 edges |

The NHTSA file keeps a `.csv` extension only because the fixture harness binds
fixtures to sources by extension. It is TAB-delimited, headerless and unquoted,
like the real member.

## What the set exercises

1. **One model year from both agencies.**
   - EPA `Ford F150 2019` meets NHTSA `FORD F-150 2019`.
   - EPA `Honda Accord 2018` meets NHTSA `HONDA ACCORD 2018`, with four
     campaigns and seven configurations.
   - Camry 2018, Ranger 2023, Tesla Model 3 2021, Tiguan 2021 and Accord 2019
     also join.
2. **The measured join gap, never guessed.**
   - NHTSA `ACCORD HYBRID 2018` does not become EPA's `Accord 2018`. EPA files
     the hybrid under `baseModel` `Accord`.
   - NHTSA `C 300 2019` does not become EPA's `C-Class 2019`.
   - Each stays its own NHTSA-only model year.
3. **One campaign across model years and models.**
   - `23V858000` covers `ACCORD 2018` and `ACCORD HYBRID 2018`.
   - `18V629000` has two rows for one model year with **two components**, so
     the `component` values compete.
4. **Correct absence.**
   - The EVs (Tesla) have no `cylinders`/`displ`.
   - Conventional vehicles have no `atvType`.
   - `20V314000` has no `MFGCAMPNO`.
5. **Real quirks.**
   - Row `228731` (`22V176000`) has a field beginning with `"`, which only the
     unquoted parse (`quote: ""`) accepts.
   - `23V283000` carries `DO_NOT_DRIVE` `Yes`.
   - `18V761000`'s `MFGCAMPNO` `2019030012` is a numeric-looking string that
     exposed, and now guards, a canonical-store re-parse bug.
   - The Volt 2017 row shows the PHEV `range` semantics gap.
6. **Non-vehicle recalls are excluded.** Real rows:
   - `10E043000`, equipment, under the declared make `FORD`;
   - `25T016000`, tire, `9999` year;
   - `19C001000`, child seat.

   The `where: { column: RCLTYPECD, in: [V] }` filter keeps them all out of
   the goldens.

## Refreshing

Pick rows by line number from a newly captured member and update the banner
digest. Then regenerate the goldens
(`VEHICLES_UPDATE_GOLDENS=1 npx vitest run verticals/vehicles/tests/shape-ingest.test.ts`),
review the diff, and record the change in `../CHANGELOG.md`.
