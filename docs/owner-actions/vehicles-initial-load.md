# Vehicles initial load: operator bulk ingest from the ZIP files

**Status:** tooling ready; **not yet runnable against real data.** The real
files have not been downloaded or inspected, the column names and the NHTSA
column order are unverified (`verticals/vehicles/SOURCES.md`), and all three
vehicles sources are fail-closed (`UNDER_REVIEW`, `UNREVIEWED`, acquisition not
approved). With the committed declarations the command below **refuses** both
sources and writes no canonical claims. The refusal is intended.

This is routine engineering work once network access (`UA-009`) is available.
It is not an owner decision.

## Why an operator step

Both bulk files are expected to be ZIP archives larger than the 16 MiB
direct-HTTP ceiling and the Worker ingestion limits (`INGESTION_LIMITS`: 1 MiB
per artifact and 1,000 records). The initial snapshot is therefore loaded
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
  - at most 8 members;
  - EPA at most 256 MiB uncompressed, NHTSA at most 512 MiB;
  - a compression ratio of at most 200x;
  - exactly one member must match the declared name or glob;
  - no unsafe member names, no encryption, no ZIP64 multi-disk archives;
  - the CRC-32 is verified.

  A refusal reports a `ZIP_*` code.

## Download URLs (expected, UNVERIFIED)

| Source key | Expected URL | Expected member |
|---|---|---|
| `epa-fueleconomy-vehicles` | `https://www.fueleconomy.gov/feg/epadata/vehicles.csv.zip` | `vehicles.csv` (exact) |
| `nhtsa-recalls` | `https://static.nhtsa.gov/odi/ffdd/rcl/FLAT_RCL.zip` | `FLAT_RCL*.txt` (glob; the exact name is unverified) |

The URL recorded on the artifact is built from the source's robots
`allowed_paths` plus the file name. **Keep the publisher's file names.**
Renaming the file changes the recorded URL.

## Steps

1. **Download and record what was fetched.** From a network-enabled machine:

   ```bash
   mkdir -p ~/vehicles-load && cd ~/vehicles-load
   curl -fSLO https://www.fueleconomy.gov/feg/epadata/vehicles.csv.zip
   curl -fSLO https://static.nhtsa.gov/odi/ffdd/rcl/FLAT_RCL.zip
   sha256sum vehicles.csv.zip FLAT_RCL.zip | tee SHA256SUMS
   unzip -l vehicles.csv.zip; unzip -l FLAT_RCL.zip
   ```

   If a member name does not match `parsing.archive.member`, correct the
   mapping. Then work through every item under "Unverified source assumptions"
   in `verticals/vehicles/SOURCES.md` against the real files: column names, the
   NHTSA column order, and quoting. If NHTSA's free text contains literal `"`
   characters and the file is unquoted, declare `quote: ""` under
   `nhtsa-recalls` `parsing`. Record each correction in
   `verticals/vehicles/CHANGELOG.md`, and replace the synthetic fixtures and
   goldens with slices of the captured files.

2. **Refusal check with a throwaway database.** This proves the gates hold and
   that the CLI accepts the files:

   ```bash
   corepack pnpm --filter @data-foundry/ingest-worker ingest -- \
     --vertical vehicles \
     --artifact epa-fueleconomy-vehicles=$HOME/vehicles-load/vehicles.csv.zip \
     --artifact nhtsa-recalls=$HOME/vehicles-load/FLAT_RCL.zip \
     --max-records 2000000 --memory --dry-run
   ```

   Relative paths resolve against the directory you ran `pnpm` from.

   Both sources must report `FAIL` with a rights or status reason. A fresh
   `--memory` database holds no rights grants, so this run is always refused,
   and the refusal happens before any bytes are read. Archive and column
   problems therefore surface only in the real dry run in step 4.

   `--max-records` is the per-source ceiling on extracted records, and each row
   produces two streams. The default is 100,000 and the maximum is 5,000,000.
   The EPA file (about 48k rows, UNVERIFIED) fits in 100,000 stream records.
   The NHTSA file (several hundred thousand rows, UNVERIFIED) does not.

3. **Activate through the normal governance path.** None of this is done by the
   CLI:
   - Commit an ADR-0013 determination for each source. The expected basis is
     `PUBLIC_DOMAIN_US_GOVERNMENT_WORK`; the determination rests on captured
     terms and a captured `robots.txt`.
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
     --artifact nhtsa-recalls=$HOME/vehicles-load/FLAT_RCL.zip \
     --max-records 2000000 \
     --evidence-dir $HOME/vehicles-load/evidence --dry-run
   # Then the writing run:
   corepack pnpm --filter @data-foundry/ingest-worker ingest -- \
     --vertical vehicles \
     --artifact epa-fueleconomy-vehicles=$HOME/vehicles-load/vehicles.csv.zip \
     --artifact nhtsa-recalls=$HOME/vehicles-load/FLAT_RCL.zip \
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
