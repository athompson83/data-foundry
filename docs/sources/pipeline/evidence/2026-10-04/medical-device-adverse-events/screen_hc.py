#!/usr/bin/env python3
"""Health Canada Medical Device Incidents extract (https://hpr-rps.hres.ca/files/extract.zip, 21 MB) screen.
Usage: python3 screen_hc.py <dir-of-unzipped-extract> [mdall-deviceidentifier.json]"""
import csv, json, sys, re, time, urllib.parse, urllib.request, collections
d = sys.argv[1]
UA = {"User-Agent": "data-foundry-scout (data@mail.proviciency.com)"}
rd = lambda f: list(csv.DictReader(open(f"{d}/{f}", encoding="utf-8-sig"), delimiter="|", quotechar='"'))
inc, dev, comp = rd("INCIDENT.dsv"), rd("INCIDENT_DEVICE.dsv"), rd("INCIDENT_COMPANY.dsv")
out = {"incidents": len(inc), "incident_device_rows": len(dev), "company_rows": len(comp), "columns_incident": list(inc[0]), "columns_device": list(dev[0])}
out["newest_receipt_dt"] = max(r["RECEIPT_DT"] for r in inc)
out["oldest_receipt_dt"] = min(r["RECEIPT_DT"] for r in inc if r["RECEIPT_DT"])
out["received_2026"] = sum(r["RECEIPT_DT"].startswith("2026") for r in inc)
out["types"] = collections.Counter(r["INCIDENT_TYPE_E"] for r in inc).most_common(6)
out["source_region_top"] = collections.Counter(r["SOURCE_OF_RECALL_E"] for r in inc).most_common(5)
out["free_text_columns"] = [c for c in list(inc[0]) + list(dev[0]) + list(comp[0]) if re.search(r"NARR|TEXT|DESC|COMMENT|SUMMARY", c)]
PN = re.compile(r"\d\d[A-Z]{3}")
out["pref_name_code_to_fda_product_code_share"] = "%d/%d" % (sum(bool(PN.fullmatch(r["PREF_NAME_CODE"])) for r in dev), len(dev))
if len(sys.argv) > 2:
    mdall = json.load(open(sys.argv[2]))
    ids = {r["device_id"] for r in mdall}
    dids = {int(r["DEVICE_ID"]) for r in dev if r["DEVICE_ID"].isdigit()}
    out["join_device_id_vs_mdall"] = f"{len(dids & ids)}/{len(dids)}"
# candidate link to MAUDE: recent HC trade names searched as exact MAUDE brand_name
ids26 = {r["INCIDENT_ID"] for r in inc if r["RECEIPT_DT"] >= "2026-06"}
rows, seen = [], set()
for r in dev:
    if r["INCIDENT_ID"] in ids26 and r["TRADE_NAME"] not in seen and 6 <= len(r["TRADE_NAME"]) <= 40 and re.fullmatch(r"[A-Za-z0-9 \-\.]+", r["TRADE_NAME"]):
        seen.add(r["TRADE_NAME"]); rows.append(r)
    if len(rows) >= 40: break
co = collections.defaultdict(list)
for c in comp:
    if c["ROLE_E"] == "(MANUFACTURER)": co[c["INCIDENT_ID"]].append(c["COMPANY_NAME"])
cand = []
for r in rows:
    time.sleep(0.5)
    q = urllib.parse.urlencode({"search": f'device.brand_name:"{r["TRADE_NAME"]}"', "limit": 3}, safe=':"')
    try:
        j = json.load(urllib.request.urlopen(urllib.request.Request("https://api.fda.gov/device/event.json?" + q, headers=UA)))
        hits = [(x.get("brand_name"), x.get("manufacturer_d_name")) for e in j["results"] for x in e["device"]][:2]
        tot = j["meta"]["results"]["total"]
    except Exception:
        hits, tot = [], 0
    cand.append({"hc_trade": r["TRADE_NAME"], "hc_mfr": co.get(r["INCIDENT_ID"], [])[:1], "pref": r["PREF_NAME_CODE"], "maude_total": tot, "maude": hits})
out["hc_vs_maude_candidate"] = {"tried": len(cand), "with_hit": sum(1 for c in cand if c["maude_total"]), "rows": cand}
json.dump(out, open("results_hc.json", "w"), indent=1, default=str)
print(json.dumps({k: v for k, v in out.items() if k != "hc_vs_maude_candidate"}, indent=1, default=str))
for c in cand: print(c["hc_trade"], c["hc_mfr"], c["pref"], c["maude_total"], c["maude"])
