import io
import json
import socket
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from df_collector import extract, policy as policy_mod
from df_collector.config import Config, Limits
from df_collector.netguard import FetchFailed, FetchRefused, HostPolicy, SafeFetcher, address_allowed
from df_collector.ollama import ChatResult, LocalModelError, OllamaClient, assert_local_model_name, assert_loopback
from df_collector.runtime import TASK, Collector, Uploader, worth_extracting
from df_collector.state import State, backoff_seconds

POLICY = policy_mod.load()


def resolver_to(address: str):
    def resolve(host, port, type=None):  # noqa: A002 - mirrors socket.getaddrinfo
        family = socket.AF_INET6 if ":" in address else socket.AF_INET
        return [(family, socket.SOCK_STREAM, 6, "", (address, port))]

    return resolve


def fetcher(address: str = "93.184.216.34", **policy) -> SafeFetcher:
    base = dict(allowed_hosts=("api.data.aroqon.com", "example.gov"), prohibited_domains=POLICY.prohibited_domains, user_agent="test-agent", min_interval_s=0)
    base.update(policy)
    return SafeFetcher(HostPolicy(**base), resolver=resolver_to(address))


class NetworkGuard(unittest.TestCase):
    def test_private_loopback_link_local_and_metadata_addresses_are_refused(self):
        for address in ("127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fe80::1", "fc00::1", "::ffff:127.0.0.1", "224.0.0.1"):
            with self.subTest(address):
                self.assertFalse(address_allowed(address))
                with self.assertRaises(FetchRefused):
                    fetcher(address).check_url("https://api.data.aroqon.com/v1/x")
        self.assertTrue(address_allowed("93.184.216.34"))

    def test_scheme_host_allowlist_credentials_and_prohibited_domains(self):
        f = fetcher()
        with self.assertRaises(FetchRefused):
            f.check_url("http://api.data.aroqon.com/v1/x")
        with self.assertRaises(FetchRefused):
            f.check_url("https://evil.example.com/")
        with self.assertRaises(FetchRefused):
            f.check_url("https://user:pw@api.data.aroqon.com/")
        prohibited = fetcher(allowed_hosts=("ahridirectory.org",))
        with self.assertRaisesRegex(FetchRefused, "prohibited"):
            prohibited.check_url("https://www.ahridirectory.org/search")
        self.assertEqual(f.check_url("https://api.data.aroqon.com/v1/x")[1], "93.184.216.34")


class LocalServer:
    """A tiny HTTP server on loopback, registered as an explicit test origin."""

    def __init__(self, routes):
        routes_ref = routes

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                return

            def do_GET(self):
                status, headers, body = routes_ref.get(self.path.split("?")[0], (404, {}, b""))
                self.send_response(status)
                for k, v in headers.items():
                    self.send_header(k, v)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.origin = f"http://127.0.0.1:{self.server.server_address[1]}"
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def close(self):
        self.server.shutdown()
        self.server.server_close()


