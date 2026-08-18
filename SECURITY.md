# Security Policy

Data Foundry is an early-stage public data-infrastructure project. Security reports are welcome, especially when they involve trust boundaries, publication controls, source rights, provenance, canonical-data integrity, package boundaries or future customer-facing interfaces.

## Reporting a vulnerability

**Do not open a public GitHub issue containing exploit details, credentials, sensitive paths, proof-of-concept payloads or an unpublished vulnerability.**

Preferred reporting path:

1. Use GitHub's **Security → Report a vulnerability** flow for this repository when private vulnerability reporting is available.
2. If private vulnerability reporting is not available, contact the repository owner through the GitHub profile and request a private reporting channel. Do not include sensitive technical details in a public issue or discussion.

A useful report includes:

- the affected commit or version;
- the entry point and required preconditions;
- the security boundary or invariant that is bypassed;
- the affected read/write/publish operation;
- realistic impact;
- a minimal reproduction when safe to provide;
- any suggested remediation or counterevidence.

## Scope

Security-relevant areas include, but are not limited to:

- unauthorized access to canonical or source data;
- bypass of source-rights or publication gates;
- creation/publication of facts or relationships without required evidence;
- provenance or audit-history tampering;
- unsafe entity merges or redirects that cross authorization boundaries;
- raw SQL/storage/driver capabilities escaping trusted infrastructure boundaries;
- path traversal, SSRF, unsafe crawling or acquisition-provider abuse;
- injection vulnerabilities in extraction, query, API or MCP surfaces;
- accidental publication of restricted source artifacts or images;
- secret or credential exposure;
- future tenant/API-key isolation failures;
- vulnerabilities in deployment, MCP, REST or web interfaces once those surfaces exist.

## Current project stage

The repository currently focuses on the data factory and canonical trust architecture. It does not yet ship a production customer web application, public REST API, billing system or deployed MCP server.

Reports should distinguish between:

- a remotely/user-reachable vulnerability in a deployed surface;
- a public package capability that could let future application code bypass required controls;
- an internal architecture weakness with no current untrusted entry point.

All three may matter, but the distinction helps severity calibration.

## Disclosure expectations

Please allow reasonable time for validation and remediation before public disclosure. We will aim to preserve evidence, reproduce the issue against the real code path and fix the underlying boundary rather than only the demonstrated symptom.

Do not test against third-party systems, source websites or data providers in a way that violates their terms, creates load, bypasses access controls or accesses data you are not authorized to use.

## Supported versions

Until tagged releases exist, security fixes target the current `main` branch. Historical commits may contain defects that have since been corrected and are not independently supported.
