"""A small loopback-only dashboard.

Bound to 127.0.0.1 only (a non-loopback bind address is refused). Reads are
plain GETs; every state-changing action is a POST that must carry this
process's random CSRF token, come from the dashboard's own origin (Origin or
Referer, when the browser sends one), and name the dashboard in its Host header
(which defeats DNS rebinding). No action can grant permission: pause, resume,
run-now, kill switches and lower-or-raise resource caps only.
"""

from __future__ import annotations

import html
import ipaddress
import json
import os
import secrets
import shutil
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit

from . import COLLECTOR_ID
from .config import Config
from .runtime import TASK, Collector, dir_size_mb
from .state import State

EDITABLE_LIMITS = {
    "max_disk_mb": (256, 1_000_000),
    "min_free_disk_mb": (512, 1_000_000),
    "max_queue": (10, 100_000),
    "max_outbox": (10, 100_000),
    "max_api_requests_per_day": (0, 5_000),
    "llm_threads": (1, 256),
}


def rss_mb() -> float | None:
    try:
        if os.name == "nt":
            import ctypes
            from ctypes import wintypes

            class Counters(ctypes.Structure):
                _fields_ = [("cb", wintypes.DWORD), ("PageFaultCount", wintypes.DWORD), ("PeakWorkingSetSize", ctypes.c_size_t), ("WorkingSetSize", ctypes.c_size_t),
                            ("QuotaPeakPagedPoolUsage", ctypes.c_size_t), ("QuotaPagedPoolUsage", ctypes.c_size_t), ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t),
                            ("QuotaNonPagedPoolUsage", ctypes.c_size_t), ("PagefileUsage", ctypes.c_size_t), ("PeakPagefileUsage", ctypes.c_size_t)]

            counters = Counters()
            counters.cb = ctypes.sizeof(Counters)
            ctypes.windll.psapi.GetProcessMemoryInfo(ctypes.windll.kernel32.GetCurrentProcess(), ctypes.byref(counters), counters.cb)
            return counters.WorkingSetSize / 1048576
        import resource

        return resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / (1024 if sys.platform != "darwin" else 1048576)
    except Exception:  # noqa: BLE001 - metrics are best-effort
        return None


def snapshot(config: Config, state: State, collector: Collector | None) -> dict:
    counts = state.counts()
    latency = state.one("SELECT AVG(latency_ms) AS avg, COUNT(*) AS n FROM document WHERE latency_ms IS NOT NULL AND updated_at > ?", time.time() - 86400)
    last_extract = state.one("SELECT MAX(updated_at) AS at FROM document WHERE state IN ('extracted', 'quarantined')")
    last_upload = state.one("SELECT MAX(acked_at) AS at FROM outbox WHERE state = 'acked'")
    last_read = state.one("SELECT MAX(retrieved_at) AS at FROM retrieval")
    loaded = []
    if collector and collector.client:
        try:
            loaded = [{"name": m.get("name"), "size_mb": round(m.get("size", 0) / 1048576), "vram_mb": round(m.get("size_vram", 0) / 1048576)} for m in collector.client.loaded()]
        except Exception:  # noqa: BLE001
            loaded = []
    jobs = [dict(row) for row in state.q("SELECT id, kind, state, due_at, attempts, last_error FROM job ORDER BY id")]
    events = [dict(row) for row in state.q("SELECT at, level, kind, detail FROM event ORDER BY id DESC LIMIT 25")]
    return {
        "collector": COLLECTOR_ID,
        "task": TASK,
        "status": collector.status if collector else None,
        "paused": state.paused(),
        "uploader_paused": state.get("uploader_paused"),
        "kill_switch": state.get(f"kill:{TASK}") == "1",
        "cursor": {name: state.cursor(TASK, name) for name in ("backfill_done", "backfill_cursor", "watermark", "incremental_cursor")},
        "counts": counts,
        "last": {"read": last_read["at"] if last_read else None, "extraction": last_extract["at"] if last_extract else None, "upload": last_upload["at"] if last_upload else None},
        "limits": config.limits.__dict__,
        "api_requests_today": collector._requests_today() if collector else None,
        "resources": {
            "collector_rss_mb": rss_mb(),
            "ollama_loaded": loaded,
            "evidence_mb": round(dir_size_mb(config.evidence_dir), 1),
            "state_db_mb": round(config.db_path.stat().st_size / 1048576, 1) if config.db_path.exists() else 0,
            "free_disk_mb": round(shutil.disk_usage(config.root).free / 1048576),
            "load_average": os.getloadavg() if hasattr(os, "getloadavg") else None,
            "extraction_latency_ms_24h": round(latency["avg"]) if latency and latency["avg"] else None,
            "extractions_24h": latency["n"] if latency else 0,
        },
        "catalog": json.loads(state.get("catalog") or "null"),
        "jobs": jobs,
        "events": events,
    }


def _fmt_time(value: float | None) -> str:
    return time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(value)) if value else "never"


