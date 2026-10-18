# NHC Tropical Cyclone Reports (PDF, free text; ATCF id in the file name) -> IBTrACS (declared ATCF id) and FEMA declarations (candidate: storm name + year).
import sys, json, re, csv, io, urllib.parse
sys.path.insert(0, '..'); from common import *
csvb = get("https://www.ncei.noaa.gov/data/international-best-track-archive-for-climate-stewardship-ibtracs/v04r01/access/csv/ibtracs.last3years.list.v04r01.csv", raw=True).decode()
rows = list(csv.DictReader(io.StringIO(csvb)))[1:]  # row 2 holds units
storms = {}
for r in rows:
    a = r["USA_ATCF_ID"].strip()
    if a and r["BASIN"] in ("NA", "EP"): storms.setdefault(a, (r["NAME"], r["SEASON"]))
tcr = {}
for season in range(2023, 2027):
  for basin in ("atl", "pac"):
    html = get(f"https://www.nhc.noaa.gov/data/tcr/index.php?season={season}&basin={basin}", raw=True)
    if not html: continue
    for m in re.finditer(r'href="/data/tcr/([A-Z]{2}\d{6}_[A-Za-z0-9]+\.pdf)"', html.decode("latin1")): tcr[m.group(1)[:8]] = m.group(1)
named = {k: v for k, v in storms.items() if v[0] != "NOT_NAMED"}
matched = sorted(k for k in tcr if k.upper() in {s.upper() for s in storms})
fema = get("https://www.fema.gov/api/open/v2/DisasterDeclarationsSummaries?$filter=incidentType%20eq%20%27Hurricane%27%20and%20fyDeclared%20ge%202023&$select=disasterNumber,declarationTitle,incidentType,declarationDate,fyDeclared&$top=1000")
fe = {}
for d in (fema or {}).get("DisasterDeclarationsSummaries", []): fe[d["disasterNumber"]] = d["declarationTitle"]
names = {v[0].upper() for v in named.values()}
fe_named = {n: t for n, t in fe.items() if any(re.search(r"\b" + re.escape(x) + r"\b", t.upper()) for x in names)}
out = {"ibtracs_last3years_rows": len(rows), "ibtracs_atlantic_pacific_atcf_storms": len(storms), "named": len(named), "tcr_pdfs_listed_2023_2026": len(tcr),
       "tcr_atcf_ids_in_ibtracs": len(matched), "tcr_ids": sorted(tcr.values()), "matched": matched,
       "fema_hurricane_declarations_fy2023_on": len(fe), "fema_titles_naming_an_ibtracs_storm": len(fe_named), "fema_named_sample": dict(list(fe_named.items())[:15])}
json.dump(out, open("join.json", "w"), indent=1); print({k: v for k, v in out.items() if k not in ("tcr_ids", "matched", "fema_named_sample")})
