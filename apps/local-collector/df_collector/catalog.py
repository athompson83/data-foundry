"""What Data Foundry hosts, and what the collector can capture for it.

The live API root (``GET https://api.data.aroqon.com/``) lists the datasets that are
currently served, each with its registry key (``docs/sources/pipeline/candidates.yaml``)
and stats path. The collector refreshes it daily and joins it with the compiled
policy to build a **capture plan**:

- the member sources of every hosted dataset;
- *expansion* sources: members of composite datasets that share a member with a
  hosted dataset (e.g. EU Safety Gate for the recall datasets), so the plan points at
  more sources for the same data types;
- for each source, whether the collector captures it (``task``), whether rights and
  stage permit it but an adapter is still to be built (``permitted-no-adapter``), or
  why it is ``blocked``.

The plan only reports. Permission still comes from the registry, and a new source or
adapter is a reviewed code change (the daily scout's job), never something the collector
or its model adds by itself. A task runs only while its source belongs to a hosted
dataset: when a dataset is withdrawn from the live catalog, its tasks stop.
"""

from __future__ import annotations

import json
import time

from .policy import Policy


def parse_root(body: bytes) -> dict[str, dict]:
    data = json.loads(body)
    datasets = data.get("datasets") if isinstance(data, dict) else None
    if not isinstance(datasets, dict):
        raise ValueError("API root has no datasets object")
    out: dict[str, dict] = {}
    for key, entry in datasets.items():
        if isinstance(key, str) and isinstance(entry, dict):
            out[key] = {k: entry.get(k) for k in ("name", "registry", "docs", "stats")}
    return out


def members_of(policy: Policy, registry_key: str | None) -> list[str]:
    if not registry_key:
        return []
    if registry_key in policy.datasets:
        return list(policy.datasets[registry_key].get("sources", []))
    if registry_key in policy.sources:
        return [registry_key]
    return []


def capture_plan(policy: Policy, hosted: dict[str, dict]) -> dict:
    def describe(source: str) -> dict:
        info = policy.sources.get(source)
        if info is None:
            return {"source": source, "acquisition": "blocked", "blocked_because": ["not in the registry"], "tasks": []}
        return {"source": source, "name": info.get("name"), "rights": info.get("rights"), "stage": info.get("stage"), "format": info.get("format"),
                "acquisition": info.get("acquisition"), "tasks": info.get("tasks", []), "blocked_because": info.get("blocked_because", [])}

    plan: dict = {"datasets": [], "hosted_sources": [], "summary": {}}
    hosted_sources: set[str] = set()
    for api_key, entry in sorted(hosted.items()):
        members = members_of(policy, entry.get("registry"))
        hosted_sources.update(members)
        expansion: list[str] = []
        for other_key, other in sorted(policy.datasets.items()):
            if other_key == entry.get("registry") or not set(other.get("sources", [])) & set(members):
                continue
            expansion += [s for s in other.get("sources", []) if s not in members and s not in expansion]
        plan["datasets"].append({
            "api_key": api_key,
            "name": entry.get("name"),
            "registry": entry.get("registry"),
            "registry_known": bool(members),
            "stats": entry.get("stats"),
            "members": [describe(s) for s in members],
            "expansion": [describe(s) for s in expansion],
        })
    plan["hosted_sources"] = sorted(hosted_sources)
    everything = [m for d in plan["datasets"] for m in d["members"] + d["expansion"]]
    plan["summary"] = {state: len({m["source"] for m in everything if m["acquisition"] == state}) for state in ("task", "permitted-no-adapter", "blocked")}
    return plan


def stats_summary(body: bytes) -> dict:
    """The freshness fields of a public stats response (both recall datasets' shapes)."""
    data = json.loads(body)
    return {"last_successful_sync": data.get("last_successful_sync"), "fetched_at": time.time()}
