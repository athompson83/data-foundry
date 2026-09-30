"""Command line: ``python -m df_collector <command>``.

  init            create the data directory and default config
  doctor          measure this computer and check Ollama, the model, policy and secrets
  set-secret NAME store read-api-key or ingest-token (read from stdin, never echoed or logged)
  run             run the collector, the uploader child process and the dashboard until stopped
  stop            ask a running collector to stop (it finishes the current step first)
  status          print the current state as JSON
  pause | resume  pause or resume collection
  kill | unkill   stop or re-enable the source (local kill switch)
  purge           when the work is done: delete local working data (keeps what is needed to resume);
                  --everything also deletes state, secrets and config; --remove-model also removes the model
"""

from __future__ import annotations

import argparse
import getpass
import json
import os
import platform
import re
import shutil
import signal
import subprocess
import sys
import threading
import time
from pathlib import Path

from . import COLLECTOR_ID, policy as policy_mod
from .config import Config, load
from .ollama import LocalModelError, OllamaClient
from .state import State


def pid_alive(pid: int) -> bool:
    if pid <= 0:
        return False
    if os.name == "nt":
        import ctypes

        handle = ctypes.windll.kernel32.OpenProcess(0x1000, False, pid)  # PROCESS_QUERY_LIMITED_INFORMATION
        if not handle:
            return False
        code = ctypes.c_ulong()
        ctypes.windll.kernel32.GetExitCodeProcess(handle, ctypes.byref(code))
        ctypes.windll.kernel32.CloseHandle(handle)
        return code.value == 259  # STILL_ACTIVE
    try:
        os.kill(pid, 0)
    except OSError:
        return False
    return True


def run_dir(config: Config) -> Path:
    path = config.root / "run"
    path.mkdir(parents=True, exist_ok=True)
    return path


class ProcessLock:
    """An exclusive OS file lock held for a process's lifetime. The OS releases it when the process dies, however it
    dies, so a stale PID file or a reused PID never makes a dead collector (or uploader) look alive."""

    def __init__(self, path: Path):
        self.path = path
        self.handle = None

    def acquire(self) -> bool:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        handle = open(self.path, "a+b")
        try:
            if os.name == "nt":
                import msvcrt

                handle.seek(0)
                msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl

                fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            handle.close()
            return False
        self.handle = handle
        return True

    def release(self) -> None:
        if self.handle is not None:
            self.handle.close()  # closing the handle releases the lock
            self.handle = None


def lock_held(path: Path) -> bool:
    """Whether a live process holds the lock at path."""
    probe = ProcessLock(path)
    if probe.acquire():
        probe.release()
        return False
    return True


def running_pid(config: Config) -> int | None:
    """The running collector's PID (0 when it holds the lock but its PID file is unreadable), or None."""
    rd = run_dir(config)
    if not lock_held(rd / "collector.lock"):
        return None
    try:
        return int((rd / "collector.pid").read_text())
    except (OSError, ValueError):
        return 0


