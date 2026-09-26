# Source evidence: US federal vehicle data (captured 2026-09-26)

These are the bytes retrieved on 2026-09-26 for the `vehicles` vertical's
source review and its ADR-0013 determinations
([`../../vehicles-federal-rights-determination-20260926.md`](../../vehicles-federal-rights-determination-20260926.md)).

**How the capture was made.**

- One request per URL, with the user agent `DataFoundryBot/1.0 (+https://data.aroqon.com)`.
- robots.txt was requested from each host first.
- `www.nhtsa.gov` answers HTTP 403 to the build environment. It was not retried
  or worked around.

**Byte-for-byte.** `.gitattributes` marks this directory `-text`, so every file
below hashes to the SHA-256 recorded here and in the determinations.
`tooling/test/vehicles-determinations.test.ts` fails if a cited file changes.

**Bulk archives are not committed.** Each `*.zip.manifest.json` records:

- the URL and retrieval time;
- the HTTP status, `Content-Type`, `Last-Modified` and ETag;
- the archive's size and SHA-256;
- every member: name, sizes, CRC-32, compression ratio and SHA-256;
- the encoding, line ending, delimiter and quoting;
- the header, or the absence of one;
- the first rows;
- the row counts.

The archives were kept outside the repository in `/var/tmp/df-vehicles-sources/`
on the capturing machine.

