# Vehicles initial load: operator bulk ingest from the ZIP files

**Status:** tooling ready. The real files were downloaded and verified on
2026-09-26, and the committed mappings extract every row with zero issues
(`verticals/vehicles/SOURCES.md`, "Source verification").

The run is **still refused**, for three reasons:

- all three vehicles sources are fail-closed (`UNDER_REVIEW`, `UNREVIEWED`,
  acquisition not approved);
- the determinations are written but not recorded;
- the EPA determination permits **no customer surface**
  (`verticals/vehicles/RIGHTS.md`).

NHTSA also has one open design gap: its snapshot is **two** archives (below).

With the committed declarations, the command below refuses both sources and
writes no canonical claims. The refusal is intended. This is routine
engineering work, not an owner decision.

## Why an operator step

The bulk files are ZIP archives whose members far exceed the Worker ingestion
limits (`INGESTION_LIMITS`: 1 MiB per artifact and 1,000 records):

- `vehicles.csv`: 21.8 MB, 50,409 rows;
- `FLAT_RCL_POST_2010.txt`: 311 MB, 245,535 rows. The initial snapshot is therefore loaded
offline with `pnpm ingest --artifact`. This path uses the same acquisition
provider as a fixture run, the same rights and status gates, the same
extraction and normalization, and the same canonical store. It never bypasses
a gate.

- **Evidence (AGENTS.md rule 10).** The ZIP exactly as downloaded is the source
  artifact. `source_artifacts.content_hash` is the SHA-256 of the ZIP, and the
  bytes are kept under `--evidence-dir` in the R2 key layout
  (`raw/vehicles/<source>/content/<aa>/<sha256>`, plus a `.meta.json` sidecar).
- **Locators.** Every fact and alias locator names the archive member as well as
  the row and column, for example
  `member=vehicles.csv;row=1234;column=city08;index=5`.
- **Archive limits (fail closed).** These are declared in
  `verticals/vehicles/normalizers/source-mappings.yaml` under `parsing.archive`:
  - at most 8 members (each real archive has 1);
  - EPA at most 256 MiB uncompressed (real: 21.8 MB); NHTSA at most 512 MiB
    (real: 311 MB for POST_2010, which grows weekly);
  - a compression ratio of at most 200x (real: 9.9x, 11.3x and 20.7x);
  - exactly one member must match the declared name or glob;
  - no unsafe member names, no encryption, no ZIP64 multi-disk archives;
  - the CRC-32 is verified.

  A refusal reports a `ZIP_*` code.

## Download URLs (verified 2026-09-26)

| Source key | URL | Member | Size (zip / member) | Rows |
|---|---|---|---|---|
| `epa-fueleconomy-vehicles` | `https://www.fueleconomy.gov/feg/epadata/vehicles.csv.zip` | `vehicles.csv` | 2.2 MB / 21.8 MB | 50,409 |
| `nhtsa-recalls` | `https://static.nhtsa.gov/odi/ffdd/rcl/FLAT_RCL_PRE_2010.zip` | `FLAT_RCL_PRE_2010.txt` | 7.4 MB / 83.8 MB | 81,710 (67,311 vehicle) |
| `nhtsa-recalls` | `https://static.nhtsa.gov/odi/ffdd/rcl/FLAT_RCL_POST_2010.zip` | `FLAT_RCL_POST_2010.txt` | 15.0 MB / 311.1 MB | 245,535 (218,799 vehicle) |

There is **no** `FLAT_RCL.zip`. The captured SHA-256s and manifests are in
`docs/sources/evidence/vehicles/`.

### Open gap: NHTSA's snapshot is two archives

Both NHTSA streams are `refresh_mode: full_snapshot`. A complete-snapshot run
**retires** every stored record the loaded artifact omits. The CLI accepts one
`--artifact` per source. So loading `FLAT_RCL_PRE_2010.zip` and then
`FLAT_RCL_POST_2010.zip` in two runs would retire all pre-2010 recalls in the
second run.

Until this is resolved, **load `FLAT_RCL_POST_2010.zip` only**. It covers
every campaign received since 2010-01-01, including all model years still on
the road that matter commercially. Treat pre-2010 recalls as absent.

The fix is one of the following, as a reviewed platform change:

- let one run take several archives of one source as a single snapshot;
- declare the pre-2010 archive as its own source or stream;
- make the NHTSA streams `incremental` and accept that withdrawn campaigns are
  never retired.

The URL recorded on the artifact is built from the source's robots
`allowed_paths` plus the file name. **Keep the publisher's file names.**
Renaming the file changes the recorded URL.

## Steps

