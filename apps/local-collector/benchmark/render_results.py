"""Render benchmark/RESULTS.md from a report.json written by run_benchmark.py.

    python -m benchmark.render_results <report.json> <model.json> <resources.json> > benchmark/RESULTS.md
"""

from __future__ import annotations

import json
import sys


def row(name: str, m: dict) -> str:
    ci = lambda v: f"[{v[0]:.2f}, {v[1]:.2f}]" if v else "-"  # noqa: E731
    return f"| {name} | {m['tp']} | {m['fp']} | {m['fn']} | {m['precision']} {ci(m['precision_95ci'])} | {m['recall']} {ci(m['recall_95ci'])} | {m['f1']} |"


def main() -> None:
    report = json.load(open(sys.argv[1]))
    model = json.load(open(sys.argv[2]))
    resources = json.load(open(sys.argv[3])) if len(sys.argv) > 3 else {}
    out = [
        "# Benchmark results: `cpsc-product-identifiers@1`",
        "",
        f"Extractor `{report['extractor_version']}`, prompt SHA-256 `{report['prompt_sha256']}`.",
        f"Model `{model['name']}` ({model['family']}, {model['parameter_size']}, {model['quantization']}), Ollama ID `{model['digest'][:12]}`, license: {model['license_head']}.",
        "",
        "Sample: 130 CPSC notices drawn with seed 20260928 from the 6,698 notices the agency parser gives no model",
        "number: 90 with a product label and a digit code, 40 without (mostly negatives). 30 of them were held out and",
        "never looked at while the prompt and acceptance rules were tuned. The gold labels were made blind to model output",
        "([guidelines](ANNOTATION_GUIDELINES.md)); values the annotator marked ambiguous count neither way.",
        "",
        "Systems: `llm_raw` is every schema-valid proposal; `llm_validated` is the proposals that pass the server's",
        "acceptance rules (what gets stored); `baseline` is every token the acceptance rules accept with no model.",
        "",
    ]
    for split in ("dev", "heldout"):
        if split not in report:
            continue
        r = report[split]
        out += [
            f"## {split} ({r['notices']} notices, {r['notices_with_gold']} with gold identifiers, {r['gold_identifiers']} identifiers, {r['negative_notices']} negatives)",
            "",
            "| System | TP | FP | FN | Precision (95% CI) | Recall (95% CI) | F1 |",
            "| --- | --- | --- | --- | --- | --- | --- |",
            row("llm_raw", r["systems"]["llm_raw"]),
            row("llm_validated", r["systems"]["llm_validated"]),
            row("baseline", r["systems"]["baseline"]),
            "",
            f"- Notices with at least one correct accepted identifier: {r['notice_coverage_llm_validated']}.",
            f"- Negative notices with any accepted false positive: {r['negative_notices_with_false_positive']}.",
            f"- Raw proposals not printed anywhere in the notice (hallucinated): {r['unsupported_values_in_raw_output']}.",
            f"- Quarantined notices (invalid output or model error): {r['quarantined_notices']}.",
            f"- Latency per notice sent to the model: {json.dumps(r['latency_s'])} s; median output rate {r['output_tokens_per_s_median']} tokens/s.",
            "",
            "Accepted errors (`false_positive`) and misses:",
            "",
        ]
        out += [f"- `{e['id']}` {e['type']}: `{e['value']}`" for e in r["errors"]] or ["- none"]
        out.append("")
    if resources:
        out += ["## Resources", "", f"```json\n{json.dumps(resources, indent=2)}\n```", ""]
    print("\n".join(out))


if __name__ == "__main__":
    main()
