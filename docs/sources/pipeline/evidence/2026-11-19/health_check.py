#!/usr/bin/env python3
"""Round 28 (2026-11-19) health check of the LIVE recall datasets.

Re-fetches live: our two /stats endpoints, openFDA enforcement meta for food, drug and
device, the full CPSC Recall API list, and the Health Canada open-data index. Writes
health_check.json next to itself. Stdlib only; one request at a time.
"""
import json, time, urllib.request, collections, os

UA = "data-foundry-scout/1.0 (data@mail.proviciency.com)"
N = 0

def get(url, timeout=180):
    global N
    N += 1
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        body = r.read()
    time.sleep(0.5)
    return json.loads(body.decode("utf-8-sig"))

out = {"run_date": "2026-11-19"}
ours = get("https://api.data.aroqon.com/v1/recalls/stats")
out["fda_ours"] = {"categories": ours["categories"], "last_successful_sync": ours["last_successful_sync"],
                   "source_sync": {k: {"last_successful_sync": v["last_successful_sync"], "status": v["latest_attempt"]["status"]} for k, v in ours["source_sync"].items()}}
out["openfda"] = {}
for cat in ("food", "drug", "device"):
    d = get(f"https://api.fda.gov/{cat}/enforcement.json?sort=report_date:desc&limit=1")
    out["openfda"][cat] = {"last_updated": d["meta"]["last_updated"], "total": d["meta"]["results"]["total"], "newest_report_date": d["results"][0]["report_date"]}

prod = get("https://api.data.aroqon.com/v1/product-recalls/stats")
out["product_ours"] = {"agencies": prod["agencies"], "last_successful_sync": prod["last_successful_sync"],
                       "declared_cross_agency_links": prod["declared_cross_agency_links"],
                       "source_sync": {k: {"status": v["latest_attempt"]["status"], "window_from": v["latest_attempt"]["window_from"]} for k, v in prod["source_sync"].items()}}

cpsc = get("https://www.saferproducts.gov/RestWebServices/Recall?format=json")
dates = sorted((r.get("RecallDate") or "")[:10] for r in cpsc)
out["cpsc_source"] = {"rows": len(cpsc), "distinct_recall_ids": len({r.get("RecallID") for r in cpsc}),
                      "newest_recall_date": dates[-1], "oldest_recall_date": next(d for d in dates if d),
                      "recalls_since_2026_11_01": sum(1 for d in dates if d >= "2026-11-01")}

hc = get("https://recalls-rappels.canada.ca/sites/default/files/opendata-donneesouvertes/HCRSAMOpenData.json")
rows = hc if isinstance(hc, list) else hc.get("data", hc)
cats = collections.Counter()
newest = ""
keys = collections.Counter()
for r in rows:
    for k in r: keys[k] += 1
    org = r.get("Organization") or r.get("organization") or ""
    cats[org] += 1
out["hc_source"] = {"rows": len(rows), "by_organization": dict(cats.most_common()), "field_names": sorted(keys)}
cp = [r for r in rows if (r.get("Organization") or "") == "Consumer product safety"]
lu = sorted((r.get("Last updated") or r.get("Last Updated") or "") for r in cp)
out["hc_source"]["consumer_product_rows"] = len(cp)
out["hc_source"]["consumer_product_newest_last_updated"] = lu[-1] if lu else None
out["requests"] = N
json.dump(out, open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "health_check.json"), "w"), indent=1, sort_keys=True)
print(json.dumps(out, indent=1)[:6000])