class FetchBehaviour(unittest.TestCase):
    def serve(self, routes, **policy):
        server = LocalServer(routes)
        self.addCleanup(server.close)
        f = SafeFetcher(HostPolicy(allowed_hosts=("127.0.0.1",), prohibited_domains=(), user_agent="t", min_interval_s=0, loopback_test_origins=(server.origin,), **policy))
        return server, f

    def test_redirects_are_rechecked_and_metadata_redirect_is_refused(self):
        server, f = self.serve({"/a": (302, {"Location": "http://169.254.169.254/latest/meta-data/"}, b"")})
        with self.assertRaises(FetchRefused):
            f.get(server.origin + "/a", check_robots=False)

    def test_size_content_type_and_status_limits(self):
        server, f = self.serve({
            "/big": (200, {"Content-Type": "application/json"}, b"x" * 2048),
            "/html": (200, {"Content-Type": "text/html"}, b"<html>"),
            "/busy": (429, {"Retry-After": "120"}, b""),
            "/gone": (404, {}, b""),
            "/ok": (200, {"Content-Type": "application/json"}, b"{}"),
        }, max_bytes=1024)
        with self.assertRaisesRegex(FetchRefused, "limit"):
            f.get(server.origin + "/big", check_robots=False)
        with self.assertRaisesRegex(FetchRefused, "content-type"):
            f.get(server.origin + "/html", check_robots=False)
        with self.assertRaises(FetchFailed) as busy:
            f.get(server.origin + "/busy", check_robots=False)
        self.assertEqual(busy.exception.retry_after, 120)
        with self.assertRaises(FetchRefused):
            f.get(server.origin + "/gone", check_robots=False)
        self.assertEqual(f.get(server.origin + "/ok", check_robots=False).body, b"{}")

    def test_robots_txt_is_honoured(self):
        server, f = self.serve({
            "/robots.txt": (200, {"Content-Type": "text/plain"}, b"User-agent: *\nDisallow: /private\n"),
            "/private/x": (200, {"Content-Type": "application/json"}, b"{}"),
            "/public": (200, {"Content-Type": "application/json"}, b"{}"),
        })
        with self.assertRaisesRegex(FetchRefused, "robots"):
            f.get(server.origin + "/private/x")
        self.assertEqual(f.get(server.origin + "/public").status, 200)

    def test_per_host_interval_is_enforced(self):
        waits = []
        f = SafeFetcher(HostPolicy(allowed_hosts=("x.gov",), prohibited_domains=(), user_agent="t", min_interval_s=2.0), clock=lambda: 100.0, sleep=waits.append)
        f._throttle("x.gov")
        f._throttle("x.gov")
        self.assertEqual(waits, [2.0])


class LocalModelOnly(unittest.TestCase):
    def test_remote_and_cloud_models_are_refused(self):
        for url in ("http://192.168.1.5:11434", "https://ollama.com", "http://ollama.example.com:11434"):
            with self.subTest(url), self.assertRaises(LocalModelError):
                assert_loopback(url)
        assert_loopback("http://127.0.0.1:11434")
        assert_loopback("http://localhost:11434")
        for name in ("gpt-oss:120b-cloud", "qwen3-coder:480b-cloud", "deepseek-v3.1:671b-cloud", "kimi:cloud"):
            with self.subTest(name), self.assertRaises(LocalModelError):
                assert_local_model_name(name)
        assert_local_model_name("qwen3.5:4b")

    def test_cloud_stub_without_local_weights_is_refused(self):
        client = OllamaClient("http://127.0.0.1:11434", "qwen3.5:4b", None)
        listed = {"/api/tags": {"models": [{"name": "qwen3.5:4b", "digest": "2a654d98e6fb", "size": 0}]}, "/api/show": {"details": {}}}
        client._request = lambda path, body=None, timeout=None: listed[path]
        with self.assertRaisesRegex(LocalModelError, "no local weights"):
            client.verify()
        listed["/api/tags"]["models"][0]["size"] = 3_389_971_840
        self.assertEqual(client.verify().digest, "2a654d98e6fb")
        client.pinned_digest = "deadbeef0000"
        with self.assertRaisesRegex(LocalModelError, "does not match"):
            client.verify()

    def test_unreachable_model_raises_without_fallback(self):
        client = OllamaClient("http://127.0.0.1:9", "qwen3.5:4b", None, timeout=1)
        with self.assertRaises(LocalModelError):
            client.verify()


RECORD = {"Title": "Hoppe's Recalls Bore Cleaner", "Description": "The recalled item number is SA904 and can be found above the UPC code. Lot 44871 is not affected.", "Products": [{"Name": "Bore Cleaner", "Description": "", "Model": ""}]}


class FakeClient:
    def __init__(self, content):
        self.content = content
        self.calls = 0

    def chat_json(self, system, user, schema, seed=0):
        self.calls += 1
        return ChatResult(content=self.content, total_ms=1, prompt_tokens=1, prompt_ms=1, output_tokens=1, output_ms=1, load_ms=0)

    def verify(self):
        from df_collector.ollama import ModelIdentity

        return ModelIdentity("qwen3.5:4b", "2a654d98e6fb", "qwen35", "4.7B", "Q4_K_M", "Apache License")

    def loaded(self):
        return []


