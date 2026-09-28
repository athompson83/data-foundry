"""The resident collector: a due-work scheduler, the extraction worker and the uploader.

Process layout (``df_collector run``):

- the **main process** runs the scheduler, the source reader and the single
  LLM extraction worker, and serves the loopback dashboard. It holds the
  read-only Data Foundry API key. It never opens the ingestion credential.
- the **uploader** is a separate child process (``df_collector uploader``).
  It alone reads the ingestion credential and only ever POSTs outbox rows to
  the intake path. The model process cannot reach it.

Nothing runs just because the loop ticks: each job has a due time, sources
have per-host minimum intervals and a daily request cap, and caps pause work
instead of dropping evidence.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import sys
import threading
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlencode, urlsplit

from . import COLLECTOR_ID, catalog as catalog_mod, extract, policy as policy_mod, validate
from .config import Config
from .netguard import FetchFailed, FetchRefused, HostPolicy, RateLimited, SafeFetcher
from .ollama import LocalModelError, OllamaClient
from .state import State, backoff_seconds

TASK = "cpsc-product-identifiers@1"
PAGE_SIZE = 25
CATALOG_INTERVAL_S = 24 * 3600
# While a task waits on the catalog (its dataset not hosted, or no catalog yet), it is re-read hourly instead.
CATALOG_RETRY_S = 3600
# A catalog older than this (its refresh keeps failing) no longer counts as knowing what is hosted: tasks wait.
CATALOG_MAX_AGE_S = 7 * 86400
MAX_DOCUMENT_ATTEMPTS = 3
SWEEP_INTERVAL_S = 60
CAP_PAUSE = "cap: "
# A refused ingestion credential is retried after this long, so a fixed or re-issued credential resumes on its own.
CREDENTIAL_RETRY_S = 3600
PREFILTER = re.compile(r"\b(?:models?|items?|styles?|skus?|part|catalog(?:ue)?|product|article|stock|p/n)\b", re.I | re.A)
CODE = re.compile(r"\b[A-Za-z0-9-]*[0-9][A-Za-z0-9-]{2,}\b", re.A)


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def dir_size_mb(path: Path) -> float:
    total = 0
    for root, _, files in os.walk(path):
        for name in files:
            try:
                total += os.path.getsize(os.path.join(root, name))
            except OSError:
                pass
    return total / (1024 * 1024)


def rewind_backfill(db, state: State) -> None:
    """Restart the backfill from the first page. Notices already done are skipped by id and hash, so this costs only
    API reads, and any notice whose working copy was removed is queued again."""
    db.execute("DELETE FROM cursor WHERE task = ? AND name IN ('backfill_cursor', 'backfill_done')", (TASK,))


def seconds_until_utc_midnight() -> float:
    now = datetime.now(timezone.utc)
    return 86400 - (now.hour * 3600 + now.minute * 60 + now.second) + 5


class NoRedirect(urllib.request.HTTPRedirectHandler):
    """The uploader never follows a redirect: the ingestion credential goes only to the policy-checked intake URL."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: D401 - urllib hook
        return None


def worth_extracting(record: dict) -> bool:
    """A cheap scheduling heuristic (not a decision): a product label word and a digit-bearing code somewhere."""
    text = "\n".join(validate.candidate_field_text(record, f) or "" for f in validate.candidate_fields(record))
    return bool(PREFILTER.search(text) and CODE.search(text))


