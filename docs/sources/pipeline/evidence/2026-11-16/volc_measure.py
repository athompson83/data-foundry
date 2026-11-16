#!/usr/bin/env python3
"""Screening 2026-11-16: volcanic-activity. Fetches every source live (stdlib only).
Run from this directory with: python3 -I volc_measure.py   -> writes volc_measure.json
Output holds volcano numbers, volcano/observatory/agency names, notice ids, dates and counts only.
USGS observatory contact emails and RSS editor addresses are never written.

Members:
  Smithsonian GVP Volcanoes of the World (GeoServer WFS, webservices.volcano.si.edu): structured volcano register.
  Smithsonian/USGS Weekly Volcanic Activity Report RSS (volcano.si.edu): free-text weekly reports, guid #vn_<GVP number>.
  USGS Volcano Hazards Program HANS public API (volcanoes.usgs.gov): US volcanoes + alert levels (vnum) + free-text notices.
  GeoNet NZ volcanic alert levels (api.geonet.org.nz): structured alert level per NZ volcano, id is a name.
  Tokyo VAAC (JMA) volcanic ash advisories (data.jma.go.jp): free-text ICAO advisories citing the GVP volcano number.
  NOAA NCEI/WDS Global Significant Volcanic Eruptions Database (ngdc.noaa.gov hazel API): volcano locations + significant
    eruptions, each carrying the GVP volcano number (newNum / volcanoLocationNewNum).
Joins:
  declared: NCEI newNum / volcanoLocationNewNum, USGS vnum, weekly-report guid number, VAAC "VOLCANO: <NAME> <number>" -> GVP Volcano_Number.
  candidate: GeoNet volcanoTitle -> GVP Volcano_Name within Country New Zealand (pairs written for hand-check).
"""
import json, re, time, math, unicodedata, urllib.request, urllib.parse, html as H
from collections import Counter

UA = "data-foundry-scout/1.0 (data@mail.proviciency.com)"
out = {"run_date": time.strftime("%Y-%m-%d"), "requests": 0}


def get(u, tries=3, timeout=180):
    for i in range(tries):
        out["requests"] += 1
        try:
            r = urllib.request.Request(u, headers={"User-Agent": UA, "Accept-Encoding": "identity"})
            with urllib.request.urlopen(r, timeout=timeout) as f:
                return f.status, f.headers.get("Content-Type", ""), f.read()
        except urllib.error.HTTPError as e:
            if e.code >= 500 and i < tries - 1:
                time.sleep(10)
                continue
            return e.code, e.headers.get("Content-Type", ""), e.read()
        except Exception as e:
            if i == tries - 1:
                return 0, "", str(e).encode()
            time.sleep(5)


def norm(s):
    s = unicodedata.normalize("NFKD", s or "")
    s = "".join(c for c in s if not unicodedata.combining(c)).lower()
    return re.sub(r"[^a-z0-9]+", "", s)


def km(a, b, c, d):
    p = math.pi / 180
    x = math.sin((c - a) * p / 2) ** 2 + math.cos(a * p) * math.cos(c * p) * math.sin((d - b) * p / 2) ** 2
    return round(12742 * math.asin(math.sqrt(x)), 1)


WFS = "https://webservices.volcano.si.edu/geoserver/GVP-VOTW/ows?service=WFS&version=1.0.0&request=GetFeature&outputFormat=application/json&typeName="

# ---------------------------------------------------------------- 1. GVP Volcanoes of the World
gvp = {}
for layer in ("Smithsonian_VOTW_Holocene_Volcanoes", "Smithsonian_VOTW_Pleistocene_Volcanoes"):
    s, ct, b = get(WFS + "GVP-VOTW:" + layer)
    o = {"status": s, "bytes": len(b)}
    if s == 200:
        feats = json.loads(b)["features"]
        o["features"] = len(feats)
        o["fields"] = sorted(feats[0]["properties"].keys()) if feats else []
        for f in feats:
            p = f["properties"]
            gvp.setdefault(int(p["Volcano_Number"]), dict(p, _layer=layer))
        if layer.startswith("Smithsonian_VOTW_Holocene"):
            ly = [p["properties"].get("Last_Eruption_Year") for p in feats]
            o["last_eruption_year_ge_2025"] = sum(1 for y in ly if isinstance(y, int) and y >= 2025)
            o["with_geological_summary"] = sum(1 for p in feats if (p["properties"].get("Geological_Summary") or "").strip())
            o["countries"] = len({p["properties"].get("Country") for p in feats})
    out["gvp_" + layer] = o
    time.sleep(2)
