import io
import json
import re
import socket
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from df_collector import extract, policy as policy_mod, validate
from df_collector.behaviour import behaviour_sha256
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
        listed = {"/api/tags": {"models": [{"name": "qwen3.5:4b", "digest": "2a654d98e6fb", "size": 0}]}, "/api/show": {"details": {}}, "/api/version": {"version": "0.34.4"}}
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

        return ModelIdentity("qwen3.5:4b", "2a654d98e6fb", "qwen35", "4.7B", "Q4_K_M", "Apache License", "ollama/0.34.4")

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
            self.state.outbox_add(db, "f" * 64, {"task": TASK, "extractor": {}, "notices": [{"recall_id": "cpsc-15034", "raw_sha256": "r", "candidates": [{"value": "SA904", "field": "Description", "label": "item"}]}]})

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

    def test_credential_refusal_pauses_uploads_and_bad_requests_are_kept(self):
        uploader, _ = self.uploader([http_error(401)])
        uploader.send_one()
        self.assertTrue(self.state.get("uploader_paused"))
        self.assertEqual(self.state.one("SELECT state FROM outbox")["state"], "pending")
        with self.state.tx() as db:
            db.execute("UPDATE outbox SET next_attempt_at = 0")
        uploader, _ = self.uploader([http_error(400)])
        uploader.send_one()
        # A rejected upload stays owed (retried later), never dead-lettered.
        self.assertEqual(self.state.one("SELECT state FROM outbox")["state"], "pending")

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
            self.assertEqual({k.split("|")[2] for k in keys}, {"2a654d98e6fb", "aa11bb22cc33"})
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
            mine = {"key": "SA904", "extractor_version": extract.EXTRACTOR_VERSION, "model": config.model, "model_digest": "sha256:" + config.model_digest + "a" * 52, "prompt_sha256": extract.prompt_sha256(), "generation": '{"num_ctx":8192,"think":false}', "behaviour_sha256": behaviour_sha256()}
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


class CodexRegressionsRound9(unittest.TestCase):
    def run_set_secret(self, config, name, value):
        import contextlib
        import sys as _sys
        from unittest import mock

        from df_collector.__main__ import cmd_set_secret

        with mock.patch.object(_sys, "stdin", io.StringIO(value + "\n")), contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            return cmd_set_secret(config, name)

    def test_set_secret_refuses_truncated_values_and_revives_refused_jobs(self):
        with tempfile.TemporaryDirectory() as tmp:
            config = Config(data_dir=tmp)
            self.assertEqual(self.run_set_secret(config, "read-api-key", "rcl_live_" + "a" * 31), 2)
            self.assertEqual(self.run_set_secret(config, "ingest-token", "dfi_" + "b" * 39), 2)
            self.assertEqual(self.run_set_secret(config, "ingest-token", "dfi_" + "b" * 39 + "!"), 2)
            self.assertFalse((config.secrets_dir / "read-api-key").exists())
            state = State(config.db_path)
            state.ensure_job("read", TASK, f"{TASK}:read", {})
            with state.tx() as db:
                db.execute("UPDATE job SET state = 'refused', last_error = '401'")
            state.set("uploader_paused", "intake refused the credential (401)")
            self.assertEqual(self.run_set_secret(config, "read-api-key", "rcl_live_" + "a" * 32), 0)
            self.assertEqual(state.one("SELECT state FROM job")["state"], "pending")
            self.assertEqual(self.run_set_secret(config, "ingest-token", "dfi_" + "b" * 40), 0)
            self.assertFalse(state.get("uploader_paused"))

    def test_saving_limits_writes_back_to_the_loaded_config_file(self):
        from df_collector.config import load

        with tempfile.TemporaryDirectory() as tmp:
            custom = Path(tmp) / "custom.json"
            custom.write_text(json.dumps({"api_origin": "https://api.data.aroqon.com", "limits": {"max_queue": 7}}))
            config = load(str(custom), data_dir=str(Path(tmp) / "data"))
            config.limits.max_queue = 9
            self.assertEqual(config.save(), custom.resolve())
            self.assertEqual(load(str(custom), data_dir=str(Path(tmp) / "data")).limits.max_queue, 9)
            self.assertNotIn("source_path", json.loads(custom.read_text()))
            self.assertFalse((Path(tmp) / "data" / "collector.json").exists())


