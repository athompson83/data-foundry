"""Synthetic HC fixtures: exercise the source contract, never claim benchmark qualification."""
import hashlib
import json
import tempfile
import unittest
from unittest.mock import patch
from pathlib import Path

from df_collector import health_canada as hc, policy
from df_collector.config import Config
from df_collector.runtime import Collector, TASK
from df_collector.state import State
from df_collector.netguard import RateLimited
from tests.test_collector import FakeClient


RAW = {"NID": "12345", "Organization": "Consumer product safety", "Title": "Lamp recalled", "Product": "Item number AB-123. Lot 998877.", "What you should do": "Model SECRET123. Contact Jane."}


class HealthCanada(unittest.TestCase):
    def test_model_sees_health_canada_product_fields_without_advice(self):
        client = FakeClient('{"identifiers": []}')
        original = client.chat_json
        def chat(system, user, schema):
            self.assertIn("Health Canada", system)
            self.assertIn('name="Product"', user)
            self.assertNotIn("Jane", user)
            self.assertEqual(schema["properties"]["identifiers"]["items"]["properties"]["field"]["enum"], ["Title", "Product"])
            return original(system, user, schema)
        client.chat_json = chat
        hc.extract(client, RAW)

    def test_source_controls_target_the_named_task_and_preserve_an_existing_allowance_wait(self):
        from df_collector.dashboard import Dashboard
        with tempfile.TemporaryDirectory() as tmp:
            state = State(Path(tmp) / "state.sqlite3")
            state.event("info", "allowance_wait", {"seconds": 86400})
            collector = Collector(Config(data_dir=tmp), state)
            self.assertGreater(float(state.get("allowance_until")), 0)
            dashboard = Dashboard.__new__(Dashboard)
            dashboard.state = state
            self.assertEqual(dashboard.act("kill", {"task": hc.TASK}), "ok")
            self.assertEqual(state.get(f"kill:{hc.TASK}"), "1")
            self.assertIsNone(state.get(f"kill:{TASK}"))
            self.assertEqual(dashboard.act("kill", {"task": "unknown"}), "unknown task")
            with self.assertRaises(policy.PolicyRefused):
                collector.activate_task("unknown")
            state.db.close()

    def test_forced_working_copy_purge_rewinds_every_affected_source(self):
        from df_collector.__main__ import cmd_purge
        with tempfile.TemporaryDirectory() as tmp:
            config = Config(data_dir=tmp)
            state = State(config.db_path)
            collector = Collector(config, state)
            collector.queue_documents([{"id": "cpsc-12345", "raw": {"Description": "Item number CD-456."}, "provenance": {"raw_sha256": "a" * 64}}])
            collector.activate_task(hc.TASK)
            collector.queue_documents([{"id": "hc-12345", "raw": RAW, "provenance": {"raw_sha256": "b" * 64}}])
            with state.tx() as db:
                for task in (TASK, hc.TASK):
                    state.set_cursor(db, task, "backfill_done", "1")
            state.db.close()
            self.assertEqual(cmd_purge(config, everything=False, remove_model=False, force=True), 0)
            state = State(config.db_path)
            cursors = [state.cursor(task, "backfill_done") for task in (TASK, hc.TASK)]
            state.db.close()
            self.assertEqual(cursors, [None, None])

    def test_only_product_fields_are_proposed_and_evidence_spans_are_native(self):
        client = FakeClient(json.dumps({"identifiers": [{"value": "AB-123", "label": "item", "field": "Product"}]}))
        result = hc.extract(client, RAW)
        self.assertEqual([(p.value, p.field, p.decision.start, p.decision.end) for p in result.accepted], [("AB-123", "Product", 12, 18)])
        self.assertEqual(hc.candidate_fields(RAW), ["Title", "Product"])
        self.assertFalse(hc.decide_in_record(RAW, "SECRET123", "What you should do").ok)
        self.assertFalse(hc.decide_in_record(RAW, "998877", "Product").ok)

    def test_build_is_distinct_and_not_a_cpsc_benchmark(self):
        from df_collector import extract
        self.assertNotEqual(hc.build_id("qwen3.5:4b", "2a654d98e6fb"), extract.build_id("qwen3.5:4b", "2a654d98e6fb"))
        self.assertNotEqual(hc.prompt_sha256(), extract.prompt_sha256())
        self.assertEqual(len(hc.behaviour_sha256()), 64)

    def test_registry_policy_admits_health_canada(self):
        task = policy.load().task(hc.TASK)
        self.assertEqual(task.input["params"], {"agency": "HC"})
        self.assertEqual(task.source, "health-canada-consumer-product-recalls")

    def test_reader_extractor_outbox_and_cursors_are_separate(self):
        with tempfile.TemporaryDirectory() as tmp:
            config = Config(data_dir=tmp)
            state = State(config.db_path)
            client = FakeClient(json.dumps({"identifiers": [{"value": "AB-123", "label": "item", "field": "Product"}]}))
            collector = Collector(config, state, client=client)
            collector.activate_task(hc.TASK)
            collector.verify_model()
            with self.assertRaises(policy.PolicyRefused):
                collector.read_page(collector.policy.task(TASK))
            raw_sha = hashlib.sha256(json.dumps(RAW).encode()).hexdigest()
            notice = {"id": "hc-12345", "raw": RAW, "provenance": {"raw_sha256": raw_sha}}
            calls = []
            def api_get(task, path, params):
                calls.append(params)
                return {"data": [notice], "next_cursor": "hc-next"}
            collector.api_get = api_get
            collector.read_page(collector.task_policy())
            self.assertEqual(calls[0]["agency"], "HC")
            self.assertEqual(state.cursor(hc.TASK, "backfill_cursor"), "hc-next")
            self.assertIsNone(state.cursor(TASK, "backfill_cursor"))
            self.assertTrue(collector.extract_one())
            payload = json.loads(state.one("SELECT payload FROM outbox")["payload"])
            self.assertEqual(payload["task"], hc.TASK)
            self.assertEqual(payload["extractor"]["version"], hc.EXTRACTOR_VERSION)
            self.assertEqual(payload["notices"][0]["candidates"][0]["field"], "Product")
            collector.activate_task(TASK)
            collector.adopt_runtime("ollama/0.99.0")
            self.assertEqual(state.one("SELECT task FROM document")["task"], hc.TASK)
            self.assertEqual(state.cursor(hc.TASK, "backfill_cursor"), "hc-next")
            state.db.close()

    def test_reader_refuses_cross_source_and_non_consumer_records(self):
        with tempfile.TemporaryDirectory() as tmp:
            collector = Collector(Config(data_dir=tmp), State(Path(tmp) / "state.sqlite3"))
            collector.activate_task(hc.TASK)
            for recall_id, raw in [("cpsc-12345", RAW), ("hc-12345", {**RAW, "Organization": "Drugs"}), ("hc-99999", RAW)]:
                self.assertEqual(collector.queue_documents([{"id": recall_id, "raw": raw, "provenance": {"raw_sha256": "a" * 64}}]), 0)
            collector.state.db.close()

    def test_task_leases_never_claim_another_sources_due_job(self):
        with tempfile.TemporaryDirectory() as tmp:
            state = State(Path(tmp) / "state.sqlite3")
            state.ensure_job("read", TASK, "cpsc-read", {})
            state.ensure_job("read", hc.TASK, "hc-read", {})
            claimed = state.claim("test", ("read",), task=hc.TASK)
            self.assertEqual(claimed["task"], hc.TASK)
            self.assertEqual(state.one("SELECT state FROM job WHERE task = ?", TASK)["state"], "pending")
            state.db.close()

    def test_one_resident_worker_visits_both_tasks_and_respects_the_shared_allowance(self):
        with tempfile.TemporaryDirectory() as tmp:
            collector = Collector(Config(data_dir=tmp), State(Path(tmp) / "state.sqlite3"))
            visited = []
            def tick():
                visited.append(collector.task_name)
                if len(visited) == 2:
                    collector.stop.set()
            with patch.object(collector, "tick", side_effect=tick):
                collector.run()
            self.assertEqual(visited, [TASK, hc.TASK])
            collector.state.ensure_job("read", TASK, "read-cpsc", {})
            collector.state.ensure_job("read", hc.TASK, "read-hc", {})
            job = collector.state.claim("test", ("read",), task=TASK)
            collector.owner = "test"
            collector._wait_for_allowance(job, RateLimited("monthly allowance", retry_after=86400))
            self.assertIsNone(collector.state.claim("other", ("read",), task=hc.TASK))
            self.assertEqual(collector.state.one("SELECT attempts FROM job WHERE task = ?", TASK)["attempts"], 0)
            collector.state.db.close()
