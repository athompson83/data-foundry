#!/usr/bin/env python3
"""Round 32 (2026-11-23): river gauges and flood stages. NOAA National Water Prediction Service gauges
in one mid-Atlantic tile, 60 seeded gauge records, and the USGS site service for the USGS ids they cite.
Writes gauge_measure.json. Stdlib only; one request at a time."""
import collections, json, random, statistics, urllib.error
import scoutlib as s

out = {"run_date": "2026-11-23"}
# The unfiltered list answered HTTP 504 after 60 s; a 5 by 5 degree tile answers in about 20 s.
out["full_list_status"] = s.status("https://api.water.noaa.gov/nwps/v1/gauges", timeout=90)
TILE = "https://api.water.noaa.gov/nwps/v1/gauges?bbox.xmin=-80&bbox.ymin=36&bbox.xmax=-75&bbox.ymax=41&srid=EPSG_4326"
gauges = json.loads(s.get("nwps_t1", TILE))["gauges"]
obs = [g["status"]["observed"] for g in gauges]
out["nwps_tile"] = {
    "bbox": "lon -80..-75, lat 36..41", "gauges": len(gauges), "distinct_lids": len({g["lid"] for g in gauges}),
    "by_state": dict(collections.Counter(g["state"]["abbreviation"] for g in gauges).most_common()),
    "with_forecast_series": sum(1 for g in gauges if g["pedts"]["forecast"]),
    "observed_flood_category": dict(collections.Counter(o["floodCategory"] for o in obs).most_common()),
    "observed_valid_on_2026_11_23": sum(1 for o in obs if o["validTime"].startswith("2026-11-23")),
    "newest_observed_valid_time": max(o["validTime"] for o in obs),
    "list_rows_carrying_a_usgs_id": sum(1 for g in gauges if g.get("usgsId")),
}
random.seed(20261123)
sample = random.sample(sorted(g["lid"] for g in gauges), 60)
details, failed = [], []
for lid in sample:
    try:
        details.append(json.loads(s.get("nwps_gauge_" + lid, "https://api.water.noaa.gov/nwps/v1/gauges/" + lid, timeout=90)))
    except (urllib.error.URLError, TimeoutError, ValueError) as e:
        failed.append({"lid": lid, "error": str(e)[:80]})
impacts = [i for d in details for i in (d.get("flood") or {}).get("impacts") or []]
texts = [i.get("statement") or "" for i in impacts]
cats = lambda d: (d.get("flood") or {}).get("categories") or {}
out["nwps_sample"] = {
    "requested": len(sample), "read": len(details), "failed": failed,
    "with_usgs_id": sum(1 for d in details if d.get("usgsId")),
    "with_reach_id": sum(1 for d in details if d.get("reachId")),
    "with_a_minor_flood_stage": sum(1 for d in details if (cats(d).get("minor") or {}).get("stage", -9999) > -9999),
    "with_a_major_flood_stage": sum(1 for d in details if (cats(d).get("major") or {}).get("stage", -9999) > -9999),
    "with_flood_impact_statements": sum(1 for d in details if (d.get("flood") or {}).get("impacts")),
    "impact_statements": len(impacts), "impact_statement_characters": sum(map(len, texts)),
    "impact_statement_median_characters": statistics.median(map(len, texts)) if texts else None,
    "impact_statements_with_a_stage": sum(1 for i in impacts if isinstance(i.get("stage"), (int, float))),
    "with_historic_crests": sum(1 for d in details if ((d.get("flood") or {}).get("crests") or {}).get("historic")),
    "historic_crests": sum(len(((d.get("flood") or {}).get("crests") or {}).get("historic") or []) for d in details),
    "impact_example": {"lid": next((d["lid"] for d in details if (d.get("flood") or {}).get("impacts")), None),
                       "first_statement": next((i for i in impacts), None)},
}
ids = sorted({d["usgsId"] for d in details if d.get("usgsId")})
rdb = s.get("usgs_sites", "https://waterservices.usgs.gov/nwis/site/?format=rdb&sites=" + ",".join(ids)).decode("utf-8", "replace") if ids else ""
lines = [l.split("\t") for l in rdb.splitlines() if l and not l.startswith("#")]
usgs = {r[1]: r for r in lines[2:]} if len(lines) > 2 else {}
pairs = []
for d in details:
    u = usgs.get(d.get("usgsId") or "")
    if u:
        pairs.append({"lid": d["lid"], "usgs_id": d["usgsId"], "nwps_name": d["name"], "usgs_station_name": u[2], "usgs_site_type": u[3],
                      "distance_degrees": round(max(abs(float(u[4]) - d["latitude"]), abs(float(u[5]) - d["longitude"])), 4)})
out["join_usgs_site_number"] = {
    "nwps_sample_gauges_citing_a_usgs_id": len(ids), "resolved_by_the_usgs_site_service": len(pairs),
    "unresolved": sorted(set(ids) - set(usgs)), "usgs_site_types": dict(collections.Counter(p["usgs_site_type"] for p in pairs)),
    "pairs_within_0_01_degrees": sum(1 for p in pairs if p["distance_degrees"] <= 0.01),
    "largest_distance_degrees": max((p["distance_degrees"] for p in pairs), default=None),
}
out["handcheck_sample"] = pairs[:20]
s.write(__file__, out)
