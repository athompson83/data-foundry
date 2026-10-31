# Rights record — NOAA tropical cyclone data (NHC Tropical Cyclone Reports and NCEI IBTrACS)

**Decision:** GREEN for acquisition, storage, normalization, derivation and redistribution of the NHC Tropical Cyclone Report text and the IBTrACS best-track records on every surface, subject to the conditions below. Determined on 2026-10-31 under [ADR-0013](../decisions/ADR-0013-evidence-based-rights-determination.md) and [ADR-0018](../decisions/ADR-0018-free-public-data-presumed-usable.md). The bases are the NOAA statement that information on its servers is in the public domain, US government authorship, and free open access with no login, paywall or CAPTCHA.

## Source

| | |
| --- | --- |
| Publishers | NOAA National Hurricane Center (reports); NOAA National Centers for Environmental Information (IBTrACS) |
| Endpoints | `https://www.nhc.noaa.gov/data/tcr/` (PDF reports, file name starts with the ATCF storm id); `https://www.ncei.noaa.gov/data/international-best-track-archive-for-climate-stewardship-ibtracs/v04r01/access/csv/` |
| Reachability, 2026-10-31 | NHC report PDFs answered for all 24 sampled files; IBTrACS since-1980 CSV 145,263,024 bytes, last-3-years CSV 11,743,983 bytes, ALL CSV 333,165,979 bytes (above the 315 MiB single-object limit of `wrangler r2 object put`, so the since-1980 file is archived) |
| Terms retrieved | <https://www.nhc.noaa.gov/disclaimer.shtml> (quoted in `candidates.yaml`); NCEI IBTrACS metadata record <https://www.ncei.noaa.gov/access/metadata/landing-page/bin/iso?id=gov.noaa.ncdc:C01552> on 2026-10-31 |

## Evidence, verbatim

From the NHC disclaimer: "The information on government servers are in the public domain, unless specifically annotated otherwise, and may be used freely by the public."

From the NCEI IBTrACS metadata record (Use Constraints): "Cite as: Gahtan, Jennifer; Knapp, Kenneth R.; Schreck, Carl J. III; Diamond, Howard J.; Kossin, James P.; Kruk, Michael C. (2024). International Best Track Archive for Climate Stewardship (IBTrACS) Project, Version 4.01. [indicate subset used]. NOAA National Centers for Environmental Information. https://doi.org/10.25921/82ty-9e16 [access date]." The record states no restriction on commercial use or redistribution; it disclaims warranty and liability only.

## Reasoning

1. **Copyright.** The reports are written by NHC staff and the best-track file is a NOAA product; both are US government works. IBTrACS merges best tracks from other agencies (for example JMA, CMA, IMD); those fields carry their own agency source and are served per source, never as an NOAA-authored value.
2. **Commercial use.** Neither record limits commercial use or redistribution.
3. **Personal data.** Reports name no private individuals as subjects; casualty counts are aggregate. Names of officials or forecasters in the PDFs are not extracted.
4. **Third-party material.** Report figures and photographs may carry third-party credit lines. Only text-derived facts are served; images and charts are not cached or republished (rule 9).

## Exact fields redistributed

| Source | Fields |
| --- | --- |
| NHC Tropical Cyclone Report | ATCF id, storm name, season, basin, report URL, deaths (direct and indirect, with the source sentence), damage in US dollars (with the source sentence), landfall places and dates, peak wind, minimum pressure |
| IBTrACS | `SID`, `NAME`, `SEASON`, `BASIN`, `ISO_TIME`, position, wind, pressure, `USA_ATCF_ID`, per-agency values with their agency code |

## Rights cells

| Operation | Channel | State |
| --- | --- | --- |
| ACQUIRE, STORE, CACHE, NORMALIZE, DERIVE | — | ALLOW |
| Public web, search index, free and paid API, RapidAPI, MCP, bulk export | all | ALLOW for the fields above. Each channel is still enabled by its own product decision. |

## Conditions

- Cite IBTrACS as the NCEI record asks (DOI 10.25921/82ty-9e16, version, access date) and say "Source: NOAA NHC and NCEI. Structured by Data Foundry. Not endorsed by NOAA."
- Serve extracted counts only with their source sentence; a count the parser cannot read unambiguously (a footnote digit beside the number) is withheld, not guessed. The 2026-10-31 sample read 4 of 8 verifiable death counts correctly with the naive pattern, so the parser must be footnote-aware before PROTOTYPED.
- No NOAA or NHC logos. No report images.

**Re-review by:** 2027-10-31, or at once if the NOAA or NCEI terms change.
