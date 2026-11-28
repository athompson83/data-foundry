#!/usr/bin/env python3
"""Round 31 (2026-11-22) health check of the LIVE recall datasets.

Re-fetches live: our two /stats endpoints, openFDA enforcement meta for food, drug and
device, the full CPSC Recall API list, and the Health Canada open-data index (cache-busted and plain). Writes
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

out = {"run_date": "2026-11-22"}
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

HC_URL = "https://recalls-rappels.canada.ca/sites/default/files/opendata-donneesouvertes/HCRSAMOpenData.json"

def hc_summary(url):
    hc = get(url)
    rows = hc if isinstance(hc, list) else hc.get("data", hc)
    cats = collections.Counter((r.get("Organization") or "") for r in rows)
    keys = collections.Counter(k for r in rows for k in r)
    cp = [r for r in rows if (r.get("Organization") or "") == "Consumer product safety"]
    lu = sorted((r.get("Last updated") or "") for r in cp)
    return {"rows": len(rows), "by_organization": dict(cats.most_common()), "field_names": sorted(keys),
            "newest_last_updated_any_organization": max((r.get("Last updated") or "") for r in rows),
            "consumer_product_rows": len(cp), "consumer_product_newest_last_updated": lu[-1] if lu else None}

# The plain URL was served from a CDN edge copy that was a day behind on 2026-11-20 (response header age about
# 7,100 s, same 34,398 rows as on 2026-11-19), so the comparison uses a cache-busting query string; the plain
# copy is recorded next to it.
out["hc_source"] = hc_summary(HC_URL + "?scout=" + out["run_date"].replace("-", ""))
out["hc_source_cdn_copy_plain_url"] = {k: v for k, v in hc_summary(HC_URL).items() if k not in ("field_names", "by_organization")}
out["requests"] = N
json.dump(out, open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "health_check.json"), "w"), indent=1, sort_keys=True)
print(json.dumps(out, indent=1)[:6000])