class ModelOutput(unittest.TestCase):
    def test_invalid_and_unsupported_output_is_quarantined(self):
        for content in ("not json", '{"identifiers": "x"}', '{"identifiers": [{"value": "SA904"}]}', '{"identifiers": [{"value": "SA904", "label": "serial", "field": "Description"}]}',
                        '{"identifiers": [{"value": "SA904", "label": "item", "field": "ConsumerContact"}]}', '{"identifiers": [], "extra": 1}'):
            with self.subTest(content):
                result = extract.extract(FakeClient(content), RECORD)
                self.assertEqual(result.status, "quarantined")
                self.assertEqual(result.accepted, [])

    def test_hallucinated_and_negative_values_are_rejected_locally(self):
        content = json.dumps({"identifiers": [
            {"value": "SA904", "label": "item", "field": "Description"},
            {"value": "SA999", "label": "item", "field": "Description"},
            {"value": "44871", "label": "item", "field": "Description"},
        ]})
        result = extract.extract(FakeClient(content), RECORD)
        self.assertEqual(result.status, "extracted")
        self.assertEqual([p.value for p in result.accepted], ["SA904"])
        reasons = {p.value: p.decision.reason for p in result.proposals}
        self.assertEqual(reasons["SA999"], "not_in_source")
        self.assertEqual(reasons["44871"], "non_product_label")

    def test_prefilter(self):
        self.assertTrue(worth_extracting(RECORD))
        self.assertFalse(worth_extracting({"Title": "Dresses recalled", "Description": "Snaps can detach.", "Products": []}))


class Leases(unittest.TestCase):
    def setUp(self):
        self.now = [1000.0]
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.state = State(Path(self.tmp.name) / "s.sqlite3", clock=lambda: self.now[0])

    def test_expired_lease_is_recovered_and_stale_owner_cannot_finish(self):
        self.state.ensure_job("read", TASK, "k", {})
        first = self.state.claim("worker-a", ("read",))
        self.assertIsNotNone(first)
        self.assertIsNone(self.state.claim("worker-b", ("read",)))
        self.now[0] += 16 * 60  # worker-a crashed; its lease expires
        second = self.state.claim("worker-b", ("read",))
        self.assertEqual(second["id"], first["id"])
        self.assertEqual(second["attempts"], 2)
        self.state.finish(first["id"], "worker-a")  # the stale owner is ignored
        self.assertEqual(self.state.one("SELECT state FROM job")["state"], "leased")
        self.state.finish(first["id"], "worker-b", next_due=self.now[0] + 60)
        self.assertEqual(dict(self.state.one("SELECT state, attempts FROM job")), {"state": "pending", "attempts": 0})

    def test_backoff_ceiling_dead_letter_and_refusal(self):
        self.state.ensure_job("read", TASK, "k", {}, max_attempts=2)
        job = self.state.claim("w", ("read",))
        self.assertEqual(self.state.fail(job["id"], "w", "503"), "pending")
        self.assertGreater(self.state.one("SELECT due_at FROM job")["due_at"], self.now[0])
        self.now[0] += 10**6
        job = self.state.claim("w", ("read",))
        self.assertEqual(self.state.fail(job["id"], "w", "503"), "dead")
        self.assertTrue(self.state.run_now(job["id"]))
        job = self.state.claim("w", ("read",))
        self.assertEqual(self.state.fail(job["id"], "w", "robots", refused=True), "refused")
        for attempt in range(20):
            self.assertLessEqual(backoff_seconds(attempt), 6 * 3600)


