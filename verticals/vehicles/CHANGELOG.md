# Changelog — `vehicles`

All notable changes to this vertical's **schema and data**. Versions are the
`schema_version` in `vertical.yaml`.

## [Unreleased]

### Added
- `parsing.archive` for both mapped sources. `vehicles.csv` and `FLAT_RCL*.txt`
  are read from their ZIP archives with limits that fail closed. The ZIP is
  the recorded evidence artifact, and fact locators now cite
  `member=<name>;row=…;column=…` when the artifact is an archive.
  `accept_unarchived` keeps the plain-CSV fixtures (and an
  operator-extracted CSV) working. Goldens are unchanged.
- An operator bulk-load path, `pnpm ingest --artifact <source-key>=<zip>`
  (`docs/owner-actions/vehicles-initial-load.md`), proven end to end on the
  shape fixtures packaged as ZIPs (`tests/zip-ingest.test.ts`).

### Changed — verified against the real files (2026-09-26)
- Captured the EPA and NHTSA bulk files, NHTSA's field description `RCL.txt`,
  the fueleconomy.gov terms, vPIC docs and robots.txt for every host
  (`docs/sources/evidence/vehicles/`). Every mapped column was checked. The
  results are in SOURCES.md's "Source verification".
- **NHTSA packaging corrected.** There is no `FLAT_RCL.zip`. The history ships
  as `FLAT_RCL_PRE_2010.zip` and `FLAT_RCL_POST_2010.zip`, each holding one
  same-named `.txt`. The member glob `FLAT_RCL*.txt` still selects it. The
  column order matched `RCL.txt` exactly.
- **NHTSA parsing: `quote: ""`.** The file is unquoted, and fields beginning
  with `"` made the RFC 4180 parser throw.
- **Campaign-number pattern widened** to
  `^[0-9]{2}[VEICTX][0-9]{2}[0-9A-Z][0-9]{3}$`: `X` codes before 2010 and
  `21V00H000`-style numbers in 2021.
- `drive`, `trany` and `fuelType1` (EPA) and `DESC_DEFECT`,
  `CONEQUENCE_DEFECT` and `CORRECTIVE_ACTION` (NHTSA) are now `optional`,
  because they are blank on real rows.
- **Fixtures replaced** with REAL SAMPLES: 28 EPA rows, 16 NHTSA rows,
  including real `E`/`T`/`C` rows.
- **Publisher table replaced** with the 7 real makes in the samples.
- **Goldens regenerated** through the real pipeline: 57 entities, 580 facts,
  51 edges. `VEHICLES_UPDATE_GOLDENS=1` regenerates them.
- **ADR-0013 determinations written** (not recorded):
  - NHTSA recalls: § 105, every surface ALLOW.
  - EPA: `PUBLISHED_TERMS_PERMIT`, internal processing only, every customer
    surface UNKNOWN. fueleconomy.gov's copyright statement is non-commercial.

### Fixed
- Canonical store re-parsed JSONB string values, so `"2019030012"` became a
  number and every unchanged re-run re-versioned the fact. The real samples
  caught it; the fix is platform-wide.

### Known (QUALITY.md)
- EPA `baseModel` ↔ NHTSA `MODELTXT` joins about 41% of shared-make keys.
- `range` is the total range for PHEVs.
- NHTSA's two-archive snapshot does not fit one `--artifact`.

## [0.1.0] — 2026-09-26

### Changed (prelaunch, before any activation)
- Both `nhtsa-recalls` streams now declare the generic row filter
  `where: { column: RCLTYPECD, in: [V] }`, closing the non-vehicle-recall
  gap. `RCLTYPECD` codes (`V`/`E`/`T`/`C`) remain UNVERIFIED. The NHTSA fixture
  gains one equipment (`E`) and one tire (`T`) SYNTHETIC row, both excluded;
  goldens are unchanged (30 entities, 262 facts, 29 edges).

### Added
- Vertical scaffold: `make`, `vehicle_model_year`, `vehicle_configuration`,
  `recall_campaign`; predicates `makes`, `configuration_of`, `recall_affects`;
  alias types `make_model_year` (composite), `epa_vehicle_id`,
  `nhtsa_campaign_number`, all on HVAC's case-fold-and-strip-separators chain.
- Source declarations `epa-fueleconomy-vehicles`, `nhtsa-recalls` (mapped) and
  `nhtsa-vpic` (declared only) — all `UNDER_REVIEW`, `UNREVIEWED`,
  unapproved, with no acquisition target.
- SYNTHETIC SHAPE FIXTURES (fictional makes) for the EPA vehicles.csv and the
  NHTSA flat file, and golden records: 30 entities, 262 facts, 29 edges.
- `product.yaml` (prelaunch) with the conversion-first ladder: Evaluate,
  Starter, Developer, Growth, Scale; VIN → recalls headline, stated as
  dependent on vPIC.
- Filters, SEO policy (nothing indexable while DRAFT), the six generic MCP
  tools.

### Unverified
- Every source column name, the NHTSA column order, artifact URLs and zip
  packaging, and the value sets listed in SOURCES.md. Capturing real artifacts
  will change fixtures and goldens; record each correction here.

### Rights
- No determination. Expected ADR-0013 basis `PUBLIC_DOMAIN_US_GOVERNMENT_WORK`
  pending captured terms.
