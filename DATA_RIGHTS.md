# Data Rights and Licensing

The repository's `LICENSE` applies to the **software code** in this repository unless a file states otherwise.

It does **not** automatically grant rights to third-party source data, source artifacts, images, documents, normalized records, compiled datasets, exports or other content processed by Data Foundry.

## Core rule

**Publicly accessible does not mean freely reusable, commercially redistributable or sublicensable.**

Every real source must be reviewed for the specific use Data Foundry intends to make of it before material derived from that source reaches a public or commercial surface.

The platform models this explicitly through source-level rights metadata and publication gates.

## Categories of material

### 1. Platform software

Source code authored for Data Foundry is governed by the repository software license unless otherwise noted.

### 2. Synthetic fixtures

Synthetic fixtures created specifically for repository tests may be used under the repository software/project terms unless their local documentation says otherwise. Synthetic fixtures are not evidence that a real publisher permits the same acquisition or redistribution behavior.

### 3. Third-party source artifacts

Examples include:

- HTML pages;
- PDFs and manuals;
- CSV/JSON exports;
- images and diagrams;
- API responses;
- downloaded files;
- archived source documents.

Rights remain subject to the source's applicable copyright, database rights, license, contract, terms of service, attribution requirements and other restrictions.

### 4. Normalized/canonical data

Normalization does not automatically remove source restrictions. A canonical fact may still depend on a source whose terms restrict commercial use, derivative works or redistribution.

The publication decision must therefore consider the rights policy attached to the supporting source, not merely the format of the normalized output.

### 5. Images and media

Images are governed separately from factual data. A source may permit factual reuse while prohibiting image copying or caching.

Data Foundry must not cache, republish or commercially distribute third-party images unless the source's image policy permits the intended use and any attribution conditions are satisfiable.

### 6. Bulk datasets and exports

Future CSV, JSONL, Parquet or other dataset exports may have licensing terms separate from the platform source code. Those terms must be stated with the dataset or product when such exports are published.

Do not infer that an exported dataset is MIT-licensed merely because the software used to build it is.

## Source review expectations

A publishable source should have explicit metadata covering at least:

- rights classification;
- human reviewer and review date;
- commercial-use permission;
- redistribution permission;
- derivative/normalization permission;
- attribution requirements;
- acquisition method approval;
- image reuse/caching policy;
- provenance-retention requirements;
- source status and kill-switch state.

The source registry and publication gate are designed to fail closed when required rights information is missing or incompatible with the intended public/commercial use.

## Provenance and attribution

Published facts should retain enough provenance to identify the source evidence and satisfy required attribution without falsely implying that a source publisher endorses Data Foundry.

Where a source permits citation but not republication of the underlying artifact, public interfaces should expose only the permitted factual/citation surface rather than copying restricted source content.

## Changes in source terms

Source rights are not assumed to be permanent.

If terms, licenses, robots policies, API agreements or other relevant conditions change, the source must be re-reviewed. The platform's kill-switch and publication controls should be used when continued publication is no longer clearly permitted.

## No legal conclusion from repository status

The existence of a source adapter, fixture, schema, test or source declaration in the repository does not by itself mean that a real-world publisher has approved commercial use.

Current HVAC fixtures are synthetic. Real-source commercial validation is a separate milestone.

## Contribution guidance

Do not contribute copyrighted datasets, proprietary documents, credentials, scraped personal data, restricted images or third-party source artifacts unless you have confirmed that their inclusion and redistribution through this public repository are permitted.

When adding a real source integration, include the source's public-safe rights and attribution documentation required by the vertical/source registry. Keep confidential contracts, legal advice and internal risk analysis out of the public repository.

## Legal review

This document describes the project's engineering and publication policy. It is not legal advice and does not replace source-specific legal review where the intended acquisition or commercial use is uncertain.
