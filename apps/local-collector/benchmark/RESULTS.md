# Benchmark results: `cpsc-product-identifiers@1`

Extractor `cpsc-product-identifiers@1/prompt-3`, prompt SHA-256 `e4a912fb71b2f0edbcb5929cd483cad57b7a8e9ebc419ea3fef3f3e19ee69d53`.
Model `qwen3.5:4b` (qwen35, 4.7B, Q4_K_M), Ollama ID `2a654d98e6fb`, license: Apache License.

Data: [`data/`](data/) holds the sample, gold labels, per-notice predictions with raw model output, the report and the model identity, so every number here can be re-scored (`--score-only`).

Sample: 130 CPSC notices drawn with seed 20260928 from the 6,698 notices the agency parser gives no model
number: 90 with a product label and a digit code, 40 without (mostly negatives). 30 of them were held out and
never looked at while the prompt and acceptance rules were tuned. The gold labels were made blind to model output
([guidelines](ANNOTATION_GUIDELINES.md)); values the annotator marked ambiguous count neither way.

Systems: `llm_raw` is every schema-valid proposal; `llm_validated` is the proposals that pass the server's
acceptance rules (what gets stored); `baseline` is every token the acceptance rules accept with no model.

## Verdict against [the pre-registered bar](QUALITY_BAR.md)

The held-out result for `llm_validated` meets every line of the bar:

- precision 38/38 = **1.00** (95% CI 0.91–1.00), against a bar of ≥ 0.95;
- **0/18** negative notices with a false positive;
- **0** unsupported values accepted;
- recall 0.84.

On evidence, `EXTRACTED_IDENTIFIERS_OPEN` may be set to `"1"` for this exact extractor version and model build once
the intake is deployed.

Caveats a reviewer should weigh:

- **Small sample.** The held-out split is 30 notices (45 identifiers in 12 notices). This is an acceptance screen,
  not a guarantee. A larger audit is due before the published share grows materially (for example, after the first
  1,000 accepted identifiers).
- **The baseline is uneven.** On held-out, the rules-only baseline also scored well (precision 0.98), but on dev it
  fell to 0.58 with 72 false positives. The model's proposals are what keep precision stable across notice
  layouts: the rules alone accept serials, lots and UPC cells in flattened tables.
- **What was tuned on dev.** The prompt was fixed before any run. Three acceptance-rule changes were made after
  reading dev errors, and are recorded in the shared test vectors:
  1. field resolution;
  2. the table rule, calendar-aware dates and `;` inside sentences;
  3. "model year" as a non-product label.

  Dev scores are therefore optimistic. The held-out split was run once, after these changes.
- **Output cap.** Dev notices 1–76 ran before `num_predict: 1500` was added, and 77–100 plus all of held-out ran
  with it. No output reached the cap.
- **One transient model error.** One HTTP 500 from the local model server (dev notice 77) succeeded on retry. The
  collector now charges such failures to the notice and dead-letters it after three attempts.
- **Measured on a cloud container,** not the owner's computer (see Resources). The dashboard reports per-notice
  latency on the real machine.

## dev (100 notices, 36 with gold identifiers, 149 identifiers, 64 negatives)

| System | TP | FP | FN | Precision (95% CI) | Recall (95% CI) | F1 |
| --- | --- | --- | --- | --- | --- | --- |
| llm_raw | 120 | 37 | 29 | 0.764 [0.69, 0.82] | 0.805 [0.73, 0.86] | 0.784 |
| llm_validated | 94 | 4 | 55 | 0.959 [0.90, 0.98] | 0.631 [0.55, 0.70] | 0.761 |
| baseline | 98 | 72 | 51 | 0.576 [0.50, 0.65] | 0.658 [0.58, 0.73] | 0.614 |

- Notices with at least one correct accepted identifier: 28/36.
- Negative notices with any accepted false positive: 0/64.
- Raw proposals not printed anywhere in the notice (hallucinated): 0.
- Quarantined notices (invalid output or model error): 0.
- Latency per notice sent to the model: {"p50": 12.4, "p95": 47.5, "mean": 19.0} s; median output rate 6.8 tokens/s.

Accepted errors (`false_positive`) and misses:

