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

## Changing the extractor or the rules

The publishable build (`PUBLISHABLE_EXTRACTORS` in `apps/recalls-worker/src/intake.ts`) pins the extractor version,
model, full model digest, prompt hash and the extraction-behaviour fingerprint (`pnpm collector:behaviour`). The
fingerprint covers the acceptance rules, the extractor's schema, truncation and options, and the generation defaults.
Any change to them fails CI until this bar is met again for the changed behaviour:

- a rules-only change: re-score the stored predictions (`python benchmark/run_benchmark.py … --score-only`);
  the report records the fingerprint it was scored under, and CI requires the entry to name that value and the
  committed held-out result to meet this bar;
- stored predictions carry the build that made them (`predictions-build.json`: model and digest, Ollama runtime,
  generation settings and the request fingerprint). The runner refuses to resume another build's predictions
  (`--fresh` discards them), and CI requires the scored build to match the entry and the extractor's current request,
  so a prompt, schema, truncation or option change needs a full run, never a re-score. The runner re-proves the model
  digest and Ollama runtime around every notice and stops if either changes, and scoring refuses predictions that do
  not exactly cover each split (CI requires the full held-out split);
- a prompt, schema, truncation or option change: a full run on the dev and held-out splits.

Then update `EXTRACTION_BEHAVIOUR_SHA256` and the entry (with its benchmark note) in the same reviewed change. Rows
accepted under an earlier fingerprint stay stored as evidence and are no longer served.
