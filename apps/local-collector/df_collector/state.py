"""Durable local state: jobs, leases, documents, candidates, outbox, counters.

SQLite in WAL mode is a checkpoint and outbox store only. It is never served to
customers and is not a second canonical database: the canonical record is the
recalls Worker's D1/R2, and this file only remembers what the collector has
done and what it still owes the server.

Crash safety:

- a job is claimed with a lease (owner + expiry); a crashed worker's lease
  expires and the job is reclaimed; attempts are counted, retried with
  exponential backoff and jitter, and dead-lettered at the ceiling;
- extraction results and their outbox row are written in one transaction;
- an outbox row is deleted only after the server's 2xx response has been
  recorded (acknowledged), and every upload carries a stable Idempotency-Key,
  so a crash between send and record resends the same request, which the
  server answers from its stored response.

Retention (nothing is kept locally once Data Foundry holds it):

- a notice's text is on disk only while it waits for the model; the canonical
  copy is the R2 evidence the server re-reads, so the local file is deleted as
  soon as the notice leaves the queue (and never written for skipped notices);
- an acknowledged upload is deleted at once;
- candidate values are deleted once their outcome is final (rejected, a
  duplicate, or verified queryable; unverified ones after 7 days), and only
  their counts are kept;
- what remains is identifiers and hashes (which notices were done), counters,
  and a bounded event and retrieval log.
"""

from __future__ import annotations

import json
import random
import sqlite3
import threading
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator

SCHEMA = """
PRAGMA journal_mode = WAL;
PRAGMA synchronous = FULL;
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS setting (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS job (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  task TEXT NOT NULL,
  dedupe_key TEXT NOT NULL,
  params TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('pending', 'leased', 'done', 'dead', 'refused')),
  due_at REAL NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 8,
  lease_owner TEXT,
  lease_expires_at REAL,
  last_error TEXT,
  created_at REAL NOT NULL,
  updated_at REAL NOT NULL,
  UNIQUE (kind, dedupe_key)
);
CREATE INDEX IF NOT EXISTS job_due_idx ON job (state, due_at);
CREATE TABLE IF NOT EXISTS cursor (task TEXT NOT NULL, name TEXT NOT NULL, value TEXT NOT NULL, updated_at REAL NOT NULL, PRIMARY KEY (task, name));
CREATE TABLE IF NOT EXISTS document (
  recall_id TEXT NOT NULL,
  raw_sha256 TEXT NOT NULL,
  task TEXT NOT NULL,
  extractor_version TEXT NOT NULL,
  evidence_path TEXT NOT NULL,
  evidence_ref TEXT,
  retrieved_at REAL NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('queued', 'extracted', 'skipped', 'quarantined', 'failed')),
  detail TEXT,
  latency_ms REAL,
  attempts INTEGER NOT NULL DEFAULT 0,
  server_errors INTEGER NOT NULL DEFAULT 0,
  last_server_error_at REAL,
  updated_at REAL NOT NULL,
  PRIMARY KEY (recall_id, raw_sha256, extractor_version)
);
CREATE INDEX IF NOT EXISTS document_state_idx ON document (state);
CREATE TABLE IF NOT EXISTS retrieval (id INTEGER PRIMARY KEY AUTOINCREMENT, url TEXT NOT NULL, status INTEGER, bytes INTEGER, sha256 TEXT, retrieved_at REAL NOT NULL, note TEXT);
CREATE TABLE IF NOT EXISTS candidate (
  recall_id TEXT NOT NULL,
  raw_sha256 TEXT NOT NULL,
  extractor_version TEXT NOT NULL,
  value TEXT NOT NULL,
  field TEXT NOT NULL,
  label TEXT NOT NULL,
  local_decision TEXT NOT NULL,
  local_reason TEXT,
  span_start INTEGER,
  span_end INTEGER,
  server_status TEXT,
  server_reason TEXT,
  queryable INTEGER NOT NULL DEFAULT 0,
  updated_at REAL NOT NULL,
  -- When the read-back last looked for it. Kept apart from updated_at, which the retention sweep ages from.
  checked_at REAL,
  PRIMARY KEY (recall_id, raw_sha256, extractor_version, field, value)
);
CREATE TABLE IF NOT EXISTS outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  idempotency_key TEXT NOT NULL UNIQUE,
  payload TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('pending', 'acked', 'dead')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at REAL NOT NULL,
  last_error TEXT,
  response TEXT,
  created_at REAL NOT NULL,
  acked_at REAL
);
-- Running totals for rows the retention sweep has deleted, so counters survive deletion.
CREATE TABLE IF NOT EXISTS counter (name TEXT PRIMARY KEY, value INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS event (id INTEGER PRIMARY KEY AUTOINCREMENT, at REAL NOT NULL, level TEXT NOT NULL, kind TEXT NOT NULL, detail TEXT NOT NULL);
"""

