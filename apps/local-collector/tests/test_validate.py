import json
import unittest
from pathlib import Path

from df_collector import validate

VECTORS = Path(__file__).resolve().parents[3] / "packages/product-recall-structuring/test/identifier-candidate-vectors.json"


class SharedVectors(unittest.TestCase):
    def test_every_vector_matches_the_server_rules(self):
        cases = json.loads(VECTORS.read_text())["cases"]
        self.assertGreater(len(cases), 15)
        for case in cases:
            with self.subTest(case["name"]):
                decision = validate.decide(case["text"], case["value"], case["field"])
                self.assertEqual(decision.ok, case["expect"]["ok"], decision)
                if decision.ok:
                    if "label" in case["expect"]:
                        self.assertEqual(decision.label, case["expect"]["label"])
                    if "key" in case["expect"]:
                        self.assertEqual(decision.key, case["expect"]["key"])
                    if "start" in case["expect"]:
                        self.assertEqual(decision.start, case["expect"]["start"])
                    self.assertEqual(case["text"][decision.start:decision.end], case["value"])
                else:
                    self.assertEqual(decision.reason, case["expect"]["reason"])

    def test_record_vectors_match_the_server_rules(self):
        records = json.loads(VECTORS.read_text())["records"]
        self.assertGreaterEqual(len(records), 5)
        for case in records:
            with self.subTest(case["name"]):
                decision = validate.decide_in_record(case["record"], case["value"], case["claimed_field"])
                self.assertEqual(decision.ok, case["expect"]["ok"], decision)
                if decision.ok:
                    self.assertEqual(decision.field, case["expect"]["field"])
                    self.assertEqual(decision.label, case["expect"]["label"])
                else:
                    self.assertEqual(decision.reason, case["expect"]["reason"])

    def test_field_paths(self):
        record = {"Title": "T", "Description": "Item 12345", "ConsumerContact": "x", "Products": [{"Name": "Heater", "Model": "H-1", "Description": ""}]}
        self.assertEqual(validate.candidate_fields(record), ["Title", "Description", "Products[0].Name", "Products[0].Model"])
        self.assertIsNone(validate.candidate_field_text(record, "ConsumerContact"))
        self.assertIsNone(validate.candidate_field_text(record, "Products[3].Name"))

    def test_gs1(self):
        self.assertTrue(validate.gs1_check_digit_valid("036000291452"))
        self.assertFalse(validate.gs1_check_digit_valid("036000291453"))


if __name__ == "__main__":
    unittest.main()
