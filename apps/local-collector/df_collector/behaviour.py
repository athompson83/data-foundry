"""The extraction-behaviour fingerprint, computed exactly as tooling/scripts/extraction-behaviour.ts computes it.

It covers the acceptance rules (TypeScript and this collector's mirror), the extractor's request (schema, truncation,
prompt assembly), the model options and the generation defaults. The recalls Worker stamps the same value on every
row it accepts and serves only the benchmarked one, so the collector keys its local build by it too: when the rules
change (a re-scored, rules-only update), every notice is re-extracted under the new build instead of being skipped.
The collector runs from a checkout of the repository, so the TypeScript rules file is present; a CI test pins this
value to the Worker's EXTRACTION_BEHAVIOUR_SHA256.
"""

from __future__ import annotations

import hashlib
import json
import re
from functools import lru_cache
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]

FILES = (
    "packages/product-recall-structuring/src/identifier-candidates.ts",
    "apps/local-collector/df_collector/validate.py",
    "apps/local-collector/df_collector/extract.py",
    "apps/local-collector/df_collector/ollama.py",
)


def _generation_defaults() -> dict[str, str]:
    config = (ROOT / "apps/local-collector/df_collector/config.py").read_text(encoding="utf-8")
    out: dict[str, str] = {}
    for name in ("model", "num_ctx", "think"):
        match = re.search(rf"^\s+{name}:[^=\n]*=\s*(.+)$", config, re.M)
        if not match:
            raise ValueError(f"config.py has no default for {name}")
        out[name] = match.group(1).strip()
    return out


@lru_cache(maxsize=1)
def behaviour_sha256() -> str:
    """The fingerprint of the files as checked out; 'unknown' when the checkout is incomplete (never publishable)."""
    try:
        digest = hashlib.sha256()
        for path in FILES:
            text = (ROOT / path).read_text(encoding="utf-8").replace("\r\n", "\n")
            digest.update(f"{path}\n{text}\n".encode("utf-8"))
        digest.update(json.dumps(_generation_defaults(), separators=(",", ":"), ensure_ascii=False).encode("utf-8"))
        return digest.hexdigest()
    except (OSError, ValueError):
        return "unknown"