class FakeResponse(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


class FakeOpener:
    def __init__(self, outcomes):
        self.outcomes = list(outcomes)
        self.requests = []

    def open(self, request, timeout=None):
        self.requests.append(request)
        outcome = self.outcomes.pop(0)
        if isinstance(outcome, Exception):
            raise outcome
        return FakeResponse(json.dumps(outcome).encode())


def http_error(code):
    return urllib.error.HTTPError("https://api.data.aroqon.com/v1/intake", code, "x", {}, io.BytesIO(b'{"error":{}}'))


class UploaderBehaviour(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.config = Config(data_dir=self.tmp.name, limits=Limits())
        self.config.secrets_dir.mkdir(parents=True)
        (self.config.secrets_dir / "ingest-token").write_text("dfi_" + "a" * 40)
        self.state = State(self.config.db_path)
        with self.state.tx() as db:
            db.execute("INSERT INTO candidate (recall_id, raw_sha256, extractor_version, value, field, label, local_decision, updated_at) VALUES ('cpsc-15034', 'r', ?, 'SA904', 'Description', 'item', 'accepted', 0)", (extract.EXTRACTOR_VERSION,))
            self.state.outbox_add(db, "f" * 64, {"task": TASK, "extractor": {}, "notices": []})

    def uploader(self, outcomes):
        opener = FakeOpener(outcomes)
        return Uploader(self.config, self.state, POLICY, opener=opener), opener

    def test_interrupted_upload_is_resent_with_the_same_idempotency_key_and_acked_once(self):
        ok = {"extractor_version": extract.EXTRACTOR_VERSION, "accepted": 1, "replayed": 0, "rejected": 0, "results": [{"recall_id": "cpsc-15034", "candidates": [{"value": "SA904", "field": "Description", "status": "accepted"}]}]}
        uploader, opener = self.uploader([urllib.error.URLError("connection reset"), {**ok, "idempotent_replay": True}])
        self.assertFalse(uploader.send_one())
        self.assertEqual(self.state.one("SELECT state FROM outbox")["state"], "pending")
        with self.state.tx() as db:
            db.execute("UPDATE outbox SET next_attempt_at = 0")
        self.assertTrue(uploader.send_one())
        keys = {r.get_header("Idempotency-key") for r in opener.requests}
        self.assertEqual(keys, {"f" * 64})
        self.assertEqual(self.state.one("SELECT state FROM outbox")["state"], "acked")
        self.assertEqual(self.state.one("SELECT server_status FROM candidate")["server_status"], "accepted")
        self.assertNotIn("collector", json.loads(opener.requests[-1].data))

    def test_credential_refusal_pauses_uploads_and_bad_requests_dead_letter(self):
        uploader, _ = self.uploader([http_error(401)])
        uploader.send_one()
        self.assertTrue(self.state.get("uploader_paused"))
        self.assertEqual(self.state.one("SELECT state FROM outbox")["state"], "pending")
        with self.state.tx() as db:
            db.execute("UPDATE outbox SET next_attempt_at = 0")
        uploader, _ = self.uploader([http_error(400)])
        uploader.send_one()
        self.assertEqual(self.state.one("SELECT state FROM outbox")["state"], "dead")

    def test_kill_switch_and_policy_withdrawal_stop_uploads(self):
        self.state.set(f"kill:{TASK}", "1")
        uploader, opener = self.uploader([])
        self.assertFalse(uploader.send_one())
        self.assertEqual(opener.requests, [])
        self.state.set(f"kill:{TASK}", "0")
        withdrawn = policy_mod.Policy(registry_sha256="x", tasks={TASK: {**POLICY.tasks[TASK], "enabled": False, "rights": "RED", "refused_because": ["rights verdict is RED"]}}, prohibited_domains=())
        with self.state.tx() as db:
            db.execute("UPDATE outbox SET next_attempt_at = 0")
        uploader = Uploader(self.config, self.state, withdrawn, opener=opener)
        self.assertFalse(uploader.send_one())
        self.assertEqual(opener.requests, [])
        self.assertIn("RED", self.state.one("SELECT last_error FROM outbox")["last_error"])


class PolicyGate(unittest.TestCase):
    def test_compiled_policy_enables_only_the_registered_task(self):
        task = POLICY.task(TASK)
        self.assertEqual((task.source, task.rights), ("cpsc-recalls", "GREEN"))
        with self.assertRaises(policy_mod.PolicyRefused):
            POLICY.task("unknown-task@1")
        with self.assertRaises(policy_mod.PolicyRefused):
            POLICY.task(TASK, kill_switch=True)

    def test_missing_or_malformed_policy_fails_closed(self):
        with tempfile.TemporaryDirectory() as tmp:
            bad = Path(tmp) / "sources.json"
            bad.write_text("{")
            with self.assertRaises(policy_mod.PolicyRefused):
                policy_mod.load(bad)
            with self.assertRaises(policy_mod.PolicyRefused):
                policy_mod.load(Path(tmp) / "missing.json")

    def test_collector_refuses_jobs_after_withdrawal(self):
        with tempfile.TemporaryDirectory() as tmp:
            config = Config(data_dir=tmp)
            state = State(config.db_path)
            state.ensure_job("read", TASK, f"{TASK}:read", {})
            withdrawn = policy_mod.Policy(registry_sha256="x", tasks={TASK: {**POLICY.tasks[TASK], "enabled": False, "refused_because": ["rights withdrawn"]}}, prohibited_domains=())
            collector = Collector(config, state, client=FakeClient("{}"), policy=withdrawn)
            collector.tick()
            self.assertEqual(state.one("SELECT state FROM job")["state"], "refused")
            self.assertEqual(collector.status["phase"], "refused by policy")


class DashboardGuard(unittest.TestCase):
    def test_state_changes_need_the_csrf_token_same_origin_and_host(self):
        from df_collector.dashboard import Dashboard

        with tempfile.TemporaryDirectory() as tmp:
            config = Config(data_dir=tmp, dashboard_port=0)
            state = State(config.db_path)
            dashboard = Dashboard(config, state, None)
            port = dashboard.server.server_address[1]
            dashboard.allowed_hosts = {f"127.0.0.1:{port}"}
            dashboard.allowed_origins = {f"http://127.0.0.1:{port}"}
            threading.Thread(target=dashboard.serve, daemon=True).start()
            self.addCleanup(dashboard.shutdown)
            opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))

            def post(body, headers=None):
                request = urllib.request.Request(f"http://127.0.0.1:{port}/action/pause", data=body.encode(), method="POST", headers={"Content-Type": "application/x-www-form-urlencoded", **(headers or {})})
                try:
                    return opener.open(request, timeout=5).status
                except urllib.error.HTTPError as error:
                    return error.code

            self.assertEqual(post("csrf=wrong"), 403)
            self.assertEqual(post(f"csrf={dashboard.csrf}", {"Origin": "https://evil.example"}), 403)
            self.assertEqual(post(f"csrf={dashboard.csrf}", {"Host": "evil.example"}), 421)
            self.assertIsNone(state.paused())
            post(f"csrf={dashboard.csrf}", {"Origin": f"http://127.0.0.1:{port}"})
            self.assertTrue(state.paused())
            with self.assertRaises(ValueError):
                Dashboard(Config(data_dir=tmp, dashboard_host="0.0.0.0"), state, None)