def hardware() -> dict:
    info: dict = {"os": platform.platform(), "python": sys.version.split()[0], "cpu_count": os.cpu_count(), "machine": platform.machine()}
    try:
        if os.name == "nt":
            import ctypes

            class MemoryStatus(ctypes.Structure):
                _fields_ = [("dwLength", ctypes.c_ulong), ("dwMemoryLoad", ctypes.c_ulong), ("ullTotalPhys", ctypes.c_ulonglong), ("ullAvailPhys", ctypes.c_ulonglong),
                            ("ullTotalPageFile", ctypes.c_ulonglong), ("ullAvailPageFile", ctypes.c_ulonglong), ("ullTotalVirtual", ctypes.c_ulonglong),
                            ("ullAvailVirtual", ctypes.c_ulonglong), ("ullAvailExtendedVirtual", ctypes.c_ulonglong)]

            status = MemoryStatus()
            status.dwLength = ctypes.sizeof(MemoryStatus)
            ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(status))
            info["ram_total_gb"] = round(status.ullTotalPhys / 2**30, 1)
            info["ram_available_gb"] = round(status.ullAvailPhys / 2**30, 1)
        else:
            meminfo = dict(line.split(":", 1) for line in Path("/proc/meminfo").read_text().splitlines() if ":" in line)
            info["ram_total_gb"] = round(int(meminfo["MemTotal"].split()[0]) / 2**20, 1)
            info["ram_available_gb"] = round(int(meminfo["MemAvailable"].split()[0]) / 2**20, 1)
    except Exception as error:  # noqa: BLE001
        info["ram_error"] = str(error)
    gpus = []
    if shutil.which("nvidia-smi"):
        try:
            out = subprocess.run(["nvidia-smi", "--query-gpu=name,memory.total,memory.free,driver_version", "--format=csv,noheader,nounits"], capture_output=True, text=True, timeout=15)
            for line in out.stdout.strip().splitlines():
                name, total, free, driver = [part.strip() for part in line.split(",")]
                gpus.append({"vendor": "nvidia", "name": name, "vram_total_mb": int(total), "vram_free_mb": int(free), "driver": driver})
        except (OSError, ValueError, subprocess.SubprocessError) as error:
            info["gpu_error"] = str(error)
    info["gpus"] = gpus
    info["gpu_note"] = "measured with nvidia-smi" if gpus else "no NVIDIA GPU detected by nvidia-smi; running CPU-only (AMD/Intel GPUs are not measured here)"
    return info


def cmd_doctor(config: Config) -> int:
    report: dict = {"collector": COLLECTOR_ID, "data_dir": str(config.root), "hardware": hardware()}
    disk = shutil.disk_usage(config.root if config.root.exists() else Path.home())
    report["hardware"]["disk_free_gb"] = round(disk.free / 2**30, 1)
    ok = True
    try:
        client = OllamaClient(config.ollama_url, config.model, config.model_digest, num_ctx=config.num_ctx)
        report["ollama_version"] = client.version()
        report["model"] = client.verify().__dict__
        report["ollama_env_OLLAMA_NO_CLOUD"] = os.environ.get("OLLAMA_NO_CLOUD", "(not set in this process)")
    except LocalModelError as error:
        ok = False
        report["model_error"] = str(error)
    try:
        policy = policy_mod.load()
        report["policy"] = {name: {"enabled": t["enabled"], "rights": t["rights"], "stage": t["stage"], "refused_because": t["refused_because"]} for name, t in policy.tasks.items()}
        report["policy_registry_sha256"] = policy.registry_sha256
    except policy_mod.PolicyRefused as error:
        ok = False
        report["policy_error"] = str(error)
    report["secrets"] = {name: (config.secrets_dir / name).exists() for name in ("read-api-key", "ingest-token")}
    report["api_origin"] = config.api_origin
    report["dashboard"] = f"http://{config.dashboard_host}:{config.dashboard_port}/"
    config.root.mkdir(parents=True, exist_ok=True)
    (config.root / "hardware.json").write_text(json.dumps(report["hardware"], indent=2))
    print(json.dumps(report, indent=2))
    return 0 if ok else 1


