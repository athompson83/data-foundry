#!/usr/bin/env python3
"""2026-10-26 scout screening: live measurements for four new data types. Writes measure.json."""
import json, time, urllib.request, urllib.parse, math, datetime as dt
UA = "data-foundry-scout/1.0 (data@mail.proviciency.com)"
def get(url, tries=3):
    for i in range(tries):
        try:
            r = urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=60)
            return json.loads(r.read())
        except Exception as e:
            err = str(e)
            time.sleep(8)
    return {"_error": err}
out = {"date": "2026-10-26"}

# 1. software-vulnerabilities: declared CVE id across CISA KEV, NVD, OSV
kev = get("https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json")
vs = kev["vulnerabilities"]; newest = sorted(vs, key=lambda v: v["dateAdded"])[-30:]
ids = [v["cveID"] for v in newest]
nvd_hit = osv_hit = nvd_desc = 0; nvd_n = 0; rows = []
for cid in ids[:15]:
    d = get("https://services.nvd.nist.gov/rest/json/cves/2.0?cveId=" + cid); nvd_n += 1
    ok = bool(d.get("vulnerabilities")); nvd_hit += ok
    desc = ok and any(x["lang"] == "en" and len(x["value"]) > 40 for x in d["vulnerabilities"][0]["cve"]["descriptions"])
    nvd_desc += bool(desc); rows.append({"cve": cid, "nvd": ok, "nvd_description": bool(desc)}); time.sleep(7)
for cid in ids:
    d = get("https://api.osv.dev/v1/vulns/" + cid); osv_hit += ("_error" not in d)
out["software-vulnerabilities"] = {
    "kev_count": kev["count"], "kev_catalogVersion": kev["catalogVersion"], "kev_with_notes_text": sum(1 for v in vs if v.get("shortDescription")),
    "nvd_total": get("https://services.nvd.nist.gov/rest/json/cves/2.0?resultsPerPage=1").get("totalResults"),
    "sample_newest_kev": len(ids), "nvd_sampled": nvd_n, "nvd_found": nvd_hit, "nvd_with_description": nvd_desc,
    "osv_found_of_sample": osv_hit, "rows": rows}

# 2. earthquake-events: USGS vs EMSC on M>=5 in last 30 days (time+location proposal only)
end = dt.date(2026, 10, 26); start = end - dt.timedelta(days=30)
u = get(f"https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&minmagnitude=5&starttime={start}&endtime={end}")
e = get(f"https://www.seismicportal.eu/fdsnws/event/1/query?format=json&minmag=5&start={start}&end={end}")
def hav(a, b, c, d):
    p = math.pi / 180; x = math.sin((c - a) * p / 2) ** 2 + math.cos(a * p) * math.cos(c * p) * math.sin((d - b) * p / 2) ** 2
    return 12742 * math.asin(math.sqrt(x))
ef = []
for f in e["features"]:
    p = f["properties"]; ef.append((dt.datetime.fromisoformat(p["time"].replace("Z", "+00:00")).timestamp(), p["lat"], p["lon"], p["mag"], p.get("unid")))
match = 0; magdiff = []
for f in u["features"]:
    p = f["properties"]; t = p["time"] / 1000; lon, lat = f["geometry"]["coordinates"][:2]
    c = [x for x in ef if abs(x[0] - t) < 60 and hav(lat, lon, x[1], x[2]) < 100]
    if c: match += 1; magdiff.append(abs(c[0][3] - p["mag"]))
out["earthquake-events"] = {"window": f"{start}..{end}", "usgs_m5": len(u["features"]), "emsc_m5": len(e["features"]), "usgs_with_emsc_match_60s_100km": match,
    "mean_abs_magnitude_difference": round(sum(magdiff) / max(1, len(magdiff)), 3), "usgs_events_with_place_text": sum(1 for f in u["features"] if f["properties"].get("place")),
    "usgs_total_since_2026-10-01": get("https://earthquake.usgs.gov/fdsnws/event/1/count?starttime=2026-10-01&format=geojson").get("count")}

# 3. variant-clinical-significance: ClinVar variation id declared in ClinGen Allele Registry
q = urllib.parse.quote("BRCA1[gene] AND pathogenic[clinsig]")
s = get(f"https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=clinvar&term={q}&retmode=json&retmax=20&sort=date+modified")
vids = s["esearchresult"]["idlist"]; tot = s["esearchresult"]["count"]; hit = 0; rows = []
for v in vids:
    time.sleep(0.5)
    a = get("https://reg.genome.network/allele?ClinVar.variationId=" + v)
    ok = "_error" not in a and a.get("@id") is not None; hit += ok; rows.append({"variation_id": v, "allele_registry": a.get("@id") if ok else None})
out["variant-clinical-significance"] = {"clinvar_brca1_pathogenic_total": tot, "sampled_recent": len(vids), "found_in_allele_registry_by_declared_clinvar_id": hit, "rows": rows}

# 4. weather-alerts: NWS and MeteoAlarm (no declared shared identifier)
n = get("https://api.weather.gov/alerts/active")
out["weather-alerts"] = {"nws_active": len(n.get("features", [])), "nws_with_description": sum(1 for f in n.get("features", []) if f["properties"].get("description")),
    "nws_event_types": len({f["properties"]["event"] for f in n.get("features", [])})}
json.dump(out, open("measure.json", "w"), indent=1)
print(json.dumps({k: {a: b for a, b in v.items() if a != "rows"} if isinstance(v, dict) else v for k, v in out.items()}, indent=1))