class Collector:
    """Scheduler + reader + extraction worker. Holds the read key, never the ingestion credential."""

    def __init__(self, config: Config, state: State, fetcher: SafeFetcher | None = None, client: OllamaClient | None = None, policy: policy_mod.Policy | None = None):
        self.config = config
        self.state = state
        self.policy = policy or policy_mod.load()
        self.owner = f"{COLLECTOR_ID}:{os.getpid()}"
        self.stop = threading.Event()
        self.status: dict = {"phase": "starting", "current": None, "model": None, "last_error": None}
        self.client = client
        self.fetcher = fetcher
        self.model_identity = None
        self._last_sweep = 0.0

    # -- helpers -------------------------------------------------------------------------------------------------

    def task_policy(self) -> policy_mod.TaskPolicy:
        return self.policy.task(TASK, kill_switch=self.state.get(f"kill:{TASK}") == "1")

    def _fetcher(self, task: policy_mod.TaskPolicy) -> SafeFetcher:
        if self.fetcher is None:
            api_host = urlsplit(self.config.api_origin).hostname or ""
            test_origins: tuple[str, ...] = ()
            allowed = task.allowed_hosts
            if self.config.api_origin.startswith("http://"):
                # Local verification against `wrangler dev` only: an exact loopback origin, never a LAN address.
                test_origins = (self.config.api_origin.rstrip("/"),)
                allowed = (*allowed, api_host)
            self.fetcher = SafeFetcher(
                HostPolicy(
                    allowed_hosts=allowed,
                    prohibited_domains=self.policy.prohibited_domains,
                    user_agent=self.config.user_agent,
                    max_bytes=self.config.limits.max_response_mb * 1024 * 1024,
                    min_interval_s=max(task.min_interval_s, self.config.limits.min_host_interval_s),
                    loopback_test_origins=test_origins,
                )
            )
        return self.fetcher

    def _client(self) -> OllamaClient:
        if self.client is None:
            self.client = OllamaClient(self.config.ollama_url, self.config.model, self.config.model_digest, num_ctx=self.config.num_ctx, num_thread=self.config.limits.llm_threads, think=self.config.think)
        return self.client

    def _read_key(self) -> str:
        key = self.config.secret("read-api-key")
        if not key:
            raise policy_mod.PolicyRefused("no Data Foundry read API key: save one to secrets/read-api-key")
        return key

    def _requests_today(self) -> int:
        day = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        return int(self.state.get(f"api_requests:{day}", "0") or 0)

    def _count_request(self) -> None:
        day = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        self.state.set(f"api_requests:{day}", str(self._requests_today() + 1))

    def check_caps(self) -> str | None:
        limits = self.config.limits
        used = dir_size_mb(self.config.evidence_dir) + (self.config.db_path.stat().st_size / 1048576 if self.config.db_path.exists() else 0)
        if used > limits.max_disk_mb:
            return f"disk cap reached ({used:.0f} MB of {limits.max_disk_mb} MB)"
        free = shutil.disk_usage(self.config.root).free / 1048576
        if free < limits.min_free_disk_mb:
            return f"free disk below {limits.min_free_disk_mb} MB ({free:.0f} MB free)"
        return None

    def api_get(self, task: policy_mod.TaskPolicy, path: str, params: dict) -> dict:
        if self._requests_today() >= self.config.limits.max_api_requests_per_day:
            raise RateLimited("daily API request cap reached", retry_after=seconds_until_utc_midnight())
        url = self.config.api_origin.rstrip("/") + path + "?" + urlencode(params)
        self._count_request()
        # The API host is Data Foundry's own; robots.txt on the api host disallows crawlers, and this is an
        # authenticated API client, not a crawler, so robots is not consulted here. Source hosts always are.
        response = self._fetcher(task).get(url, headers={"Authorization": f"Bearer {self._read_key()}"}, check_robots=False)
        with self.state.tx() as db:
            db.execute("INSERT INTO retrieval (url, status, bytes, sha256, retrieved_at, note) VALUES (?, ?, ?, ?, ?, ?)", (url.split("?")[0] + "?" + urlencode({k: v for k, v in params.items() if k != "cursor"}), response.status, len(response.body), hashlib.sha256(response.body).hexdigest(), response.retrieved_at, "dataforge-api"))
        return json.loads(response.body)

    # -- live catalog ---------------------------------------------------------------------------------------------

    def refresh_catalog(self, task: policy_mod.TaskPolicy) -> dict:
        """Read the datasets Data Foundry serves now (keyless API root and stats) and rebuild the capture plan."""
        origin = self.config.api_origin.rstrip("/")
        if self._requests_today() >= self.config.limits.max_api_requests_per_day:
            raise RateLimited("daily API request cap reached", retry_after=seconds_until_utc_midnight())
        self._count_request()
        root = self._fetcher(task).get(origin + "/", check_robots=False)
        hosted = catalog_mod.parse_root(root.body)
        freshness: dict[str, dict] = {}
        for key, entry in hosted.items():
            stats = entry.get("stats") or ""
            # Stats are fetched only from the API's own host; anything else in the catalog is ignored.
            if urlsplit(stats).hostname != urlsplit(origin).hostname and not stats.startswith(origin):
                continue
            path = urlsplit(stats).path
            try:
                self._count_request()
                freshness[key] = catalog_mod.stats_summary(self._fetcher(task).get(origin + path, check_robots=False).body)
            except (FetchFailed, FetchRefused, ValueError) as error:
                freshness[key] = {"error": str(error)}
        plan = catalog_mod.capture_plan(self.policy, hosted)
        snapshot = {"fetched_at": time.time(), "hosted": hosted, "freshness": freshness, "plan": plan}
        self.state.set("catalog", json.dumps(snapshot))
        self.state.event("info", "catalog", {"hosted": sorted(hosted), "capture": plan["summary"]})
        return snapshot

    def catalog(self) -> dict | None:
        raw = self.state.get("catalog")
        return json.loads(raw) if raw else None

    def hosted_gate(self, task: policy_mod.TaskPolicy) -> str | None:
        """Why the task may not run against the live catalog, or None. Unknown (no or stale catalog) waits."""
        snapshot = self.catalog()
        if snapshot is None:
            return "waiting for the live dataset catalog"
        if time.time() - snapshot["fetched_at"] > CATALOG_MAX_AGE_S:
            return "the live dataset catalog is more than 7 days old"
        if task.source not in snapshot["plan"]["hosted_sources"]:
            return f"{task.source} is not a member of any dataset Data Foundry hosts now"
        return None

    # -- source reading (one page per due job) -------------------------------------------------------------------

    def read_page(self, task: policy_mod.TaskPolicy) -> float:
        """Read one page: the resumable backfill first, then the changed_since cursor. Returns the next due delay."""
        backfill_done = self.state.cursor(TASK, "backfill_done") == "1"
        params = {**task.input.get("params", {}), "limit": str(PAGE_SIZE), "include": "raw"}
        if not backfill_done:
            if self.state.cursor(TASK, "watermark") is None:
                with self.state.tx() as db:
                    self.state.set_cursor(db, TASK, "watermark", utc_now_iso())
            cursor = self.state.cursor(TASK, "backfill_cursor")
        else:
            params["changed_since"] = self.state.cursor(TASK, "watermark") or "1970-01-01T00:00:00Z"
            cursor = self.state.cursor(TASK, "incremental_cursor")
            if cursor is None and self.state.cursor(TASK, "incremental_started") is None:
                with self.state.tx() as db:
                    self.state.set_cursor(db, TASK, "incremental_started", utc_now_iso())
        if cursor:
            params["cursor"] = cursor
        page = self.api_get(task, task.input["path"], params)
        queued = self.queue_documents(page.get("data", []))
        next_cursor = page.get("next_cursor")
        with self.state.tx() as db:
            if not backfill_done:
                if next_cursor:
                    self.state.set_cursor(db, TASK, "backfill_cursor", next_cursor)
                else:
                    self.state.set_cursor(db, TASK, "backfill_done", "1")
            elif next_cursor:
                self.state.set_cursor(db, TASK, "incremental_cursor", next_cursor)
            else:
                started = self.state.cursor(TASK, "incremental_started") or utc_now_iso()
                self.state.set_cursor(db, TASK, "watermark", started)
                db.execute("DELETE FROM cursor WHERE task = ? AND name IN ('incremental_cursor', 'incremental_started')", (TASK,))
        self.state.event("info", "page", {"queued": queued, "records": len(page.get("data", [])), "backfill": not backfill_done, "more": bool(next_cursor)})
        more = bool(next_cursor)
        return self.config.backfill_interval_s if (not backfill_done or more) else self.config.incremental_interval_s

    def queue_documents(self, notices: list[dict]) -> int:
        queued = 0
        self.config.evidence_dir.mkdir(parents=True, exist_ok=True)
        for notice in notices:
            recall_id = notice.get("id")
            raw = notice.get("raw")
            raw_sha = (notice.get("provenance") or {}).get("raw_sha256")
            if not (isinstance(recall_id, str) and recall_id.startswith("cpsc-") and isinstance(raw, dict) and isinstance(raw_sha, str)):
                continue
            if self.state.one("SELECT 1 FROM document WHERE recall_id = ? AND raw_sha256 = ? AND extractor_version = ?", recall_id, raw_sha, extract.EXTRACTOR_VERSION):
                continue
            state = "queued" if worth_extracting(raw) else "skipped"
            path: Path | str = ""
            if state == "queued":
                # A working copy only while the notice waits for the model; R2 holds the evidence.
                body = json.dumps(raw, ensure_ascii=False, sort_keys=True).encode()
                digest = hashlib.sha256(body).hexdigest()
                path = self.config.evidence_dir / digest[:2] / f"{digest}.json"
                if not path.exists():
                    path.parent.mkdir(parents=True, exist_ok=True)
                    tmp = path.with_suffix(".tmp")
                    tmp.write_bytes(body)
                    os.replace(tmp, path)
            with self.state.tx() as db:
                db.execute(
                    "INSERT INTO document (recall_id, raw_sha256, task, extractor_version, evidence_path, evidence_ref, retrieved_at, state, detail, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING",
                    (recall_id, raw_sha, TASK, extract.EXTRACTOR_VERSION, str(path), (notice.get("provenance") or {}).get("raw_evidence"), time.time(), state, None if state == "queued" else "no product label or code in the allowed fields", time.time()),
                )
            queued += state == "queued"
        return queued

    # -- extraction ----------------------------------------------------------------------------------------------

    def verify_model(self) -> None:
        self.model_identity = self._client().verify()
        self.status["model"] = self.model_identity.__dict__

    def extract_one(self) -> bool:
        """Extract the oldest queued document. Returns False when there is nothing to do."""
        if self.state.outbox_pending() >= self.config.limits.max_outbox:
            self.status["phase"] = "waiting: outbox at its cap"
            return False
        row = self.state.one("SELECT * FROM document WHERE state = 'queued' AND task = ? ORDER BY attempts, retrieved_at LIMIT 1", TASK)
        if row is None:
            return False
        try:
            record = json.loads(Path(row["evidence_path"]).read_text())
        except (OSError, ValueError):
            # The working copy is gone (a purge or a manual clean-up): forget the notice and rewind the backfill, so
            # it is read again from Data Foundry rather than lost.
            with self.state.tx() as db:
                db.execute("DELETE FROM document WHERE recall_id = ? AND raw_sha256 = ? AND extractor_version = ?", (row["recall_id"], row["raw_sha256"], row["extractor_version"]))
                rewind_backfill(db, self.state)
            self.state.event("warn", "working_copy_missing", {"recall_id": row["recall_id"]})
            return True
        self.status.update(phase="extracting", current=row["recall_id"])
        started = time.monotonic()
        try:
            result = extract.extract(self._client(), record)
        except LocalModelError as error:
            if not error.request_failed:
                raise
            # The model server answered with an error for this notice: charge it, and dead-letter it after three.
            with self.state.tx() as db:
                db.execute(
                    "UPDATE document SET attempts = attempts + 1, state = CASE WHEN attempts + 1 >= ? THEN 'failed' ELSE state END, detail = ?, updated_at = ? WHERE recall_id = ? AND raw_sha256 = ? AND extractor_version = ?",
                    (MAX_DOCUMENT_ATTEMPTS, str(error)[:500], time.time(), row["recall_id"], row["raw_sha256"], row["extractor_version"]),
                )
            self.state.event("warn", "extraction_failed", {"recall_id": row["recall_id"], "error": str(error)[:300]})
            if (self.state.one("SELECT state FROM document WHERE recall_id = ? AND raw_sha256 = ? AND extractor_version = ?", row["recall_id"], row["raw_sha256"], row["extractor_version"]) or {"state": ""})["state"] == "failed":
                self._drop_working_copy(row)
            self.status.update(phase="idle", current=None, last_error=str(error))
            return True
        latency = (time.monotonic() - started) * 1000
        accepted = result.accepted
        with self.state.tx() as db:
            db.execute("UPDATE document SET state = ?, detail = ?, latency_ms = ?, updated_at = ? WHERE recall_id = ? AND raw_sha256 = ? AND extractor_version = ?", (result.status, result.error, latency, time.time(), row["recall_id"], row["raw_sha256"], row["extractor_version"]))
            for p in result.proposals:
                db.execute(
                    """INSERT INTO candidate (recall_id, raw_sha256, extractor_version, value, field, label, local_decision, local_reason, span_start, span_end, updated_at)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING""",
                    (row["recall_id"], row["raw_sha256"], row["extractor_version"], p.value, p.field, p.decision.label or p.label, "accepted" if p.decision.ok else "rejected", p.decision.reason, p.decision.start, p.decision.end, time.time()),
                )
            if accepted:
                identity = self.model_identity
                payload = {
                    "task": TASK,
                    "extractor": {"version": extract.EXTRACTOR_VERSION, "model": self.config.model, "model_digest": identity.digest if identity else self.config.model_digest, "prompt_sha256": extract.prompt_sha256()},
                    "notices": [{"recall_id": row["recall_id"], "raw_sha256": row["raw_sha256"], "candidates": [{"value": p.value, "field": p.field, "label": p.label} for p in accepted]}],
                    "collector": COLLECTOR_ID,
                }
                key_material = json.dumps([TASK, extract.EXTRACTOR_VERSION, row["recall_id"], row["raw_sha256"], sorted((p.field, p.value) for p in accepted)])
                self.state.outbox_add(db, hashlib.sha256(key_material.encode()).hexdigest(), payload)
        # The candidates are in the outbox; the notice text is no longer needed on this computer.
        self._drop_working_copy(row)
        self.state.event("info", "extracted", {"recall_id": row["recall_id"], "status": result.status, "proposed": len(result.proposals), "accepted_locally": len(accepted), "latency_ms": round(latency)})
        self.status.update(phase="idle", current=None)
        return True

    def _drop_working_copy(self, row) -> None:
        with self.state.tx() as db:
            db.execute("UPDATE document SET evidence_path = '' WHERE recall_id = ? AND raw_sha256 = ? AND extractor_version = ?", (row["recall_id"], row["raw_sha256"], row["extractor_version"]))
            still_needed = db.execute("SELECT 1 FROM document WHERE evidence_path = ? AND state = 'queued'", (row["evidence_path"],)).fetchone()
        if row["evidence_path"] and not still_needed:
            try:
                Path(row["evidence_path"]).unlink()
            except OSError:
                pass

    # -- publication check ---------------------------------------------------------------------------------------

    def verify_queryable(self, task: policy_mod.TaskPolicy, limit: int = 5) -> int:
        """Read back server-accepted candidates through the authenticated customer API; mark the ones it serves.

        Read-back may use at most half the daily API allowance, so it never starves the source reading."""
        if self._requests_today() >= self.config.limits.max_api_requests_per_day // 2:
            return 0
        rows = self.state.q(
            "SELECT DISTINCT recall_id, raw_sha256 FROM candidate WHERE server_status IN ('accepted', 'replayed') AND queryable = 0 AND updated_at < ? LIMIT ?",
            time.time() - 60,
            limit,
        )
        marked = 0
        for row in rows:
            notice = self.api_get(task, f"{task.input['path']}/{row['recall_id']}", {})
            data = notice.get("data") or {}
            served = {item.get("key") for item in data.get("extracted_identifiers") or []}
            current = (data.get("provenance") or {}).get("raw_sha256") == row["raw_sha256"]
            with self.state.tx() as db:
                for candidate in self.state.q("SELECT value, field FROM candidate WHERE recall_id = ? AND raw_sha256 = ? AND server_status IN ('accepted', 'replayed')", row["recall_id"], row["raw_sha256"]):
                    ok = current and validate.model_key(candidate["value"]) in served
                    db.execute("UPDATE candidate SET queryable = ?, updated_at = ? WHERE recall_id = ? AND raw_sha256 = ? AND field = ? AND value = ?", (1 if ok else 0, time.time(), row["recall_id"], row["raw_sha256"], candidate["field"], candidate["value"]))
                    marked += ok
        return marked

    # -- main loop -----------------------------------------------------------------------------------------------

    def tick(self) -> None:
        if time.time() - self._last_sweep > SWEEP_INTERVAL_S:
            self._last_sweep = time.time()
            removed = self.state.sweep(self.config.evidence_dir)
            if any(removed.values()):
                self.state.event("info", "sweep", removed)
        paused = self.state.paused()
        if paused and paused.startswith(CAP_PAUSE):
            # A cap pause lifts itself when the condition clears (the sweep frees disk; the backlog drains).
            if self.check_caps() is None:
                self.state.set("paused", "")
                self.state.event("info", "resumed", paused)
                paused = None
        if paused:
            self.status["phase"] = f"paused: {paused}"
            return
        cap = self.check_caps()
        if cap:
            self.state.set("paused", CAP_PAUSE + cap)
            self.state.event("warn", "cap", cap)
            return
        try:
            task = self.task_policy()
        except policy_mod.PolicyRefused as refusal:
            self.status.update(phase="refused by policy", last_error=str(refusal))
            with self.state.tx() as db:
                db.execute("UPDATE job SET state = 'refused', last_error = ?, updated_at = ? WHERE task = ? AND state IN ('pending', 'leased')", (str(refusal), time.time(), TASK))
            return
        # The live catalog decides which hosted datasets (and so which sources) there is anything to collect for.
        self.state.ensure_job("catalog", "catalog", "catalog", {})
        job = self.state.claim(self.owner, ("catalog",))
        if job is not None:
            self.status.update(phase="reading the live catalog", current=self.config.api_origin)
            try:
                self.refresh_catalog(task)
                self.state.finish(job["id"], self.owner, next_due=time.time() + CATALOG_INTERVAL_S)
            except RateLimited as error:
                self._wait_for_allowance(job, error)
            except (FetchFailed, FetchRefused, ValueError) as error:
                self.state.fail(job["id"], self.owner, str(error), retry_after=getattr(error, "retry_after", None))
                self.state.event("warn", "catalog_failed", str(error))
        gate = self.hosted_gate(task)
        if gate:
            self.status.update(phase=f"idle: {gate}", current=None)
            # Unattended: re-read the catalog hourly while waiting, so a dataset that returns is picked up on its own.
            with self.state.tx() as db:
                db.execute("UPDATE job SET due_at = MIN(due_at, ?) WHERE kind = 'catalog' AND state = 'pending'", (time.time() + CATALOG_RETRY_S,))
            return
        self.state.ensure_job("read", TASK, f"{TASK}:read", {})
        queue = int((self.state.one("SELECT COUNT(*) AS n FROM document WHERE state = 'queued'") or {"n": 0})["n"])
        if queue < self.config.limits.max_queue:
            job = self.state.claim(self.owner, ("read",))
            if job is not None:
                self.status.update(phase="reading source", current=task.input["path"])
                try:
                    delay = self.read_page(task)
                    self.state.finish(job["id"], self.owner, next_due=time.time() + delay)
                except RateLimited as error:
                    self._wait_for_allowance(job, error)
                except FetchRefused as error:
                    self.state.fail(job["id"], self.owner, str(error), refused=True)
                    self.state.event("error", "refused", str(error))
                except (FetchFailed, policy_mod.PolicyRefused, ValueError, OSError) as error:
                    retry = getattr(error, "retry_after", None)
                    outcome = self.state.fail(job["id"], self.owner, str(error), retry_after=retry)
                    self.status["last_error"] = str(error)
                    self.state.event("warn", "read_failed", {"error": str(error), "outcome": outcome})
        try:
            if self.model_identity is None:
                self.verify_model()
            self.extract_one()
        except LocalModelError as error:
            self.model_identity = None
            self.status.update(phase="waiting for the local model", last_error=str(error))
            self.state.event("warn", "model_unavailable", str(error))
            self.stop.wait(min(300, backoff_seconds(int(self.state.get("model_failures", "0") or 0), base=10)))
            self.state.set("model_failures", str(int(self.state.get("model_failures", "0") or 0) + 1))
            return
        self.state.set("model_failures", "0")
        # Publication read-back: a recurring job, due every five minutes, one notice per run.
        self.state.ensure_job("verify", TASK, f"{TASK}:verify", {})
        job = self.state.claim(self.owner, ("verify",))
        if job is not None:
            try:
                self.verify_queryable(task)
                self.state.finish(job["id"], self.owner, next_due=time.time() + 300)
            except RateLimited as error:
                self._wait_for_allowance(job, error)
            except (FetchFailed, FetchRefused, policy_mod.PolicyRefused, ValueError) as error:
                self.state.fail(job["id"], self.owner, str(error), retry_after=getattr(error, "retry_after", None))
                self.state.event("warn", "verify_failed", str(error))

    def _wait_for_allowance(self, job, error: RateLimited) -> None:
        """A used-up allowance is a pause, not a failure: release the job without charging an attempt."""
        delay = max(float(error.retry_after or 0), 60.0) if error.retry_after is not None else 3600.0
        self.state.release(job["id"], self.owner, delay)
        self.status.update(phase=f"waiting for the request allowance ({error})", current=None)
        self.state.event("info", "allowance_wait", {"job": job["kind"], "seconds": round(delay)})

    def run(self) -> None:
        self.state.event("info", "started", {"collector": COLLECTOR_ID, "pid": os.getpid()})
        # Always start from what Data Foundry hosts now, not from a catalog read before a restart.
        with self.state.tx() as db:
            db.execute("UPDATE job SET due_at = ? WHERE kind = 'catalog' AND state = 'pending'", (time.time(),))
        while not self.stop.is_set():
            before = self.status.get("phase")
            self.tick()
            idle = self.status.get("phase") in ("idle", before) and not self.state.one("SELECT 1 FROM document WHERE state = 'queued' LIMIT 1")
            self.stop.wait(5 if idle else 0.2)
        self.state.event("info", "stopped", {"pid": os.getpid()})


