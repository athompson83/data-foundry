"""Local-only Ollama client.

The collector never talks to a hosted model. Before any extraction it proves:

- the Ollama base URL is a loopback address (no LAN, tunnel or hosted endpoint);
- the model name is not an Ollama cloud tag (``*:cloud`` / ``*-cloud``);
- the model is present in the local store with the pinned digest;
- ``/api/show`` reports no remote host (cloud-proxied models do).

Requests use schema-constrained JSON output, temperature 0 and thinking off.
There is no fallback: if the local model is unavailable the job waits and
retries; it never switches provider.
"""

from __future__ import annotations

import ipaddress
import json
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from urllib.parse import urlsplit


class LocalModelError(RuntimeError):
    """The local model is unavailable or does not satisfy the local-only policy."""

    def __init__(self, message: str, request_failed: bool = False, status: int | None = None):
        super().__init__(message)
        # request_failed: the server answered this request with an HTTP error (status set); False: unreachable.
        self.request_failed = request_failed
        self.status = status

    @property
    def input_specific(self) -> bool:
        """A 4xx other than a missing model: this input was refused, so it counts against the notice."""
        return self.request_failed and self.status is not None and 400 <= self.status < 500 and self.status != 404


LOOPBACK_HOSTS = {"localhost"}


def assert_loopback(base_url: str) -> None:
    parts = urlsplit(base_url)
    if parts.scheme != "http":
        raise LocalModelError(f"Ollama URL must be plain http on loopback, got {parts.scheme!r}")
    host = parts.hostname or ""
    if host in LOOPBACK_HOSTS:
        return
    try:
        if ipaddress.ip_address(host).is_loopback:
            return
    except ValueError:
        pass
    raise LocalModelError(f"Ollama host {host!r} is not loopback; remote or hosted inference is refused")


def assert_local_model_name(model: str) -> None:
    lowered = model.lower()
    if lowered.endswith(":cloud") or "-cloud" in lowered.split(":", 1)[-1] or lowered.startswith("cloud/"):
        raise LocalModelError(f"model {model!r} is an Ollama cloud model; only local models are allowed")


@dataclass
class ModelIdentity:
    name: str
    digest: str
    family: str
    parameter_size: str
    quantization: str
    license_head: str


@dataclass
class ChatResult:
    content: str
    total_ms: float
    prompt_tokens: int
    prompt_ms: float
    output_tokens: int
    output_ms: float
    load_ms: float


class OllamaClient:
    def __init__(self, base_url: str, model: str, pinned_digest: str | None, timeout: float = 600.0, num_ctx: int = 8192, num_thread: int | None = None, think: bool | str = False):
        assert_loopback(base_url)
        assert_local_model_name(model)
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.pinned_digest = pinned_digest
        self.timeout = timeout
        self.num_ctx = num_ctx
        self.num_thread = num_thread
        # Qwen takes true/false; OpenAI's open-weight gpt-oss takes "low" | "medium" | "high" and cannot turn it off.
        self.think = think
        # Never route model traffic through a proxy, whatever the environment says.
        self._opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))

    def _request(self, path: str, body: dict | None = None, timeout: float | None = None) -> dict:
        data = None if body is None else json.dumps(body).encode()
        request = urllib.request.Request(self.base_url + path, data=data, method="POST" if body is not None else "GET", headers={"content-type": "application/json"})
        try:
            with self._opener.open(request, timeout=timeout or self.timeout) as response:
                return json.loads(response.read().decode())
        except urllib.error.HTTPError as error:
            detail = error.read().decode(errors="replace")[:300]
            raise LocalModelError(f"local Ollama failed {path}: HTTP {error.code} {detail}", request_failed=True, status=error.code) from error
        except (urllib.error.URLError, TimeoutError, ConnectionError) as error:
            raise LocalModelError(f"local Ollama unavailable at {self.base_url}: {error}") from error

    def version(self) -> str:
        return str(self._request("/api/version", timeout=5).get("version", ""))

    def verify(self) -> ModelIdentity:
        """Prove the pinned model is local. Raises LocalModelError otherwise."""
        tags = self._request("/api/tags", timeout=10).get("models", [])
        entry = next((m for m in tags if m.get("name") == self.model or m.get("model") == self.model), None)
        if entry is None:
            raise LocalModelError(f"model {self.model!r} is not in the local Ollama store; pull it first")
        if entry.get("remote_host") or entry.get("remote_model"):
            raise LocalModelError(f"model {self.model!r} is a remote (cloud) model")
        # A cloud stub is listed with no local weights (size 0) and, with OLLAMA_NO_CLOUD=1, no remote_host either.
        if not int(entry.get("size") or 0) > 100 * 1024 * 1024:
            raise LocalModelError(f"model {self.model!r} has no local weights in the Ollama store")
        show = self._request("/api/show", {"model": self.model}, timeout=30)
        if show.get("remote_host") or show.get("remote_model"):
            raise LocalModelError(f"model {self.model!r} is served by a remote host")
        digest = str(entry.get("digest", ""))
        if self.pinned_digest and not digest.startswith(self.pinned_digest.removeprefix("sha256:")):
            raise LocalModelError(f"model digest {digest[:12]} does not match the pinned {self.pinned_digest[:19]}")
        details = show.get("details", {})
        return ModelIdentity(
            name=self.model,
            digest=digest,
            family=str(details.get("family", "")),
            parameter_size=str(details.get("parameter_size", "")),
            quantization=str(details.get("quantization_level", "")),
            license_head=str(show.get("license", "")).strip().splitlines()[0] if show.get("license") else "",
        )

    def loaded(self) -> list[dict]:
        return list(self._request("/api/ps", timeout=5).get("models", []))

    def chat_json(self, system: str, user: str, schema: dict, seed: int = 0) -> ChatResult:
        # num_predict bounds one notice's generation time (60 identifiers of JSON fit well inside it).
        options: dict = {"temperature": 0, "seed": seed, "num_ctx": self.num_ctx, "num_predict": 1500}
        if self.num_thread:
            options["num_thread"] = self.num_thread
        body = {
            "model": self.model,
            "stream": False,
            "think": self.think,
            "format": schema,
            "options": options,
            "keep_alive": "15m",
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
        }
        started = time.monotonic()
        out = self._request("/api/chat", body)
        if out.get("model") not in (self.model, None):
            raise LocalModelError(f"response came from {out.get('model')!r}, not the pinned {self.model!r}")
        ns = 1e6
        return ChatResult(
            content=str(out.get("message", {}).get("content", "")),
            total_ms=out.get("total_duration", (time.monotonic() - started) * 1e9) / ns,
            prompt_tokens=int(out.get("prompt_eval_count", 0)),
            prompt_ms=out.get("prompt_eval_duration", 0) / ns,
            output_tokens=int(out.get("eval_count", 0)),
            output_ms=out.get("eval_duration", 0) / ns,
            load_ms=out.get("load_duration", 0) / ns,
        )
