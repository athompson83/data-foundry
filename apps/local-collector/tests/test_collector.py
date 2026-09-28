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
        # A prohibited domain is refused even when a policy lists it as allowed (read from the list, never written here).
        domain = POLICY.prohibited_domains[0]
        prohibited = fetcher(allowed_hosts=(domain,))
        with self.assertRaisesRegex(FetchRefused, "prohibited"):
            prohibited.check_url(f"https://www.{domain}/search")
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
        self.current = ""

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
        # Acknowledged uploads are deleted at once; only the count remains.
        self.assertIsNone(self.state.one("SELECT 1 FROM outbox"))
        self.assertEqual(self.state.counts()["outbox"], {"acked": 1})
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
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.config = Config(data_dir=self.tmp.name)
        self.state = State(self.config.db_path)
        for recall_id in ("cpsc-00001", "cpsc-00002"):
            Collector(self.config, self.state, client=FakeClient("{}"), policy=POLICY).queue_documents([{"id": recall_id, "raw": RECORD, "provenance": {"raw_sha256": recall_id * 2}}])

    def docs(self):
        return {r["recall_id"]: (r["state"], r["attempts"], r["server_errors"]) for r in self.state.q("SELECT recall_id, state, attempts, server_errors FROM document")}

    def test_a_notice_the_model_refuses_is_dead_lettered_and_the_queue_moves_on(self):
        class Refusing(FakeClient):
            def chat_json(self, *args, **kwargs):
                raise LocalModelError("local Ollama failed /api/chat: HTTP 400 bad input", request_failed=True, status=400)

        collector = Collector(self.config, self.state, client=Refusing("{}"), policy=POLICY)
        for _ in range(5):
            collector.extract_one()
        docs = self.docs()
        self.assertEqual(docs["cpsc-00001"][:2], ("failed", 3))
        self.assertEqual(docs["cpsc-00002"][:2], ("queued", 2))

    def test_a_server_error_charges_no_notice_and_waits_for_the_server(self):
        class Down(FakeClient):
            def chat_json(self, *args, **kwargs):
                raise LocalModelError("local Ollama failed /api/chat: HTTP 503 runner crashed", request_failed=True, status=503)

        collector = Collector(self.config, self.state, client=Down("{}"), policy=POLICY)
        for _ in range(6):
            with self.assertRaises(LocalModelError) as raised:
                collector.extract_one()
            self.assertFalse(raised.exception.request_failed)  # handled as an outage by tick()
        docs = self.docs()
        self.assertEqual({d[0] for d in docs.values()}, {"queued"})
        self.assertEqual({d[1] for d in docs.values()}, {0})
        # No success preceded these errors, so this is an outage: no notice is charged at all.
        self.assertEqual(sum(d[2] for d in docs.values()), 0)

    def test_a_notice_that_keeps_failing_while_others_succeed_is_set_aside(self):
        class Flaky(FakeClient):
            """Fails only on cpsc-00001; every other notice succeeds."""

            def chat_json(self, system, user, schema, seed=0):
                if "cpsc-00001" in self.current:
                    raise LocalModelError("local Ollama failed /api/chat: HTTP 500", request_failed=True, status=500)
                return super().chat_json(system, user, schema, seed)

        client = Flaky(json.dumps({"identifiers": []}))
        collector = Collector(self.config, self.state, client=client, policy=POLICY)
        for n in range(3):
            # A healthy extraction of another notice, then the poison notice fails right after it.
            Collector(self.config, self.state, client=client, policy=POLICY).queue_documents([{"id": f"cpsc-1000{n}", "raw": RECORD, "provenance": {"raw_sha256": f"b{n}" * 32}}])
            with self.state.tx() as db:
                db.execute("UPDATE document SET retrieved_at = CASE WHEN recall_id = ? THEN 0 WHEN recall_id = 'cpsc-00001' THEN 1 ELSE 9e9 END WHERE state = 'queued'", (f"cpsc-1000{n}",))
            client.current = f"cpsc-1000{n}"
            collector.extract_one()
            client.current = "cpsc-00001"
            with self.assertRaises(LocalModelError):
                collector.extract_one()
        self.assertEqual(self.docs()["cpsc-00001"][0], "failed")
        self.assertEqual(self.docs()["cpsc-00002"][0], "queued")

    def test_a_long_outage_cycling_the_backlog_sets_nothing_aside(self):
        class Down(FakeClient):
            def chat_json(self, *args, **kwargs):
                raise LocalModelError("local Ollama failed /api/chat: HTTP 503", request_failed=True, status=503)

        self.state.set("last_model_outcome", "success")  # the server was healthy, then went down
        collector = Collector(self.config, self.state, client=Down("{}"), policy=POLICY)
        for _ in range(20):  # ten passes over the two-notice backlog
            with self.assertRaises(LocalModelError):
                collector.extract_one()
        collector.client = FakeClient(json.dumps({"identifiers": []}))
        collector.extract_one()  # recovery
        states = [d[0] for d in self.docs().values()]
        self.assertNotIn("failed", states)
        self.assertEqual(states.count("extracted"), 1)

    def test_state_files_from_before_these_columns_are_upgraded(self):
        import sqlite3

        old = Path(self.tmp.name) / "old.sqlite3"
        db = sqlite3.connect(old)
        db.execute("CREATE TABLE document (recall_id TEXT NOT NULL, raw_sha256 TEXT NOT NULL, task TEXT NOT NULL, extractor_version TEXT NOT NULL, evidence_path TEXT NOT NULL, evidence_ref TEXT, retrieved_at REAL NOT NULL, state TEXT NOT NULL, detail TEXT, latency_ms REAL, updated_at REAL NOT NULL, PRIMARY KEY (recall_id, raw_sha256, extractor_version))")
        db.commit()
        db.close()
        columns = {r[1] for r in State(old).db.execute("PRAGMA table_info(document)")}
        self.assertTrue({"attempts", "server_errors", "last_server_error_at"} <= columns)

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