class CodexRegressionsRound10(unittest.TestCase):
    def test_the_local_build_id_includes_the_model_name(self):
        self.assertNotEqual(extract.build_id("qwen3.5:4b", "2a654d98e6fb"), extract.build_id("qwen-alias:latest", "2a654d98e6fb"))
        with tempfile.TemporaryDirectory() as tmp:
            config = Config(data_dir=tmp)
            collector = Collector(config, State(config.db_path), client=FakeClient("{}"), policy=POLICY)
            self.assertIn(f"|{config.model}|", collector.build)

    def test_the_prefilter_passes_a_populated_model_field_and_the_validators_code_shapes(self):
        # The only identifier sits in Products[0].Model and no text says "model"; slash forms count as codes.
        self.assertTrue(worth_extracting({"Title": "Lamps recalled", "Description": "The lamps can overheat.", "Products": [{"Name": "Desk lamp", "Model": "AB/12"}]}))
        self.assertTrue(worth_extracting({"Title": "Kettles recalled", "Description": "Item AB/12 can leak.", "Products": []}))
        self.assertFalse(worth_extracting({"Title": "Lamps recalled", "Description": "The lamps can overheat.", "Products": [{"Name": "Desk lamp", "Model": ""}]}))

    def test_candidates_of_a_dead_lettered_upload_age_out(self):
        import time as _time

        with tempfile.TemporaryDirectory() as tmp:
            config = Config(data_dir=tmp)
            state = State(config.db_path)
            old = _time.time() - 8 * 86400
            with state.tx() as db:
                for recall_id in ("cpsc-1", "cpsc-2"):
                    db.execute("INSERT INTO candidate (recall_id, raw_sha256, extractor_version, value, field, label, local_decision, updated_at) VALUES (?, 'r', 'b', 'SA904', 'Description', 'item', 'accepted', ?)", (recall_id, old))
                state.outbox_add(db, "1" * 64, {"task": TASK, "build": "b", "notices": [{"recall_id": "cpsc-1", "raw_sha256": "r"}]})
                state.outbox_add(db, "2" * 64, {"task": TASK, "build": "b", "notices": [{"recall_id": "cpsc-2", "raw_sha256": "r"}]})
                db.execute("UPDATE outbox SET state = 'dead' WHERE idempotency_key = ?", ("1" * 64,))
            state.sweep(config.evidence_dir)
            # cpsc-1's upload was dead-lettered: its candidate goes. cpsc-2's upload is still owed: its candidate stays.
            self.assertEqual([r["recall_id"] for r in state.q("SELECT recall_id FROM candidate")], ["cpsc-2"])


class CodexRegressionsRound11(unittest.TestCase):
    def test_a_failed_restart_spawn_is_retried_on_the_backoff(self):
        from df_collector.__main__ import UploaderSupervisor

        class Child:
            def __init__(self):
                self.pid, self.returncode = 1, None

            def poll(self):
                return self.returncode

        attempts = []

        def spawn():
            attempts.append(1)
            if len(attempts) == 2:
                raise OSError("resource temporarily unavailable")
            return Child()

        now = [0.0]
        with tempfile.TemporaryDirectory() as tmp:
            state = State(Config(data_dir=tmp).db_path)
            sup = UploaderSupervisor(spawn, state, clock=lambda: now[0])
            sup.child.returncode = 1
            sup.check()
            now[0] += 30
            sup.check()  # the restart spawn fails: logged, rescheduled, no exception
            self.assertIsNotNone(sup.restart_at)
            now[0] += 60
            sup.check()
            self.assertEqual(len(attempts), 3)
            self.assertIsNone(sup.restart_at)
            kinds = [r["kind"] for r in state.q("SELECT kind FROM event ORDER BY id")]
            self.assertIn("uploader_spawn_failed", kinds)
            self.assertEqual(kinds[-1], "uploader_restarted")


class CodexRegressionsRound12(unittest.TestCase):
    def test_an_acknowledgement_updates_only_the_source_version_it_was_submitted_against(self):
        with tempfile.TemporaryDirectory() as tmp:
            config = Config(data_dir=tmp)
            config.secrets_dir.mkdir(parents=True)
            (config.secrets_dir / "ingest-token").write_text("dfi_" + "a" * 40)
            state = State(config.db_path)
            with state.tx() as db:
                for raw in ("old", "new"):
                    db.execute("INSERT INTO candidate (recall_id, raw_sha256, extractor_version, value, field, label, local_decision, updated_at) VALUES ('cpsc-1', ?, 'b', 'SA904', 'Description', 'item', 'accepted', 0)", (raw,))
                state.outbox_add(db, "1" * 64, {"task": TASK, "build": "b", "notices": [{"recall_id": "cpsc-1", "raw_sha256": "old", "candidates": []}]})
            answer = {"extractor_version": "v", "accepted": 0, "replayed": 0, "rejected": 1, "results": [{"recall_id": "cpsc-1", "candidates": [{"value": "SA904", "field": "Description", "status": "rejected", "reason": "not_in_source"}]}]}
            self.assertTrue(Uploader(config, state, POLICY, opener=FakeOpener([answer])).send_one())
            rows = {r["raw_sha256"]: r["server_status"] for r in state.q("SELECT raw_sha256, server_status FROM candidate")}
            self.assertEqual(rows, {"old": "rejected", "new": None})


