"""Command line: ``python -m df_collector <command>``.

  init            create the data directory and default config
  doctor          measure this computer and check Ollama, the model, policy and secrets
  set-secret NAME store read-api-key or ingest-token (read from stdin, never echoed or logged)
  run             run the collector, the uploader child process and the dashboard until stopped
  stop            ask a running collector to stop (it finishes the current step first)
  status          print the current state as JSON
  pause | resume  pause or resume collection
  kill | unkill   stop or re-enable the source (local kill switch)
"""

from __future__ import annotations

import argparse
import getpass
import json
import os
import platform
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


def running_pid(config: Config) -> int | None:
    try:
        pid = int((run_dir(config) / "collector.pid").read_text())
    except (OSError, ValueError):
        return None
    return pid if pid_alive(pid) else None


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
    prefix = {"read-api-key": "rcl_live_", "ingest-token": "dfi_"}[name]
    if not value.startswith(prefix):
        print(f"{name} must start with {prefix}", file=sys.stderr)
        return 2
    config.secrets_dir.mkdir(parents=True, exist_ok=True)
    path = config.secrets_dir / name
    path.write_text(value)
    try:
        os.chmod(path, 0o600)
    except OSError:
        pass
    print(f"saved {name} to {path}")
    return 0


def cmd_run(config: Config, config_path: str | None) -> int:
    from .dashboard import Dashboard
    from .runtime import Collector

    if running_pid(config):
        print(f"already running (pid {running_pid(config)})")
        return 0
    rd = run_dir(config)
    stop_file = rd / "stop"
    stop_file.unlink(missing_ok=True)
    (rd / "collector.pid").write_text(str(os.getpid()))
    state = State(config.db_path)
    collector = Collector(config, state)
    # The uploader is a separate process: only it reads the ingestion credential.
    child_args = [sys.executable, "-m", "df_collector", "--data-dir", str(config.root)] + (["--config", config_path] if config_path else []) + ["uploader"]
    creationflags = 0x08000000 if os.name == "nt" else 0  # CREATE_NO_WINDOW
    uploader = subprocess.Popen(child_args, cwd=str(Path(__file__).resolve().parents[1]), creationflags=creationflags)
    (rd / "uploader.pid").write_text(str(uploader.pid))
    dashboard = Dashboard(config, state, collector)
    threading.Thread(target=dashboard.serve, daemon=True).start()
    print(f"{COLLECTOR_ID} running; dashboard http://{config.dashboard_host}:{config.dashboard_port}/", flush=True)

    def request_stop(*_: object) -> None:
        stop_file.touch()

    signal.signal(signal.SIGINT, request_stop)
    signal.signal(signal.SIGTERM, request_stop)

    def watch() -> None:
        while not stop_file.exists():
            if uploader.poll() is not None and not stop_file.exists():
                state.event("error", "uploader_exited", {"code": uploader.returncode})
                stop_file.touch()
            time.sleep(1)
        collector.stop.set()

    threading.Thread(target=watch, daemon=True).start()
    try:
        collector.run()
    finally:
        stop_file.touch()
        try:
            uploader.wait(timeout=30)
        except subprocess.TimeoutExpired:
            uploader.terminate()
        dashboard.shutdown()
        (rd / "collector.pid").unlink(missing_ok=True)
        (rd / "uploader.pid").unlink(missing_ok=True)
    return 0


def cmd_stop(config: Config) -> int:
    pid = running_pid(config)
    (run_dir(config) / "stop").touch()
    if not pid:
        print("not running")
        return 0
    for _ in range(120):
        if not pid_alive(pid):
            print("stopped")
            return 0
        time.sleep(1)
    print(f"collector (pid {pid}) is still finishing its current step; it will stop when that completes")
    return 1


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="df_collector")
    parser.add_argument("--data-dir")
    parser.add_argument("--config")
    parser.add_argument("command", choices=["init", "doctor", "set-secret", "run", "uploader", "stop", "status", "pause", "resume", "kill", "unkill"])
    parser.add_argument("arg", nargs="?")
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

        uploader_main(config, run_dir(config) / "stop")
        return 0
    if args.command == "stop":
        return cmd_stop(config)
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
