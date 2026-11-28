#!/usr/bin/env python3
"""Round 31 (2026-11-22): public emergency alerts (CAP messages). US National Weather Service alerts API,
FEMA IPAWS Archived Alerts on OpenFEMA, and the Environment and Climate Change Canada CAP files on the
MSC Datamart. Writes alert_measure.json. Stdlib only."""
import collections, datetime, json, random, re, urllib.error, urllib.parse
import xml.etree.ElementTree as ET
from scoutlib import get, status, write

out = {"run_date": "2026-11-22"}
GEO = "application/geo+json"
C = collections.Counter


def try_get(name, url, **kw):
    """Body, or the HTTP status as an int when the source answers 4xx/5xx."""
    try:
        return get(name, url, **kw)
    except urllib.error.HTTPError as e:
        return e.code


def instant(s):
    """An ISO timestamp as a UTC instant string, so both sides compare regardless of the offset written."""
    s = s.replace("Z", "+00:00")
    s = re.sub(r"\.\d+", "", s)
    return datetime.datetime.fromisoformat(s).astimezone(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def median(xs):
    xs = sorted(xs)
    return xs[len(xs) // 2] if xs else None


# --- robots.txt as answered to the declared User-Agent ---------------------------------------------------
robots = {}
for name, url in (("robots_api_weather_gov.txt", "https://api.weather.gov/robots.txt"), ("robots_fema.txt", "https://www.fema.gov/robots.txt"), ("robots_dd_weather_gc_ca.txt", "https://dd.weather.gc.ca/robots.txt")):
    b = try_get(name, url, timeout=60)
    robots[url] = {"http_status": b} if isinstance(b, int) else {"http_status": 200, "body": b.decode("utf-8", "replace").strip()[:200]}
out["robots"] = robots

# --- NWS: the active alerts, and every alert sent on one full UTC day ------------------------------------
def nws_stats(feats):
    p = [f["properties"] for f in feats]
    return {
        "alerts": len(p), "distinct_ids": len({x["id"] for x in p}),
        "by_status": dict(C(x["status"] for x in p).most_common()), "by_message_type": dict(C(x["messageType"] for x in p).most_common()),
        "by_severity": dict(C(x["severity"] for x in p).most_common()), "distinct_events": len({x["event"] for x in p}),
        "top_events": dict(C(x["event"] for x in p).most_common(8)),
        "with_description": sum(1 for x in p if (x.get("description") or "").strip()), "with_instruction": sum(1 for x in p if (x.get("instruction") or "").strip()),
        "median_description_characters": median([len(x["description"]) for x in p if x.get("description")]),
        "with_references": sum(1 for x in p if x.get("references")), "with_vtec": sum(1 for x in p if x["parameters"].get("VTEC")),
        "with_wea_handling": sum(1 for x in p if x["parameters"].get("WEAHandling")), "with_geometry": sum(1 for f in feats if f.get("geometry")),
        "sent_min": min(instant(x["sent"]) for x in p), "sent_max": max(instant(x["sent"]) for x in p),
        "ids_matching_urn_oid_2_49_0_1_840": sum(1 for x in p if x["id"].startswith("urn:oid:2.49.0.1.840.0.")),
    }

active = json.loads(get("nws_active.json", "https://api.weather.gov/alerts/active", accept=GEO))["features"]
out["nws_active"] = nws_stats(active)

DAY = "2026-11-19"
day_feats, url, page = [], f"https://api.weather.gov/alerts?start={DAY}T00:00:00Z&end=2026-11-20T00:00:00Z&limit=500", 0
while url:
    d = json.loads(get(f"nws_day_{DAY}_{page:02d}.json", url, accept=GEO))
    day_feats += d["features"]
    url = (d.get("pagination") or {}).get("next") if d["features"] else None
    page += 1
    if page > 40:
        break
day_feats = [f for f in day_feats if instant(f["properties"]["sent"]).startswith(DAY)]
out["nws_one_day"] = dict(nws_stats(day_feats), day_utc=DAY, pages=page)
# references name earlier alerts of the same publisher by identifier
refs = [r["identifier"] for f in day_feats for r in f["properties"].get("references") or []]
day_ids = {f["properties"]["id"] for f in day_feats}
out["nws_one_day"]["references_cited"] = len(refs)
out["nws_one_day"]["references_resolving_to_an_alert_sent_the_same_day"] = sum(1 for r in refs if r in day_ids)

# --- FEMA IPAWS archive -----------------------------------------------------------------------------------
IP = "https://www.fema.gov/api/open/v1/IpawsArchivedAlerts?"
meta = json.loads(get("openfema_datasets.json", "https://www.fema.gov/api/open/v1/OpenFemaDataSets?$filter=" + urllib.parse.quote("name eq 'IpawsArchivedAlerts' or name eq 'DisasterDeclarationsSummaries' or name eq 'FemaWebDisasterDeclarations'")))["OpenFemaDataSets"]
ipm = next(r for r in meta if r["name"] == "IpawsArchivedAlerts")
SEL = "&$select=identifier,sender,sent,status,msgType,cogId,info"
W0, W1 = "2026-11-08T00:00:00.000Z", "2026-11-21T00:00:00.000Z"
allw = json.loads(get("ipaws_all_1108_1120.json", IP + "$filter=" + urllib.parse.quote(f"sent ge '{W0}' and sent lt '{W1}'") + "&$top=5000&$inlinecount=allpages&$orderby=sent" + SEL))
rows = allw["IpawsArchivedAlerts"]
ev = lambda r: (r.get("info") or [{}])[0].get("event") or ""
same = lambda r: sorted({g["value"] for i in r.get("info") or [] for a in i.get("area") or [] for g in a.get("geocode") or [] if g.get("name") == "SAME"})
par = lambda r, n: [p["value"] for i in r.get("info") or [] for p in i.get("parameter") or [] if p.get("name") == n]
PERSON = re.compile(r"missing|amber|child abduction|silver|blue alert|endangered", re.I)
person_rows = [r for r in rows if PERSON.search(ev(r)) or any(c.get("value") in ("CAE", "MEP", "BLU") for i in r.get("info") or [] for c in i.get("eventCode") or [])]
out["ipaws_archive"] = {
    "catalog_record_count": ipm["recordCount"], "catalog_temporal": ipm["temporal"], "catalog_accrual_periodicity": ipm["accrualPeriodicity"], "catalog_license_field": ipm["license"],
    "window": [W0, W1], "window_count_reported": allw["metadata"]["count"], "window_rows_returned": len(rows), "window_distinct_identifiers": len({r["identifier"] for r in rows}),
    "window_by_status": dict(C(r["status"] for r in rows).most_common()), "window_by_msg_type": dict(C(r["msgType"] for r in rows).most_common()),
    "window_distinct_senders": len({r["sender"] for r in rows}), "window_distinct_cog_ids": len({r["cogId"] for r in rows}),
    "window_from_nws_sender": sum(1 for r in rows if r["sender"] == "w-nws.webmaster@noaa.gov"),
    "window_top_events": dict(C(ev(r) for r in rows).most_common(10)),
    "window_with_description": sum(1 for r in rows if any((i.get("description") or "").strip() for i in r.get("info") or [])),
    "window_with_wea_text": sum(1 for r in rows if par(r, "CMAMtext") or par(r, "CMAMlongtext")),
    "window_missing_person_or_abduction_alerts": len(person_rows),
    "window_senders_written_as_an_email_address_other_than_nws": len({r["sender"] for r in rows if "@" in r["sender"] and r["sender"] != "w-nws.webmaster@noaa.gov"}),
    "newest_sent_in_window": max(r["sent"] for r in rows),
}
newest = json.loads(get("ipaws_newest.json", IP + "$top=1&$orderby=sent%20desc&$inlinecount=allpages&$select=identifier,sent"))
out["ipaws_archive"]["total_count_reported"] = newest["metadata"]["count"]
out["ipaws_archive"]["newest_sent"] = newest["IpawsArchivedAlerts"][0]["sent"]
out["ipaws_archive"]["api_run_time"] = newest["metadata"]["rundate"]

nws_ip = json.loads(get("ipaws_nws_since_oct.json", IP + "$filter=" + urllib.parse.quote("sender eq 'w-nws.webmaster@noaa.gov' and sent ge '2026-10-01T00:00:00.000Z'") + "&$top=1000&$inlinecount=allpages&$orderby=sent%20desc" + SEL))
nrows = nws_ip["IpawsArchivedAlerts"]
out["ipaws_nws_origin_since_2026_10_01"] = {
    "count_reported": nws_ip["metadata"]["count"], "rows_returned": len(nrows), "by_event": dict(C(ev(r) for r in nrows).most_common()),
    "identifiers_ending_dot_IPAWS": sum(1 for r in nrows if r["identifier"].endswith(".IPAWS")),
    "identifiers_starting_urn_oid_2_49_0_1_840_0": sum(1 for r in nrows if r["identifier"].startswith("urn:oid:2.49.0.1.840.0.")),
    "sent_min": min(r["sent"] for r in nrows), "sent_max": max(r["sent"] for r in nrows),
}

# --- Declared join: the CAP alert identifier. IPAWS writes the NWS identifier with a ".IPAWS" suffix ------
def nws_id(r):
    return re.sub(r"\.IPAWS$", "", r["identifier"])

join_rows = sorted((r for r in nrows if r["sent"] >= W0), key=lambda r: r["sent"])
pairs, per_day = [], collections.defaultdict(lambda: [0, 0])
for r in join_rows:
    i = nws_id(r)
    b = try_get("nws_alert_" + re.sub(r"[^A-Za-z0-9.]", "_", i) + ".json", "https://api.weather.gov/alerts/" + i, accept=GEO, timeout=60)
    day = r["sent"][:10]
    per_day[day][1] += 1
    if isinstance(b, int):
        continue
    p = json.loads(b)["properties"]
    if p["id"] == i:
        per_day[day][0] += 1
        pairs.append((r, p))
recent = [d for d in per_day if d >= "2026-11-15"]
older = [d for d in per_day if d < "2026-11-15"]
out["cap_identifier_join"] = {
    "rule": "IPAWS identifier with the trailing '.IPAWS' removed equals the NWS API alert id; resolved with one GET of https://api.weather.gov/alerts/{id} per IPAWS alert",
    "ipaws_nws_origin_alerts_sent_since_2026_11_08": len(join_rows),
    "resolved_at_nws_api": len(pairs),
    "by_sent_day_matched_total": {d: per_day[d] for d in sorted(per_day)},
    "sent_2026_11_15_or_later": {"matched": sum(per_day[d][0] for d in recent), "total": sum(per_day[d][1] for d in recent)},
    "sent_2026_11_08_to_2026_11_14": {"matched": sum(per_day[d][0] for d in older), "total": sum(per_day[d][1] for d in older)},
}

def side_by_side(r, p):
    i0 = (r.get("info") or [{}])[0]
    return {
        "ipaws_identifier": r["identifier"], "nws_id": p["id"],
        "ipaws_event": i0.get("event"), "nws_event": p["event"],
        "ipaws_sent_utc": instant(r["sent"]), "nws_sent_utc": instant(p["sent"]),
        "ipaws_expires_utc": instant(i0["expires"]) if i0.get("expires") else None, "nws_expires_utc": instant(p["expires"]) if p.get("expires") else None,
        "ipaws_same": same(r), "nws_same": sorted(p["geocode"].get("SAME") or []),
        "ipaws_vtec": sorted(set(par(r, "VTEC"))), "nws_vtec": sorted(set(p["parameters"].get("VTEC") or [])),
        "ipaws_info_languages": [i.get("language") for i in r.get("info") or []],
        "ipaws_sender_name": i0.get("senderName"), "nws_sender_name": p.get("senderName"),
        "same_description_text": (i0.get("description") or "").strip() == (p.get("description") or "").strip(),
    }

sbs = [side_by_side(r, p) for r, p in pairs]
agree = lambda a, b: sum(1 for s in sbs if s[a] == s[b])
out["cap_identifier_join"]["matched_pairs_agreeing"] = {
    "event": agree("ipaws_event", "nws_event"), "sent_instant": agree("ipaws_sent_utc", "nws_sent_utc"), "expires_instant": agree("ipaws_expires_utc", "nws_expires_utc"),
    "same_codes": agree("ipaws_same", "nws_same"), "vtec": agree("ipaws_vtec", "nws_vtec"), "sender_name": agree("ipaws_sender_name", "nws_sender_name"),
    "description_text": sum(1 for s in sbs if s["same_description_text"]), "pairs": len(sbs),
}

# Reverse direction, on the one full day: NWS alerts flagged for Wireless Emergency Alerts that the archive holds.
ip_ids = {nws_id(r) for r in nrows}
wea = [f["properties"] for f in day_feats if f["properties"]["parameters"].get("WEAHandling")]
out["cap_identifier_join"]["reverse_one_day"] = {
    "day_utc": DAY, "nws_alerts_sent": len(day_feats), "nws_alerts_with_wea_handling": len(wea),
    "of_those_present_in_ipaws_archive": sum(1 for p in wea if p["id"] in ip_ids),
    "nws_alerts_without_wea_handling_present_in_ipaws_archive": sum(1 for f in day_feats if not f["properties"]["parameters"].get("WEAHandling") and f["properties"]["id"] in ip_ids),
    "ipaws_nws_origin_alerts_sent_that_day": sum(1 for r in nrows if r["sent"].startswith(DAY)),
}

random.seed(20261122)
out["handcheck_sample"] = random.sample(sorted(sbs, key=lambda s: s["nws_id"]), min(20, len(sbs)))

# --- ECCC CAP files: every file published for one full UTC day -------------------------------------------
EDAY = "20261121"
EBASE = f"https://dd.weather.gc.ca/{EDAY}/WXO-DD/alerts/cap/{EDAY}/"
links = lambda b: [h for h in re.findall(r'href="([^"?/][^"]*)"', b.decode("utf-8", "replace")) if not h.startswith("http")]
NS = {"c": "urn:oasis:names:tc:emergency:cap:1.2"}
offices = [o for o in links(get(f"eccc_{EDAY}_index.html", EBASE)) if o.endswith("/")]
caps, listed = [], 0
for o in offices:
    for h in [x for x in links(get(f"eccc_{EDAY}_{o.strip('/')}.html", EBASE + o)) if x.endswith("/")]:
        for f in [x for x in links(get(f"eccc_{EDAY}_{o.strip('/')}_{h.strip('/')}.html", EBASE + o + h)) if x.endswith(".cap")]:
            listed += 1
            root = ET.fromstring(get(f"eccc_{EDAY}_{f}", EBASE + o + h + f))
            g = lambda tag, el=root: (el.findtext("c:" + tag, default="", namespaces=NS) or "").strip()
            infos = root.findall("c:info", NS)
            caps.append({
                "office": o.strip("/"), "identifier": g("identifier"), "sender": g("sender"), "sent": g("sent"), "status": g("status"), "msgType": g("msgType"),
                "references": [x.split(",")[1] for x in g("references").split() if x.count(",") >= 2],
                "languages": sorted({g("language", i) for i in infos}), "event": g("event", infos[0]) if infos else "",
                "headline": g("headline", infos[0]) if infos else "", "desc_chars": [len(g("description", i)) for i in infos if g("language", i) == "en-CA"],
                "polygons": len(root.findall(".//c:polygon", NS)), "clc": len([1 for gc in root.findall(".//c:geocode", NS) if "Location" in g("valueName", gc)]),
            })
cap_ids = {c["identifier"] for c in caps}
erefs = [r for c in caps for r in c["references"]]
out["eccc_cap_one_day"] = {
    "day_utc": EDAY, "index_url": EBASE, "offices": dict(C(c["office"] for c in caps).most_common()), "files_listed": listed, "files_parsed": len(caps),
    "distinct_identifiers": len(cap_ids), "identifiers_starting_urn_oid_2_49_0_1_124": sum(1 for i in cap_ids if i.startswith("urn:oid:2.49.0.1.124.")),
    "by_status": dict(C(c["status"] for c in caps).most_common()), "by_msg_type": dict(C(c["msgType"] for c in caps).most_common()),
    "senders": dict(C(c["sender"] for c in caps).most_common()), "by_headline": dict(C(c["headline"] for c in caps).most_common(10)),
    "by_event": dict(C(c["event"] for c in caps).most_common(10)),
    "files_with_english_and_french_info": sum(1 for c in caps if {"en-CA", "fr-CA"} <= set(c["languages"])),
    "files_with_english_description": sum(1 for c in caps if any(n > 0 for n in c["desc_chars"])),
    "median_english_description_characters": median([n for c in caps for n in c["desc_chars"] if n > 0]),
    "files_with_polygon": sum(1 for c in caps if c["polygons"]), "files_with_location_geocode": sum(1 for c in caps if c["clc"]),
    "files_with_references": sum(1 for c in caps if c["references"]), "references_cited": len(erefs), "distinct_references_cited": len(set(erefs)),
    "references_resolving_to_a_file_of_the_same_day": sum(1 for r in erefs if r in cap_ids),
    "sent_min": min(instant(c["sent"]) for c in caps), "sent_max": max(instant(c["sent"]) for c in caps),
    "sample_identifiers": sorted(cap_ids)[:5],
    "identifiers_also_present_in_nws_or_ipaws_sets": len(cap_ids & (day_ids | ip_ids | {r["identifier"] for r in rows})),
}
# --- Terms pages: each quoted sentence is checked against the fetched body -------------------------------
QUOTES = [
    ("terms_nws_disclaimer.html", "https://www.weather.gov/disclaimer", "The information on National Weather Service (NWS) Web pages are in the public domain, unless specifically noted otherwise, and may be used without charge for any lawful purpose so long as you do not: 1) claim it is your own"),
    ("terms_nws_api.html", "https://www.weather.gov/documentation/services-web-api", "All of the information presented via the API is intended to be open data, free to use for any purpose."),
    ("terms_eccc.html", "https://eccc-msc.github.io/open-data/licence/readme_en/", "The Information Provider grants you a worldwide, royalty-free, perpetual, non-exclusive licence to use the Information, including for commercial purposes, subject to the terms below."),
    ("terms_eccc.html", "https://eccc-msc.github.io/open-data/licence/readme_en/", "In the case of weather alerts (i.e. watches/warnings), any information shall be reproduced in such a way that there is no alteration of the content or intent of the alert."),
]
terms = [{"url": u, "quote": q, "quote_found_verbatim_in_body": q in get(n, u, timeout=120).decode("utf-8", "replace")} for n, u, q in QUOTES]
FQ = "This is raw, unedited data with no personally identifiable information from the IPAWS Alert Aggregator from June 2012 to the present created by over 1450 Alert Originators across the country. FEMA does not validate the content of each message."
terms.append({"url": "https://www.fema.gov/api/open/v1/OpenFemaDataSets", "quote": FQ, "quote_found_verbatim_in_body": FQ in ipm["description"], "note": "dataset description in the OpenFEMA catalogue API; it is a description, not a licence"})
out["terms"] = terms
out["terms_not_readable"] = {u: status(u) for u in ("https://www.fema.gov/about/openfema/terms-conditions", "https://www.fema.gov/openfema-data-page/ipaws-archived-alerts-v1")}
write(__file__, out)