| File | URL | Retrieved (UTC) | Bytes | SHA-256 | Note |
|---|---|---|---|---|---|
| `robots.json` | four hosts (see file) | 2026-09-26T21:19:30Z | 2414 | `94bb36583e6b5108be66c35f9321690ceb7bb2365ed0d909732f389b1adcca38` | vpic.nhtsa.dot.gov 404 (none); api.nhtsa.gov 403 gateway (none published); static.nhtsa.gov 404 NoSuchKey (none); www.fueleconomy.gov: empty reply on three attempts (not retrievable) |
| `fueleconomy-ws-index.html` | https://www.fueleconomy.gov/feg/ws/index.shtml | 2026-09-26T21:19:59Z | 55476 | `a4d82d1d266b1070f396322ac2b387270e95a9e63b60704a4b1641bd430577a0` | Web services and the `vehicles.csv` data description (column dictionary) |
| `fueleconomy-download.html` | https://www.fueleconomy.gov/feg/download.shtml | 2026-09-26T21:20:00Z | 70070 | `1d196c4e780b6f426b9be25d90576c550bd4d345b3deed0275c70464801996bc` | Links `/feg/epadata/vehicles.csv.zip`; "Fuel economy data are the result of vehicle testing done at [EPA] ... and by vehicle manufacturers with oversight by EPA" |
| `fueleconomy-ORNL-disclaimer.html` | https://www.fueleconomy.gov/feg/ORNL-disclaimer.htm | 2026-09-26T21:20:35Z | 8725 | `5ccccc187a4a6478a4d957ddf9258e1046999200ed7270e16680a43d61210460` | The footer "Privacy/Security" page. **Copyright Status: non-commercial, scientific and educational use** (the controlling EPA-side terms) |
| `nhtsa-rcl-directory-listing.xml` | https://static.nhtsa.gov/?prefix=odi/ffdd/rcl/ | 2026-09-26T21:21:18Z | 6960 | `f3a4397c67c627aa71af20e102a612ae8f8ed52366e52a8a38cbe722612869df` | S3 listing of `odi/ffdd/rcl/`: current file names, sizes, times |
| `nhtsa-RCL.txt` | https://static.nhtsa.gov/odi/ffdd/rcl/RCL.txt | 2026-09-26T21:21:19Z | 3053 | `3438cc7e4131efa401dfe6437dbe035607e092c129155dfb411d459d58802203` | Official field description of the recall flat file: 29 fields, TAB-delimited, `YYYYMMDD` dates, "Last Updated May 2025" |
| `nhtsa-RCL_Annual_Rpts.txt` | https://static.nhtsa.gov/odi/ffdd/rcl/RCL_Annual_Rpts.txt | 2026-09-26T21:21:29Z | 1635 | `ff45c24d4474d5b2d9bc6b93f96fef1b0d227d5b2ca71f79c7980956fea4219a` | Annual-report file description (not mapped) |
| `nhtsa-RCL_Qtrly_Rpts.txt` | https://static.nhtsa.gov/odi/ffdd/rcl/RCL_Qtrly_Rpts.txt | 2026-09-26T21:21:30Z | 1244 | `b76ab35073e3585a56912f058aa0a53dc865de68c8ea12b687faa32f3952c8bf` | Quarterly-report file description (not mapped) |
| `vpic-api-index.html` | https://vpic.nhtsa.dot.gov/api/ | 2026-09-26T21:25:09Z | 104408 | `8a3dd332ecffbab46968c9c6f04bfc64c94ec463fa02f305ca06284ab24b717c` | vPIC API documentation ("automated traffic rate control") |
| `vpic-api-faq.html` | https://vpic.nhtsa.dot.gov/api/home/index/faq | 2026-09-26T21:25:36Z | 46575 | `31862b354baa88d1068c3ea5e22f83d8e9892db2fe0d34ca3b5d329f14e2a975` | "No [licensing requirement], NHTSA is a government agency and the services provided on the API are free for use by the public ... Open Data initiatives" |
| `vpic-downloads.html` | https://vpic.nhtsa.dot.gov/downloads/ | 2026-09-26T21:25:38Z | 51762 | `b511a261f89b82074a56ff363b42913fe94c79a8a6a3dda9f6654532ca8674bb` | Standalone vPIC databases (MS SQL; PostgreSQL 17 custom 67.8 MB / plain 72.6 MB), VIN decoding only |
| `vpic-DecodeVinValues-1HGCM82633A004352.json` | https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/1HGCM82633A004352?format=json | 2026-09-26T21:25:10Z | 3921 | `5bbe2f293edb394f21e10fe8220fb11b30dc7e1614b0a8c2d216c9a27993e6ef` | Decodes to HONDA / Accord / 2003 / EX-V6, ErrorCode 0 |
| `vpic-GetMakesForVehicleType-car.json` | https://vpic.nhtsa.dot.gov/api/vehicles/GetMakesForVehicleType/car?format=json | 2026-09-26T21:25:12Z | 18152 | `9ede9a748f7f583ba2f9c9c598f10bceddfa96f0fb409e6068ee394e1a689380` | 195 passenger-car makes |
| `vpic-GetModelsForMakeYear-mercedes-benz-2020.json` | https://vpic.nhtsa.dot.gov/api/vehicles/GetModelsForMakeYear/make/mercedes-benz/modelyear/2020?format=json | 2026-09-26T21:25:14Z | 2475 | `a6016d90ae43f94c4fc38a2f912f5e6e4e15cbb648b51520dd7878ce77b27d70` | vPIC model names are class names (`C-Class`), like EPA `baseModel`, not recall `MODELTXT` (`C 300`) |
| `api-nhtsa-recallsByVehicle-honda-accord-2018.json` | https://api.nhtsa.gov/recalls/recallsByVehicle?make=honda&model=accord&modelYear=2018 | 2026-09-26T21:25:13Z | 8033 | `367260043e263abbc8183c9a190833f1ba004e001d87ebe1653b52cacb5bad8d` | Six campaigns, exactly the flat file's HONDA/ACCORD/2018 vehicle campaigns; dates `DD/MM/YYYY` |
| `vehicles.csv.zip.manifest.json` | https://www.fueleconomy.gov/feg/epadata/vehicles.csv.zip | 2026-09-26T21:21:32Z | 2211728 (archive) | `fd9132961f2aff95464b9671aec025ecd886092521aa8855e79f77717a45ec0f` (archive) | Manifest only. Member `vehicles.csv`: 21,803,514 B, SHA-256 `1ffc03be…5917`, 84 columns, 50,409 rows |
| `FLAT_RCL_PRE_2010.zip.manifest.json` | https://static.nhtsa.gov/odi/ffdd/rcl/FLAT_RCL_PRE_2010.zip | 2026-09-26T21:21:25Z | 7435840 (archive) | `d771bf14248ee62f75050f3c61f62d4afc3a5d9a4a7f539bb32d07d9f48bfe46` (archive) | Manifest only. Member `FLAT_RCL_PRE_2010.txt`: 83,786,437 B, SHA-256 `76081646…1b37`, 81,710 rows plus 5 blank lines |
| `FLAT_RCL_POST_2010.zip.manifest.json` | https://static.nhtsa.gov/odi/ffdd/rcl/FLAT_RCL_POST_2010.zip | 2026-09-26T21:21:27Z | 15039755 (archive) | `306e4fb488c45e184d0dc79a786c9e8062029d634e3590ced869fd26ba2cac95` (archive) | Manifest only. Member `FLAT_RCL_POST_2010.txt`: 311,128,234 B, SHA-256 `171b301e…0bbf`, 245,535 rows |
| (not committed) | https://static.nhtsa.gov/odi/ffdd/rcl/Import_Instructions_Recalls.pdf | 2026-09-26T21:21:31Z | 1030032 | `ff5c5297bfc5b9930de71f2d8a9f98f596f2aeb301b6eafe8cf3949907ede46b` | NHTSA import instructions PDF |

Not retrieved: `https://www.nhtsa.gov/about-nhtsa/web-policies-notices`
(HTTP 403 from the build environment). The fueleconomy.gov paths
`/feg/privacy.shtml`, `/feg/disclaimer.shtml` and `/feg/contact.shtml` return
404. The live pages are `/feg/ORNL-disclaimer.htm` and `/feg/contacts.shtml`.

Reproduce (the host is polite to one request per URL):

```bash
UA='DataFoundryBot/1.0 (+https://data.aroqon.com)'
curl -sS -A "$UA" -O https://static.nhtsa.gov/odi/ffdd/rcl/RCL.txt
curl -sS -A "$UA" -O https://static.nhtsa.gov/odi/ffdd/rcl/FLAT_RCL_POST_2010.zip
curl -sS -A "$UA" -O https://www.fueleconomy.gov/feg/epadata/vehicles.csv.zip
sha256sum FLAT_RCL_POST_2010.zip vehicles.csv.zip
```

Both publishers regenerate their files (NHTSA daily, EPA with each data
release), so a later download will hash differently. The manifests record
what these determinations saw.
