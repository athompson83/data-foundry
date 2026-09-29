"""Benchmark local extraction against a blind gold set.

    python -m benchmark.run_benchmark --sample bench_sample.json --gold gold.json --out results/ [--split dev|heldout|all]

Resumable: per-notice results are appended to ``<out>/predictions-<split>.jsonl``
and notices already present are skipped. ``--score-only`` recomputes the report.

Three systems are scored on the same notices:

- ``llm_raw``: every identifier the model proposed (schema-valid JSON only);
- ``llm_validated``: the proposals that pass the deterministic acceptance rules
  (what the collector would submit);
- ``baseline``: every token the acceptance rules alone accept, with no model.

Values the annotator marked ambiguous count neither as hits nor as errors.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import statistics
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from df_collector import extract as ex, validate  # noqa: E402
from df_collector.ollama import LocalModelError, OllamaClient  # noqa: E402


def record_of(item: dict) -> dict:
    return item["fields"]


def peak_rss_mb(pid: int) -> float | None:
    try:
        for line in Path(f"/proc/{pid}/status").read_text().splitlines():
            if line.startswith("VmHWM:"):
                return int(line.split()[1]) / 1024
    except OSError:
        return None
    return None


def ollama_pids() -> list[int]:
    pids = []
    for entry in Path("/proc").iterdir() if Path("/proc").exists() else []:
        if entry.name.isdigit():
            try:
                if "ollama" in (entry / "comm").read_text():
                    pids.append(int(entry.name))
            except OSError:
                continue
    return pids


BUILD_FILE = "predictions-build.json"


def sample_sha256(sample: list[dict]) -> str:
    """A digest of the benchmark inputs (every notice's id, split and source fields), so stored predictions are never
    resumed or scored against notice text the model did not see."""
    canonical = sorted(({"id": item["id"], "split": item["split"], "fields": item["fields"]} for item in sample), key=lambda item: item["id"])
    return hashlib.sha256(json.dumps(canonical, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode()).hexdigest()


def prediction_build(identity, args: argparse.Namespace, think: bool | str, sample: list[dict]) -> dict:
    """Everything that decides what the model returns: the inputs, extractor version, model build, runtime and request."""
    return {
        "sample_sha256": sample_sha256(sample),
        "extractor_version": ex.EXTRACTOR_VERSION,
        "model": identity.name,
        "model_digest": identity.digest,
        "runtime": identity.runtime,
        "generation": ex.generation(args.num_ctx, think, args.num_thread),
        "request_sha256": ex.request_sha256(identity.name, args.num_ctx, think, args.num_thread),
    }


def check_identity(client: OllamaClient, expected, notice_id: str) -> None:
    now = client.verify()
    if (now.digest, now.runtime) != (expected.digest, expected.runtime):
        raise SystemExit(
            f"the model build changed at {notice_id} ({expected.digest[:12]} {expected.runtime} -> {now.digest[:12]} {now.runtime});"
            " the prediction was not stored. Re-run with --fresh on a stable build."
        )


def coverage(sample: dict, rows: list[dict]) -> dict[str, str]:
    """Refuse to score predictions that do not exactly cover each split they touch: no duplicate, unknown or
    mis-split notice, and no missing one. A partial held-out file cannot produce an authorizing report."""
    seen: dict[str, int] = {}
    for row in rows:
        seen[row["id"]] = seen.get(row["id"], 0) + 1
        if row["id"] not in sample or sample[row["id"]]["split"] != row.get("split"):
            raise SystemExit(f"prediction for {row['id']} is not a notice of split {row.get('split')!r} in the sample")
    duplicates = sorted(i for i, n in seen.items() if n > 1)
    if duplicates:
        raise SystemExit(f"duplicate predictions: {duplicates[:5]}")
    result: dict[str, str] = {}
    for split in sorted({row["split"] for row in rows}):
        expected = {i for i, item in sample.items() if item["split"] == split}
        missing = sorted(expected - set(seen))
        if missing:
            raise SystemExit(f"split {split} is incomplete: {len(missing)} of {len(expected)} notices have no prediction (e.g. {missing[:3]})")
        result[split] = f"{len(expected)}/{len(expected)}"
    return result


def run(args: argparse.Namespace) -> None:
    sample = json.loads(Path(args.sample).read_text())
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    think: bool | str = False if args.think in ("false", "") else args.think
    client = OllamaClient(args.ollama, args.model, args.digest, num_ctx=args.num_ctx, num_thread=args.num_thread, think=think)
    identity = client.verify()
    build = prediction_build(identity, args, think, sample)
    existing = sorted(out.glob("predictions-*.jsonl"))
    build_path = out / BUILD_FILE
    recorded = json.loads(build_path.read_text()) if build_path.exists() else None
    if args.fresh:
        for path in existing:
            path.unlink()
    elif existing and recorded != build:
        # Stored predictions are resumed only for the build that made them: another build's output is never mixed in.
        raise SystemExit(f"{out} holds predictions from another build ({recorded}); run with --fresh to discard them")
    build_path.write_text(json.dumps(build, indent=2) + "\n")
    (out / "model.json").write_text(json.dumps(identity.__dict__, indent=2))
    preds_path = out / f"predictions-{args.split}.jsonl"
    done = set()
    if preds_path.exists():
        done = {json.loads(line)["id"] for line in preds_path.read_text().splitlines() if line.strip()}
    items = [i for i in sample if args.split == "all" or i["split"] == args.split]
    with preds_path.open("a") as sink:
        for n, item in enumerate(items, 1):
            if item["id"] in done:
                continue
            record = record_of(item)
            # The model build and runtime are re-proved around every notice: a re-pulled tag or an Ollama upgrade or
            # restart mid-run stops the run, so no stored prediction comes from anything but the recorded build.
            check_identity(client, identity, item["id"])
            started = time.monotonic()
            result = None
            for attempt in range(2):
                try:
                    result = ex.extract(client, record)
                    break
                except LocalModelError as error:
                    if not error.request_failed:
                        raise
                    print(f"  model error on {item['id']} (attempt {attempt + 1}): {error}", flush=True)
            if result is None:
                result = ex.Extraction(status="model_error", error="local model returned an error twice")
            wall = (time.monotonic() - started) * 1000
            check_identity(client, identity, item["id"])
            baseline = ex.deterministic_baseline(record)
            row = {
                "id": item["id"],
                "split": item["split"],
                "status": result.status,
                "error": result.error,
                "wall_ms": round(wall),
                "chat": result.chat.__dict__ if result.chat else None,
                "proposals": [{"value": p.value, "label": p.label, "field": p.field, "ok": p.decision.ok, "reason": p.decision.reason, "server_label": p.decision.label} for p in result.proposals],
                "baseline": [{"value": p.value, "label": p.label, "field": p.field} for p in baseline],
                # The complete response (Extraction.raw_output is shortened for logs): scoring re-parses it, so every
                # proposal production would submit is counted.
                "raw_output": result.chat.content if result.chat else result.raw_output,
            }
            sink.write(json.dumps(row) + "\n")
            sink.flush()
            print(f"[{n}/{len(items)}] {item['id']} {result.status} proposals={len(result.proposals)} accepted={len(result.accepted)} {wall/1000:.1f}s", flush=True)
    rss = {pid: peak_rss_mb(pid) for pid in ollama_pids()}
    (out / f"resources-{args.split}.json").write_text(json.dumps({"ollama_peak_rss_mb": rss, "cpu_count": os.cpu_count()}, indent=2))


def wilson(successes: int, total: int, z: float = 1.96) -> list[float] | None:
    if total == 0:
        return None
    p = successes / total
    centre = (p + z * z / (2 * total)) / (1 + z * z / total)
    half = z * ((p * (1 - p) / total + z * z / (4 * total * total)) ** 0.5) / (1 + z * z / total)
    return [round(centre - half, 3), round(centre + half, 3)]


def prf(tp: int, fp: int, fn: int) -> dict:
    p = tp / (tp + fp) if tp + fp else None
    r = tp / (tp + fn) if tp + fn else None
    f = 2 * p * r / (p + r) if p and r else None
    return {
        "tp": tp, "fp": fp, "fn": fn,
        "precision": round(p, 3) if p is not None else None, "precision_95ci": wilson(tp, tp + fp),
        "recall": round(r, 3) if r is not None else None, "recall_95ci": wilson(tp, tp + fn),
        "f1": round(f, 3) if f is not None else None,
    }


def score(args: argparse.Namespace) -> dict:
    gold = json.loads(Path(args.gold).read_text())
    sample = {i["id"]: i for i in json.loads(Path(args.sample).read_text())}
    out = Path(args.out)
    rows = []
    for path in sorted(out.glob("predictions-*.jsonl")):
        rows += [json.loads(line) for line in path.read_text().splitlines() if line.strip()]
    covered = coverage(sample, rows)
    by_id = {r["id"]: r for r in rows}
    # The extraction-behaviour fingerprint the report was scored under: a publishable entry must name this report's
    # value (CI checks it), so a rules change cannot be allowlisted without re-scoring.
    from df_collector.behaviour import behaviour_sha256

    # The build that produced the predictions being scored (a rules-only re-score keeps it; CI compares it with the
    # publishable entry and with the extractor's current request).
    build_path = Path(args.out) / BUILD_FILE
    if not build_path.exists():
        raise SystemExit(f"{build_path} is missing: the predictions cannot be attributed to a build")
    build = json.loads(build_path.read_text())
    if build.get("sample_sha256") != sample_sha256(list(sample.values())):
        raise SystemExit(f"the stored predictions were made from another sample ({build.get('sample_sha256')}); re-run the benchmark (--fresh)")
    report: dict = {"extractor_version": ex.EXTRACTOR_VERSION, "prompt_sha256": ex.prompt_sha256(), "behaviour_sha256": behaviour_sha256(), "predictions_build": json.loads(build_path.read_text()), "coverage": covered}
    for split in ("dev", "heldout"):
        ids = [i for i in by_id if by_id[i]["split"] == split]
        if not ids:
            continue
        systems = {"llm_raw": [0, 0, 0], "llm_validated": [0, 0, 0], "baseline": [0, 0, 0]}
        notices_with_gold = notices_covered = 0
        unsupported = quarantined = fp_notices_negative = negatives = 0
        errors: list[dict] = []
        latencies = []
        out_tps = []
        for i in ids:
            row = by_id[i]
            g = gold[i]
            gset = {x["value"] for x in g["identifiers"]}
            amb = {x["value"] for x in g.get("ambiguous", [])}
            fields_text = "\n".join([sample[i]["fields"]["Title"], sample[i]["fields"]["Description"]] + [p[k] for p in sample[i]["fields"]["Products"] for k in ("Name", "Description", "Model")])
            if row["status"] in ("quarantined", "model_error"):
                quarantined += 1
            if row["chat"]:
                latencies.append(row["wall_ms"] / 1000)
                if row["chat"]["output_ms"]:
                    out_tps.append(row["chat"]["output_tokens"] / (row["chat"]["output_ms"] / 1000))
            # Decisions are recomputed from the stored raw model output with the current validator, so a validator
            # change is re-scored without new model calls; the model output itself is never regenerated here.
            record = sample[i]["fields"]
            fields = validate.candidate_fields(record)
            try:
                proposed = [item["value"] for item in ex.parse_output(row["raw_output"], fields)] if row["status"] == "extracted" and row["raw_output"] else []
            except (ValueError, json.JSONDecodeError) as error:
                # An extracted notice whose stored output no longer parses (truncated or corrupted) cannot be scored as
                # "no proposals": that would hide whatever production submitted. Refuse to score it.
                raise SystemExit(f"stored output for {i} does not parse ({error}); re-run the benchmark (--fresh)") from error
            preds = {
                "llm_raw": set(proposed),
                "llm_validated": {v for v in proposed if validate.decide_in_record(record, v, fields[0] if fields else "Description").ok},
                "baseline": {p.value for p in ex.deterministic_baseline(record)},
            }
            unsupported += sum(1 for v in preds["llm_raw"] if v not in fields_text)
            for name, pset in preds.items():
                pset = pset - amb
                tp = len(pset & gset)
                systems[name][0] += tp
                systems[name][1] += len(pset - gset)
                systems[name][2] += len(gset - pset)
                if name == "llm_validated":
                    for v in sorted(pset - gset):
                        errors.append({"id": i, "type": "false_positive", "value": v})
                    for v in sorted(gset - pset):
                        errors.append({"id": i, "type": "missed", "value": v})
            if gset:
                notices_with_gold += 1
                if preds["llm_validated"] & gset:
                    notices_covered += 1
            else:
                negatives += 1
                if preds["llm_validated"] - amb:
                    fp_notices_negative += 1
        report[split] = {
            "notices": len(ids),
            "gold_identifiers": sum(len(gold[i]["identifiers"]) for i in ids),
            "notices_with_gold": notices_with_gold,
            "negative_notices": negatives,
            "systems": {name: prf(*v) for name, v in systems.items()},
            "notice_coverage_llm_validated": f"{notices_covered}/{notices_with_gold}",
            "negative_notices_with_false_positive": f"{fp_notices_negative}/{negatives}",
            "unsupported_values_in_raw_output": unsupported,
            "quarantined_notices": quarantined,
            "latency_s": {"p50": round(statistics.median(latencies), 1), "p95": round(sorted(latencies)[int(0.95 * (len(latencies) - 1))], 1), "mean": round(statistics.mean(latencies), 1)} if latencies else None,
            "output_tokens_per_s_median": round(statistics.median(out_tps), 1) if out_tps else None,
            "errors": errors,
        }
    (out / "report.json").write_text(json.dumps(report, indent=2))
    return report


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--sample", required=True)
    parser.add_argument("--gold", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--split", default="dev", choices=["dev", "heldout", "all"])
    parser.add_argument("--ollama", default="http://127.0.0.1:11434")
    parser.add_argument("--model", default="qwen3.5:4b")
    parser.add_argument("--digest", default=None)
    parser.add_argument("--num-ctx", type=int, default=8192)
    parser.add_argument("--num-thread", type=int, default=None)
    parser.add_argument("--think", default="false", help='false for qwen3.5; "low" for gpt-oss')
    parser.add_argument("--score-only", action="store_true")
    parser.add_argument("--fresh", action="store_true", help="discard stored predictions (required when the build changed)")
    args = parser.parse_args()
    if not args.score_only:
        run(args)
    report = score(args)
    print(json.dumps({k: {kk: vv for kk, vv in v.items() if kk != "errors"} if isinstance(v, dict) else v for k, v in report.items()}, indent=2))


if __name__ == "__main__":
    main()