class CodexRegressionsRound13(unittest.TestCase):
    def test_generation_settings_are_part_of_the_build_and_reported_to_the_intake(self):
        self.assertEqual(extract.build_id("qwen3.5:4b", "2a654d98e6fb"), extract.build_id("qwen3.5:4b", "2a654d98e6fb", 8192, False))
        self.assertNotEqual(extract.build_id("qwen3.5:4b", "2a654d98e6fb"), extract.build_id("qwen3.5:4b", "2a654d98e6fb", 4096, False))
        self.assertNotEqual(extract.build_id("qwen3.5:4b", "2a654d98e6fb"), extract.build_id("qwen3.5:4b", "2a654d98e6fb", 8192, "low"))
        with tempfile.TemporaryDirectory() as tmp:
            config = Config(data_dir=tmp, num_ctx=4096)
            state = State(config.db_path)
            client = FakeClient(json.dumps({"identifiers": [{"value": "SA904", "label": "item", "field": "Description"}]}))
            collector = Collector(config, state, client=client, policy=POLICY)
            self.assertTrue(collector.build.endswith("|ctx4096-thinkfalse"))
            collector.queue_documents([{"id": "cpsc-15034", "raw": RECORD, "provenance": {"raw_sha256": "a" * 64}}])
            collector.extract_one()
            payload = json.loads(state.one("SELECT payload FROM outbox")["payload"])
            self.assertEqual(payload["extractor"]["generation"], {"num_ctx": 4096, "think": False})


class CodexRegressionsRound14(unittest.TestCase):
    def collector(self, client):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        config = Config(data_dir=tmp.name)
        state = State(config.db_path)
        collector = Collector(config, state, client=client, policy=POLICY)
        collector.queue_documents([{"id": "cpsc-15034", "raw": RECORD, "provenance": {"raw_sha256": "a" * 64}}])
        return collector, state

    def test_output_that_straddles_a_model_swap_is_discarded_uncharged(self):
        from df_collector.ollama import ModelIdentity

        class Swapping(FakeClient):
            verifies = 0

            def verify(self):
                self.verifies += 1
                digest = "2a654d98e6fb" if self.verifies == 1 else "ffffffffffff"
                return ModelIdentity("qwen3.5:4b", digest, "qwen35", "4.7B", "Q4_K_M", "Apache License", "ollama/0.34.4")

        collector, state = self.collector(Swapping(json.dumps({"identifiers": [{"value": "SA904", "label": "item", "field": "Description"}]})))
        with self.assertRaises(LocalModelError):
            collector.extract_one()
        self.assertIsNone(state.one("SELECT 1 FROM outbox"))
        self.assertEqual(dict(state.one("SELECT state, attempts, server_errors FROM document")), {"state": "queued", "attempts": 0, "server_errors": 0})

    def test_the_last_queued_notice_that_keeps_failing_a_healthy_server_is_set_aside(self):
        class PoisonOnly(FakeClient):
            def chat_json(self, system, user, schema, seed=0):
                if user == "{}":  # the health probe: the server is fine
                    return super().chat_json(system, user, schema, seed)
                raise LocalModelError("local Ollama failed /api/chat: HTTP 500", request_failed=True, status=500)

        collector, state = self.collector(PoisonOnly("{}"))
        for _ in range(5):
            try:
                collector.extract_one()
            except LocalModelError:
                pass
        self.assertEqual(state.one("SELECT state FROM document")["state"], "failed")


class CodexRegressionsRound15(unittest.TestCase):
    def test_a_pending_upload_of_another_revision_does_not_keep_old_candidates(self):
        import time as _time

        with tempfile.TemporaryDirectory() as tmp:
            config = Config(data_dir=tmp)
            state = State(config.db_path)
            with state.tx() as db:
                db.execute("INSERT INTO candidate (recall_id, raw_sha256, extractor_version, value, field, label, local_decision, updated_at) VALUES ('cpsc-1', 'old', 'b', 'SA904', 'Description', 'item', 'accepted', ?)", (_time.time() - 8 * 86400,))
                # A newer source revision of the same notice is still owed an upload.
                state.outbox_add(db, "3" * 64, {"task": TASK, "build": "b", "notices": [{"recall_id": "cpsc-1", "raw_sha256": "new"}]})
            state.sweep(config.evidence_dir)
            self.assertIsNone(state.one("SELECT 1 FROM candidate"))

    def test_a_thread_override_is_reported_and_makes_its_own_build(self):
        self.assertEqual(extract.generation(8192, False), {"num_ctx": 8192, "think": False})
        self.assertEqual(extract.generation(8192, False, 4), {"num_ctx": 8192, "think": False, "num_thread": 4})
        self.assertNotEqual(extract.build_id("qwen3.5:4b", "2a654d98e6fb"), extract.build_id("qwen3.5:4b", "2a654d98e6fb", num_thread=4))

    def test_a_leftover_uploader_is_signalled_and_waited_for_before_a_new_start(self):
        import os

        from df_collector import __main__ as cli

        with tempfile.TemporaryDirectory() as tmp:
            rd = Path(tmp)
            (rd / "uploader.pid").write_text(str(os.getpid()))
            leftover = cli.ProcessLock(rd / "uploader.lock")
            self.assertTrue(leftover.acquire())  # a live uploader holds its lock
            self.assertFalse(cli.reap_leftover_uploader(rd, wait_s=2, sleep=lambda s: None))
            self.assertTrue((rd / "stop").exists())  # it was told to stop
            leftover.release()  # it exits
            self.assertTrue(cli.reap_leftover_uploader(rd, wait_s=2, sleep=lambda s: None))
            self.assertFalse((rd / "uploader.pid").exists())

    def test_the_uploader_stops_when_its_parent_collector_is_gone(self):
        from unittest import mock

        from df_collector import runtime as rt

        with tempfile.TemporaryDirectory() as tmp:
            config = Config(data_dir=tmp)
            State(config.db_path)
            with mock.patch.object(rt.Uploader, "run", lambda self: self.stop.wait(5)), mock.patch.object(rt.sys, "exit") as exited:
                started = __import__("time").monotonic()
                rt.uploader_main(config, Path(tmp) / "stop", parent_alive=lambda: False)
                self.assertLess(__import__("time").monotonic() - started, 4)
                exited.assert_called_once_with(0)