- `cpsc-14202` missed: `Contessa Speedster 25`
- `cpsc-14202` missed: `Contessa Speedster 35`
- `cpsc-14202` missed: `Speedster 30`
- `cpsc-14202` missed: `Speedster 40`
- `cpsc-09002` false_positive: `11-44`
- `cpsc-09002` false_positive: `15-60`
- `cpsc-09002` false_positive: `8-32`
- `cpsc-09002` false_positive: `WB2`
- `cpsc-09002` missed: `WB2 11-44`
- `cpsc-09002` missed: `WB2 15-60`
- `cpsc-09002` missed: `WB2 6-24`
- `cpsc-09002` missed: `WB2 6-24C`
- `cpsc-09002` missed: `WB2 8-32`
- `cpsc-78086` missed: `51GA0661`
- `cpsc-78086` missed: `51GB0661`
- `cpsc-23020` missed: `AAP206`
- `cpsc-17714` missed: `Can-Am Maverick X3 STD`
- `cpsc-17714` missed: `Can-Am Maverick X3 XDS`
- `cpsc-17714` missed: `Can-Am Maverick X3 XRS`
- `cpsc-23790` missed: `XPLORER XR 500`
- `cpsc-23790` missed: `XPLORER XR 500 LE`
- `cpsc-23790` missed: `XPLORER XR 570`
- `cpsc-23790` missed: `XPLORER XR 570 LE`
- `cpsc-23790` missed: `XPLORER XRT 500`
- `cpsc-23790` missed: `XPLORER XRT 570`
- `cpsc-23790` missed: `XPLORER XRT 570 LE`
- `cpsc-11022` missed: `PDW9200J`
- `cpsc-11022` missed: `PDW9280J`
- `cpsc-11022` missed: `PDW9700J`
- `cpsc-11022` missed: `PDW9800J`
- `cpsc-11022` missed: `PDW9880J`
- `cpsc-11022` missed: `ZBD0700K00`
- `cpsc-11022` missed: `ZBD0700K01`
- `cpsc-11022` missed: `ZBD0700K03`
- `cpsc-11022` missed: `ZBD0700K10`
- `cpsc-11022` missed: `ZBD0710K00`
- `cpsc-11022` missed: `ZBD0710K01`
- `cpsc-11022` missed: `ZBD0710K03`
- `cpsc-11022` missed: `ZBD0710K10`
- `cpsc-11022` missed: `ZBD6800K00`
- `cpsc-11022` missed: `ZBD6800K01`
- `cpsc-11022` missed: `ZBD6800K03`
- `cpsc-11022` missed: `ZBD6800K10`
- `cpsc-11022` missed: `ZBD6880K00`
- `cpsc-11022` missed: `ZBD6880K01`
- `cpsc-11022` missed: `ZBD6880K03`
- `cpsc-11022` missed: `ZBD6880K10`
- `cpsc-11022` missed: `ZBD6890K00`
- `cpsc-11022` missed: `ZBD6890K01`
- `cpsc-11022` missed: `ZBD6890K03`
- `cpsc-11022` missed: `ZBD6890K10`
- `cpsc-04162` missed: `AV5105`
- `cpsc-04162` missed: `AV5150`
- `cpsc-04162` missed: `LK240`
- `cpsc-23258` missed: `2208123`
- `cpsc-23258` missed: `2521943`
- `cpsc-23258` missed: `2522060`
- `cpsc-23258` missed: `2522267`
- `cpsc-23258` missed: `7396260`

## heldout (30 notices, 12 with gold identifiers, 45 identifiers, 18 negatives)

| System | TP | FP | FN | Precision (95% CI) | Recall (95% CI) | F1 |
| --- | --- | --- | --- | --- | --- | --- |
| llm_raw | 40 | 23 | 5 | 0.635 [0.51, 0.74] | 0.889 [0.77, 0.95] | 0.741 |
| llm_validated | 38 | 0 | 7 | 1.0 [0.91, 1.00] | 0.844 [0.71, 0.92] | 0.916 |
| baseline | 42 | 1 | 3 | 0.977 [0.88, 1.00] | 0.933 [0.82, 0.98] | 0.955 |

- Notices with at least one correct accepted identifier: 12/12.
- Negative notices with any accepted false positive: 0/18.
- Raw proposals not printed anywhere in the notice (hallucinated): 0.
- Quarantined notices (invalid output or model error): 0.
- Latency per notice sent to the model: {"p50": 12.3, "p95": 49.6, "mean": 23.8} s; median output rate 6.6 tokens/s.

Accepted errors (`false_positive`) and misses:

- `cpsc-21026` missed: `001969-501`
- `cpsc-21026` missed: `001969-605`
- `cpsc-21026` missed: `001969-905`
- `cpsc-21026` missed: `001970-501`
- `cpsc-21026` missed: `001970-605`
- `cpsc-06072` missed: `891`
- `cpsc-19108` missed: `89304`

## Resources

```json
{
  "machine": "cloud container used for this benchmark: 4 vCPU (x86_64), 15.7 GB RAM, no GPU; not the owner's Windows computer",
  "ollama": "0.34.4, OLLAMA_NO_CLOUD=1, OLLAMA_HOST=127.0.0.1:11434, CPU only",
  "model_file_gb": 3.39,
  "ollama_reported_model_size_mb": 3743,
  "llama_server_rss_mb_after_130_notices": 8479,
  "note": "Runtime memory is more than twice the file size: llama-server keeps a prompt cache (about 170-270 MB per cached prompt). Plan for 16 GB of RAM; the model unloads after 15 idle minutes (keep_alive).",
  "num_ctx": 8192,
  "llm_concurrency": 1
}
```

