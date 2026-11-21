#!/usr/bin/env python3
"""Scout round 2026-11-14: vehicle-crash-test-ratings screening.

Re-fetches every source live with the declared scout User-Agent and writes
ncap_measure.json next to this script. Stdlib only. Run: python3 -I ncap_measure.py
Records identifiers, counts and quoted terms only.
"""
import json, os, re, urllib.request, urllib.error, html

UA = "data-foundry-scout/1.0 (data@mail.proviciency.com)"
HERE = os.path.dirname(os.path.abspath(__file__))


def get(u, n=None, accept=None):
    h = {"User-Agent": UA}
    if accept:
        h["Accept"] = accept
    r = urllib.request.Request(u, headers=h)
    try:
        with urllib.request.urlopen(r, timeout=60) as f:
            return f.status, (f.read(n) if n else f.read()), f.geturl()
    except urllib.error.HTTPError as e:
        return e.code, b"", u
    except Exception as e:  # network / proxy failure is recorded, not raised
        return None, str(e).encode(), u


def text(b):
    t = b.decode("utf8", "replace")
    t = re.sub(r"<script.*?</script>|<style.*?</style>", " ", t, flags=re.S)
    return html.unescape(re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", t)))


def quote(t, pat, before=0, after=260):
    m = re.search(pat, t, re.I)
    return t[max(0, m.start() - before): m.end() + after].strip() if m else None


out = {"measured_on": "2026-11-14"}

# 1. NHTSA NCAP 5-Star Safety Ratings API (structured)
API = "https://api.nhtsa.gov/SafetyRatings"
ncap = {}
for y in (2024, 2025, 2026):
    s, b, _ = get(f"{API}/modelyear/{y}")
    ncap[f"makes_{y}"] = json.loads(b)["Count"] if s == 200 else s
# variants for a fixed sample of makes, model year 2024
variants, sample_makes = [], ["TOYOTA", "FORD", "HONDA", "HYUNDAI", "TESLA"]
models_by_make = {}
for mk in sample_makes:
    s, b, _ = get(f"{API}/modelyear/2024/make/{mk}")
    models = [r["Model"] for r in json.loads(b)["Results"]] if s == 200 else []
    models_by_make[mk] = models
    for mo in models[:4]:
        s2, b2, _ = get(f"{API}/modelyear/2024/make/{mk}/model/{urllib.request.quote(mo)}")
        if s2 == 200:
            variants += [r["VehicleId"] for r in json.loads(b2)["Results"]]
ncap["models_2024_by_sample_make"] = {k: len(v) for k, v in models_by_make.items()}
ncap["variants_2024_first4models_sample"] = len(variants)
details = []
for vid in variants[:12]:
    s, b, _ = get(f"{API}/VehicleId/{vid}")
    if s == 200 and json.loads(b)["Results"]:
        details.append(json.loads(b)["Results"][0])
ncap["detail_sampled"] = len(details)
ncap["detail_fields"] = sorted(details[0].keys()) if details else []
ncap["fill_overall_rating_not_rated"] = sum(d.get("OverallRating") in (None, "", "Not Rated") for d in details)
ncap["fill_complaints_recalls_investigations"] = sum(all(k in d for k in ("ComplaintsCount", "RecallsCount", "InvestigationCount")) for d in details)
ncap["sample_vehicle_ids"] = [d["VehicleId"] for d in details]
# crash-test picture URLs carry the NHTSA Research Database test number (vNNNNN)
tests = sorted({int(m) for d in details for k in ("FrontCrashPicture", "SideCrashPicture", "SidePolePicture")
                for m in re.findall(r"/v(\d+)[PC]", d.get(k) or "")})
ncap["nrd_test_numbers_cited"] = tests
ncap["free_text_fields"] = "none: every field is a coded rating, count, flag or media URL"
out["nhtsa_ncap_api"] = ncap

# 2. NHTSA Research Database test metadata (same publisher; test report PDFs)
nrd = []
for t in tests[:6]:
    s, b, _ = get(f"https://nrd.api.nhtsa.dot.gov/nhtsa/vehicle/api/v1/vehicle-database-test-results/metadata/{t}")
    if s == 200:
        r = json.loads(b)["results"][0]
        nrd.append({"tstno": r["TEST"]["TSTNO"], "title_has_NCAP": "NCAP" in (r["TEST"].get("TITLE") or ""),
                    "test_date": r["TEST"].get("TSTDAT"), "reports": len(r.get("REPORTS") or []),
                    "photos": len(r.get("PHOTOS") or [])})
    else:
        nrd.append({"tstno": t, "http": s})
out["nhtsa_nrd_api"] = {"tests_resolved": f"{sum('title_has_NCAP' in x for x in nrd)}/{len(nrd)}", "with_report_pdf": sum((x.get('reports') or 0) > 0 for x in nrd), "rows": nrd,
                        "note": "nrd.nhtsa.dot.gov (HTML query site) failed CONNECT 502 from this egress on 2026-11-14; the nrd.api host answered"}

# 3. NHTSA vPIC (make/model ids) and model-name join to NCAP for Toyota 2024 (same publisher)
s, b, _ = get("https://vpic.nhtsa.dot.gov/api/vehicles/GetModelsForMakeYear/make/toyota/modelyear/2024?format=json")
vp = {r["Model_Name"].upper(): r["Model_ID"] for r in json.loads(b)["Results"]} if s == 200 else {}
nc = models_by_make.get("TOYOTA", [])
out["nhtsa_vpic"] = {"http": s, "toyota_2024_models": len(vp),
                     "ncap_toyota_2024_models_exact_name_in_vpic": f"{sum(m.upper() in vp for m in nc)}/{len(nc)}"}

# 4. Euro NCAP: sitemap size and copyright terms
s, b, _ = get("https://www.euroncap.com/sitemap.xml")
locs = re.findall(r"<loc>([^<]+)</loc>", b.decode("utf8", "replace")) if s == 200 else []
s2, b2, _ = get("https://www.euroncap.com/terms-conditions/")
t = text(b2)
s3, b3, _ = get("https://www.euroncap.com/robots.txt")
out["euro_ncap"] = {"sitemap_http": s, "sitemap_urls": len(locs),
                    "assessment_urls": sum("/assessments/" in u for u in locs),
                    "robots_disallow_api": "Disallow: /api/" in b3.decode("utf8", "replace"),
                    "terms_http": s2,
                    "terms_quote": quote(t, r"Reproduction is not authorised for commercial purposes", 85, 140)}

# 5. ANCAP terms
s, b, _ = get("https://www.ancap.com.au/privacy-and-terms-of-use")
t = text(b)
out["ancap"] = {"terms_http": s,
                "quote_automated": quote(t, r"conduct any systematic or automated data collection activities", 0, 0),
                "quote_commercial": quote(t, r"reproduce or exploit any Content on this Platform for commercial purpose", 20, 140)}

# 6. Latin NCAP terms
s, b, _ = get("https://www.latinncap.com/en/terms-and-conditions")
t = text(b)
out["latin_ncap"] = {"terms_http": s, "quote": quote(t, r"Any reproduction, distribution, public communication", 0, 150)}

# 7. IIHS-HLDI API: key application and terms
s, b, _ = get("https://api.iihs.org/docs/terms")
t = text(b)
s2, b2, u2 = get("https://api.iihs.org/V4/ratings/modelyears")
out["iihs_api"] = {"terms_http": s, "unauthenticated_ratings_call_http": s2, "unauthenticated_ratings_call_final_url": u2,
                   "unauthenticated_ratings_call_is_json": b2[:1] in (b"[", b"{"),
                   "quote_key": quote(t, r"In order to use the IIHS API service, you must provide", 0, 80) or quote(t, r"submit an application for an API key", 60, 0),
                   "quote_sell": quote(t, r"You will not sublicense", 0, 230)}

# 8. Transport Canada / open.canada.ca: any crash-test rating dataset
s, b, _ = get("https://open.canada.ca/data/api/action/package_search?q=crash%20test%20rating&rows=5")
r = json.loads(b)["result"] if s == 200 else {}
out["transport_canada_open_data"] = {"http": s, "hits": r.get("count"),
                                     "orgs": [x.get("organization", {}).get("name") for x in r.get("results", [])]}

json.dump(out, open(os.path.join(HERE, "ncap_measure.json"), "w"), indent=1, default=str)
print(json.dumps(out, indent=1, default=str)[:6000])