def catalog_html(snapshot: dict | None) -> str:
    e = html.escape
    if not snapshot:
        return "<p>Not read yet.</p>"
    rows = []
    for dataset in snapshot["plan"]["datasets"]:
        fresh = snapshot.get("freshness", {}).get(dataset["api_key"], {})
        rows.append(f"<tr><th colspan=4>{e(str(dataset['name']))} <code>{e(dataset['api_key'])}</code> → registry <code>{e(str(dataset['registry']))}</code> · last sync {e(json.dumps(fresh.get('last_successful_sync')))}</th></tr>")
        for kind in ("members", "expansion"):
            for m in dataset[kind]:
                why = ", ".join(m.get("tasks") or []) or "; ".join(m.get("blocked_because") or []) or "rights and stage permit it; adapter to be built by a reviewed change"
                rows.append(f"<tr><td>{'member' if kind == 'members' else 'expansion'}</td><td><code>{e(m['source'])}</code></td><td>{e(str(m['acquisition']))}</td><td>{e(why)}</td></tr>")
    return f"<p class=k>Read {_fmt_time(snapshot['fetched_at'])} · capture: {e(json.dumps(snapshot['plan']['summary']))}</p><table>{''.join(rows)}</table>"


def render(snap: dict, csrf: str) -> str:
    e = html.escape

    def form(action: str, label: str, extra: str = "") -> str:
        return f'<form method="post" action="/action/{action}"><input type="hidden" name="csrf" value="{e(csrf)}">{extra}<button>{e(label)}</button></form>'

    def job_field(job_id: int) -> str:
        return f'<input type="hidden" name="job" value="{int(job_id)}">'

    c = snap["counts"]
    rows = "".join(
        f"<tr><td>{j['id']}</td><td>{e(j['kind'])}</td><td>{e(j['state'])}</td><td>{_fmt_time(j['due_at'])}</td><td>{j['attempts']}</td><td>{e(j['last_error'] or '')}</td>"
        f"<td>{form('run-now', 'Run now', job_field(j['id'])) if j['state'] in ('pending', 'dead', 'refused') else ''}</td></tr>"
        for j in snap["jobs"]
    )
    events = "".join(f"<tr><td>{_fmt_time(ev['at'])}</td><td>{e(ev['level'])}</td><td>{e(ev['kind'])}</td><td><code>{e(ev['detail'][:200])}</code></td></tr>" for ev in snap["events"])
    limits = "".join(
        f'<label>{e(k)} <input name="{e(k)}" value="{e(str(v if v is not None else ""))}" size="8"></label> ' for k, v in snap["limits"].items() if k in EDITABLE_LIMITS
    )
    status = snap["status"] or {}
    state_line = "PAUSED: " + snap["paused"] if snap["paused"] else status.get("phase", "?")
    return f"""<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="refresh" content="10">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Data Foundry Local Collector</title>
<style>body{{font:14px system-ui,sans-serif;margin:16px;max-width:1100px;color:#1c2024;background:#fbfbfa}}table{{border-collapse:collapse;width:100%;margin:8px 0}}
td,th{{border-bottom:1px solid #ddd;padding:4px 6px;text-align:left;vertical-align:top}}form{{display:inline}}button{{margin:2px}}.k{{color:#666}}
.grid{{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:8px}}.card{{background:#fff;border:1px solid #ddd;border-radius:6px;padding:8px}}
code{{white-space:pre-wrap;word-break:break-all}}</style></head><body>
<h1>Data Foundry Local Collector</h1>
<p><b>{e(state_line)}</b> · task <code>{e(snap['task'])}</code> · {e(snap['collector'])} · current: {e(str(status.get('current') or '-'))}</p>
<p>{form('pause', 'Pause')} {form('resume', 'Resume')} {form('kill', 'Stop this source (kill switch)') if not snap['kill_switch'] else form('unkill', 'Re-enable this source')}
{('<b>Uploader paused: ' + e(snap['uploader_paused']) + '</b> ' + form('resume-uploader', 'Resume uploads')) if snap['uploader_paused'] else ''}</p>
<p class="k">Model: {e(json.dumps(status.get('model')) if status.get('model') else 'not verified yet')} · last error: {e(str(status.get('last_error') or '-'))}</p>
<div class="grid">
<div class="card"><b>Last activity</b><br>read {_fmt_time(snap['last']['read'])}<br>extraction {_fmt_time(snap['last']['extraction'])}<br>upload {_fmt_time(snap['last']['upload'])}</div>
<div class="card"><b>Source cursor</b><br>backfill done: {e(str(snap['cursor']['backfill_done'] or 'no'))}<br>watermark: {e(str(snap['cursor']['watermark'] or '-'))}<br>API requests today: {snap['api_requests_today']}</div>
<div class="card"><b>Notices</b><br>{e(json.dumps(c['documents']))}</div>
<div class="card"><b>Candidates</b><br>local: {e(json.dumps(c['candidates_local']))}<br>server: {e(json.dumps(c['candidates_server']))}<br>publicly queryable: {c['queryable']}</div>
<div class="card"><b>Outbox</b><br>{e(json.dumps(c['outbox']))}</div>
<div class="card"><b>Resources</b><br>{e(json.dumps(snap['resources']))}</div>
</div>
<h2>Hosted datasets and capture plan</h2>{catalog_html(snap.get("catalog"))}
<h2>Limits</h2><form method="post" action="/action/limits"><input type="hidden" name="csrf" value="{e(csrf)}">{limits}<button>Save limits</button></form>
<h2>Jobs</h2><table><tr><th>id</th><th>kind</th><th>state</th><th>due</th><th>attempts</th><th>last error</th><th></th></tr>{rows}</table>
<h2>Recent events</h2><table>{events}</table>
<p class="k">Collection stops while this computer sleeps, shuts down or is offline; the hosted Data Foundry API keeps serving independently.</p>
</body></html>"""


