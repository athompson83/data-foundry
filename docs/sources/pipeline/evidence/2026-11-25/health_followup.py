#!/usr/bin/env python3
"""Round 34 (2026-11-25) follow-up to health_check.py. (1) How many openFDA enforcement records carry the newest
report date, to compare with how far the openFDA totals and ours moved since 2026-11-24. (2) The Health Canada
consumer-product notices updated since 2026-11-21, with the dates the agency page and our page show.
Writes health_followup.json. Stdlib only; one request at a time."""
import json, re
import scoutlib as s
from termslib import visible

out = {"run_date": "2026-11-25"}
y = json.load(open("../2026-11-24/health_check.json")); t = json.load(open("health_check.json"))
ours = lambda d: {c["category"]: c["recalls"] for c in d["fda_ours"]["categories"]}
out["fda"] = {}
for cat in ("food", "drug", "device"):
    d = json.loads(s.get(f"openfda_{cat}_20261118.json", f"https://api.fda.gov/{cat}/enforcement.json?search=report_date:20261118&limit=1"))
    out["fda"][cat] = {"openfda_records_with_report_date_2026_11_18": d["meta"]["results"]["total"],
        "openfda_total_growth_since_2026_11_24": t["openfda"][cat]["total"] - y["openfda"][cat]["total"],
        "our_growth_since_2026_11_24": ours(t)[cat] - ours(y)[cat],
        "gap_today": t["openfda"][cat]["total"] - ours(t)[cat], "gap_2026_11_24": y["openfda"][cat]["total"] - ours(y)[cat]}
    f = out["fda"][cat]
    f["openfda_new_records_with_an_earlier_report_date"] = f["openfda_total_growth_since_2026_11_24"] - f["openfda_records_with_report_date_2026_11_18"]
rows = json.loads(s.get("hc_index_followup.json", "https://recalls-rappels.canada.ca/sites/default/files/opendata-donneesouvertes/HCRSAMOpenData.json?scout=20261125f").decode("utf-8-sig"))
recent = [r for r in rows if r.get("Organization") == "Consumer product safety" and (r.get("Last updated") or "") >= "2026-11-21"]
out["health_canada_updated_since_2026_11_21"] = []
dates = lambda text: sorted(set(re.findall(r"20\d\d-\d\d-\d\d", text)))
for r in recent:
    agency = visible(s.get(f"hc_page_{r['NID']}.html", r["URL"]).decode("utf-8", "replace"))
    mine = visible(s.get(f"our_page_{r['NID']}.html", f"https://data.aroqon.com/product-recalls/hc-{r['NID']}").decode("utf-8", "replace"))
    out["health_canada_updated_since_2026_11_21"].append({"nid": r["NID"], "index_last_updated": r["Last updated"],
        "dates_on_the_agency_page": dates(agency), "dates_on_our_page": dates(mine)})
s.write(__file__, out)