def cmd_set_secret(config: Config, name: str) -> int:
    if name not in ("read-api-key", "ingest-token"):
        print("secret must be read-api-key or ingest-token", file=sys.stderr)
        return 2
    value = sys.stdin.readline().strip() if not sys.stdin.isatty() else getpass.getpass(f"{name}: ")
    # The exact shapes the Worker issues: a truncated or mangled paste is refused here, not at the first request.
    shape = {"read-api-key": (r"rcl_live_[A-Za-z0-9]{32}", "rcl_live_ followed by 32 letters and digits"), "ingest-token": (r"dfi_[A-Za-z0-9]{40}", "dfi_ followed by 40 letters and digits")}[name]
    if not re.fullmatch(shape[0], value):
        print(f"{name} must be {shape[1]}; check the value was pasted whole", file=sys.stderr)
        return 2
    config.secrets_dir.mkdir(parents=True, exist_ok=True)
    path = config.secrets_dir / name
    path.write_text(value)
    try:
        os.chmod(path, 0o600)
    except OSError:
        pass
    if config.db_path.exists():
        # A job refused by the old value (a 401) runs again now, and a paused uploader retries at once.
        state = State(config.db_path)
        revived = state.revive_refused()
        if name == "ingest-token":
            state.set("uploader_paused", "")
        if revived:
            print(f"resumed {revived} job(s) refused with the previous value")
    print(f"saved {name} to {path}")
    return 0


def reap_leftover_uploader(rd: Path, wait_s: float = 90.0, sleep=time.sleep) -> bool:
    """True once no uploader holds its lock in the run directory (signalling it through the stop file)."""
    if not lock_held(rd / "uploader.lock"):
        (rd / "uploader.pid").unlink(missing_ok=True)
        return True
    (rd / "stop").touch()
    waited = 0.0
    while waited < wait_s:
        if not lock_held(rd / "uploader.lock"):
            (rd / "uploader.pid").unlink(missing_ok=True)
            return True
        sleep(1)
        waited += 1
    return False


def uploader_args(config: Config, config_path: str | None) -> list[str]:
    """The uploader child's command line. It runs from the app directory, so paths are made absolute first."""
    args = [sys.executable, "-m", "df_collector", "--data-dir", str(Path(config.root).resolve())]
    if config_path:
        args += ["--config", str(Path(config_path).resolve())]
    return args + ["uploader"]


class UploaderSupervisor:
    """Keeps the uploader child running: an unexpected exit is logged and the child restarted after a backoff.

    The collector keeps reading and extracting meanwhile (the outbox holds the work), so one crash never stops the
    unattended pipeline. The backoff doubles from 30 s up to an hour, and resets once a child has run for 10 minutes."""

    BASE_S = 30.0
    MAX_S = 3600.0
    HEALTHY_S = 600.0

    def __init__(self, spawn, state: State, clock=time.monotonic):
        self.spawn = spawn
        self.state = state
        self.clock = clock
        self.child = spawn()
        self.started = clock()
        self.failures = 0
        self.restart_at: float | None = None

    def check(self) -> None:
        now = self.clock()
        if self.restart_at is None:
            if self.child.poll() is None:
                return
            self.failures = 1 if now - self.started >= self.HEALTHY_S else self.failures + 1
            delay = min(self.BASE_S * 2 ** (self.failures - 1), self.MAX_S)
            self.restart_at = now + delay
            self.state.event("error", "uploader_exited", {"code": self.child.returncode, "restart_in_s": int(delay)})
        elif now >= self.restart_at:
            try:
                child = self.spawn()
            except OSError as error:
                # A failed spawn (e.g. a transient resource error) is retried on the same backoff; supervision never ends.
                self.failures += 1
                delay = min(self.BASE_S * 2 ** (self.failures - 1), self.MAX_S)
                self.restart_at = now + delay
                self.state.event("error", "uploader_spawn_failed", {"error": str(error), "restart_in_s": int(delay)})
                return
            self.child = child
            self.started = now
            self.restart_at = None
            self.state.event("info", "uploader_restarted", {"pid": self.child.pid, "failures": self.failures})