if __name__ == "__main__":
    unittest.main()


class PoisonNotice(unittest.TestCase):
    def test_a_notice_the_model_server_keeps_failing_is_dead_lettered_and_the_queue_moves_on(self):
        with tempfile.TemporaryDirectory() as tmp:
            config = Config(data_dir=tmp)
            state = State(config.db_path)
            config.evidence_dir.mkdir(parents=True)
            path = config.evidence_dir / "r.json"
            path.write_text(json.dumps(RECORD))
            with state.tx() as db:
                for recall_id in ("cpsc-00001", "cpsc-00002"):
                    db.execute("INSERT INTO document (recall_id, raw_sha256, task, extractor_version, evidence_path, retrieved_at, state, updated_at) VALUES (?, 'r', ?, ?, ?, ?, 'queued', 0)", (recall_id, TASK, extract.EXTRACTOR_VERSION, str(path), 1 if recall_id.endswith("1") else 2))

            class Failing(FakeClient):
                def chat_json(self, *args, **kwargs):
                    raise LocalModelError("local Ollama failed /api/chat: HTTP 500", request_failed=True)

            collector = Collector(config, state, client=Failing("{}"), policy=POLICY)
            # Failures rotate between notices (least-attempted first), and each is dead-lettered at its third.
            for _ in range(5):
                collector.extract_one()
            states = {r["recall_id"]: (r["state"], r["attempts"]) for r in state.q("SELECT recall_id, state, attempts FROM document")}
            self.assertEqual(states["cpsc-00001"], ("failed", 3))
            self.assertEqual(states["cpsc-00002"], ("queued", 2))

            class Down(FakeClient):
                def chat_json(self, *args, **kwargs):
                    raise LocalModelError("local Ollama unavailable")

            collector.client = Down("{}")
            with self.assertRaises(LocalModelError):
                collector.extract_one()
            # An unreachable server is not charged to the notice.
            self.assertEqual(state.one("SELECT attempts FROM document WHERE recall_id = 'cpsc-00002'")["attempts"], 2)


