#!/usr/bin/env python3
"""Round 29 (2026-11-20) screening of three DISCOVERED candidates:
fsis-recalls, contractors-osha-inspections, electrical-open-charge-map.

Re-fetches live, one request at a time, declared User-Agent, no keys. Writes adv_measure.json
next to itself: HTTP statuses, counts, dates, licence strings and organisation names only
(no user names, comments or addresses are written).
"""
import collections, gzip, hashlib, io, json, os, re, time, urllib.error, urllib.request

UA = "data-foundry-scout/1.0 (data@mail.proviciency.com)"
N = 0

def fetch(url, timeout=300, rng=None):
    """Return (status, final_url, content_type, body)."""
    global N
    N += 1
    headers = {"User-Agent": UA}
    if rng: headers["Range"] = rng
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            res = (r.status, r.geturl(), r.headers.get("Content-Type", ""), r.read())
    except urllib.error.HTTPError as e:
        res = (e.code, e.geturl(), e.headers.get("Content-Type", ""), e.read())
    time.sleep(0.6)
    return res

def probe(url, marker=None):
    s, final, ct, body = fetch(url, timeout=60)
    text = body[:4000].decode("utf-8", "replace")
    row = {"url": url, "status": s, "final_url": final, "content_type": ct, "bytes": len(body)}
    if marker: row["marker_present"] = {m: (m in text) for m in marker}
    return row, body