def cmd_run(config: Config, config_path: str | None) -> int:
    from .dashboard import Dashboard
    from .runtime import Collector

    rd = run_dir(config)
    lock = ProcessLock(rd / "collector.lock")
    if not lock.acquire():
        print(f"already running (pid {running_pid(config)})")
        return 0
    stop_file = rd / "stop"
    # An uploader left by a collector that was killed outright must be gone before the stop signal is cleared:
    # signal it, wait for it, and refuse to start (the next scheduled start retries) if it is still running.
    if not reap_leftover_uploader(rd):
        print("a previous uploader is still running; not starting a second one", file=sys.stderr)
        return 1
    stop_file.unlink(missing_ok=True)
    (rd / "collector.pid").write_text(str(os.getpid()))
    state = State(config.db_path)
    collector = Collector(config, state)
    # Bind the dashboard first: if its port is taken this raises before any child process exists.
    dashboard = Dashboard(config, state, collector)
    # The uploader is a separate process: only it reads the ingestion credential.
    child_args = uploader_args(config, config_path)
    child_env = {**os.environ, "DF_COLLECTOR_PARENT_PID": str(os.getpid())}
    creationflags = 0x08000000 if os.name == "nt" else 0  # CREATE_NO_WINDOW

    def spawn_uploader() -> subprocess.Popen:
        child = subprocess.Popen(child_args, env=child_env, cwd=str(Path(__file__).resolve().parents[1]), creationflags=creationflags)
        (rd / "uploader.pid").write_text(str(child.pid))
        return child

    uploader = UploaderSupervisor(spawn_uploader, state)
    threading.Thread(target=dashboard.serve, daemon=True).start()
    print(f"{COLLECTOR_ID} running; dashboard http://{config.dashboard_host}:{config.dashboard_port}/", flush=True)

    def request_stop(*_: object) -> None:
        stop_file.touch()

    signal.signal(signal.SIGINT, request_stop)
    signal.signal(signal.SIGTERM, request_stop)

    def watch() -> None:
        while not stop_file.exists():
            try:
                uploader.check()
            except Exception as error:  # noqa: BLE001 - supervision must outlive any single failure
                state.event("error", "uploader_supervision", {"error": str(error)})
            time.sleep(1)
        collector.stop.set()

    threading.Thread(target=watch, daemon=True).start()
    try:
        collector.run()
    finally:
        stop_file.touch()
        try:
            uploader.child.wait(timeout=30)
        except subprocess.TimeoutExpired:
            uploader.child.terminate()
        dashboard.shutdown()
        (rd / "collector.pid").unlink(missing_ok=True)
        (rd / "uploader.pid").unlink(missing_ok=True)
    return 0


def cmd_stop(config: Config) -> int:
    pid = running_pid(config)
    (run_dir(config) / "stop").touch()
    if pid is None:
        print("not running")
        return 0
    for _ in range(120):
        if running_pid(config) is None:
            print("stopped")
            return 0
        time.sleep(1)
    print(f"collector (pid {pid}) is still finishing its current step; it will stop when that completes")
    return 1


