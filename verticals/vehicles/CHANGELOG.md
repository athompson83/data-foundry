# Changelog — `vehicles`

All notable changes to this vertical's **schema and data**. Versions are the
`schema_version` in `vertical.yaml`.

## [Unreleased]

### Added
- `parsing.archive` for both mapped sources. `vehicles.csv` and `FLAT_RCL*.txt`
  are read from their ZIP archives with limits that fail closed. The ZIP is
  the recorded evidence artifact, and fact locators now cite
  `member=<name>;row=…;column=…` when the artifact is an archive.
  `accept_unarchived` keeps the plain-CSV synthetic fixtures (and an
  operator-extracted CSV) working. Goldens are unchanged.
- An operator bulk-load path, `pnpm ingest --artifact <source-key>=<zip>`
  (`docs/owner-actions/vehicles-initial-load.md`), proven end to end on the
  shape fixtures packaged as ZIPs (`tests/zip-ingest.test.ts`).

### Unverified
- Member names, archive sizes and compression ratios of the real files.

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