1. **Download and record what was fetched.** From a network-enabled machine:

   ```bash
   mkdir -p ~/vehicles-load && cd ~/vehicles-load
   UA='DataFoundryBot/1.0 (+https://data.aroqon.com)'
   curl -fSLO -A "$UA" https://www.fueleconomy.gov/feg/epadata/vehicles.csv.zip
   curl -fSLO -A "$UA" https://static.nhtsa.gov/odi/ffdd/rcl/FLAT_RCL_POST_2010.zip
   curl -fSLO -A "$UA" https://static.nhtsa.gov/odi/ffdd/rcl/RCL.txt
   sha256sum vehicles.csv.zip FLAT_RCL_POST_2010.zip RCL.txt | tee SHA256SUMS
   unzip -l vehicles.csv.zip; unzip -l FLAT_RCL_POST_2010.zip
   ```

   Compare `RCL.txt` with `docs/sources/evidence/vehicles/nhtsa-RCL.txt`. If its
   change log added a field, re-verify the column order before loading. The
   mappings were verified on 2026-09-26: column names, the NHTSA column order,
   and `quote: ""` for the unquoted flat file.

2. **Refusal check with a throwaway database.** This proves the gates hold and
   that the CLI accepts the files:

   ```bash
   corepack pnpm --filter @data-foundry/ingest-worker ingest -- \
     --vertical vehicles \
     --artifact epa-fueleconomy-vehicles=$HOME/vehicles-load/vehicles.csv.zip \
     --artifact nhtsa-recalls=$HOME/vehicles-load/FLAT_RCL_POST_2010.zip \
     --max-records 2000000 --memory --dry-run
   ```

   Relative paths resolve against the directory you ran `pnpm` from.

   Both sources must report `FAIL` with a rights or status reason. A fresh
   `--memory` database holds no rights grants, so this run is always refused,
   and the refusal happens before any bytes are read. Archive and column
   problems therefore surface only in the real dry run in step 4.

   `--max-records` is the per-source ceiling on extracted records, and each row
   produces two streams. The default is 100,000 and the maximum is 5,000,000.
   The EPA file has 50,409 rows, which is 100,818 stream records. That is just
   over the default, so pass `--max-records`. The NHTSA POST_2010 file has
   245,535 rows (218,799 vehicle rows).

3. **Activate through the normal governance path.** None of this is done by the
   CLI:
   - The ADR-0013 determinations are committed in
     `docs/sources/determinations/`:
     - NHTSA recalls: § 105, every surface ALLOW.
     - EPA: internal processing only, every customer surface UNKNOWN. EPA
       facts may be loaded for evaluation but cannot reach a customer.
   - Record each determination:
     `POSTGRES_URL=... corepack pnpm rights:record -- --file docs/sources/determinations/<source-key>.yaml`.
   - Move each source YAML to an approved or active status, approve its
     acquisition policy and assign its `authority_rank`, in a reviewed PR.

4. **Load into the private schema.** Use the runtime role for application work
   and the dedicated migration role, exactly as for any real ingest (see
   `cloudflare-deployment.md`):

   ```bash
   export POSTGRES_URL='<df_ingestion runtime connection>'
   export DATA_FOUNDRY_MIGRATION_DATABASE_URL='<migration role connection>'
   export DATA_FOUNDRY_RELEASE_SHA="$(git rev-parse HEAD)"
   # First with --dry-run: acquire, unpack, extract, normalize and resolve, but
   # write no canonical claims. Fix any ZIP_* or UNKNOWN_COLUMN error before
   # the real run.
   corepack pnpm --filter @data-foundry/ingest-worker ingest -- \
     --vertical vehicles \
     --artifact epa-fueleconomy-vehicles=$HOME/vehicles-load/vehicles.csv.zip \
     --artifact nhtsa-recalls=$HOME/vehicles-load/FLAT_RCL_POST_2010.zip \
     --max-records 2000000 \
     --evidence-dir $HOME/vehicles-load/evidence --dry-run
   # Then the writing run:
   corepack pnpm --filter @data-foundry/ingest-worker ingest -- \
     --vertical vehicles \
     --artifact epa-fueleconomy-vehicles=$HOME/vehicles-load/vehicles.csv.zip \
     --artifact nhtsa-recalls=$HOME/vehicles-load/FLAT_RCL_POST_2010.zip \
     --max-records 2000000 \
     --evidence-dir $HOME/vehicles-load/evidence \
     --run-id vehicles-initial-$(date -u +%Y%m%d)
   ```

   Any `--artifact` run against a persistent database, including a dry run,
   refuses to start without `--evidence-dir`: the run records the file as a
   source artifact, so the bytes must be kept.
   The run exits non-zero if any source fails or if provenance coverage is
   below 100%.

5. **Preserve the evidence.** Upload the `--evidence-dir` tree to the raw
   artifact bucket under the same keys. The artifact rows currently record
   `file://` URIs from this machine. Re-pointing `r2_uri` to the bucket is a
   follow-up; until then, keep the local tree and `SHA256SUMS` together.

## Known limits

- **Memory.** The whole file is read, one member is inflated in memory, and
  every extracted record is held for the run. Expect a few GB of heap for the
  NHTSA file; run with `NODE_OPTIONS=--max-old-space-size=8192` if needed.
- **ZIP64.** ZIP64 archives on a single disk are read. Multi-disk archives,
  encryption and compression methods other than stored and deflate are refused.
- **Refresh.** Monthly and weekly refreshes still need a partitioned or streamed
  design. This path is the initial snapshot and manual re-loads.