class CodexRegressionsRound16(unittest.TestCase):
    def test_read_back_stops_at_the_half_allowance_inside_the_loop(self):
        with tempfile.TemporaryDirectory() as tmp:
            config = Config(data_dir=tmp)
            config.limits.max_api_requests_per_day = 10
            state = State(config.db_path)
            collector = Collector(config, state, client=FakeClient("{}"), policy=POLICY)
            with state.tx() as db:
                for n in range(5):
                    db.execute("INSERT INTO candidate (recall_id, raw_sha256, extractor_version, value, field, label, local_decision, server_status, updated_at) VALUES (?, 'r', ?, 'SA904', 'Description', 'item', 'accepted', 'accepted', 0)", (f"cpsc-{n}", collector.build))
            for _ in range(4):
                collector._count_request()

            def api_get(task, path, params):
                collector._count_request()
                return {"data": {"provenance": {"raw_sha256": "r"}, "extracted_identifiers": []}}

            collector.api_get = api_get
            collector.verify_queryable(POLICY.task(TASK))
            self.assertEqual(collector._requests_today(), 5)  # one read-back, then the half-allowance (5) is reached

    def test_generation_settings_are_a_snapshot_taken_at_start(self):
        with tempfile.TemporaryDirectory() as tmp:
            config = Config(data_dir=tmp)
            collector = Collector(config, State(config.db_path), client=FakeClient("{}"), policy=POLICY)
            build, generation = collector.build, dict(collector.generation)
            config.limits.llm_threads = 4  # a dashboard edit while running
            self.assertEqual((collector.build, collector.generation), (build, generation))
            collector.queue_documents([{"id": "cpsc-15034", "raw": RECORD, "provenance": {"raw_sha256": "a" * 64}}])
            collector.client = FakeClient(json.dumps({"identifiers": [{"value": "SA904", "label": "item", "field": "Description"}]}))
            collector.extract_one()
            payload = json.loads(collector.state.one("SELECT payload FROM outbox")["payload"])
            self.assertEqual(payload["extractor"]["generation"], {"num_ctx": 8192, "think": False})


class CodexRegressionsRound17(unittest.TestCase):
    def test_the_behaviour_fingerprint_is_part_of_the_local_build(self):
        from unittest import mock

        from df_collector import behaviour

        current = extract.build_id("qwen3.5:4b", "2a654d98e6fb")
        self.assertIn(f"|b{behaviour.behaviour_sha256()[:12]}", current)
        with mock.patch.object(behaviour, "behaviour_sha256", lambda: "f" * 64):
            # A rules-only change (re-scored benchmark, new fingerprint) is a new build: every notice is re-extracted.
            self.assertNotEqual(extract.build_id("qwen3.5:4b", "2a654d98e6fb"), current)


class CodexRegressionsRound18(unittest.TestCase):
    def test_a_stale_pid_file_of_a_reused_pid_does_not_look_like_a_running_collector(self):
        import os

        from df_collector import __main__ as cli

        with tempfile.TemporaryDirectory() as tmp:
            config = Config(data_dir=tmp)
            rd = cli.run_dir(config)
            (rd / "collector.pid").write_text(str(os.getpid()))  # a live process, but not a collector
            self.assertIsNone(cli.running_pid(config))
            lock = cli.ProcessLock(rd / "collector.lock")
            self.assertTrue(lock.acquire())
            self.assertEqual(cli.running_pid(config), os.getpid())
            self.assertFalse(cli.ProcessLock(rd / "collector.lock").acquire())  # a second collector is refused
            lock.release()
            self.assertIsNone(cli.running_pid(config))

    def test_only_one_uploader_runs_at_a_time(self):
        import contextlib
        import sys as _sys
        from unittest import mock

        from df_collector import __main__ as cli

        with tempfile.TemporaryDirectory() as tmp:
            rd = cli.run_dir(Config(data_dir=tmp))
            held = cli.ProcessLock(rd / "uploader.lock")
            self.assertTrue(held.acquire())
            with mock.patch.object(_sys, "argv", ["df_collector", "--data-dir", tmp, "uploader"]), contextlib.redirect_stderr(io.StringIO()):
                self.assertEqual(cli.main(), 1)
            held.release()


