# Measures the CAL FIRE incident list against NIFC WFIGS incident locations (California, 2026).
import json, urllib.request, urllib.parse, re, datetime
UA = "data-foundry-scout/1.0 (data@mail.proviciency.com)"
def get(u): return json.load(urllib.request.urlopen(urllib.request.Request(u, headers={"User-Agent": UA}), timeout=60))
cal = get("https://incidents.fire.ca.gov/umbraco/api/IncidentApi/List?inactive=true")
base = "https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Incident_Locations_YearToDate/FeatureServer/0/query"
q = {"where": "POOState='US-CA'", "outFields": "IncidentName,IrwinID,FireDiscoveryDateTime,IncidentSize,POOCounty,IncidentShortDescription,ModifiedOnDateTime", "f": "json", "resultRecordCount": 2000}
w = {}
feats = []
try:
    off = 0
    while True:
        r = get(base + "?" + urllib.parse.urlencode({**q, "resultOffset": off, "orderByFields": "OBJECTID"}))
        got = [f["attributes"] for f in r.get("features", [])]
        feats += got
        if not got or not r.get("exceededTransferLimit"): break
        off += len(got)
except Exception as e:
    w = {"error": str(e)}
def norm(s): return re.sub(r"[^a-z0-9]", "", (s or "").lower().replace("fire", ""))
def day(ms): return datetime.datetime.utcfromtimestamp(ms/1000).date() if ms else None
idx = {}
for a in feats: idx.setdefault(norm(a["IncidentName"]), []).append(a)
wild = [c for c in cal if c.get("Type") == "Wildfire"]
hits, rows, agree, county_agree = 0, [], 0, 0
for c in wild:
    cands = idx.get(norm(c["Name"]), [])
    sd = datetime.date.fromisoformat(c["StartedDateOnly"]) if c.get("StartedDateOnly") else None
    ok = [a for a in cands if sd and day(a["FireDiscoveryDateTime"]) and abs((day(a["FireDiscoveryDateTime"]) - sd).days) <= 2]
    if ok:
        hits += 1
        a = ok[0]
        cty = (a.get("POOCounty") or "").lower().replace(" county", "") == (c.get("County") or "").lower().replace(" county", "")
        ac = a.get("IncidentSize"); cac = c.get("AcresBurned")
        acres_close = ac is not None and cac is not None and abs(ac - cac) <= max(1, 0.25 * max(ac, cac))
        agree = agree + 1 if (cty and acres_close) else agree
        county_agree += cty
    rows.append({"calfire": c["Name"], "started": c.get("StartedDateOnly"), "match": [a["IrwinID"] for a in ok]})
out = {"calfire_total": len(cal), "calfire_wildfire": len(wild), "wfigs_ca_ytd": len(feats), "wfigs_error": w.get("error"), "name_and_date_within_2d": hits, "county_equal": county_agree, "county_and_acres_within_25pct": agree, "sample": rows[:25]}
json.dump(out, open("join.json", "w"), indent=1)
print({k: v for k, v in out.items() if k != "sample"})
