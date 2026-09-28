"""Configuration and conservative default limits.

The config file is JSON (``collector.json`` in the data directory). Secrets are
never stored in it: the Data Foundry read key and the ingestion credential live
in separate files under ``<data>/secrets/`` and each process reads only the one
it needs (the worker never opens the ingestion credential).
"""

from __future__ import annotations

import json
import os
from dataclasses import asdict, dataclass, field
from pathlib import Path


def default_data_dir() -> Path:
    if os.name == "nt":
        return Path(os.environ.get("LOCALAPPDATA", str(Path.home()))) / "DataFoundryCollector"
    return Path(os.environ.get("XDG_DATA_HOME", str(Path.home() / ".local" / "share"))) / "data-foundry-collector"


@dataclass
class Limits:
    # Local evidence and state may use at most this much disk; collection pauses at the cap.
    max_disk_mb: int = 2048
    # Pause if the volume holding the data directory has less free space than this.
    min_free_disk_mb: int = 5120
    # Notices waiting for extraction; fetching pauses while the backlog is at the cap.
    max_queue: int = 500
    # Outbox rows waiting for upload; extraction pauses while the outbox is at the cap.
    max_outbox: int = 200
    # Data Foundry read-API requests per UTC day (each returns up to 25 notices). Metered against the read key's plan.
    max_api_requests_per_day: int = 400
    # Largest response body accepted from any source.
    max_response_mb: int = 16
    # Simultaneous LLM extractions. One on a CPU-only machine.
    llm_concurrency: int = 1
    # CPU threads Ollama may use for this collector's requests (None = Ollama's default).
    llm_threads: int | None = None
    # Minimum seconds between requests to one host.
    min_host_interval_s: float = 2.0
    # Browser sessions: none are used by the current tasks; kept at 0 so nothing launches one.
    max_browser_sessions: int = 0


@dataclass
class Config:
    data_dir: str = field(default_factory=lambda: str(default_data_dir()))
    ollama_url: str = "http://127.0.0.1:11434"
    model: str = "qwen3.5:4b"
    # Ollama manifest id of the tested build (``ollama list`` ID). Weights layer: sha256:81fb60c7daa8…
    model_digest: str = "2a654d98e6fb"
    # False for qwen3.5; "low" for OpenAI's open-weight gpt-oss models (see README "Choosing a model").
    think: bool | str = False
    num_ctx: int = 8192
    api_origin: str = "https://api.data.aroqon.com"
    dashboard_host: str = "127.0.0.1"
    dashboard_port: int = 8765
    user_agent: str = "DataFoundry-LocalCollector/0.1 (+data@mail.proviciency.com)"
    # How often the backfill pages and the incremental cursor are due (seconds).
    backfill_interval_s: int = 60
    incremental_interval_s: int = 6 * 3600
    limits: Limits = field(default_factory=Limits)

    @property
    def root(self) -> Path:
        return Path(self.data_dir)

    @property
    def db_path(self) -> Path:
        return self.root / "state.sqlite3"

    @property
    def evidence_dir(self) -> Path:
        return self.root / "evidence"

    @property
    def secrets_dir(self) -> Path:
        return self.root / "secrets"

    def secret(self, name: str) -> str | None:
        path = self.secrets_dir / name
        try:
            value = path.read_text().strip()
        except OSError:
            return None
        return value or None

    def save(self, path: Path | None = None) -> Path:
        # The file this configuration was loaded from, so dashboard edits persist where the next start reads them.
        target = path or getattr(self, "source_path", None) or self.root / "collector.json"
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps(asdict(self), indent=2))
        return target


def load(path: str | None = None, data_dir: str | None = None) -> Config:
    base = Path(data_dir) if data_dir else default_data_dir()
    file = Path(path) if path else base / "collector.json"
    config = Config(data_dir=str(base))
    if file.exists():
        raw = json.loads(file.read_text())
        limits = Limits(**raw.pop("limits", {}))
        known = {k: v for k, v in raw.items() if k in Config.__dataclass_fields__}
        config = Config(**{**known, "limits": limits})
        if data_dir:
            config.data_dir = str(base)
    if path:
        config.source_path = file.resolve()  # not a dataclass field, so never written into the file itself
    return config