out["gvp_volcano_numbers"] = len(gvp)
# eruptions layer: count and field list only
s, ct, b = get(WFS + "GVP-VOTW:Smithsonian_VOTW_Holocene_Eruptions&maxFeatures=1")
if s == 200:
    f = json.loads(b)["features"]
    out["gvp_eruptions_fields"] = sorted(f[0]["properties"].keys()) if f else []
s, ct, b = get("https://webservices.volcano.si.edu/geoserver/GVP-VOTW/ows?service=WFS&version=1.1.0&request=GetFeature&resultType=hits&typeName=GVP-VOTW:Smithsonian_VOTW_Holocene_Eruptions")
m = re.search(rb'numberOfFeatures="(\d+)"', b or b"")
out["gvp_holocene_eruptions_count"] = int(m.group(1)) if m else {"status": s}
s, ct, b = get("https://webservices.volcano.si.edu/geoserver/GVP-VOTW/ows?service=WFS&request=GetCapabilities")
out["gvp_wfs_capabilities"] = {"status": s, "access_constraints": (re.findall(rb"<ows:AccessConstraints>([^<]*)", b) or [b""])[0].decode(), "fees": (re.findall(rb"<ows:Fees>([^<]*)", b) or [b""])[0].decode()}
# terms pages (Cloudflare managed challenge observed; recorded, never bypassed)
for u in ("https://volcano.si.edu/gvp_terms.cfm", "https://www.si.edu/termsofuse"):
    s, ct, b = get(u)
    t = b.decode("utf8", "replace")
    out.setdefault("gvp_terms_pages", []).append({"url": u, "status": s, "challenge": ("challenge-platform" in t) or ("Request verification" in t), "title": (re.findall(r"<title>([^<]*)", t) or [""])[0].strip()})
    time.sleep(1)

# ---------------------------------------------------------------- 2. Weekly Volcanic Activity Report RSS
s, ct, b = get("https://volcano.si.edu/news/WeeklyVolcanoRSS.xml")
t = b.decode("latin-1")
items = re.findall(r"<item>(.*?)</item>", t, re.S)
w = {"status": s, "bytes": len(b), "items": len(items), "channel_pubDate": (re.findall(r"<pubDate>([^<]*)", t) or [None])[0]}
wk = []
for it in items:
    title = H.unescape((re.findall(r"<title>(.*?)</title>", it, re.S) or [""])[0]).strip()
    num = re.findall(r"#vn_(\d+)", it)
    desc = re.sub(r"<[^>]+>", " ", H.unescape((re.findall(r"<description>(.*?)</description>", it, re.S) or [""])[0]))
    src = re.findall(r"Sources?:\s*([^\n]+)", desc)
    mt = re.match(r"(.+?) \(([^)]+)\) - Report for (.+?) - (.+)", title)
    wk.append({"vn": int(num[0]) if num else None, "name": mt.group(1) if mt else title, "country": mt.group(2) if mt else None,
               "period": mt.group(3) if mt else None, "kind": mt.group(4) if mt else None, "chars": len(desc.split()),
               "alert_level_phrase": bool(re.search(r"Alert Level|Aviation Color Code|alert level", desc)),
               "source_agencies": [x.strip() for x in re.split(r";|, and | and ", src[0])] if src else []})
