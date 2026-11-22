#!/usr/bin/env python3
"""Round 31 (2026-11-22): which Health Canada notice do we hold that the source no longer lists?

/v1/product-recalls/stats reported 5,241 Health Canada notices while the index held 5,240 consumer-product rows.
This script reads the public year hubs of our site (200 newest notices per year) for 2024 to 2026, compares their
notice ids with the NIDs in the Health Canada index, and requests the Health Canada page of each id that the index
no longer carries. Writes health_delisted.json. Stdlib only; one request at a time.
"""
import json, re, urllib.error, urllib.request
from scoutlib import UA, get, status, write

out = {"run_date": "2026-11-22"}
HC_URL = "https://recalls-rappels.canada.ca/sites/default/files/opendata-donneesouvertes/HCRSAMOpenData.json?scout=20261122"
index = json.loads(get("hc_index.json", HC_URL).decode("utf-8-sig"))
by_nid = {r["NID"]: r for r in index}
consumer = {r["NID"] for r in index if (r.get("Organization") or "") == "Consumer product safety"}
out["hc_index"] = {"rows": len(index), "consumer_product_rows": len(consumer)}

missing = {}
out["our_year_hubs"] = {}
for year in (2026, 2025, 2024):
    page = get(f"browse_hc_{year}.html", f"https://data.aroqon.com/product-recalls/browse/hc/{year}").decode("utf-8")
    ids = sorted(set(re.findall(r"/product-recalls/hc-(\d+)", page)))
    absent = [i for i in ids if i not in consumer]
    out["our_year_hubs"][str(year)] = {"notice_ids_on_first_page": len(ids), "not_consumer_product_rows_in_index": absent}
    for nid in absent:
        missing[nid] = {"in_index_under_another_organization": by_nid.get(nid, {}).get("Organization")}

for nid, record in missing.items():
    ours = get(f"ours_hc_{nid}.html", f"https://data.aroqon.com/product-recalls/hc-{nid}").decode("utf-8")
    record["our_page_title"] = re.search(r"<title>([^<]*)", ours).group(1).replace("​", "").strip()
    record["our_page_robots_noindex"] = "noindex" in ours
    source_url = re.search(r'"isBasedOn":"(https://recalls-rappels\.canada\.ca[^"]+)"', ours).group(1)
    record["source_url"] = source_url
    record["source_page_http_status"] = status(source_url)
    record["title_found_anywhere_in_index"] = any((r.get("URL") or "") == source_url for r in index)
out["held_by_us_but_not_listed_by_health_canada"] = missing
write(__file__, out)