class CodexRegressionsRound19(unittest.TestCase):
    def test_the_collector_sends_its_behaviour_fingerprint_and_reads_back_only_its_own(self):
        with tempfile.TemporaryDirectory() as tmp:
            config = Config(data_dir=tmp)
            collector = Collector(config, State(config.db_path), client=FakeClient(json.dumps({"identifiers": [{"value": "SA904", "label": "item", "field": "Description"}]})), policy=POLICY)
            collector.queue_documents([{"id": "cpsc-15034", "raw": RECORD, "provenance": {"raw_sha256": "a" * 64}}])
            collector.extract_one()
            payload = json.loads(collector.state.one("SELECT payload FROM outbox")["payload"])
            self.assertEqual(payload["extractor"]["behaviour_sha256"], behaviour_sha256())
            item = {"extractor_version": extract.EXTRACTOR_VERSION, "model": config.model, "model_digest": "sha256:" + config.model_digest + "a" * 52, "prompt_sha256": extract.prompt_sha256(), "generation": '{"num_ctx":8192,"think":false}', "behaviour_sha256": behaviour_sha256(), "runtime": "ollama/0.34.4"}
            self.assertTrue(collector._is_this_build(item))
            # The same tuple from a collector with other extraction behaviour is not this build.
            self.assertFalse(collector._is_this_build(dict(item, behaviour_sha256="e" * 64)))


class CodexRegressionsRound20(unittest.TestCase):
    def test_runs_without_console_streams_as_under_pythonw(self):
        import contextlib
        import sys as _sys
        from unittest import mock

        from df_collector import __main__ as cli

        with tempfile.TemporaryDirectory() as tmp, contextlib.ExitStack() as stack:
            stack.enter_context(mock.patch.object(_sys, "stdout", None))
            stack.enter_context(mock.patch.object(_sys, "stderr", None))
            # pythonw.exe (the Scheduled Task) gives no console streams: print() is then a no-op, so commands that
            # print to either stream still return normally.
            self.assertEqual(cli.main(["--data-dir", tmp, "set-secret", "no-such-secret"]), 2)
            self.assertEqual(cli.main(["--data-dir", tmp, "status"]), 0)
            print("started", flush=True)

    def test_the_dashboard_never_writes_request_logs_to_the_console(self):
        import inspect

        from df_collector import dashboard

        # BaseHTTPRequestHandler logs every request with sys.stderr.write, which fails without a console; the
        # dashboard's handler overrides log_message (log_error goes through it too).
        self.assertIn("def log_message(self, *args) -> None:", inspect.getsource(dashboard))


class CodexRegressionsRound21(unittest.TestCase):
    def test_the_ollama_runtime_is_part_of_the_submitted_build(self):
        with tempfile.TemporaryDirectory() as tmp:
            config = Config(data_dir=tmp)
            collector = Collector(config, State(config.db_path), client=FakeClient(json.dumps({"identifiers": [{"value": "SA904", "label": "item", "field": "Description"}]})), policy=POLICY)
            collector.queue_documents([{"id": "cpsc-15034", "raw": RECORD, "provenance": {"raw_sha256": "a" * 64}}])
            collector.extract_one()
            payload = json.loads(collector.state.one("SELECT payload FROM outbox")["payload"])
            self.assertEqual(payload["extractor"]["runtime"], "ollama/0.34.4")
            item = dict(payload["extractor"], extractor_version=extract.EXTRACTOR_VERSION, generation='{"num_ctx":8192,"think":false}')
            self.assertTrue(collector._is_this_build(item))
            # The same build served by another Ollama release is not this collector's output.
            self.assertFalse(collector._is_this_build(dict(item, runtime="ollama/0.35.0")))

    def test_verify_reports_the_runtime_and_refuses_a_server_without_a_version(self):
        client = OllamaClient("http://127.0.0.1:11434", "qwen3.5:4b", "2a654d98e6fb")
        listed = {"/api/tags": {"models": [{"name": "qwen3.5:4b", "digest": "2a654d98e6fb", "size": 3_389_971_840}]}, "/api/show": {"details": {}}, "/api/version": {"version": "0.34.4"}}
        client._request = lambda path, body=None, timeout=None: listed[path]
        self.assertEqual(client.verify().runtime, "ollama/0.34.4")
        listed["/api/version"] = {}
        with self.assertRaises(LocalModelError):
            client.verify()

    def test_an_ollama_upgrade_during_extraction_discards_the_result(self):
        versions = iter(["ollama/0.34.4", "ollama/0.35.0"])

        class Upgrading(FakeClient):
            def verify(self):
                identity = super().verify()
                identity.runtime = next(versions)
                return identity

        with tempfile.TemporaryDirectory() as tmp:
            config = Config(data_dir=tmp)
            collector = Collector(config, State(config.db_path), client=Upgrading(json.dumps({"identifiers": [{"value": "SA904", "label": "item", "field": "Description"}]})), policy=POLICY)
            collector.queue_documents([{"id": "cpsc-15034", "raw": RECORD, "provenance": {"raw_sha256": "a" * 64}}])
            with self.assertRaises(LocalModelError):
                collector.extract_one()
            self.assertIsNone(collector.state.one("SELECT payload FROM outbox"))