ROOT_BODY = json.dumps({"name": "Data Foundry API", "datasets": {
    "recalls": {"name": "FDA Recall Intelligence", "registry": "fda-recalls", "stats": "https://api.data.aroqon.com/v1/recalls/stats"},
    "product-recalls": {"name": "North American Consumer Product Recalls", "registry": "consumer-product-recalls-north-america", "stats": "https://api.data.aroqon.com/v1/product-recalls/stats"},
}}).encode()


class LiveCatalog(unittest.TestCase):
    def test_capture_plan_maps_hosted_datasets_to_member_and_expansion_sources(self):
        from df_collector import catalog

        plan = catalog.capture_plan(POLICY, catalog.parse_root(ROOT_BODY))
        by_key = {d["api_key"]: d for d in plan["datasets"]}
        members = {m["source"]: m["acquisition"] for m in by_key["product-recalls"]["members"]}
        self.assertEqual(members, {"cpsc-recalls": "task", "health-canada-consumer-product-recalls": "permitted-no-adapter"})
        expansion = {m["source"]: m for m in by_key["product-recalls"]["expansion"]}
        self.assertIn("eu-safety-gate-alerts", expansion)
        self.assertEqual(expansion["eu-safety-gate-alerts"]["acquisition"], "blocked")
        self.assertTrue(expansion["eu-safety-gate-alerts"]["blocked_because"])
        self.assertIn("cpsc-recalls", plan["hosted_sources"])
        self.assertEqual([m["source"] for m in by_key["recalls"]["members"]], ["fda-recalls"])

    def test_tasks_wait_without_a_catalog_and_stop_when_their_dataset_leaves_it(self):
        from df_collector import catalog

        with tempfile.TemporaryDirectory() as tmp:
            config = Config(data_dir=tmp)
            state = State(config.db_path)
            collector = Collector(config, state, client=FakeClient("{}"), policy=POLICY)
            task = POLICY.task(TASK)
            self.assertIn("waiting", collector.hosted_gate(task))
            hosted = catalog.parse_root(ROOT_BODY)
            state.set("catalog", json.dumps({"fetched_at": __import__("time").time(), "hosted": hosted, "plan": catalog.capture_plan(POLICY, hosted)}))
            self.assertIsNone(collector.hosted_gate(task))
            hosted.pop("product-recalls")  # the dataset is withdrawn from the live catalog
            state.set("catalog", json.dumps({"fetched_at": __import__("time").time(), "hosted": hosted, "plan": catalog.capture_plan(POLICY, hosted)}))
            self.assertIn("not a member", collector.hosted_gate(task))
            # An API root without registry keys (a Worker before ADR-0017) maps to nothing: fail closed.
            bare = catalog.parse_root(json.dumps({"datasets": {"product-recalls": {"docs": "x"}}}).encode())
            self.assertEqual(catalog.capture_plan(POLICY, bare)["hosted_sources"], [])
