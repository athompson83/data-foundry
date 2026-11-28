#!/usr/bin/env python3
"""Round 35 (2026-11-28) retest of a parked source: the EPA ECHO drinking-water REST services, parked on
2026-10-04 on proxy errors. Asks get_systems for Vermont, reads every page of the answer with get_qid, and
compares the PWSIDs with the Envirofacts SDWIS WATER_SYSTEM table for the same primacy agency. Writes
echo_measure.json. Stdlib only."""
import collections, json, random
import scoutlib as s
from termslib import check

out = {"run_date": "2026-11-28", "state": "VT"}
q = json.loads(s.get("echo_get_systems_vt.json", "https://echodata.epa.gov/echo/sdw_rest_services.get_systems?output=JSON&p_st=VT"))["Results"]
out["get_systems"] = {k: q.get(k) for k in ("Message", "Version", "QueryRows", "SVRows", "CVRows", "V3Rows", "FEARows", "InfFEARows", "INSPRows")}
qid, total = q["QueryID"], int(q["QueryRows"])
systems, page = [], 1
while len(systems) < total and page <= 60:
    r = json.loads(s.get(f"echo_get_qid_vt_page{page}.json", f"https://echodata.epa.gov/echo/sdw_rest_services.get_qid?qid={qid}&output=JSON&p_pageno={page}"))["Results"]
    rows = r.get("WaterSystems") or []
    if not rows:
        break
    systems += rows; page += 1
echo = {x["PWSId"]: x for x in systems}
filled = collections.Counter(k for x in systems for k, v in x.items() if v not in (None, ""))
out["echo_systems"] = {"pages_read": page - 1, "rows": len(systems), "distinct_pwsids": len(echo), "fields": len(systems[0]) if systems else 0,
    "by_activity": dict(collections.Counter(x.get("PWSActivityDesc") for x in systems).most_common()), "by_type": dict(collections.Counter(x.get("PWSTypeDesc") for x in systems).most_common()),
    "serious_violators": sum(1 for x in systems if x.get("SeriousViolator") == "Yes"), "with_current_violation_flag": sum(1 for x in systems if x.get("CurrVioFlag") == "1"),
    "with_contaminants_in_violation_3yr": filled.get("SDWAContaminantsInViol3yr", 0), "with_last_sanitary_survey_date": filled.get("DateLastSansurvey", 0),
    "with_registry_id": filled.get("RegistryID", 0), "with_detailed_facility_report_url": filled.get("DfrUrl", 0), "with_fips_codes": filled.get("FIPSCodes", 0),
    "with_formal_enforcement_date": filled.get("SDWDateLastFea", 0), "with_violation_categories": filled.get("ViolationCategories", 0)}
sdwis, start = [], 0
while start < 20000:
    rows = json.loads(s.get(f"sdwis_water_system_vt_{start}.json", f"https://data.epa.gov/efservice/WATER_SYSTEM/PRIMACY_AGENCY_CODE/VT/ROWS/{start}:{start + 999}/JSON", timeout=180))
    sdwis += rows; start += 1000
    if len(rows) < 1000:
        break
sd = {x["pwsid"]: x for x in sdwis}
both = sorted(set(echo) & set(sd))
out["sdwis_water_system_vt"] = {"rows": len(sdwis), "distinct_pwsids": len(sd), "by_activity_code": dict(collections.Counter(x.get("pws_activity_code") for x in sdwis).most_common())}
out["join_pwsid"] = {"echo_pwsids": len(echo), "found_in_sdwis": len(both), "echo_not_in_sdwis": sorted(set(echo) - set(sd))[:10], "sdwis_not_in_echo": len(set(sd) - set(echo)),
    "same_system_name_ignoring_case": sum(1 for p in both if (echo[p].get("PWSName") or "").strip().lower() == (sd[p].get("pws_name") or "").strip().lower()),
    "same_population_served": sum(1 for p in both if str(echo[p].get("PopulationServedCount")) == str(sd[p].get("population_served_count"))),
    "same_activity_code": sum(1 for p in both if echo[p].get("PWSActivityCode") == sd[p].get("pws_activity_code"))}
random.seed(20261128)
out["handcheck_sample"] = [{"pwsid": p, "echo_name": echo[p].get("PWSName"), "sdwis_name": sd[p].get("pws_name"), "echo_type": echo[p].get("PWSTypeCode"), "sdwis_type": sd[p].get("pws_type_code"),
    "echo_population": echo[p].get("PopulationServedCount"), "sdwis_population": sd[p].get("population_served_count"), "echo_activity": echo[p].get("PWSActivityCode"), "sdwis_activity": sd[p].get("pws_activity_code")}
    for p in random.sample(both, min(20, len(both)))]
out["terms"] = {"epa_disclaimers": check("terms_epa_disclaimers.html", "https://www.epa.gov/web-policies-and-procedures/epa-disclaimers",
    ["Commercial use of the documents available from the EPA websites may be protected under the U.S. and Foreign Copyright Laws."], ("public domain", "copyright")),
    "echo_about_the_data": check("terms_echo_about.html", "https://echo.epa.gov/resources/echo-data/about-the-data", [], ("public domain", "copyright", "refresh", "updated weekly", "weekly"))}
s.write(__file__, out)
