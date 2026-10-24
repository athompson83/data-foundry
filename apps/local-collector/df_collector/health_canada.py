"""Health Canada open-index identifier adapter. Only Title/Product are rights-admitted.

Uses the common bounded model engine and code rules, with native evidence fields,
a distinct prompt/build/fingerprint, and no publication qualification inherited from CPSC.
"""
from __future__ import annotations

import hashlib
import json
import sys
from dataclasses import replace

from . import extract as engine, validate
from .behaviour import ROOT, behaviour_sha256 as common_behaviour_sha256

TASK = "health-canada-product-identifiers@1"
EXTRACTOR_VERSION = TASK + "/prompt-1"
SYSTEM_PROMPT = engine.SYSTEM_PROMPT.replace("one U.S. CPSC recall notice", "one Health Canada consumer-product recall from its open-data index")
generation = engine.generation
FILES = (
    "apps/local-collector/df_collector/health_canada.py",
    "packages/product-recall-structuring/src/hc-identifier-candidates.ts",
)


def candidate_field_text(record: object, field: str) -> str | None:
    if field not in ("Title", "Product") or not isinstance(record, dict):
        return None
    value = record.get(field)
    return value if isinstance(value, str) else None


def candidate_fields(record: object) -> list[str]:
    return [field for field in ("Title", "Product") if (candidate_field_text(record, field) or "").strip()]


def decide_in_record(record: object, value: str, claimed_field: str) -> validate.Decision:
    if claimed_field not in ("Title", "Product"):
        return validate.Decision(False, "field_not_allowed", field=claimed_field)
    first = None
    for field in [claimed_field] + [f for f in candidate_fields(record) if f != claimed_field]:
        text = candidate_field_text(record, field)
        if text is None:
            continue
        # Description applies the common unstructured-text rules, with no implicit model-field anchor.
        decision = replace(validate.decide(text, value, "Description"), field=field)
        if decision.ok:
            return decision
        if decision.reason != "not_in_source" and first is None:
            first = decision
    return first or validate.Decision(False, "not_in_source", field=claimed_field)


def worth_extracting(record: object) -> bool:
    return validate.worth_extracting({"Title": candidate_field_text(record, "Title"), "Description": candidate_field_text(record, "Product")})


def prompt_sha256() -> str:
    return hashlib.sha256((EXTRACTOR_VERSION + "\n" + SYSTEM_PROMPT).encode()).hexdigest()


def behaviour_sha256() -> str:
    try:
        digest = hashlib.sha256((common_behaviour_sha256() + "\n").encode())
        for path in FILES:
            text = (ROOT / path).read_text(encoding="utf-8").replace("\r\n", "\n")
            digest.update(f"{path}\n{text}\n".encode())
        return digest.hexdigest()
    except OSError:
        return "unknown"


def build_id(model: str, model_digest: str, num_ctx: int = 8192, think: bool | str = False, num_thread: int | None = None, runtime: str | None = None) -> str:
    settings = generation(num_ctx, think, num_thread)
    identity = [EXTRACTOR_VERSION, model, model_digest.removeprefix("sha256:"), prompt_sha256(), behaviour_sha256(), settings, runtime]
    return EXTRACTOR_VERSION + "|" + hashlib.sha256(json.dumps(identity, sort_keys=True).encode()).hexdigest()


def extract(client, record: dict) -> engine.Extraction:
    return engine.extract(client, record, rules=sys.modules[__name__], system_prompt=SYSTEM_PROMPT)