def flat(body):
    import html
    return html.unescape(re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", body.decode("utf-8", "replace"))))

out = {"run_date": "2026-11-20", "user_agent": UA}

# ---- fsis-recalls -------------------------------------------------------------------------
fs = []
for u in ("https://www.fsis.usda.gov/fsis/api/recall/v/1", "https://www.fsis.usda.gov/recalls", "https://www.fsis.usda.gov/policy",
          "https://www.fsis.usda.gov/robots.txt"):
    row, _ = probe(u, marker=["Access Denied", "errors.edgesuite.net"])
    fs.append(row)
out["fsis"] = {"probes": fs, "any_200": any(r["status"] == 200 for r in fs)}

# ---- contractors-osha-inspections ----------------------------------------------------------
os_rows = []
for u in ("https://apiprod.dol.gov/v4/get/OSHA/inspection/json",
          "https://enforcedata.dol.gov/views/data_catalogs.php",
          "https://enfxfr.dol.gov/data_catalog/OSHA/osha_inspection_20261119.csv.zip",
          "https://www.osha.gov/ords/imis/establishment.html",
          "https://www.osha.gov/robots.txt",
          "https://data.dol.gov/datasets"):
    row, body = probe(u, marker=["Request blocked", "PK\x03\x04"])
    if u.startswith("https://apiprod"): row["body"] = body[:200].decode("utf-8", "replace")
    os_rows.append(row)
s, final, ct, body = fetch("https://www.dol.gov/general/aboutdol/copyright", timeout=60)
t = flat(body)
q = "Materials created by the federal government are generally part of the public domain and may be used, reproduced and distributed without permission."
out["osha"] = {"probes": os_rows,
               "keyless_bulk_route_found": any(r["status"] in (200, 206) and "zip" in r["content_type"] for r in os_rows),
               "dol_copyright_page": {"status": s, "bytes": len(body), "sha256": hashlib.sha256(body).hexdigest(), "quote_present": q in t}}

# ---- electrical-open-charge-map --------------------------------------------------------------
ocm = {}
row, body = probe("https://api.openchargemap.io/v3/poi?maxresults=1")
row["body"] = body[:200].decode("utf-8", "replace")
ocm["api_without_key"] = row
s, final, ct, body = fetch("https://openchargemap.org/about/terms", timeout=60)
t = flat(body)
quotes = [
    "Data contributed to us by our users which we then redistribute is licensed under a Creative Commons Attribution 4.0 International (CC BY 4.0)",
    "Data imported from 3rd party Data Providers is copyright the original Data Provider in each case and is not provided under the same terms as the user-contributed data detailed above.",
    "Use of our API or data in an application or service requires that the appropriate Data Provider attribution (including license terms) be provided in a way which is visible the end user.",
]
ocm["terms_page"] = {"status": s, "bytes": len(body), "sha256": hashlib.sha256(body).hexdigest(), "quotes_present": [qq in t for qq in quotes]}
for name, u, needles in (
    ("ocm_data_readme", "https://raw.githubusercontent.com/openchargemap/ocm-data/master/README.md", ["Deprecated: data exports will be moving to https://github.com/openchargemap/ocm-export"]),
    ("ocm_export_readme", "https://raw.githubusercontent.com/openchargemap/ocm-export/main/README.md",
     ["POIs with Data Provider ID 1 are created by Open Charge Map contributors and licensed per Open Charge Maps data license. Other POIs have different data providers and the data license will vary"])):
    s, final, ct, body = fetch(u, timeout=60)
    ocm[name] = {"status": s, "bytes": len(body), "needles_present": [n in body.decode("utf-8", "replace") for n in needles]}
for name, u in (("ocm_data_repo_page", "https://github.com/openchargemap/ocm-data"), ("ocm_export_tarball", "https://codeload.github.com/openchargemap/ocm-export/tar.gz/refs/heads/main")):
    row, _ = probe(u); ocm[name] = row

s, final, ct, body = fetch("https://raw.githubusercontent.com/openchargemap/ocm-export/main/data/referencedata.json", timeout=120)
ref = json.loads(body)
providers = {p["ID"]: p for p in ref["DataProviders"]}
ocm["reference_export"] = {"status": s, "bytes": len(body), "data_providers": len(providers), "operators": len(ref.get("Operators", [])),
                           "connection_types": len(ref.get("ConnectionTypes", [])), "countries": len(ref.get("Countries", []))}

s, final, ct, body = fetch("https://raw.githubusercontent.com/openchargemap/ocm-data/master/poi.json.gz", timeout=600)
ocm["poi_snapshot"] = {"status": s, "bytes": len(body), "sha256": hashlib.sha256(body).hexdigest()}
def d(v):
    if isinstance(v, dict): v = v.get("$date")
    return (v or "")[:10] if isinstance(v, str) else ""
n = 0
by_provider = collections.Counter(); by_country = collections.Counter(); by_status = collections.Counter()
created = collections.Counter(); newest_created = newest_status = ""
cost = cost_num = cost_free = comments = with_conn = with_operator = with_usercomments = 0
cost_len = []
for line in gzip.open(io.BytesIO(body), "rt", encoding="utf-8"):
    line = line.strip()
    if not line: continue
    p = json.loads(line); n += 1
    by_provider[p.get("DataProviderID")] += 1
    by_country[((p.get("AddressInfo") or {}).get("Country") or {}).get("ISOCode") or "?"] += 1
    by_status[((p.get("StatusType") or {}).get("Title")) or "?"] += 1
    c = d(p.get("DateCreated")); created[c[:4]] += 1
    newest_created = max(newest_created, c); newest_status = max(newest_status, d(p.get("DateLastStatusUpdate")))
    uc = (p.get("UsageCost") or "").strip()
    if uc:
        cost += 1; cost_len.append(len(uc))
        if re.search(r"\d", uc): cost_num += 1
        if re.search(r"free|gratis|gratuit|kostenlos", uc, re.I): cost_free += 1
    if (p.get("GeneralComments") or "").strip(): comments += 1
    if p.get("Connections"): with_conn += 1
    if p.get("OperatorID") not in (None, 1): with_operator += 1
    if p.get("UserComments"): with_usercomments += 1
cost_len.sort()
prov = []
for pid, cnt in by_provider.most_common():
    pr = providers.get(pid, {})
    prov.append({"id": pid, "title": pr.get("Title"), "pois": cnt, "is_open_data_licensed": pr.get("IsOpenDataLicensed"),
                 "license": (pr.get("License") or "")[:300]})
ocm["poi_snapshot"].update({
    "pois": n, "by_data_provider": prov, "countries": len(by_country), "top_countries": by_country.most_common(10),
    "by_status": by_status.most_common(), "created_by_year": sorted(created.items()),
    "newest_date_created": newest_created, "newest_status_update": newest_status,
    "usage_cost_nonempty": cost, "usage_cost_with_digit": cost_num, "usage_cost_free_word": cost_free,
    "usage_cost_median_chars": cost_len[len(cost_len) // 2] if cost_len else None,
    "general_comments_nonempty": comments, "with_connections": with_conn, "with_named_operator": with_operator,
    "pois_with_user_comments_counted_not_written": with_usercomments,
    "pois_from_open_licensed_providers": sum(x["pois"] for x in prov if x["is_open_data_licensed"]),
})
out["open_charge_map"] = ocm
out["requests"] = N
json.dump(out, open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "adv_measure.json"), "w"), indent=1, sort_keys=True)
print(json.dumps(out, indent=1)[:9000])