class Uploader:
    """Sends outbox rows to the intake. The only holder of the ingestion credential."""

    def __init__(self, config: Config, state: State, policy: policy_mod.Policy | None = None, opener=None):
        self.config = config
        self.state = state
        self.policy = policy or policy_mod.load()
        self.stop = threading.Event()
        self._opener = opener or urllib.request.build_opener(NoRedirect())

    def _token(self) -> str | None:
        return self.config.secret("ingest-token")

    def send_one(self) -> bool:
        rows = self.state.outbox_due(1)
        if not rows:
            return False
        row = rows[0]
        payload = json.loads(row["payload"])
        task = payload.get("task")
        try:
            tp = self.policy.task(task, kill_switch=self.state.get(f"kill:{task}") == "1")
        except policy_mod.PolicyRefused as refusal:
            self._defer(row, str(refusal), 3600)
            return False
        token = self._token()
        if not token:
            self._defer(row, "no ingestion credential in secrets/ingest-token", 600)
            return False
        origin = self.config.api_origin.rstrip("/")
        host = urlsplit(origin).hostname or ""
        if not (host in tp.allowed_hosts or (origin.startswith("http://") and host in ("127.0.0.1", "localhost"))):
            self._defer(row, f"intake host {host} is not allowed by the policy", 3600)
            return False
        body = json.dumps({k: v for k, v in payload.items() if k != "collector"}).encode()
        request = urllib.request.Request(origin + tp.intake_path, data=body, method="POST", headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "Idempotency-Key": row["idempotency_key"],
            "User-Agent": self.config.user_agent,
        })
        try:
            with self._opener.open(request, timeout=60) as response:
                answer = json.loads(response.read().decode())
        except urllib.error.HTTPError as error:
            detail = error.read().decode(errors="replace")[:500]
            if error.code in (401, 403):
                self.state.set("uploader_paused", f"intake refused the credential ({error.code})")
                self.state.set("uploader_paused_at", str(time.time()))
                self._defer(row, f"{error.code}: {detail}", 3600)
            elif error.code in (400, 409, 413):
                self._dead(row, f"{error.code}: {detail}")
            elif 300 <= error.code < 400:
                # Never followed (the credential stays with the checked URL); an intake that redirects is misconfigured.
                self._defer(row, f"{error.code} redirect refused: {detail}", 3600)
            else:
                retry = error.headers.get("retry-after") if error.headers else None
                self._defer(row, f"{error.code}: {detail}", max(float(retry) if retry and retry.isdigit() else 0, backoff_seconds(row["attempts"])))
            return False
        except (urllib.error.URLError, TimeoutError, ConnectionError, json.JSONDecodeError) as error:
            self._defer(row, str(error), backoff_seconds(row["attempts"]))
            return False
        self._ack(row, answer)
        return True

    def _defer(self, row, error: str, delay: float) -> None:
        with self.state.tx() as db:
            db.execute("UPDATE outbox SET attempts = attempts + 1, next_attempt_at = ?, last_error = ? WHERE id = ?", (time.time() + delay, error[:1000], row["id"]))
        self.state.event("warn", "upload_deferred", {"id": row["id"], "error": error[:300]})

    def _dead(self, row, error: str) -> None:
        with self.state.tx() as db:
            db.execute("UPDATE outbox SET state = 'dead', attempts = attempts + 1, last_error = ? WHERE id = ?", (error[:1000], row["id"]))
        self.state.event("error", "upload_dead", {"id": row["id"], "error": error[:300]})

    def _ack(self, row, answer: dict) -> None:
        """Record the server's answer, then mark the row acknowledged, in one transaction."""
        with self.state.tx() as db:
            for notice in answer.get("results", []):
                for candidate in notice.get("candidates", []):
                    db.execute(
                        "UPDATE candidate SET server_status = ?, server_reason = ?, updated_at = ? WHERE recall_id = ? AND field = ? AND value = ? AND extractor_version = ?",
                        (candidate.get("status"), candidate.get("reason"), time.time(), notice.get("recall_id"), candidate.get("field"), candidate.get("value"), answer.get("extractor_version")),
                    )
            # Acknowledged: the server holds the result (and answers a resend from its stored response), so the
            # local copy is deleted now; only the count is kept.
            db.execute("DELETE FROM outbox WHERE id = ?", (row["id"],))
            self.state.bump(db, "outbox:acked")
        self.state.event("info", "uploaded", {"id": row["id"], "accepted": answer.get("accepted"), "replayed": answer.get("replayed"), "rejected": answer.get("rejected"), "replay": bool(answer.get("idempotent_replay"))})

    def run(self) -> None:
        while not self.stop.is_set():
            if self.state.get("uploader_paused") and time.time() - float(self.state.get("uploader_paused_at", "0") or 0) > CREDENTIAL_RETRY_S:
                self.state.set("uploader_paused", "")  # retry hourly: a fixed or re-issued credential resumes unattended
            if self.state.get("uploader_paused") or self.state.paused():
                self.stop.wait(10)
                continue
            sent = self.send_one()
            self.stop.wait(0.5 if sent else 5)


def uploader_main(config: Config, stop_file: Path) -> None:
    uploader = Uploader(config, State(config.db_path))

    def watch() -> None:
        while not stop_file.exists():
            time.sleep(1)
        uploader.stop.set()

    threading.Thread(target=watch, daemon=True).start()
    uploader.run()
    sys.exit(0)