class Dashboard:
    def __init__(self, config: Config, state: State, collector: Collector | None):
        host = config.dashboard_host
        if not ipaddress.ip_address(host).is_loopback:
            raise ValueError(f"the dashboard binds to loopback only, not {host}")
        self.config = config
        self.state = state
        self.collector = collector
        self.csrf = secrets.token_urlsafe(32)
        self.allowed_hosts = {f"127.0.0.1:{config.dashboard_port}", f"localhost:{config.dashboard_port}"}
        self.allowed_origins = {f"http://{h}" for h in self.allowed_hosts}
        dashboard = self

        class Handler(BaseHTTPRequestHandler):
            server_version = "df-collector"

            def log_message(self, *args) -> None:  # quiet
                return

            def _send(self, status: int, body: str, content_type: str = "text/html; charset=utf-8") -> None:
                data = body.encode()
                self.send_response(status)
                self.send_header("Content-Type", content_type)
                self.send_header("Content-Length", str(len(data)))
                self.send_header("Cache-Control", "no-store")
                self.send_header("X-Frame-Options", "DENY")
                self.send_header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'")
                self.end_headers()
                self.wfile.write(data)

            def _host_ok(self) -> bool:
                return self.headers.get("Host", "") in dashboard.allowed_hosts

            def do_GET(self) -> None:
                if not self._host_ok():
                    return self._send(421, "wrong host")
                path = urlsplit(self.path).path
                snap = snapshot(dashboard.config, dashboard.state, dashboard.collector)
                if path == "/api/status":
                    return self._send(200, json.dumps(snap, default=str), "application/json")
                if path == "/":
                    return self._send(200, render(snap, dashboard.csrf))
                return self._send(404, "not found")

            def do_POST(self) -> None:
                if not self._host_ok():
                    return self._send(421, "wrong host")
                origin = self.headers.get("Origin") or ""
                referer = self.headers.get("Referer") or ""
                if origin and origin not in dashboard.allowed_origins:
                    return self._send(403, "cross-origin request refused")
                if not origin and referer and f"{urlsplit(referer).scheme}://{urlsplit(referer).netloc}" not in dashboard.allowed_origins:
                    return self._send(403, "cross-origin request refused")
                length = int(self.headers.get("Content-Length") or 0)
                if length > 8192 or (self.headers.get("Content-Type") or "").split(";")[0] != "application/x-www-form-urlencoded":
                    return self._send(400, "bad request")
                form = {k: v[0] for k, v in parse_qs(self.rfile.read(length).decode()).items()}
                if not secrets.compare_digest(form.get("csrf", ""), dashboard.csrf):
                    return self._send(403, "missing or wrong CSRF token")
                message = dashboard.act(urlsplit(self.path).path.removeprefix("/action/"), form)
                if message is None:
                    return self._send(404, "unknown action")
                self.send_response(303)
                self.send_header("Location", "/")
                self.end_headers()

        self.server = ThreadingHTTPServer((host, config.dashboard_port), Handler)

    def act(self, action: str, form: dict) -> str | None:
        state = self.state
        if action == "pause":
            state.set("paused", "paused from the dashboard")
        elif action == "resume":
            state.set("paused", "")
        elif action == "resume-uploader":
            state.set("uploader_paused", "")
        elif action == "kill":
            state.set(f"kill:{TASK}", "1")
        elif action == "unkill":
            state.set(f"kill:{TASK}", "0")
            with state.tx() as db:
                db.execute("UPDATE job SET state = 'pending', due_at = ? WHERE task = ? AND state = 'refused'", (time.time(), TASK))
        elif action == "run-now":
            try:
                state.run_now(int(form.get("job", "")))
            except ValueError:
                return "bad job"
        elif action == "limits":
            for key, (low, high) in EDITABLE_LIMITS.items():
                if key in form and form[key].strip():
                    try:
                        value = int(form[key])
                    except ValueError:
                        continue
                    setattr(self.config.limits, key, max(low, min(high, value)))
            self.config.save()
        else:
            return None
        state.event("info", "dashboard", {"action": action})
        return "ok"

    def serve(self) -> None:
        self.server.serve_forever(poll_interval=0.5)

    def shutdown(self) -> None:
        self.server.shutdown()
        self.server.server_close()