class Retention(unittest.TestCase):
    """Nothing stays on this computer once Data Foundry holds it; counts survive."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.config = Config(data_dir=self.tmp.name)
        self.state = State(self.config.db_path)
        self.collector = Collector(self.config, self.state, client=FakeClient(json.dumps({"identifiers": [
            {"value": "SA904", "label": "item", "field": "Description"}, {"value": "44871", "label": "item", "field": "Description"}]})), policy=POLICY)

    def notice(self, recall_id, record):
        return {"id": recall_id, "raw": record, "provenance": {"raw_sha256": recall_id * 2}}

    def test_working_copies_exist_only_while_queued_and_skipped_notices_are_never_written(self):
        queued = self.collector.queue_documents([self.notice("cpsc-00001", RECORD), self.notice("cpsc-00002", {"Title": "Dresses", "Description": "Snaps detach.", "Products": []})])
        self.assertEqual(queued, 1)
        files = [p for p in self.config.evidence_dir.rglob("*") if p.is_file()]
        self.assertEqual(len(files), 1)
        self.assertEqual(self.state.one("SELECT evidence_path FROM document WHERE recall_id = 'cpsc-00002'")["evidence_path"], "")
        self.collector.extract_one()
        self.assertEqual([p for p in self.config.evidence_dir.rglob("*") if p.is_file()], [])
        self.assertEqual(self.state.one("SELECT state, evidence_path FROM document WHERE recall_id = 'cpsc-00001'")["evidence_path"], "")

    def test_sweep_deletes_final_candidates_and_orphans_but_keeps_counts(self):
        self.collector.queue_documents([self.notice("cpsc-00001", RECORD)])
        self.collector.extract_one()
        with self.state.tx() as db:
            db.execute("UPDATE candidate SET server_status = 'accepted', queryable = 1 WHERE value = 'SA904'")
        orphan = self.config.evidence_dir / "ab" / "orphan.json"
        orphan.parent.mkdir(parents=True, exist_ok=True)
        orphan.write_text("{}")
        removed = self.state.sweep(self.config.evidence_dir)
        self.assertEqual(removed["candidates"], 2)
        self.assertFalse(orphan.exists())
        self.assertIsNone(self.state.one("SELECT 1 FROM candidate"))
        counts = self.state.counts()
        self.assertEqual(counts["candidates_local"], {"accepted": 1, "rejected": 1})
        self.assertEqual(counts["candidates_server"], {"accepted": 1})
        self.assertEqual(counts["queryable"], 1)

    def test_unverified_accepted_candidates_wait_for_read_back(self):
        self.collector.queue_documents([self.notice("cpsc-00001", RECORD)])
        self.collector.extract_one()
        with self.state.tx() as db:
            db.execute("UPDATE candidate SET server_status = 'accepted' WHERE value = 'SA904'")
        self.state.sweep(self.config.evidence_dir)
        self.assertEqual(self.state.one("SELECT value FROM candidate")["value"], "SA904")

    def test_cap_pause_lifts_itself(self):
        self.state.set("paused", "cap: disk cap reached")
        self.collector.check_caps = lambda: None
        self.collector.tick()
        self.assertIsNone(self.state.paused())
        self.state.set("paused", "paused from the dashboard")
        self.collector.tick()
        self.assertEqual(self.state.paused(), "paused from the dashboard")

    def test_purge_refuses_while_notices_wait_and_force_rewinds_the_backfill(self):
        from df_collector.__main__ import main

        self.collector.queue_documents([self.notice("cpsc-00001", RECORD)])
        with self.state.tx() as db:
            self.state.set_cursor(db, TASK, "backfill_cursor", "abc")
        self.assertEqual(main(["--data-dir", self.tmp.name, "purge"]), 1)
        self.assertEqual(main(["--data-dir", self.tmp.name, "purge", "--force"]), 0)
        state = State(self.config.db_path)
        self.assertIsNone(state.one("SELECT 1 FROM document"))
        self.assertIsNone(state.cursor(TASK, "backfill_cursor"))

    def test_a_missing_working_copy_rewinds_instead_of_crashing(self):
        self.collector.queue_documents([self.notice("cpsc-00001", RECORD)])
        for path in self.config.evidence_dir.rglob("*.json"):
            path.unlink()
        with self.state.tx() as db:
            self.state.set_cursor(db, TASK, "backfill_done", "1")
        self.assertTrue(self.collector.extract_one())
        self.assertIsNone(self.state.one("SELECT 1 FROM document"))
        self.assertIsNone(self.state.cursor(TASK, "backfill_done"))

    def test_purge_refuses_with_uploads_owed_then_leaves_no_notice_data(self):
        from df_collector.__main__ import main

        self.collector.queue_documents([self.notice("cpsc-00001", RECORD)])
        self.collector.extract_one()
        self.assertEqual(main(["--data-dir", self.tmp.name, "purge"]), 1)
        with self.state.tx() as db:
            db.execute("DELETE FROM outbox")
        self.assertEqual(main(["--data-dir", self.tmp.name, "purge"]), 0)
        state = State(self.config.db_path)
        self.assertIsNone(state.one("SELECT 1 FROM candidate"))
        self.assertFalse(self.config.evidence_dir.exists())
        self.assertEqual(main(["--data-dir", self.tmp.name, "purge", "--everything"]), 0)
        self.assertFalse(Path(self.tmp.name).exists())


class CatalogRecheck(unittest.TestCase):
    def test_a_task_waiting_on_the_catalog_rechecks_it_hourly(self):
        from df_collector import catalog
        from df_collector.runtime import CATALOG_RETRY_S

        with tempfile.TemporaryDirectory() as tmp:
            config = Config(data_dir=tmp)
            state = State(config.db_path)
            collector = Collector(config, state, client=FakeClient("{}"), policy=POLICY)
            hosted = catalog.parse_root(ROOT_BODY)
            hosted.pop("product-recalls")
            now = __import__("time").time()
            state.set("catalog", json.dumps({"fetched_at": now, "hosted": hosted, "plan": catalog.capture_plan(POLICY, hosted)}))
            state.ensure_job("catalog", "catalog", "catalog", {}, due_at=now + 86400)
            collector.refresh_catalog = lambda task: None  # not due, so not called
            collector.tick()
            due = state.one("SELECT due_at FROM job WHERE kind = 'catalog'")["due_at"]
            self.assertLessEqual(due, now + CATALOG_RETRY_S + 5)


class CodexRegressions(unittest.TestCase):
    def test_uploader_never_follows_a_redirect_with_the_credential(self):
        seen = []

        class Recorder(BaseHTTPRequestHandler):
            def log_message(self, *args):
                return

            def do_GET(self):
                seen.append(self.headers.get("Authorization"))
                self.send_response(200)
                self.end_headers()

            do_POST = do_GET

        elsewhere = ThreadingHTTPServer(("127.0.0.1", 0), Recorder)
        threading.Thread(target=elsewhere.serve_forever, daemon=True).start()
        self.addCleanup(elsewhere.server_close)
        self.addCleanup(elsewhere.shutdown)
        target = f"http://127.0.0.1:{elsewhere.server_address[1]}/steal"

        class Redirector(BaseHTTPRequestHandler):
            def log_message(self, *args):
                return

            def do_POST(self):
                self.rfile.read(int(self.headers.get("Content-Length") or 0))
                self.send_response(302)
                self.send_header("Location", target)
                self.send_header("Content-Length", "0")
                self.end_headers()

        intake = ThreadingHTTPServer(("127.0.0.1", 0), Redirector)
        threading.Thread(target=intake.serve_forever, daemon=True).start()
        self.addCleanup(intake.server_close)
        self.addCleanup(intake.shutdown)
        with tempfile.TemporaryDirectory() as tmp:
            config = Config(data_dir=tmp, api_origin=f"http://127.0.0.1:{intake.server_address[1]}")
            config.secrets_dir.mkdir(parents=True)
            (config.secrets_dir / "ingest-token").write_text("dfi_" + "b" * 40)
            state = State(config.db_path)
            with state.tx() as db:
                state.outbox_add(db, "e" * 64, {"task": TASK, "extractor": {}, "notices": []})
            import os

            os.environ.setdefault("NO_PROXY", "127.0.0.1")
            self.assertFalse(Uploader(config, state, POLICY).send_one())
            self.assertEqual(seen, [])
            row = state.one("SELECT state, last_error FROM outbox")
            self.assertEqual(row["state"], "pending")
            self.assertIn("redirect refused", row["last_error"])

    def test_the_daily_allowance_pauses_jobs_without_dead_lettering_them(self):
        from df_collector import catalog

        with tempfile.TemporaryDirectory() as tmp:
            config = Config(data_dir=tmp)
            config.limits.max_api_requests_per_day = 0
            state = State(config.db_path)
            collector = Collector(config, state, client=FakeClient("{}"), policy=POLICY)
            hosted = catalog.parse_root(ROOT_BODY)
            state.set("catalog", json.dumps({"fetched_at": __import__("time").time(), "hosted": hosted, "plan": catalog.capture_plan(POLICY, hosted)}))
            for _ in range(12):
                with state.tx() as db:
                    db.execute("UPDATE job SET due_at = 0")
                collector.tick()
            jobs = {r["kind"]: (r["state"], r["attempts"]) for r in state.q("SELECT kind, state, attempts FROM job")}
            self.assertEqual(jobs["read"], ("pending", 0))
            self.assertEqual(jobs["catalog"], ("pending", 0))
            self.assertGreater(state.one("SELECT due_at FROM job WHERE kind = 'read'")["due_at"], __import__("time").time() + 50)


class DiskCap(unittest.TestCase):
    def test_a_disk_cap_stops_reading_but_keeps_draining(self):
        from df_collector import catalog

        with tempfile.TemporaryDirectory() as tmp:
            config = Config(data_dir=tmp)
            state = State(config.db_path)
            collector = Collector(config, state, client=FakeClient(json.dumps({"identifiers": []})), policy=POLICY)
            collector.queue_documents([{"id": "cpsc-00001", "raw": RECORD, "provenance": {"raw_sha256": "a" * 64}}])
            hosted = catalog.parse_root(ROOT_BODY)
            state.set("catalog", json.dumps({"fetched_at": __import__("time").time(), "hosted": hosted, "plan": catalog.capture_plan(POLICY, hosted)}))
            state.ensure_job("catalog", "catalog", "catalog", {}, due_at=__import__("time").time() + 86400)
            collector.check_caps = lambda: "disk cap reached (3000 MB of 2048 MB)"
            collector.read_page = lambda task: self.fail("must not read while a cap is reached")
            collector.tick()
            self.assertIsNone(state.paused())
            self.assertEqual(state.one("SELECT state FROM document")["state"], "extracted")
            self.assertEqual([p for p in config.evidence_dir.rglob("*") if p.is_file()], [])


class RecurringJobs(unittest.TestCase):
    def test_transient_failures_never_dead_letter_a_recurring_job(self):
        with tempfile.TemporaryDirectory() as tmp:
            now = [1000.0]
            state = State(Path(tmp) / "s.sqlite3", clock=lambda: now[0])
            state.ensure_job("read", TASK, "k", {})
            for _ in range(30):
                now[0] += 10**6
                job = state.claim("w", ("read",))
                self.assertEqual(state.fail(job["id"], "w", "503 from api", recurring=True), "pending")
            self.assertLessEqual(state.one("SELECT due_at FROM job")["due_at"] - now[0], 6 * 3600)


class BuildKeys(unittest.TestCase):
    def test_a_new_model_build_re_extracts_under_its_own_keys(self):
        with tempfile.TemporaryDirectory() as tmp:
            config = Config(data_dir=tmp)
            state = State(config.db_path)
            notice = {"id": "cpsc-00001", "raw": RECORD, "provenance": {"raw_sha256": "a" * 64}}
            first = Collector(config, state, client=FakeClient(json.dumps({"identifiers": [{"value": "SA904", "label": "item", "field": "Description"}]})), policy=POLICY)
            self.assertEqual(first.queue_documents([notice]), 1)
            first.extract_one()
            config.model_digest = "aa11bb22cc33"  # the documented model switch
            second = Collector(config, state, client=FakeClient(json.dumps({"identifiers": [{"value": "SA904", "label": "item", "field": "Description"}]})), policy=POLICY)
            self.assertEqual(second.queue_documents([notice]), 1)  # not skipped
            second.extract_one()
            keys = [json.loads(r["payload"])["build"] for r in state.q("SELECT payload FROM outbox")]
            self.assertEqual(len(set(r["idempotency_key"] for r in state.q("SELECT idempotency_key FROM outbox"))), 2)
            self.assertEqual({k.split("|")[1] for k in keys}, {"2a654d98e6fb", "aa11bb22cc33"})
            self.assertTrue(all("build" not in json.loads(r["payload"]).get("extractor", {}) for r in state.q("SELECT payload FROM outbox")))


class CodexRegressionsRound5(unittest.TestCase):
    def test_the_uploader_never_sends_the_credential_over_plain_http_to_a_policy_host(self):
        with tempfile.TemporaryDirectory() as tmp:
            config = Config(data_dir=tmp, api_origin="http://api.data.aroqon.com")
            config.secrets_dir.mkdir(parents=True)
            (config.secrets_dir / "ingest-token").write_text("dfi_" + "c" * 40)
            state = State(config.db_path)
            with state.tx() as db:
                state.outbox_add(db, "d" * 64, {"task": TASK, "extractor": {}, "notices": []})
            opener = FakeOpener([])
            self.assertFalse(Uploader(config, state, POLICY, opener=opener).send_one())
            self.assertEqual(opener.requests, [])
            row = state.one("SELECT state, last_error FROM outbox")
            self.assertEqual(row["state"], "pending")
            self.assertIn("https", row["last_error"])

    def test_catalog_refresh_stops_fetching_stats_at_the_daily_cap(self):
        class Fetcher:
            def __init__(self):
                self.urls = []

            def get(self, url, headers=None, check_robots=True):
                self.urls.append(url)
                return type("R", (), {"body": ROOT_BODY if url.endswith("/") else b"{}"})()

        with tempfile.TemporaryDirectory() as tmp:
            config = Config(data_dir=tmp)
            config.limits.max_api_requests_per_day = 1  # the root only; two stats URLs would exceed it
            state = State(config.db_path)
            collector = Collector(config, state, client=FakeClient("{}"), policy=POLICY)
            collector.fetcher = fake = Fetcher()
            snapshot = collector.refresh_catalog(POLICY.task(TASK))
            self.assertEqual(fake.urls, ["https://api.data.aroqon.com/"])
            self.assertEqual(collector._requests_today(), 1)
            self.assertEqual(set(snapshot["hosted"]), {"recalls", "product-recalls"})
            self.assertTrue(all("cap" in f["error"] for f in snapshot["freshness"].values()))

    def test_a_taken_dashboard_port_fails_before_the_uploader_is_spawned(self):
        from unittest import mock

        from df_collector import __main__ as cli

        taken = socket.socket()
        taken.bind(("127.0.0.1", 0))
        taken.listen(1)
        self.addCleanup(taken.close)
        with tempfile.TemporaryDirectory() as tmp:
            config = Config(data_dir=tmp, dashboard_port=taken.getsockname()[1])
            with mock.patch.object(cli.subprocess, "Popen") as popen:
                with self.assertRaises(OSError):
                    cli.cmd_run(config, None)
            popen.assert_not_called()


class CodexRegressionsRound6(unittest.TestCase):
    def test_the_dashboard_reports_the_last_successful_upload(self):
        from df_collector.dashboard import snapshot

        with tempfile.TemporaryDirectory() as tmp:
            config = Config(data_dir=tmp)
            config.secrets_dir.mkdir(parents=True)
            (config.secrets_dir / "ingest-token").write_text("dfi_" + "a" * 40)
            state = State(config.db_path)
            with state.tx() as db:
                state.outbox_add(db, "f" * 64, {"task": TASK, "extractor": {}, "notices": []})
            self.assertIsNone(snapshot(config, state, None)["last"]["upload"])
            ok = {"extractor_version": extract.EXTRACTOR_VERSION, "accepted": 0, "replayed": 0, "rejected": 0, "results": []}
            self.assertTrue(Uploader(config, state, POLICY, opener=FakeOpener([ok])).send_one())
            self.assertIsNone(state.one("SELECT 1 FROM outbox"))
            self.assertIsNotNone(snapshot(config, state, None)["last"]["upload"])

    def test_read_back_does_not_keep_unserved_candidates_young(self):
        import time as _time

        with tempfile.TemporaryDirectory() as tmp:
            config = Config(data_dir=tmp)
            state = State(config.db_path)
            collector = Collector(config, state, client=FakeClient("{}"), policy=POLICY)
            accepted_at = _time.time() - 6 * 86400
            with state.tx() as db:
                db.execute("INSERT INTO candidate (recall_id, raw_sha256, extractor_version, value, field, label, local_decision, server_status, updated_at) VALUES ('cpsc-15034', 'r', ?, 'SA904', 'Description', 'item', 'accepted', 'accepted', ?)", (collector.build, accepted_at))
            calls = []

            def api_get(task, path, params):
                calls.append(path)
                return {"data": {"provenance": {"raw_sha256": "r"}, "extracted_identifiers": []}}  # gate closed: nothing served

            collector.api_get = api_get
            task = POLICY.task(TASK)
            self.assertEqual(collector.verify_queryable(task), 0)
            row = state.one("SELECT updated_at, checked_at, queryable FROM candidate")
            self.assertEqual(row["updated_at"], accepted_at)
            self.assertIsNotNone(row["checked_at"])
            collector.verify_queryable(task)
            self.assertEqual(len(calls), 1)  # re-checked at most hourly
            # A day later it is past the seven-day retention and the sweep removes it.
            with state.tx() as db:
                db.execute("UPDATE candidate SET updated_at = updated_at - 86400")
            state.sweep(config.evidence_dir)
            self.assertIsNone(state.one("SELECT 1 FROM candidate"))

    def test_older_state_files_gain_the_checked_at_column(self):
        import sqlite3

        with tempfile.TemporaryDirectory() as tmp:
            config = Config(data_dir=tmp)
            State(config.db_path).db.close()
            db = sqlite3.connect(str(config.db_path))
            db.execute("ALTER TABLE candidate DROP COLUMN checked_at")
            db.close()
            state = State(config.db_path)
            self.assertIn("checked_at", {r[1] for r in state.db.execute("PRAGMA table_info(candidate)")})


class CodexRegressionsRound7(unittest.TestCase):
    def test_an_exited_uploader_is_restarted_with_backoff_and_the_collector_keeps_running(self):
        from df_collector.__main__ import UploaderSupervisor

        class Child:
            def __init__(self, pid):
                self.pid, self.returncode = pid, None

            def poll(self):
                return self.returncode

        spawned = []

        def spawn():
            spawned.append(Child(len(spawned) + 1))
            return spawned[-1]

        now = [0.0]
        with tempfile.TemporaryDirectory() as tmp:
            state = State(Config(data_dir=tmp).db_path)
            sup = UploaderSupervisor(spawn, state, clock=lambda: now[0])
            sup.check()
            self.assertEqual(len(spawned), 1)
            spawned[0].returncode = 1  # crashed
            sup.check()
            now[0] += 29
            sup.check()
            self.assertEqual(len(spawned), 1)  # still backing off
            now[0] += 1
            sup.check()
            self.assertEqual(len(spawned), 2)
            spawned[1].returncode = 1  # crashes again at once: the backoff doubles
            sup.check()
            now[0] += 59
            sup.check()
            self.assertEqual(len(spawned), 2)
            now[0] += 1
            sup.check()
            self.assertEqual(len(spawned), 3)
            now[0] += 700  # runs healthily, then crashes: the backoff resets
            spawned[2].returncode = 1
            sup.check()
            now[0] += 30
            sup.check()
            self.assertEqual(len(spawned), 4)
            kinds = [r["kind"] for r in state.q("SELECT kind FROM event ORDER BY id")]
            self.assertEqual(kinds.count("uploader_exited"), 3)
            self.assertEqual(kinds.count("uploader_restarted"), 3)


class CodexRegressionsRound8(unittest.TestCase):
    def test_read_back_marks_only_this_builds_candidates_and_only_for_this_builds_rows(self):
        with tempfile.TemporaryDirectory() as tmp:
            config = Config(data_dir=tmp)
            state = State(config.db_path)
            collector = Collector(config, state, client=FakeClient("{}"), policy=POLICY)
            with state.tx() as db:
                for build in (collector.build, "experimental-build"):
                    db.execute("INSERT INTO candidate (recall_id, raw_sha256, extractor_version, value, field, label, local_decision, server_status, updated_at) VALUES ('cpsc-15034', 'r', ?, 'SA904', 'Description', 'item', 'accepted', 'accepted', 0)", (build,))
            mine = {"key": "SA904", "extractor_version": extract.EXTRACTOR_VERSION, "model": config.model, "model_digest": "sha256:" + config.model_digest + "a" * 52, "prompt_sha256": extract.prompt_sha256()}
            served = [dict(mine, prompt_sha256="f" * 64)]  # the same key, served from another build
            collector.api_get = lambda task, path, params: {"data": {"provenance": {"raw_sha256": "r"}, "extracted_identifiers": served}}
            task = POLICY.task(TASK)
            self.assertEqual(collector.verify_queryable(task), 0)
            served[:] = [mine]
            with state.tx() as db:
                db.execute("UPDATE candidate SET checked_at = NULL")
            self.assertEqual(collector.verify_queryable(task), 1)
            rows = {r["extractor_version"]: r["queryable"] for r in state.q("SELECT extractor_version, queryable FROM candidate")}
            self.assertEqual(rows, {collector.build: 1, "experimental-build": 0})

    def test_the_uploader_gets_absolute_paths_for_a_relative_config(self):
        import os

        from df_collector.__main__ import uploader_args

        with tempfile.TemporaryDirectory() as tmp:
            cwd = os.getcwd()
            os.chdir(tmp)
            self.addCleanup(os.chdir, cwd)
            args = uploader_args(Config(data_dir="data"), "collector.json")
            self.assertEqual(args[args.index("--config") + 1], str(Path(tmp).resolve() / "collector.json"))
            self.assertEqual(args[args.index("--data-dir") + 1], str(Path(tmp).resolve() / "data"))
