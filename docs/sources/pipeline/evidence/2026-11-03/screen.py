#!/usr/bin/env python3 -I
"""Round 2026-11-03 deep screens. Writes screen.json. Declared UA; no key; no login."""
import json, re, urllib.request, urllib.parse, statistics as st, datetime
UA = "data-foundry-scout/1.0 (data@mail.proviciency.com)"
def get(url, timeout=60):
    r = urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=timeout)
    return r.read()
def jget(url): return json.loads(get(url))
out = {}

# A. NGA MSI broadcast warnings
w = jget("https://msi.nga.mil/api/publications/broadcast-warn?output=json&status=active")["broadcast-warn"]
tl = [len(x.get("text") or "") for x in w]
out["nga_active"] = {"n": len(w), "navareas": sorted({str(x["navArea"]) for x in w}), "years": sorted({x["msgYear"] for x in w})[:3],
  "text_median": st.median(tl), "text_over_200": sum(t > 200 for t in tl), "keys": sorted(w[0].keys()),
  "with_coords_in_text": sum(bool(re.search(r"\d{1,3}-\d{2}(?:\.\d+)?[NS]", x.get("text") or "")) for x in w),
  "sample_ids": [f'{x["msgYear"]}/{x["msgNumber"]}/{x["navArea"]}' for x in w[:10]]}
try:
    allw = jget("https://msi.nga.mil/api/publications/broadcast-warn?output=json&status=all")["broadcast-warn"]
    out["nga_all"] = {"n": len(allw), "years": [min(x["msgYear"] for x in allw), max(x["msgYear"] for x in allw)]}
except Exception as e:
    out["nga_all"] = {"error": str(e)}

# B. Avalanche.org map layer + Avalanche Canada areas
f = jget("https://api.avalanche.org/v2/public/products/map-layer")["features"]
out["avalanche_org"] = {"zones": len(f), "centers": len({x["properties"].get("center_id") for x in f}),
  "prop_keys": sorted(f[0]["properties"].keys()), "states": sorted({x["properties"].get("state") for x in f if x["properties"].get("state")})[:20]}
ca = jget("https://api.avalanche.ca/forecasts/en/areas")["features"]
out["avalanche_ca"] = {"areas": len(ca), "prop_keys": sorted(ca[0]["properties"].keys())}
try:
    p = jget("https://api.avalanche.ca/forecasts/en/products")
    out["avalanche_ca_products"] = {"n": len(p), "keys": sorted(p[0].keys()) if p else [], "sample_title": (p[0].get("report", {}) or {}).get("highlights", "")[:200] if p else ""}
except Exception as e:
    out["avalanche_ca_products"] = {"error": str(e)}
# one avalanche.org center's product
try:
    z = f[0]["properties"]
    cid = z.get("center_id"); zid = f[0]["id"]
    prod = jget(f"https://api.avalanche.org/v2/public/product?type=forecast&center_id={cid}&zone_id={zid}")
    out["avalanche_org_product"] = {"center": cid, "zone": zid, "keys": sorted(prod.keys()), "bottom_line_len": len(prod.get("bottom_line") or ""), "has_danger": bool(prod.get("danger")), "published": prod.get("published_time")}
except Exception as e:
    out["avalanche_org_product"] = {"error": str(e)}

# C. HUDOC + CELLAR
q = lambda extra, n=3: jget("https://hudoc.echr.coe.int/app/query/results?query=" + urllib.parse.quote(extra) + f"&select=itemid,docname,ecli,kpdate,appno,languageisocode,importance&sort=kpdate%20Descending&start=0&length={n}")
try:
    h = jget("https://hudoc.echr.coe.int/app/query/results?query=contentsitename:ECHR%20AND%20(documentcollectionid2:%22JUDGMENTS%22)&select=itemid,docname,ecli,kpdate&sort=kpdate%20Descending&start=0&length=20")
    out["hudoc"] = {"judgments_total_all_languages": h["resultcount"], "page": len(h["results"]), "newest": h["results"][0]["columns"]["kpdate"], "with_ecli": sum(bool(r["columns"].get("ecli")) for r in h["results"]), "sample": [r["columns"]["ecli"] for r in h["results"][:8]]}
except Exception as e:
    out["hudoc"] = {"error": str(e)}
sp = """PREFIX cdm: <http://publications.europa.eu/ontology/cdm#>
SELECT (COUNT(DISTINCT ?w) AS ?n) WHERE { ?w cdm:resource_legal_id_celex ?c . ?w cdm:work_has_resource-type <http://publications.europa.eu/resource/authority/resource-type/JUDG> }"""
try:
    r = get("https://publications.europa.eu/webapi/rdf/sparql?query=" + urllib.parse.quote(sp) + "&format=application%2Fsparql-results%2Bjson", 90)
    out["cellar_judg_count"] = json.loads(r)["results"]["bindings"]
except Exception as e:
    out["cellar_judg_count"] = {"error": str(e)}
sp2 = """PREFIX cdm: <http://publications.europa.eu/ontology/cdm#>
SELECT ?c ?ecli ?d WHERE { ?w cdm:case-law_ecli ?ecli . ?w cdm:resource_legal_id_celex ?c . ?w cdm:work_date_document ?d } ORDER BY DESC(?d) LIMIT 10"""
try:
    r = get("https://publications.europa.eu/webapi/rdf/sparql?query=" + urllib.parse.quote(sp2) + "&format=application%2Fsparql-results%2Bjson", 90)
    out["cellar_ecli_sample"] = [{k: v["value"] for k, v in b.items()} for b in json.loads(r)["results"]["bindings"]]
except Exception as e:
    out["cellar_ecli_sample"] = {"error": str(e)}

# D. TRI
t = jget("https://data.epa.gov/efservice/tri_facility/rows/0:2/JSON")
out["tri"] = {"keys": sorted(t[0].keys()), "has_free_text": any(k for k in t[0] if "narr" in k.lower() or "desc" in k.lower())}
try:
    out["tri_count"] = get("https://data.epa.gov/efservice/tri_facility/COUNT/JSON").decode()[:100]
except Exception as e:
    out["tri_count"] = str(e)

# E. NWS AFD
a = jget("https://api.weather.gov/products/types/AFD")["@graph"]
out["nws_afd"] = {"listed": len(a), "newest": max(x["issuanceTime"] for x in a), "offices": len({x["issuingOffice"] for x in a})}
json.dump(out, open("screen.json", "w"), indent=1, default=str)
print(json.dumps(out, indent=1, default=str)[:6000])
