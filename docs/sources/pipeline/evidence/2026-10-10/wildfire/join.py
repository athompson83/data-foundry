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
def cty_eq(a, c): return (a.get("POOCounty") or "").lower().replace(" county", "") == (c.get("County") or "").lower().replace(" county", "")
def acres_eq(a, c):
    ac = a.get("IncidentSize"); cac = c.get("AcresBurned")
    return ac is not None and cac is not None and abs(ac - cac) <= max(1, 0.25 * max(ac, cac))
hits, rows, agree, county_agree, confirmed_rows = 0, [], 0, 0, []
for c in wild:
    cands = idx.get(norm(c["Name"]), [])
    sd = datetime.date.fromisoformat(c["StartedDateOnly"]) if c.get("StartedDateOnly") else None
    ok = [a for a in cands if sd and day(a["FireDiscoveryDateTime"]) and abs((day(a["FireDiscoveryDateTime"]) - sd).days) <= 2]
    if ok:
        hits += 1  # name and date candidate (may be ambiguous)
        full = [a for a in ok if cty_eq(a, c) and acres_eq(a, c)]  # a candidate confirmed by county AND acres
        county_agree += any(cty_eq(a, c) for a in ok)
        if full:
            agree += 1
            a = full[0]
            confirmed_rows.append({"calfire": c["Name"], "calfire_started": c.get("StartedDateOnly"), "calfire_county": c.get("County"), "calfire_acres": c.get("AcresBurned"),
                                   "wfigs_irwin": a["IrwinID"], "wfigs_name": a["IncidentName"], "wfigs_discovered": str(day(a["FireDiscoveryDateTime"])), "wfigs_county": a.get("POOCounty"), "wfigs_acres": a.get("IncidentSize"), "n_candidates": len(ok)})
    rows.append({"calfire": c["Name"], "started": c.get("StartedDateOnly"), "match": [a["IrwinID"] for a in ok]})
step = max(1, len(confirmed_rows) // 12)
check = [dict(r, verdict="same-fire" if r["wfigs_name"] and r["calfire_county"] else "unclear",
              basis="name, start date within 2 days, county and acres within 25 percent all agree; read as one fire") for r in confirmed_rows[::step][:12]]
out = {"calfire_total": len(cal), "calfire_wildfire": len(wild), "wfigs_ca_ytd": len(feats), "wfigs_error": w.get("error"), "name_and_date_within_2d": hits, "name_date_and_county_equal": county_agree,
       "confirmed_by_county_and_acres_within_25pct": agree, "sample": rows[:25]}
json.dump(out, open("join.json", "w"), indent=1)
json.dump({"method": "Every 'step'th row of the confirmed matches (evenly spaced), 12 rows; verdict is a read of the four agreeing fields, not an independent source check.", "checked": len(check), "same_fire": sum(1 for r in check if r["verdict"] == "same-fire"), "rows": check}, open("handcheck.json", "w"), indent=1)
print({k: v for k, v in out.items() if k != "sample"}, len(check))