def cmd_purge(config: Config, everything: bool, remove_model: bool, force: bool) -> int:
    """Delete local data once Data Foundry holds it. Refuses while running or while uploads are still owed."""
    if running_pid(config) is not None:
        print("stop the collector first (df_collector stop)", file=sys.stderr)
        return 1
    report: dict = {"data_dir": str(config.root)}
    if config.db_path.exists():
        state = State(config.db_path)
        pending = state.outbox_pending()
        if pending and not force:
            print(f"{pending} upload(s) are not yet acknowledged by Data Foundry; run the collector until they are, or pass --force", file=sys.stderr)
            return 1
        waiting = int(state.one("SELECT COUNT(*) AS n FROM document WHERE state = 'queued'")["n"])
        if waiting and not force:
            print(f"{waiting} notice(s) are still waiting for the model: the work is not done. Let the collector finish, or pass --force (they are read again from Data Foundry on the next run)", file=sys.stderr)
            return 1
        if waiting:
            from .runtime import rewind_backfill

            with state.tx() as db:
                db.execute("DELETE FROM document WHERE state = 'queued'")
                rewind_backfill(db, state)
            report["rewound"] = f"{waiting} queued notice(s) forgotten; the backfill restarts from the first page on the next run"
        report["swept"] = state.sweep(config.evidence_dir, unverified_days=0)
        with state.tx() as db:
            db.execute("DELETE FROM candidate")
            db.execute("DELETE FROM retrieval")
            db.execute("DELETE FROM event")
            db.execute("UPDATE document SET detail = NULL")
        state.db.execute("VACUUM")
        state.db.close()
    if config.evidence_dir.exists():
        shutil.rmtree(config.evidence_dir, ignore_errors=True)
    if everything and config.root.exists():
        shutil.rmtree(config.root, ignore_errors=True)
        report["deleted"] = "everything (state, secrets, config)"
    if remove_model and shutil.which("ollama"):
        report["model_removed"] = subprocess.run(["ollama", "rm", config.model], capture_output=True, text=True).returncode == 0
    print(json.dumps(report, indent=2))
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="df_collector")
    parser.add_argument("--data-dir")
    parser.add_argument("--config")
    parser.add_argument("command", choices=["init", "doctor", "set-secret", "run", "uploader", "stop", "status", "pause", "resume", "kill", "unkill", "purge"])
    parser.add_argument("arg", nargs="?")
    parser.add_argument("--everything", action="store_true", help="purge: delete the whole data directory")
    parser.add_argument("--remove-model", action="store_true", help="purge: also run `ollama rm` on the configured model")
    parser.add_argument("--force", action="store_true", help="purge: even with work outstanding; queued notices are re-read from Data Foundry on the next run, and owed uploads are kept and sent then (with --everything they are lost)")
    args = parser.parse_args(argv)
    config = load(args.config, args.data_dir)
    if args.command == "init":
        config.root.mkdir(parents=True, exist_ok=True)
        config.secrets_dir.mkdir(parents=True, exist_ok=True)
        path = config.root / "collector.json"
        if not path.exists():
            config.save(path)
        print(json.dumps({"data_dir": str(config.root), "config": str(path)}))
        return 0
    if args.command == "doctor":
        return cmd_doctor(config)
    if args.command == "set-secret":
        return cmd_set_secret(config, args.arg or "")
    if args.command == "run":
        return cmd_run(config, args.config)
    if args.command == "uploader":
        from .runtime import uploader_main

        rd = run_dir(config)
        # One uploader at a time: a second one (a leftover, or a manual start) exits at once.
        lock = ProcessLock(rd / "uploader.lock")
        if not lock.acquire():
            print("an uploader is already running", file=sys.stderr)
            return 1
        started_by_collector = bool(os.environ.get("DF_COLLECTOR_PARENT_PID"))
        # The parent collector is judged by its lock, not its PID (a PID can be reused once it exits).
        uploader_main(config, rd / "stop", parent_alive=(lambda: lock_held(rd / "collector.lock")) if started_by_collector else None)
        return 0
    if args.command == "stop":
        return cmd_stop(config)
    if args.command == "purge":
        return cmd_purge(config, args.everything, args.remove_model, args.force)
    state = State(config.db_path)
    if args.command == "status":
        from .dashboard import snapshot

        snap = snapshot(config, state, None)
        snap["running_pid"] = running_pid(config)
        snap.pop("events", None)
        print(json.dumps(snap, indent=2, default=str))
        return 0
    from .runtime import TASK

    if args.command == "pause":
        state.set("paused", "paused from the command line")
    elif args.command == "resume":
        state.set("paused", "")
        state.set("uploader_paused", "")
    elif args.command == "kill":
        state.set(f"kill:{TASK}", "1")
    elif args.command == "unkill":
        state.set(f"kill:{TASK}", "0")
        with state.tx() as db:
            db.execute("UPDATE job SET state = 'pending', due_at = ? WHERE task = ? AND state = 'refused'", (time.time(), TASK))
    print(args.command)
    return 0


if __name__ == "__main__":
    sys.exit(main())
