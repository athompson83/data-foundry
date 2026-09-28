"""Outbound fetches that cannot be steered at the local network.

Every request (and every redirect hop) must:

- use https (http only for an explicitly allowed loopback test origin);
- resolve only to public unicast addresses: loopback, private, link-local
  (including 169.254.169.254 cloud metadata), CGNAT, multicast, reserved and
  unspecified addresses are refused, for IPv4 and IPv6 (incl. mapped forms);
- connect to the exact address that was checked (no second DNS lookup, so DNS
  rebinding cannot swap the target between check and connect);
- stay on a host the source policy allows, and never on a prohibited domain;
- honour size, time and content-type limits, Retry-After, a per-host minimum
  interval, and robots.txt (RFC 9309);
- present the collector's identifying User-Agent.
"""

from __future__ import annotations

import http.client
import ipaddress
import socket
import ssl
import threading
import time
import urllib.robotparser
from dataclasses import dataclass
from urllib.parse import urljoin, urlsplit


class FetchRefused(RuntimeError):
    """The request violates the network or source policy. Never retried."""


class FetchFailed(RuntimeError):
    """A transient failure (timeout, 5xx, 429). May be retried with backoff."""

    def __init__(self, message: str, retry_after: float | None = None):
        super().__init__(message)
        self.retry_after = retry_after


class RateLimited(FetchFailed):
    """A 429 or a local request allowance used up: wait until it resets. Not a failed attempt, so it never dead-letters."""


BLOCKED_NETWORKS = [ipaddress.ip_network(n) for n in ("100.64.0.0/10", "192.0.0.0/24", "198.18.0.0/15", "64:ff9b::/96", "2001:db8::/32")]


def address_allowed(address: str) -> bool:
    ip = ipaddress.ip_address(address)
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped:
        ip = ip.ipv4_mapped
    if ip.is_loopback or ip.is_private or ip.is_link_local or ip.is_multicast or ip.is_reserved or ip.is_unspecified or not ip.is_global:
        return False
    return not any(ip in net for net in BLOCKED_NETWORKS if net.version == ip.version)


def domain_matches(host: str, domain: str) -> bool:
    host, domain = host.lower().rstrip("."), domain.lower().rstrip(".")
    return host == domain or host.endswith("." + domain)


@dataclass
class Response:
    url: str
    status: int
    headers: dict[str, str]
    body: bytes
    retrieved_at: float


@dataclass
class HostPolicy:
    allowed_hosts: tuple[str, ...]
    prohibited_domains: tuple[str, ...]
    user_agent: str
    max_bytes: int = 16 * 1024 * 1024
    timeout_s: float = 60.0
    min_interval_s: float = 2.0
    content_types: tuple[str, ...] = ("application/json", "text/plain", "text/csv", "application/xml", "text/xml")
    max_redirects: int = 3
    # Test-only escape hatch: exact origins ("http://127.0.0.1:8787") that may be plain http on loopback.
    loopback_test_origins: tuple[str, ...] = ()


class _PinnedHTTPSConnection(http.client.HTTPSConnection):
    """HTTPS to a pre-resolved, pre-checked address, with SNI and certificate checks for the real host name."""

    def __init__(self, host: str, address: str, port: int, timeout: float):
        super().__init__(host, port=port, timeout=timeout, context=ssl.create_default_context())
        self._address = address

    def connect(self) -> None:
        self.sock = socket.create_connection((self._address, self.port), self.timeout)
        self.sock = self._context.wrap_socket(self.sock, server_hostname=self.host)