class CodexRegressionsRound22(unittest.TestCase):
    NOTICE = {"id": "cpsc-15034", "raw": RECORD, "provenance": {"raw_sha256": "a" * 64}}

    def test_the_local_build_includes_an_unbenchmarked_runtime(self):
        benchmarked = extract.build_id("qwen3.5:4b", "2a654d98e6fb", runtime=extract.BENCHMARKED_RUNTIME)
        self.assertEqual(benchmarked, extract.build_id("qwen3.5:4b", "2a654d98e6fb"))
        self.assertNotEqual(extract.build_id("qwen3.5:4b", "2a654d98e6fb", runtime="ollama/0.35.0"), benchmarked)

    def test_returning_to_the_benchmarked_runtime_re_extracts_notices_done_under_another(self):
        with tempfile.TemporaryDirectory() as tmp:
            config = Config(data_dir=tmp)
            state = State(config.db_path)
            collector = Collector(config, state, client=FakeClient("{}"), policy=POLICY)
            # Everything was read and extracted while an unbenchmarked Ollama release served the model.
            collector.adopt_runtime("ollama/0.35.0")
            collector.queue_documents([self.NOTICE])
            with state.tx() as db:
                db.execute("UPDATE document SET state = 'extracted'")
                state.set_cursor(db, TASK, "backfill_done", "1")
            # Back on the benchmarked release: a new build, so the backfill restarts and the notice is queued again.
            self.assertTrue(collector.adopt_runtime(extract.BENCHMARKED_RUNTIME))
            self.assertIsNone(state.cursor(TASK, "backfill_done"))
            self.assertEqual(collector.queue_documents([self.NOTICE]), 1)
            self.assertEqual(state.one("SELECT COUNT(*) AS n FROM document WHERE state = 'queued'")["n"], 1)

    def test_queued_notices_move_to_the_new_build_and_the_backfill_rewinds_once(self):
        with tempfile.TemporaryDirectory() as tmp:
            config = Config(data_dir=tmp)
            state = State(config.db_path)
            collector = Collector(config, state, client=FakeClient("{}"), policy=POLICY)
            collector.adopt_runtime(extract.BENCHMARKED_RUNTIME)
            collector.queue_documents([self.NOTICE])
            with state.tx() as db:
                state.set_cursor(db, TASK, "backfill_done", "1")
            self.assertFalse(collector.adopt_runtime(extract.BENCHMARKED_RUNTIME))  # unchanged: nothing rewinds
            self.assertEqual(state.cursor(TASK, "backfill_done"), "1")
            self.assertTrue(collector.adopt_runtime("ollama/0.35.0"))
            self.assertEqual(state.one("SELECT extractor_version FROM document WHERE state = 'queued'")["extractor_version"], collector.build)
            self.assertIsNone(state.cursor(TASK, "backfill_done"))

    def test_a_restart_under_a_changed_build_restarts_a_finished_backfill(self):
        with tempfile.TemporaryDirectory() as tmp:
            config = Config(data_dir=tmp)
            state = State(config.db_path)
            Collector(config, state, client=FakeClient("{}"), policy=POLICY).adopt_runtime(extract.BENCHMARKED_RUNTIME)
            with state.tx() as db:
                state.set_cursor(db, TASK, "backfill_done", "1")
            config.limits.llm_threads = 4  # takes effect at the next start: another build
            Collector(config, state, client=FakeClient("{}"), policy=POLICY).adopt_runtime(extract.BENCHMARKED_RUNTIME)
            self.assertIsNone(state.cursor(TASK, "backfill_done"))


class CodexRegressionsRound23(unittest.TestCase):
    def test_the_prefilter_admits_every_label_the_rules_accept(self):
        for text in ("Reference number RF-2231 is affected.", "The recalled Cat. No. 88-114B lamps.", "Stock code ST4410 was sold.", "Article # AR-77 was sold."):
            self.assertTrue(worth_extracting({"Title": "Lamps recalled", "Description": text, "Products": []}), text)
            # Each is a value the rules accept, so skipping it would lose an identifier.
            value = re.search(r"[A-Z]{2}-?\d+|\d+-\d+B", text).group(0)
            self.assertTrue(validate.decide(text, value, "Description").ok, text)
        self.assertFalse(worth_extracting({"Title": "Lamps recalled", "Description": "Lot 44871 and serial 99812 are affected.", "Products": []}))

    def test_the_prefilter_is_fingerprinted_so_a_change_re_examines_skipped_notices(self):
        from unittest import mock

        from df_collector import behaviour

        self.assertIs(worth_extracting, validate.worth_extracting)
        self.assertIn("apps/local-collector/df_collector/validate.py", behaviour.FILES)
        notice = {"id": "cpsc-15034", "raw": {"Title": "Lamps recalled", "Description": "No codes here.", "Products": []}, "provenance": {"raw_sha256": "b" * 64}}
        with tempfile.TemporaryDirectory() as tmp:
            config = Config(data_dir=tmp)
            state = State(config.db_path)
            collector = Collector(config, state, client=FakeClient("{}"), policy=POLICY)
            collector.adopt_runtime(extract.BENCHMARKED_RUNTIME)
            self.assertEqual(collector.queue_documents([notice]), 0)
            self.assertEqual(state.one("SELECT state FROM document")["state"], "skipped")
            with state.tx() as db:
                state.set_cursor(db, TASK, "backfill_done", "1")
            # A corrected prefilter (validate.py changed) is a new fingerprint, so a new build: the backfill restarts
            # and the notice skipped under the old build is examined again.
            with mock.patch.object(behaviour, "behaviour_sha256", lambda: "e" * 64), mock.patch.object(validate, "worth_extracting", lambda record: True), mock.patch("df_collector.runtime.worth_extracting", lambda record: True):
                self.assertTrue(collector.adopt_runtime(extract.BENCHMARKED_RUNTIME))
                self.assertIsNone(state.cursor(TASK, "backfill_done"))
                self.assertEqual(collector.queue_documents([notice]), 1)