w["kinds"] = dict(Counter(x["kind"] for x in wk))
w["with_alert_level_phrase"] = sum(x["alert_level_phrase"] for x in wk)
w["with_source_line"] = sum(1 for x in wk if x["source_agencies"])
w["median_words"] = sorted(x["chars"] for x in wk)[len(wk) // 2] if wk else 0
out["weekly_rss"] = w
res = [x for x in wk if x["vn"] in gvp]
out["join_weekly_to_gvp"] = {"items": len(wk), "with_number": sum(1 for x in wk if x["vn"]), "resolve": len(res),
                             "same_name": sum(1 for x in res if norm(x["name"]) == norm(gvp[x["vn"]]["Volcano_Name"]))}
out["weekly_samples"] = [{k: x[k] for k in ("vn", "name", "country", "period", "kind")} for x in wk]

# ---------------------------------------------------------------- 3. USGS HANS
H_API = "https://volcanoes.usgs.gov/hans-public/api/"
s, ct, b = get(H_API + "volcano/getUSVolcanoes")
us = json.loads(b) if s == 200 else []
out["usgs_us_volcanoes"] = {"status": s, "count": len(us), "fields": sorted(k for k in (us[0].keys() if us else []) if k != "obs_email"),
                            "observatories": dict(Counter(v["obs_abbr"] for v in us))}
res = [v for v in us if v.get("vnum") and v["vnum"].isdigit() and int(v["vnum"]) in gvp]
out["join_usgs_to_gvp"] = {"usgs_volcanoes": len(us), "with_vnum": sum(1 for v in us if v.get("vnum")), "resolve": len(res),
                           "same_name": sum(1 for v in res if norm(v["volcano_name"]) == norm(gvp[int(v["vnum"])]["Volcano_Name"])),
                           "within_25km": sum(1 for v in res if v.get("latitude") is not None and km(v["latitude"], v["longitude"], gvp[int(v["vnum"])]["Latitude"], gvp[int(v["vnum"])]["Longitude"]) <= 25),
                           "unresolved": [{"vnum": v.get("vnum"), "name": v["volcano_name"]} for v in us if v not in res]}
time.sleep(1)
s, ct, b = get(H_API + "volcano/getMonitoredVolcanoes")
mon = json.loads(b) if s == 200 else []
out["usgs_monitored"] = {"status": s, "count": len(mon), "alert_levels": dict(Counter(v["alert_level"] for v in mon)), "newest_sent_utc": max((v.get("sent_utc") or "" for v in mon), default=None)}
s, ct, b = get(H_API + "volcano/getElevatedVolcanoes")
el = json.loads(b) if s == 200 else []
out["usgs_elevated"] = [{k: v[k] for k in ("volcano_name", "vnum", "obs_abbr", "alert_level", "color_code", "notice_identifier", "sent_utc")} for v in el]
s, ct, b = get(H_API + "notice/getNewestOrRecent")
nr = json.loads(b) if s == 200 else []
out["usgs_newest_or_recent"] = {"status": s, "count": len(nr), "types": dict(Counter(n.get("notice_type_cd") for n in nr)), "newest_sent_utc": max((n.get("sent_utc") or "" for n in nr), default=None)}
# fetch the free-text notice of each elevated volcano: VNUM cited in prose
nt = []
for v in el[:10]:
    time.sleep(1)
    s, ct, b = get(v["notice_data"])
    if s != 200:
        nt.append({"id": v["notice_identifier"], "status": s}); continue
    d = json.loads(b)
    txt = re.sub(r"<[^>]+>", " ", H.unescape(d.get("notice_html") or ""))
    cited = [int(x) for x in re.findall(r"VNUM #(\d+)", txt)]
    nt.append({"id": v["notice_identifier"], "type": d.get("notice_type_cd"), "words": len(txt.split()), "vnum_cited": cited,
               "cited_resolve": sum(1 for c in cited if c in gvp), "sections": [s_.get("section_title") if isinstance(s_, dict) else None for s_ in (d.get("notice_sections") or [])][:6]})
out["usgs_elevated_notices"] = nt
wkn = {x["vn"] for x in wk}
out["overlap_usgs_elevated_in_weekly"] = {"elevated": len(el), "in_weekly": sum(1 for v in el if int(v["vnum"]) in wkn)}

# ---------------------------------------------------------------- 4. GeoNet VAL
s, ct, b = get("https://api.geonet.org.nz/volcano/val")
gn = json.loads(b)["features"] if s == 200 else []
out["geonet_val"] = {"status": s, "content_type": ct, "count": len(gn), "levels": dict(Counter(f["properties"]["level"] for f in gn)),
                     "fields": sorted(gn[0]["properties"].keys()) if gn else []}
nz = [p for p in gvp.values() if p.get("Country") == "New Zealand"]
pairs = []
for f in gn:
    p = f["properties"]; lon, lat = f["geometry"]["coordinates"]
    names = {norm(x) for x in re.split(r"/", p["volcanoTitle"])} | {norm(p["volcanoTitle"])}
    hit = [g for g in nz if norm(g["Volcano_Name"]) in names or any(n and n in norm(g["Volcano_Name"]) for n in names)]
    best = min(nz, key=lambda g: km(lat, lon, g["Latitude"], g["Longitude"]))
    pairs.append({"geonet_id": p["volcanoID"], "geonet_title": p["volcanoTitle"], "level": p["level"],
                  "name_match": [{"vn": g["Volcano_Number"], "gvp_name": g["Volcano_Name"], "km": km(lat, lon, g["Latitude"], g["Longitude"])} for g in hit],
                  "nearest": {"vn": best["Volcano_Number"], "gvp_name": best["Volcano_Name"], "km": km(lat, lon, best["Latitude"], best["Longitude"])}})
out["join_geonet_to_gvp"] = {"geonet": len(gn), "gvp_nz_volcanoes": len(nz), "name_matched": sum(1 for x in pairs if x["name_match"]), "pairs": pairs}

# ---------------------------------------------------------------- 5. Tokyo VAAC
s, ct, b = get("https://www.data.jma.go.jp/vaac/data/vaac_list.html")
links = sorted(set(re.findall(r'TextData/(\d{4})/(\d{8})_(\d{6})(\d{2})_(\d{4})_Text\.html', b.decode("utf8", "replace"))))
out["vaac_list"] = {"status": s, "advisories": len(links), "oldest": links[0][1] if links else None, "newest": links[-1][1] if links else None,
                    "distinct_volcano_numbers": len({l[2] for l in links}),
                    "filename_numbers_resolve": sum(1 for n in {l[2] for l in links} if int(n) in gvp)}
# newest advisory per volcano, up to 20 texts
latest = {}
for l in links:
    latest[l[2]] = l
vt = []
for n, l in sorted(latest.items(), key=lambda kv: kv[1][1], reverse=True)[:20]:
    time.sleep(1)
    u = f"https://www.data.jma.go.jp/vaac/data/TextData/{l[0]}/{l[1]}_{l[2]}{l[3]}_{l[4]}_Text.html"
    s, ct, b = get(u)
    txt = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", b.decode("utf8", "replace")))
    m = re.search(r"VOLCANO: (.+?) (\d{6})\b", txt)
    vn = int(m.group(2)) if m else None
    vt.append({"file": u.rsplit("/", 1)[1], "status": s, "volcano": m.group(1) if m else None, "cited_number": vn,
               "matches_filename": vn == int(n), "resolves": vn in gvp, "gvp_name": gvp[vn]["Volcano_Name"] if vn in gvp else None,
               "has_eruption_details": "ERUPTION DETAILS:" in txt, "area": (re.findall(r"AREA: (.+?) SUMMIT ELEV|AREA: (.+?) SOURCE ELEV", txt) or [None])[0]})
out["vaac_texts"] = vt
out["join_vaac_to_gvp"] = {"fetched": len(vt), "cite_number": sum(1 for x in vt if x["cited_number"]), "resolve": sum(1 for x in vt if x["resolves"]),
                           "number_equals_filename": sum(1 for x in vt if x["matches_filename"])}
vaacn = {int(l[2]) for l in links}
out["overlap_weekly_vs_vaac"] = {"weekly_numbers": len(wkn), "also_in_vaac_list": len(wkn & vaacn)}

# ---------------------------------------------------------------- 6. NOAA NCEI significant volcanic eruptions
NC = "https://www.ngdc.noaa.gov/hazel/hazard-service/api/v1/"
for ep in ("volcanolocs", "volcanoes"):
    rows, page, pages, meta = [], 1, 1, {}
    while page <= pages and page <= 20:
        s, ct, b = get(f"{NC}{ep}?page={page}")
        if s != 200:
            meta["error"] = {"page": page, "status": s}; break
        d = json.loads(b); pages = d["totalPages"]; meta["totalItems"] = d["totalItems"]
        rows += d["items"]; page += 1; time.sleep(1)
    meta["fetched"] = len(rows)
    if ep == "volcanolocs":
        nums = [r.get("newNum") for r in rows]
        meta["with_gvp_number"] = sum(1 for n in nums if n)
        meta["resolve"] = sum(1 for n in nums if n and int(n) in gvp)
        res = [r for r in rows if r.get("newNum") and int(r["newNum"]) in gvp]
        meta["same_name"] = sum(1 for r in res if norm(r["name"]) == norm(gvp[int(r["newNum"])]["Volcano_Name"]))
        meta["within_25km"] = sum(1 for r in res if r.get("latitude") is not None and km(r["latitude"], r["longitude"], gvp[int(r["newNum"])]["Latitude"], gvp[int(r["newNum"])]["Longitude"]) <= 25)
        meta["unresolved_sample"] = [{"newNum": r.get("newNum"), "name": r.get("name")} for r in rows if r not in res][:15]
        out["join_ncei_locs_to_gvp"] = meta
    else:
        nums = [r.get("volcanoLocationNewNum") for r in rows]
        meta["with_gvp_number"] = sum(1 for n in nums if n)
        meta["resolve"] = sum(1 for n in nums if n and int(n) in gvp)
        meta["distinct_volcanoes"] = len({n for n in nums if n})
        ys = sorted((r.get("year"), r.get("month") or 0, r.get("day") or 0) for r in rows if r.get("year") is not None)
        meta["newest_eruption"] = ys[-1] if ys else None
        meta["since_2020"] = sum(1 for y in ys if y[0] >= 2020)
        meta["with_comments"] = sum(1 for r in rows if (r.get("comments") or "").strip())
        meta["fields"] = sorted({k for r in rows for k in r.keys()})
        out["join_ncei_eruptions_to_gvp"] = meta

with open("volc_measure.json", "w") as f:
    json.dump(out, f, indent=1, ensure_ascii=False)
print(json.dumps({k: v for k, v in out.items() if k.startswith("join_") or k in ("requests", "gvp_volcano_numbers")}, indent=1, ensure_ascii=False)[:6000])