class SafeFetcher:
    def __init__(self, policy: HostPolicy, resolver=socket.getaddrinfo, clock=time.monotonic, sleep=time.sleep):
        self.policy = policy
        self._resolve = resolver
        self._clock = clock
        self._sleep = sleep
        self._last: dict[str, float] = {}
        self._robots: dict[str, urllib.robotparser.RobotFileParser | None] = {}
        self._lock = threading.Lock()

    # -- policy checks -------------------------------------------------------------------------------------------

    def _is_test_origin(self, url: str) -> bool:
        parts = urlsplit(url)
        return f"{parts.scheme}://{parts.netloc}" in self.policy.loopback_test_origins

    def check_url(self, url: str) -> tuple[str, str, int]:
        parts = urlsplit(url)
        host = (parts.hostname or "").lower()
        if not host:
            raise FetchRefused(f"no host in {url!r}")
        if parts.username or parts.password:
            raise FetchRefused("credentials in URLs are refused")
        for domain in self.policy.prohibited_domains:
            if domain_matches(host, domain):
                raise FetchRefused(f"{host} is a prohibited source ({domain})")
        if not any(domain_matches(host, allowed) for allowed in self.policy.allowed_hosts):
            raise FetchRefused(f"{host} is not an allowed host for this source")
        if self._is_test_origin(url):
            return host, "127.0.0.1", parts.port or 80
        if parts.scheme != "https":
            raise FetchRefused(f"only https is allowed, got {parts.scheme}")
        port = parts.port or 443
        try:
            infos = self._resolve(host, port, type=socket.SOCK_STREAM)
        except OSError as error:
            raise FetchFailed(f"DNS lookup failed for {host}: {error}") from error
        addresses = [info[4][0] for info in infos]
        if not addresses:
            raise FetchFailed(f"{host} has no addresses")
        bad = [a for a in addresses if not address_allowed(a)]
        if bad:
            raise FetchRefused(f"{host} resolves to a non-public address ({bad[0]})")
        return host, addresses[0], port

    # -- transport -----------------------------------------------------------------------------------------------

    def _throttle(self, host: str) -> None:
        with self._lock:
            wait = self._last.get(host, -1e9) + self.policy.min_interval_s - self._clock()
            if wait > 0:
                self._sleep(wait)
            self._last[host] = self._clock()

    def _open(self, url: str, headers: dict[str, str]) -> Response:
        host, address, port = self.check_url(url)
        self._throttle(host)
        parts = urlsplit(url)
        path = (parts.path or "/") + (f"?{parts.query}" if parts.query else "")
        if self._is_test_origin(url):
            connection: http.client.HTTPConnection = http.client.HTTPConnection(address, port, timeout=self.policy.timeout_s)
        else:
            connection = _PinnedHTTPSConnection(host, address, port, self.policy.timeout_s)
        try:
            connection.request("GET", path, headers={"User-Agent": self.policy.user_agent, "Accept": "application/json", "Host": parts.netloc, **headers})
            raw = connection.getresponse()
            declared = raw.getheader("content-length")
            if declared and int(declared) > self.policy.max_bytes:
                raise FetchRefused(f"response of {declared} bytes exceeds the {self.policy.max_bytes}-byte limit")
            body = raw.read(self.policy.max_bytes + 1)
            if len(body) > self.policy.max_bytes:
                raise FetchRefused(f"response exceeds the {self.policy.max_bytes}-byte limit")
            return Response(url=url, status=raw.status, headers={k.lower(): v for k, v in raw.getheaders()}, body=body, retrieved_at=time.time())
        except (socket.timeout, TimeoutError, ConnectionError, http.client.HTTPException, ssl.SSLError) as error:
            raise FetchFailed(f"{host}: {error}") from error
        finally:
            connection.close()

    def robots_allows(self, url: str) -> bool:
        parts = urlsplit(url)
        origin = f"{parts.scheme}://{parts.netloc}"
        if origin not in self._robots:
            parser: urllib.robotparser.RobotFileParser | None = urllib.robotparser.RobotFileParser()
            try:
                response = self._open(origin + "/robots.txt", {"Accept": "text/plain"})
                content_type = response.headers.get("content-type", "")
                if response.status >= 500:
                    parser = None  # RFC 9309 2.3.1.4: unreachable -> assume complete disallow
                elif response.status >= 400 or "text/plain" not in content_type:
                    parser.parse([])  # 4xx, or an HTML error page served as 200: no rules
                else:
                    parser.parse(response.body.decode("utf-8", "replace").splitlines())
            except FetchFailed:
                parser = None
            self._robots[origin] = parser
        parser = self._robots[origin]
        return bool(parser and parser.can_fetch(self.policy.user_agent, url))

    def get(self, url: str, headers: dict[str, str] | None = None, check_robots: bool = True) -> Response:
        if check_robots and not self.robots_allows(url):
            raise FetchRefused(f"robots.txt disallows {url}")
        current = url
        for _ in range(self.policy.max_redirects + 1):
            response = self._open(current, headers or {})
            if response.status in (301, 302, 303, 307, 308):
                location = response.headers.get("location")
                if not location:
                    raise FetchFailed(f"redirect without Location from {current}")
                current = urljoin(current, location)
                continue  # the next hop is re-checked (scheme, host allowlist, prohibited list, DNS/IP)
            if response.status == 429:
                raise RateLimited(f"429 from {current}", retry_after=_retry_after(response.headers.get("retry-after")))
            if response.status >= 500:
                raise FetchFailed(f"{response.status} from {current}", retry_after=_retry_after(response.headers.get("retry-after")))
            if response.status >= 400:
                raise FetchRefused(f"{response.status} from {current}")
            content_type = response.headers.get("content-type", "").split(";")[0].strip().lower()
            if content_type not in self.policy.content_types:
                raise FetchRefused(f"unexpected content-type {content_type!r} from {current}")
            return response
        raise FetchRefused(f"more than {self.policy.max_redirects} redirects from {url}")


def _retry_after(value: str | None) -> float | None:
    if not value:
        return None
    try:
        return max(0.0, float(value))
    except ValueError:
        from email.utils import parsedate_to_datetime

        try:
            return max(0.0, parsedate_to_datetime(value).timestamp() - time.time())
        except (TypeError, ValueError):
            return None