class CodexRegressionsRound24(unittest.TestCase):
    def test_the_prefilter_recognises_space_separated_codes_the_rules_accept(self):
        text = "Model number AB 12 is affected."
        self.assertTrue(validate.decide(text, "AB 12", "Description").ok)
        self.assertTrue(worth_extracting({"Title": "Lamps recalled", "Description": text, "Products": []}))
        # Still skipped: a label with no code-shaped value at all.
        self.assertFalse(worth_extracting({"Title": "Lamps recalled", "Description": "Model lamps can overheat.", "Products": []}))


class CodexRegressionsRound25(unittest.TestCase):
    def test_queued_notices_from_an_earlier_process_move_to_the_current_build(self):
        notice = {"id": "cpsc-15034", "raw": RECORD, "provenance": {"raw_sha256": "a" * 64}}
        with tempfile.TemporaryDirectory() as tmp:
            config = Config(data_dir=tmp)
            state = State(config.db_path)
            first = Collector(config, state, client=FakeClient("{}"), policy=POLICY)
            first.adopt_runtime(extract.BENCHMARKED_RUNTIME)
            first.queue_documents([notice])
            # The next start runs with another thread setting: another build from the outset.
            config.limits.llm_threads = 4
            second = Collector(config, state, client=FakeClient("{}"), policy=POLICY)
            self.assertNotEqual(second.build, first.build)
            second.adopt_runtime(extract.BENCHMARKED_RUNTIME)
            self.assertEqual({r["extractor_version"] for r in state.q("SELECT extractor_version FROM document WHERE state = 'queued'")}, {second.build})
            # Queued again by the rewound backfill: still one queued row, under the current build.
            second.queue_documents([notice])
            self.assertEqual(state.one("SELECT COUNT(*) AS n FROM document WHERE state = 'queued'")["n"], 1)

    def test_the_request_fingerprint_follows_the_model_call(self):
        base = extract.request_sha256("qwen3.5:4b")
        self.assertEqual(base, extract.request_sha256("qwen3.5:4b", 8192, False, None))
        self.assertNotEqual(extract.request_sha256("qwen3.5:4b", 4096), base)
        self.assertNotEqual(extract.request_sha256("qwen3.5:4b", num_thread=4), base)
        self.assertNotEqual(extract.request_sha256("gpt-oss:20b"), base)


