# Publication bar for `cpsc-product-identifiers@1`

Fixed on 2026-09-28 **before** the held-out split was run, after tuning the prompt and the acceptance rules on the
dev split only. Accepted candidates are served (`EXTRACTED_IDENTIFIERS_OPEN = "1"`) only if the held-out result of
the exact extractor version, model build and acceptance rules meets every line:

| Measure (held-out, LLM proposals after the server's acceptance rules) | Bar |
| --- | --- |
| Identifier-level precision | ≥ 0.95 |
| False positives on negative notices (gold has no identifier) | 0 |
| Accepted values not printed verbatim in the stored record | 0 (enforced by construction) |
| Identifier-level recall | reported, no bar: every accepted identifier is additive to the agency parser |

For comparison, the agency parser's own model-number precision was measured at 26/30 notices (0.87) in
`docs/sources/pipeline/prototypes/cpsc-recalls/README.md`.

If the held-out result misses the bar, the intake may still accept and store candidates (they are evidence for the
next version), but they are not served, and a new extractor version must pass a fresh held-out sample.

Scale caveat: a held-out split of 30 notices is an acceptance screen, not a guarantee. The report gives Wilson 95%
intervals, and a larger audit is due before the published share of extracted identifiers grows materially.