LEASE_SECONDS = 15 * 60


def backoff_seconds(attempts: int, base: float = 30.0, cap: float = 6 * 3600.0, rng: random.Random | None = None) -> float:
    """Exponential backoff with full jitter: uniform in [base/2, min(cap, base * 2**attempts)]."""
    ceiling = min(cap, base * (2 ** max(0, attempts)))
    return (rng or random).uniform(min(base / 2, ceiling), ceiling)


class State:
    def __init__(self, path: Path, clock=time.time):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.path = path
        self.clock = clock
        self._lock = threading.RLock()
        self.db = sqlite3.connect(str(path), timeout=30, isolation_level=None, check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.db.executescript(SCHEMA)
        # Columns added after a state file may have been created by an earlier version.
        present = {row[1] for row in self.db.execute("PRAGMA table_info(document)")}
        for column, ddl in (("attempts", "INTEGER NOT NULL DEFAULT 0"), ("server_errors", "INTEGER NOT NULL DEFAULT 0"), ("last_server_error_at", "REAL")):
            if column not in present:
                self.db.execute(f"ALTER TABLE document ADD COLUMN {column} {ddl}")
        if "checked_at" not in {row[1] for row in self.db.execute("PRAGMA table_info(candidate)")}:
            self.db.execute("ALTER TABLE candidate ADD COLUMN checked_at REAL")

    @contextmanager
    def tx(self) -> Iterator[sqlite3.Connection]:
        with self._lock:
            self.db.execute("BEGIN IMMEDIATE")
            try:
                yield self.db
                self.db.execute("COMMIT")
            except BaseException:
                self.db.execute("ROLLBACK")
                raise

    def q(self, sql: str, *params: Any) -> list[sqlite3.Row]:
        with self._lock:
            return list(self.db.execute(sql, params))

    def one(self, sql: str, *params: Any) -> sqlite3.Row | None:
        rows = self.q(sql, *params)
        return rows[0] if rows else None

    # -- settings ------------------------------------------------------------------------------------------------

    def get(self, key: str, default: str | None = None) -> str | None:
        row = self.one("SELECT value FROM setting WHERE key = ?", key)
        return row["value"] if row else default

    def set(self, key: str, value: str) -> None:
        with self.tx() as db:
            db.execute("INSERT INTO setting (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value", (key, value))

    def paused(self) -> str | None:
        """The pause reason, or None when running."""
        return self.get("paused") or None

    def event(self, level: str, kind: str, detail: dict | str) -> None:
        with self.tx() as db:
            db.execute("INSERT INTO event (at, level, kind, detail) VALUES (?, ?, ?, ?)", (self.clock(), level, kind, json.dumps(detail) if not isinstance(detail, str) else detail))
            db.execute("DELETE FROM event WHERE id <= (SELECT MAX(id) - 2000 FROM event)")

    # -- jobs ----------------------------------------------------------------------------------------------------

    def ensure_job(self, kind: str, task: str, dedupe_key: str, params: dict, due_at: float | None = None, max_attempts: int = 8) -> None:
        now = self.clock()
        with self.tx() as db:
            db.execute(
                "INSERT INTO job (kind, task, dedupe_key, params, state, due_at, max_attempts, created_at, updated_at) VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?) ON CONFLICT (kind, dedupe_key) DO NOTHING",
                (kind, task, dedupe_key, json.dumps(params), now if due_at is None else due_at, max_attempts, now, now),
            )

    def claim(self, owner: str, kinds: tuple[str, ...]) -> sqlite3.Row | None:
        """Lease the most overdue due job of these kinds; an expired lease is reclaimed."""
        now = self.clock()
        marks = ",".join("?" * len(kinds))
        with self.tx() as db:
            row = db.execute(
                f"""SELECT * FROM job WHERE kind IN ({marks}) AND ((state = 'pending' AND due_at <= ?) OR (state = 'leased' AND lease_expires_at < ?))
                    ORDER BY due_at LIMIT 1""",
                (*kinds, now, now),
            ).fetchone()
            if row is None:
                return None
            db.execute("UPDATE job SET state = 'leased', lease_owner = ?, lease_expires_at = ?, attempts = attempts + 1, updated_at = ? WHERE id = ?", (owner, now + LEASE_SECONDS, now, row["id"]))
            return db.execute("SELECT * FROM job WHERE id = ?", (row["id"],)).fetchone()

    def _owned(self, db: sqlite3.Connection, job_id: int, owner: str) -> bool:
        row = db.execute("SELECT lease_owner, state FROM job WHERE id = ?", (job_id,)).fetchone()
        return bool(row and row["state"] == "leased" and row["lease_owner"] == owner)

    def finish(self, job_id: int, owner: str, next_due: float | None = None) -> None:
        """Done, or (with next_due) rescheduled as a recurring job with its attempts reset."""
        now = self.clock()
        with self.tx() as db:
            if not self._owned(db, job_id, owner):
                return
            if next_due is None:
                db.execute("UPDATE job SET state = 'done', lease_owner = NULL, lease_expires_at = NULL, last_error = NULL, updated_at = ? WHERE id = ?", (now, job_id))
            else:
                db.execute("UPDATE job SET state = 'pending', due_at = ?, attempts = 0, lease_owner = NULL, lease_expires_at = NULL, last_error = NULL, updated_at = ? WHERE id = ?", (next_due, now, job_id))

    def fail(self, job_id: int, owner: str, error: str, retry_after: float | None = None, refused: bool = False, recurring: bool = False) -> str:
        """Record a failure: retry with backoff, dead-letter at the ceiling, or refuse (policy) without retry.

        A recurring job (the catalog, source reading, read-back) is never dead-lettered by transient failures: it
        backs off up to the ceiling and keeps retrying, so collection resumes by itself when the network or service
        does. Only a policy refusal stops it."""
        now = self.clock()
        with self.tx() as db:
            if not self._owned(db, job_id, owner):
                return "lost_lease"
            row = db.execute("SELECT attempts, max_attempts FROM job WHERE id = ?", (job_id,)).fetchone()
            if refused:
                state, due = "refused", now
            elif row["attempts"] >= row["max_attempts"] and not recurring:
                state, due = "dead", now
            else:
                state, due = "pending", now + max(retry_after or 0.0, backoff_seconds(min(row["attempts"], row["max_attempts"])))
            db.execute("UPDATE job SET state = ?, due_at = ?, last_error = ?, lease_owner = NULL, lease_expires_at = NULL, updated_at = ? WHERE id = ?", (state, due, error[:1000], now, job_id))
            return state

    def release(self, job_id: int, owner: str, delay: float) -> None:
        """Give a job back without counting an attempt (e.g. a cap is reached or the collector is pausing)."""
        now = self.clock()
        with self.tx() as db:
            if self._owned(db, job_id, owner):
                db.execute("UPDATE job SET state = 'pending', due_at = ?, attempts = MAX(0, attempts - 1), lease_owner = NULL, lease_expires_at = NULL, updated_at = ? WHERE id = ?", (now + delay, now, job_id))

    def revive_refused(self) -> int:
        """Makes every refused job due now (after a credential is replaced); policy is re-checked when it runs."""
        with self.tx() as db:
            return db.execute("UPDATE job SET state = 'pending', attempts = 0, due_at = ?, last_error = NULL WHERE state = 'refused'", (self.clock(),)).rowcount

    def run_now(self, job_id: int) -> bool:
        with self.tx() as db:
            # An operator's "run now" also revives a dead-lettered or refused job; policy is re-checked when it runs.
            cursor = db.execute("UPDATE job SET due_at = ?, state = 'pending', attempts = CASE WHEN state IN ('dead', 'refused') THEN 0 ELSE attempts END WHERE id = ? AND state IN ('pending', 'dead', 'refused')", (self.clock(), job_id))
            return cursor.rowcount > 0

    # -- cursors -------------------------------------------------------------------------------------------------

    def cursor(self, task: str, name: str) -> str | None:
        row = self.one("SELECT value FROM cursor WHERE task = ? AND name = ?", task, name)
        return row["value"] if row else None

    def set_cursor(self, db: sqlite3.Connection, task: str, name: str, value: str) -> None:
        db.execute("INSERT INTO cursor (task, name, value, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT (task, name) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at", (task, name, value, self.clock()))

    # -- outbox --------------------------------------------------------------------------------------------------

    def outbox_add(self, db: sqlite3.Connection, idempotency_key: str, payload: dict) -> None:
        db.execute("INSERT INTO outbox (idempotency_key, payload, state, next_attempt_at, created_at) VALUES (?, ?, 'pending', ?, ?) ON CONFLICT (idempotency_key) DO NOTHING", (idempotency_key, json.dumps(payload), self.clock(), self.clock()))

    def outbox_due(self, limit: int = 1) -> list[sqlite3.Row]:
        return self.q("SELECT * FROM outbox WHERE state = 'pending' AND next_attempt_at <= ? ORDER BY id LIMIT ?", self.clock(), limit)

    def outbox_pending(self) -> int:
        row = self.one("SELECT COUNT(*) AS n FROM outbox WHERE state = 'pending'")
        return int(row["n"]) if row else 0

    # -- counters and retention -----------------------------------------------------------------------------------

    def bump(self, db: sqlite3.Connection, name: str, by: int = 1) -> None:
        if by:
            db.execute("INSERT INTO counter (name, value) VALUES (?, ?) ON CONFLICT (name) DO UPDATE SET value = value + excluded.value", (name, by))

    def sweep(self, evidence_dir: Path, unverified_days: float = 7.0) -> dict[str, int]:
        """Delete local data Data Foundry no longer needs from this computer; keep only counts. Safe to run anytime."""
        now = self.clock()
        removed = {"evidence_files": 0, "candidates": 0, "outbox_dead": 0}
        with self.tx() as db:
            final = """local_decision = 'rejected'
                OR server_status IN ('duplicate_of_agency_fact', 'rejected')
                OR (server_status IN ('accepted', 'replayed') AND (queryable = 1 OR updated_at < ?))
                OR (server_status IS NULL AND updated_at < ? AND NOT EXISTS (
                    SELECT 1 FROM outbox o, json_each(o.payload, '$.notices') n
                    WHERE o.state != 'dead' AND json_extract(n.value, '$.recall_id') = candidate.recall_id
                      AND json_extract(n.value, '$.raw_sha256') = candidate.raw_sha256
                      AND COALESCE(json_extract(o.payload, '$.build'), candidate.extractor_version) = candidate.extractor_version))"""
            cutoff = now - unverified_days * 86400
            for row in db.execute(f"SELECT local_decision, server_status, queryable FROM candidate WHERE {final}", (cutoff, cutoff)).fetchall():
                self.bump(db, f"candidates_local:{row['local_decision']}")
                if row["local_decision"] == "accepted":
                    self.bump(db, f"candidates_server:{row['server_status'] or 'not_submitted'}")
                self.bump(db, "queryable", int(row["queryable"] or 0))
            removed["candidates"] = db.execute(f"DELETE FROM candidate WHERE {final}", (cutoff, cutoff)).rowcount
            removed["outbox_dead"] = db.execute("DELETE FROM outbox WHERE state = 'dead' AND created_at < ?", (now - unverified_days * 86400,)).rowcount
            # Rows acknowledged by an older version that kept them.
            self.bump(db, "outbox:acked", db.execute("DELETE FROM outbox WHERE state = 'acked'").rowcount)
            db.execute("DELETE FROM retrieval WHERE id <= (SELECT MAX(id) - 1000 FROM retrieval)")
            keep = {row["evidence_path"] for row in db.execute("SELECT evidence_path FROM document WHERE state = 'queued' AND evidence_path <> ''")}
            db.execute("UPDATE document SET evidence_path = '' WHERE state <> 'queued' AND evidence_path <> ''")
        # Orphans too: files left by a crash between extraction and deletion.
        if evidence_dir.exists():
            for path in evidence_dir.rglob("*"):
                if path.is_file() and str(path) not in keep:
                    try:
                        path.unlink()
                        removed["evidence_files"] += 1
                    except OSError:
                        pass
        return removed

    def counts(self) -> dict[str, Any]:
        def group(sql: str) -> dict[str, int]:
            return {row[0]: row[1] for row in self.q(sql)}

        swept = group("SELECT name, value FROM counter")

        def merged(live: dict[str, int], prefix: str) -> dict[str, int]:
            out = dict(live)
            for name, value in swept.items():
                if name.startswith(prefix):
                    key = name[len(prefix):]
                    out[key] = out.get(key, 0) + value
            return out

        return {
            "jobs": group("SELECT state, COUNT(*) FROM job GROUP BY state"),
            "documents": group("SELECT state, COUNT(*) FROM document GROUP BY state"),
            "candidates_local": merged(group("SELECT local_decision, COUNT(*) FROM candidate GROUP BY local_decision"), "candidates_local:"),
            "candidates_server": merged(group("SELECT COALESCE(server_status, 'not_submitted'), COUNT(*) FROM candidate WHERE local_decision = 'accepted' GROUP BY 1"), "candidates_server:"),
            "queryable": int((self.one("SELECT COUNT(*) AS n FROM candidate WHERE queryable = 1") or {"n": 0})["n"]) + swept.get("queryable", 0),
            "outbox": merged(group("SELECT state, COUNT(*) FROM outbox GROUP BY state"), "outbox:"),
        }
