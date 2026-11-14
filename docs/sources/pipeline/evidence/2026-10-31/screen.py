"""Live screening of six candidate data types. Writes screen.json. Every figure is fetched at run time."""
import json, re, sys, urllib.request, urllib.parse, datetime as dt
UA = "data-foundry-scout/1.0 (data@mail.proviciency.com)"
def get(u, n=None):
    try:
        r = urllib.request.urlopen(urllib.request.Request(u, headers={"User-Agent": UA}), timeout=90)
        b = r.read(); return r.status, b
    except urllib.error.HTTPError as e: return e.code, b""
    except Exception as e: return 0, str(e).encode()
def j(u):
    s, b = get(u)
    try: return s, json.loads(b)
    except Exception: return s, None
out = {"run": dt.datetime.utcnow().isoformat() + "Z"}
# 1 airworthiness directives
s, d = j("https://www.federalregister.gov/api/v1/documents.json?conditions[agencies][]=federal-aviation-administration&conditions[type][]=RULE&conditions[term]=%22airworthiness+directives%22&per_page=1&order=newest")
a = {"faa_fr_rule_documents_ad": d and d.get("count"), "status": s}
s2, d2 = j("https://www.federalregister.gov/api/v1/documents.json?conditions[agencies][]=federal-aviation-administration&conditions[type][]=RULE&conditions[term]=%22airworthiness+directives%22&per_page=5&order=newest&fields[]=title&fields[]=publication_date&fields[]=abstract&fields[]=document_number&fields[]=raw_text_url")
a["newest"] = d2 and [{k: x.get(k) for k in ("document_number", "publication_date")} for x in d2["results"]]
a["abstract_present"] = d2 and sum(1 for x in d2["results"] if x.get("abstract"))
for name, u in (("easa_ad_site", "https://ad.easa.europa.eu/"), ("easa_ad_rss", "https://ad.easa.europa.eu/rss/"), ("tc_cad", "https://wwwapps.tc.gc.ca/Saf-Sec-Sur/2/cawis-swimn/AD_Index.aspx"), ("faa_drs", "https://drs.faa.gov/browse/excelExternalWindow/AD")):
    st, b = get(u); a[name] = {"status": st, "bytes": len(b)}
out["airworthiness-directives"] = a
# 2 marine accident investigations
s, d = j("https://www.gov.uk/api/search.json?filter_format=maib_report&count=0")
m = {"maib_reports_total": d and d.get("total"), "status": s}
s, d = j("https://www.gov.uk/api/search.json?filter_format=maib_report&count=50&fields=title,public_timestamp,description&order=-public_timestamp")
m["newest_public_timestamp"] = d and d["results"][0]["public_timestamp"]
st, b = get("https://www.gov.uk/api/content/maib-reports/partial-collapse-of-an-inflatable-migrant-boat-resulting-in-the-loss-of-1-life-on-9-september-2025")
try:
    c = json.loads(b); body = c["details"].get("body", ""); m["sample_report_body_chars"] = len(body); m["sample_license"] = c.get("details", {}).get("metadata", {}) and {k: v for k, v in c["details"]["metadata"].items() if k in ("vessel_type", "date_of_occurrence", "report_type")}
except Exception as e: m["sample_error"] = str(e)[:80]
for name, u in (("tsb_canada_marine", "https://www.tsb.gc.ca/eng/rapports-reports/marine/index.html"), ("ntsb_carol", "https://data.ntsb.gov/carol-main-public/basic-search"), ("dutch_dsb", "https://www.onderzoeksraad.nl/en/")):
    st, b = get(u); m[name] = {"status": st, "bytes": len(b)}
out["marine-accident-investigations"] = m
# 3 drug adverse events
s, d = j("https://api.fda.gov/drug/event.json?search=receivedate:%5B20260101+TO+20261031%5D&limit=1")
e = {"faers_2026_reports": d and d["meta"]["results"]["total"], "meta_last_updated": d and d["meta"]["last_updated"], "status": s}
e["faers_report_fields"] = d and sorted(d["results"][0].keys())[:40]
st, b = get("https://www.canada.ca/en/health-canada/services/drugs-health-products/medeffect-canada/adverse-reaction-database/canada-vigilance-online-database-data-extract.html")
h = b.decode("utf8", "ignore")
e["canada_vigilance_page"] = {"status": st, "zip_links": re.findall(r'href="([^"]+\.zip)"', h)[:4], "licence_mention": [m_.group(0) for m_ in re.finditer(r"[^.]{0,80}(Open Government Licence|licen[cs]e)[^.]{0,80}", h)][:3]}
out["drug-adverse-events"] = e
# 4 historic places
s, d = j("https://mapservices.nps.gov/arcgis/rest/services/cultural_resources/nrhp_locations/MapServer/0/query?where=1%3D1&returnCountOnly=true&f=json")
hp = {"nrhp_locations": d and d.get("count")}
s, d = j("https://services-eu1.arcgis.com/ZOdPfBS3aqqDYPUQ/arcgis/rest/services/National_Heritage_List_for_England_NHLE_v02_VIEW/FeatureServer/0/query?where=1%3D1&returnCountOnly=true&f=json")
hp["nhle_listed_building_points"] = d and d.get("count")
hp["free_text_fields"] = "NRHP layer: none (name, address, refnum, NARA_URL link); NHLE layer: Name, Grade, hyperlink only. The descriptive text sits on the list-entry pages."
out["historic-places"] = hp
# 5 legislation
st, b = get("https://www.legislation.gov.uk/new/data.feed"); t = b.decode("utf8", "ignore")
l = {"uk_new_feed_status": st, "uk_new_feed_entries_first_page": len(re.findall(r"<entry>", t))}
st, b = get("https://www.legislation.gov.uk/ukpga/data.feed"); t = b.decode("utf8", "ignore")
mm = re.search(r"totalResults>(\d+)", t); l["uk_public_general_acts_feed_total"] = mm and int(mm.group(1))
s, d = j("https://api.congress.gov/v3/bill?api_key=DEMO_KEY&format=json&limit=1")
l["congress_gov_demo_key"] = {"status": s, "count": d and d.get("pagination", {}).get("count")}
out["legislation-texts"] = l
# 6 nuclear events
st, b = get("https://www.nrc.gov/reading-rm/doc-collections/event-status/event/en.html"); t = b.decode("utf8", "ignore")
n = {"status": st, "year_links": sorted(set(re.findall(r"event/(20\d\d)/", t)))[-3:], "event_links": len(set(re.findall(r"event/20\d\d/\d{8}en\.html", t)))}
st, b = get("https://www.nrc.gov/reading-rm/doc-collections/event-status/event/2026/20261029en.html"); n["sample_day_status"] = {"status": st, "bytes": len(b), "has_event_number": bool(re.search(r"Event Number", b.decode("utf8", "ignore")))}
st, b = get("https://www.nrc.gov/reading-rm/doc-collections/event-status/event/2026/"); n["year_index"] = {"status": st, "bytes": len(b)}
out["nuclear-event-reports"] = n
json.dump(out, open(sys.argv[1], "w"), indent=1); print(json.dumps(out, indent=1)[:5000])