def _benchmark_module():
    import importlib.util

    spec = importlib.util.spec_from_file_location("run_benchmark", Path(__file__).resolve().parents[1] / "benchmark" / "run_benchmark.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class CodexRegressionsRound26(unittest.TestCase):
    SAMPLE = {"a": {"split": "heldout"}, "b": {"split": "heldout"}, "c": {"split": "dev"}}

    def test_scoring_refuses_predictions_that_do_not_exactly_cover_a_split(self):
        bench = _benchmark_module()
        full = [{"id": "a", "split": "heldout"}, {"id": "b", "split": "heldout"}]
        self.assertEqual(bench.coverage(self.SAMPLE, full), {"heldout": "2/2"})
        for rows in (
            full[:1],  # truncated to one notice
            full + [{"id": "a", "split": "heldout"}],  # duplicate
            full + [{"id": "z", "split": "heldout"}],  # unknown notice
            full + [{"id": "c", "split": "heldout"}],  # a dev notice labelled held-out
        ):
            with self.assertRaises(SystemExit):
                bench.coverage(self.SAMPLE, rows)

    def test_the_run_stops_when_the_model_build_changes_mid_run(self):
        from df_collector.ollama import ModelIdentity

        bench = _benchmark_module()
        expected = ModelIdentity("qwen3.5:4b", "2a654d98e6fb", "qwen35", "4.7B", "Q4_K_M", "Apache License", "ollama/0.34.4")

        class Client:
            def __init__(self, identity):
                self.identity = identity

            def verify(self):
                return self.identity

        bench.check_identity(Client(expected), expected, "a")  # unchanged: continues
        for changed in (ModelIdentity("qwen3.5:4b", "ffffffffffff", "qwen35", "4.7B", "Q4_K_M", "Apache License", "ollama/0.34.4"), ModelIdentity("qwen3.5:4b", "2a654d98e6fb", "qwen35", "4.7B", "Q4_K_M", "Apache License", "ollama/0.35.0")):
            with self.assertRaises(SystemExit):
                bench.check_identity(Client(changed), expected, "a")


class CodexRegressionsRound27(unittest.TestCase):
    def test_the_prefilter_accepts_every_spacing_shape_accepts(self):
        # SHAPE allows two consecutive spaces (the rules accept "AB  12"); the prefilter must see it too.
        for text in ("Affected: model number AB  12.",):
            value = "AB  12"
            self.assertTrue(validate.decide(text, value, "Description").ok, text)
            self.assertTrue(worth_extracting({"Title": "Lamps recalled", "Description": text, "Products": []}), text)

    def test_a_rejected_upload_is_kept_retried_and_counted_toward_the_cap(self):
        from df_collector.runtime import REJECTED_RETRY_S

        with tempfile.TemporaryDirectory() as tmp:
            config = Config(data_dir=tmp)
            state = State(config.db_path)
            state.set_secret = None
            (config.secrets_dir).mkdir(parents=True, exist_ok=True)
            (config.secrets_dir / "ingest-token").write_text("dfi_" + "a" * 40)
            state.outbox_add(state.db, "1" * 64, {"task": TASK, "extractor": {}, "notices": [{"recall_id": "cpsc-1", "raw_sha256": "r", "candidates": []}]})
            state.db.commit()

            class Opener:
                def open(self, request, timeout=None):
                    raise http_error(400)

            uploader = Uploader(config, state, policy=POLICY, opener=Opener())
            config.api_origin = "http://127.0.0.1:9"
            import time

            before = time.time()
            uploader.send_one()
            row = state.one("SELECT state, next_attempt_at FROM outbox")
            self.assertEqual(row["state"], "pending")
            self.assertGreaterEqual(row["next_attempt_at"], before + REJECTED_RETRY_S - 5)
            self.assertEqual(state.outbox_pending(), 1)  # still owed, so it counts toward the outbox cap
            self.assertTrue(state.get("uploads_rejected"))
            # The sweep does not discard it.
            state.sweep(config.evidence_dir, unverified_days=0)
            self.assertEqual(state.outbox_pending(), 1)


class CodexRegressionsRound28(unittest.TestCase):
    def test_the_mirror_treats_javascript_whitespace_as_whitespace(self):
        text = "The recalled lamps carry part\u00a0number AB12 and were sold online."
        self.assertTrue(validate.decide(text, "AB12", "Description").ok)
        self.assertTrue(worth_extracting({"Title": "Lamps recalled", "Description": text, "Products": []}))

    def test_scoring_refuses_an_extracted_notice_whose_stored_output_does_not_parse(self):
        import argparse

        bench = _benchmark_module()
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)
            sample = [{"id": "cpsc-1", "split": "heldout", "fields": RECORD}]
            (out / "sample.json").write_text(json.dumps(sample))
            (out / "gold.json").write_text(json.dumps({"cpsc-1": {"identifiers": [{"value": "SA904", "label": "item"}], "ambiguous": []}}))
            (out / bench.BUILD_FILE).write_text(json.dumps({"sample_sha256": bench.sample_sha256(sample)}))
            truncated = json.dumps({"identifiers": [{"value": "SA904", "label": "item", "field": "Description"}]})[:30]
            row = {"id": "cpsc-1", "split": "heldout", "status": "extracted", "error": None, "wall_ms": 1, "chat": None, "proposals": [], "baseline": [], "raw_output": truncated}
            (out / "predictions-heldout.jsonl").write_text(json.dumps(row) + "\n")
            args = argparse.Namespace(sample=str(out / "sample.json"), gold=str(out / "gold.json"), out=str(out))
            with self.assertRaises(SystemExit):
                bench.score(args)


class CodexRegressionsRound29(unittest.TestCase):
    def test_scoring_refuses_predictions_made_from_another_sample(self):
        import argparse

        bench = _benchmark_module()
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)
            sample = [{"id": "cpsc-1", "split": "heldout", "fields": RECORD}]
            (out / "sample.json").write_text(json.dumps(sample))
            (out / "gold.json").write_text(json.dumps({"cpsc-1": {"identifiers": [{"value": "SA904", "label": "item"}], "ambiguous": []}}))
            raw = json.dumps({"identifiers": [{"value": "SA904", "label": "item", "field": "Description"}]})
            row = {"id": "cpsc-1", "split": "heldout", "status": "extracted", "error": None, "wall_ms": 1, "chat": None, "proposals": [], "baseline": [], "raw_output": raw}
            (out / "predictions-heldout.jsonl").write_text(json.dumps(row) + "\n")
            args = argparse.Namespace(sample=str(out / "sample.json"), gold=str(out / "gold.json"), out=str(out))
            (out / bench.BUILD_FILE).write_text(json.dumps({"sample_sha256": bench.sample_sha256(sample)}))
            self.assertEqual(bench.score(args)["heldout"]["notices"], 1)
            # Same id and split, corrected notice text: the stored predictions no longer describe these inputs.
            changed = [{"id": "cpsc-1", "split": "heldout", "fields": {**RECORD, "Description": "Corrected text. Item SA904."}}]
            (out / "sample.json").write_text(json.dumps(changed))
            with self.assertRaises(SystemExit):
                bench.score(args)
