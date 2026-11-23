#!/usr/bin/env python3
"""Round 32 (2026-11-23) widening: openFDA device recall records (CDRH recall database) against the
openFDA device enforcement reports that the LIVE FDA Recall Intelligence dataset is built from.
Reads the 1,000 most recently posted device recall records, then looks 40 seeded product recall numbers
up in the enforcement endpoint. Writes widen_measure.json. Stdlib only; one request at a time."""
import collections, json, random, re, statistics, urllib.error, urllib.parse
import scoutlib as s

out = {"run_date": "2026-11-23"}
page = json.loads(s.get("fda_device_recall_latest", "https://api.fda.gov/device/recall.json?sort=event_date_posted:desc&limit=1000"))
enf = json.loads(s.get("fda_device_enforcement_meta", "https://api.fda.gov/device/enforcement.json?sort=report_date:desc&limit=1"))
rec = page["results"]
fields = collections.Counter(k for r in rec for k, v in r.items() if v not in ("", None, [], {}))
txt = lambda k: [r.get(k) or "" for r in rec if r.get(k)]
udi = re.compile(r"(?i)\b(?:UDI(?:-DI)?|GTIN)[^0-9]{0,12}\(?(?:01\)?)?(\d{14})\b")
out["device_recall"] = {
    "total": page["meta"]["results"]["total"], "last_updated": page["meta"]["last_updated"],
    "licence_url": page["meta"]["license"], "terms_url": page["meta"]["terms"],
    "read": len(rec), "distinct_product_res_numbers": len({r.get("product_res_number") for r in rec}),
    "distinct_res_event_numbers": len({r.get("res_event_number") for r in rec}),
    "newest_event_date_posted": max(r.get("event_date_posted", "") for r in rec), "oldest_event_date_posted_read": min(r.get("event_date_posted", "") for r in rec),
    "records_with_field": dict(sorted(fields.items())),
    "by_root_cause": dict(collections.Counter(r.get("root_cause_description") for r in rec if r.get("root_cause_description")).most_common(10)),
    "by_recall_status": dict(collections.Counter(r.get("recall_status") for r in rec if r.get("recall_status")).most_common()),
    "action_characters": sum(map(len, txt("action"))), "action_median_characters": statistics.median(map(len, txt("action"))),
    "reason_characters": sum(map(len, txt("reason_for_recall"))),
    "code_info_with_a_14_digit_udi_di": sum(1 for r in rec if udi.search(r.get("code_info") or "")),
    "with_k_number": sum(1 for r in rec if (r.get("openfda") or {}).get("k_number")),
    "with_pma_number": sum(1 for r in rec if r.get("pma_numbers") or (r.get("openfda") or {}).get("pma_number")),
}
out["device_enforcement"] = {"total": enf["meta"]["results"]["total"], "last_updated": enf["meta"]["last_updated"], "newest_report_date": enf["results"][0]["report_date"],
                             "fields": sorted(enf["results"][0])}
out["fields_in_device_recall_not_in_enforcement"] = sorted(set(fields) - set(enf["results"][0]))
random.seed(20261123)
sample = random.sample(sorted(r["product_res_number"] for r in rec if r.get("product_res_number")), 40)
by_num = {r["product_res_number"]: r for r in rec if r.get("product_res_number")}
pairs, missing = [], []
for num in sample:
    url = "https://api.fda.gov/device/enforcement.json?limit=2&search=" + urllib.parse.quote('recall_number:"%s"' % num)
    try:
        hit = json.loads(s.get("fda_enf_" + num, url))["results"]
    except urllib.error.HTTPError as e:
        if e.code != 404:
            raise
        hit = []
    r = by_num[num]
    if not hit:
        missing.append({"product_res_number": num, "event_date_posted": r.get("event_date_posted"), "recall_status": r.get("recall_status")})
        continue
    e = hit[0]
    pairs.append({"recall_number": num, "res_event_number": r.get("res_event_number"), "enforcement_event_id": e.get("event_id"),
                  "device_recall_firm": r.get("recalling_firm"), "enforcement_firm": e.get("recalling_firm"),
                  "same_event_id": r.get("res_event_number") == e.get("event_id"),
                  "same_firm": (r.get("recalling_firm") or "").lower() == (e.get("recalling_firm") or "").lower(),
                  "device_recall_product": (r.get("product_description") or "")[:120], "enforcement_product": (e.get("product_description") or "")[:120],
                  "enforcement_hits": len(hit)})
out["join_recall_number"] = {
    "sampled_device_recall_records": len(sample), "found_in_device_enforcement": len(pairs), "not_found": missing,
    "found_with_the_same_event_number": sum(1 for p in pairs if p["same_event_id"]),
    "found_with_the_same_firm_name": sum(1 for p in pairs if p["same_firm"]),
}
out["handcheck_sample"] = pairs[:20]
s.write(__file__, out)
