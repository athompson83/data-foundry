#!/usr/bin/env python3
"""Screening 2026-11-18: seaports (one record per seaport/harbour). Fetches every source live (stdlib only).
Run from this directory with: python3 -I port_measure.py   -> writes port_measure.json (hand-check pairs included; verdicts in port_handcheck.json)
Output holds port/place names, codes, coordinates, harbour attributes, short excerpts of Coast Pilot prose and counts only.
Dock operator/owner fields of the USACE file are never requested (they can name natural persons).
Downloads are kept in a temp directory outside the repo (set PORT_CACHE=<dir> to reuse a cache while developing).

Members:
  NGA World Port Index (Pub 150): msi.nga.mil API/download probed (HTTP 503, maintenance page on 2026-11-18); rows read from the
    Esri Living Atlas copy "Ports Around the World" (FeatureServer UpdatedPub150, item says downloaded from NGA in May 2026).
  UNECE UN/LOCODE: unlocode.unece.org pre-release zip (three CSV parts) + publications and terms pages; unece.org probed (403).
  NOAA United States Coast Pilot: CP1..CP10 book index XML + every chapter XML (prose paragraphs, GNIS-tagged places).
  USACE: Principal Ports, Port / Port Statistical Area polygons, Navigation Facilities (docks) on the USACE ArcGIS services.
Joins:
  declared: UN/LOCODE in a WPI row -> UNECE code list; UN/LOCODE location code in a USACE dock row (+ US) -> UNECE code list and -> WPI.
  within-publisher: USACE port code (Principal Ports PORT -> Ports PORTIDPK; docks PORT -> Ports PORTIDPK); WPI index number uniqueness.
  candidate: WPI US port <-> Coast Pilot GNIS-tagged place, same normalised name and <= 25 km apart (20 seeded pairs written for hand-check).
"""
import json, re, time, gzip, io, os, csv, zipfile, random, math, hashlib, tempfile, statistics, html as H, collections, urllib.request, urllib.error, urllib.parse

UA = "data-foundry-scout/1.0 (data@mail.proviciency.com)"
out = {"run_date": time.strftime("%Y-%m-%d")}
NREQ = [0]
CACHE = os.environ.get("PORT_CACHE") or tempfile.mkdtemp(prefix="port_measure_")
KEEP = bool(os.environ.get("PORT_CACHE"))


def get(u, timeout=240, tries=3):
    """Returns (status, content-type, bytes). 5xx/429 are retried with a pause; other HTTP errors are returned as-is."""
    p = os.path.join(CACHE, hashlib.sha1(u.encode()).hexdigest())
    if KEEP and os.path.exists(p):
        with open(p, "rb") as f:
            return 200, "", f.read()
    for i in range(tries):
        NREQ[0] += 1
        try:
            req = urllib.request.Request(u, headers={"User-Agent": UA, "Accept": "*/*", "Accept-Encoding": "gzip"})
            with urllib.request.urlopen(req, timeout=timeout) as f:
                b = f.read()
                if f.headers.get("Content-Encoding") == "gzip" or b[:2] == b"\x1f\x8b":
                    b = gzip.decompress(b)
                if KEEP:
                    with open(p, "wb") as w:
                        w.write(b)
                time.sleep(0.25)
                return f.status, f.headers.get("Content-Type", ""), b
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 502, 504) and i < tries - 1:
                time.sleep(15)
                continue
            eb = e.read()
            if eb[:2] == b"\x1f\x8b":
                eb = gzip.decompress(eb)
            return e.code, e.headers.get("Content-Type", ""), eb
        except Exception as e:
            if i == tries - 1:
                return 0, "", str(e).encode()
            time.sleep(8)


def text(b):
    t = b.decode("utf8", "replace") if isinstance(b, bytes) else b
    t = re.sub(r"<script.*?</script>|<style.*?</style>", " ", t, flags=re.S)
    return re.sub(r"\s+", " ", H.unescape(re.sub(r"<[^>]+>", " ", t))).strip()


def km(a, b):
    (la1, lo1), (la2, lo2) = a, b
    p1, p2 = math.radians(la1), math.radians(la2)
    h = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lo2 - lo1) / 2) ** 2
    return 6371.0 * 2 * math.asin(min(1.0, math.sqrt(h)))


def norm(s):
    s = H.unescape(s or "").lower()
    s = re.sub(r"\(.*?\)", " ", s)
    s = re.sub(r"\bst\.?\s", "saint ", s)
    s = re.sub(r"\b(port of|harbor|harbour|city of|town of)\b", " ", s)
    s = re.sub(r"[^a-z0-9]+", " ", s)
    return " ".join(s.split())


def arcgis_all(layer, fields, page):
    rows, off = [], 0
    while True:
        q = urllib.parse.urlencode({"where": "1=1", "outFields": fields, "returnGeometry": "false", "orderByFields": "OBJECTID" if "OBJECTID" in fields or fields == "*" else fields.split(",")[0], "resultOffset": off, "resultRecordCount": page, "f": "json"})
        st, _, b = get(f"{layer}/query?{q}")
        d = json.loads(b) if st == 200 else {}
        feats = d.get("features", [])
        rows += [f["attributes"] for f in feats]
        if st != 200 or len(feats) < page:
            return st, rows
        off += page


def iso(ms):
    return time.strftime("%Y-%m-%d", time.gmtime(ms / 1000)) if ms else None


# ------------------------------------------------------------------ NGA World Port Index
nga = {"publisher_host_probes": {}}
for u in ["https://msi.nga.mil/api/publications/world-port-index?output=json", "https://msi.nga.mil/Publications/WPI", "https://msi.nga.mil/commercial-use"]:
    st, ct, b = get(u, tries=1)
    t = text(b)
    nga["publisher_host_probes"][u] = {"status": st, "content_type": ct, "maintenance_notice": "MSI IS CURRENTLY UNDER MAINTENANCE" in t, "excerpt": t[t.find("MSI IS CURRENTLY"):][:230] if "MSI IS CURRENTLY" in t else t[:160]}
ITEM = "https://www.arcgis.com/sharing/rest/content/items/b4043522b2ea443489505d9d3cc02ac4?f=json"
WPI = "https://services7.arcgis.com/xuAg12SDp2ow0Fb8/arcgis/rest/services/UpdatedPub150/FeatureServer/0"
st, _, b = get(ITEM)
it = json.loads(b)
desc = text(it.get("description") or "")
nga["esri_copy_item"] = {"status": st, "url": ITEM, "owner": it.get("owner"), "title": it.get("title"), "snippet": it.get("snippet"), "licenseInfo_text": text(it.get("licenseInfo") or ""), "accessInformation": it.get("accessInformation"), "created": iso(it.get("created")), "modified": iso(it.get("modified")), "provenance_sentences": [s.strip() for s in re.split(r"(?<=[.])\s", desc) if re.search(r"downloaded|updates this dataset|crowd sourced", s)]}
st, _, b = get(WPI + "?f=json")
lay = json.loads(b)
nga["layer"] = {"status": st, "url": WPI, "n_fields": len(lay.get("fields", [])), "data_last_edit": iso((lay.get("editingInfo") or {}).get("dataLastEditDate")), "field_aliases": [f["alias"] for f in lay.get("fields", [])]}
st, wpi = arcgis_all(WPI, "*", 1000)
nga["rows"] = len(wpi)
nga["rows_status"] = st


def val(v):
    return v not in (None, "", " ", "Unknown", "unknown", 0, 0.0)


idx = [r.get("World_Port_Index_Number") for r in wpi]
nga["index_number"] = {"rows_with_number": sum(1 for x in idx if x), "distinct": len({x for x in idx if x}), "min": min(x for x in idx if x), "max": max(x for x in idx if x)}
loc_raw = [(r.get("UN_LOCODE") or "").strip() for r in wpi]
nga["un_locode_column"] = {"rows_with_value": sum(1 for x in loc_raw if x), "value_samples": [x for x in loc_raw if x][:8], "well_formed_single": 0, "rows_listing_several_codes": 0}
LOC = re.compile(r"\b([A-Z]{2})[ -]?([A-Z2-9]{3})\b")
wpi_codes = {}  # index number -> list of codes
for r in wpi:
    raw = (r.get("UN_LOCODE") or "").strip().upper()
    cs = ["".join(m) for m in LOC.findall(raw)] if raw else []
    wpi_codes[r["World_Port_Index_Number"]] = cs
    if len(cs) == 1:
        nga["un_locode_column"]["well_formed_single"] += 1
    elif len(cs) > 1:
        nga["un_locode_column"]["rows_listing_several_codes"] += 1
nga["un_locode_column"]["rows_unparsable"] = sum(1 for r in wpi if (r.get("UN_LOCODE") or "").strip() and not wpi_codes[r["World_Port_Index_Number"]])
nga["countries"] = len({r.get("Country_Code") for r in wpi})
nga["top_countries"] = collections.Counter(r.get("Country_Code") for r in wpi).most_common(8)
nga["harbor_size"] = dict(collections.Counter(r.get("Harbor_Size") or "" for r in wpi))
nga["harbor_type"] = dict(collections.Counter(r.get("Harbor_Type") or "" for r in wpi))
FILL = ["Channel_Depth__m_", "Anchorage_Depth__m_", "Cargo_Pier_Depth__m_", "Oil_Terminal_Depth__m_", "Tidal_Range__m_", "Entrance_Width__m_", "Maximum_Vessel_Length__m_", "Maximum_Vessel_Beam__m_", "Maximum_Vessel_Draft__m_", "Alternate_Port_Name", "Standard_Nautical_Chart", "Sailing_Direction_or_Publication", "Publication_Link"]
nga["populated"] = {f: sum(1 for r in wpi if val(r.get(f))) for f in FILL}
nga["pilotage_compulsory"] = dict(collections.Counter(r.get("Pilotage___Compulsory") or "" for r in wpi))
nga["publication_cited"] = collections.Counter(r.get("Sailing_Direction_or_Publication") or "" for r in wpi).most_common(60)
us = [r for r in wpi if (r.get("Country_Code") or "").strip() == "United States"]
nga["us_ports"] = len(us)
nga["us_ports_citing_coast_pilot"] = sum(1 for r in us if "coast pilot" in (r.get("Sailing_Direction_or_Publication") or "").lower())
nga["sample_rows"] = [{k: r.get(k) for k in ["World_Port_Index_Number", "Main_Port_Name", "UN_LOCODE", "Country_Code", "Harbor_Size", "Channel_Depth__m_", "Maximum_Vessel_Draft__m_", "Pilotage___Compulsory", "Sailing_Direction_or_Publication", "Latitude", "Longitude"]} for r in wpi if r.get("Main_Port_Name") in ("Rotterdam", "Singapore", "Houston", "Eastport")]
out["nga_wpi"] = nga

# ------------------------------------------------------------------ UNECE UN/LOCODE
un = {"probes": {}}
for u in ["https://unece.org/trade/cefact/unlocode-code-list-country-and-territory", "https://service.unece.org/trade/locode/loc241csv.zip", "https://unece.org/terms-and-conditions"]:
    st, ct, b = get(u, tries=1)
    t = text(b)
    un["probes"][u] = {"status": st, "content_type": ct, "blocked_page": bool(re.search(r"you have been blocked|attention required|access denied|just a moment", t.lower())), "excerpt": t[:120]}
st, _, b = get("https://unlocode.unece.org/publications/")
t = text(b)
un["publications_page"] = {"status": st, "last_updated": (re.search(r"Last updated: ([A-Z][a-z]+ \d{1,2}, \d{4})", t) or [None, None])[1], "latest_release": (re.search(r"Latest Release Production ([A-Z][a-z]+ \d{4})", t) or [None, None])[1], "footer_licence_sentence": (re.search(r"All UN/CEFACT standards are free to use under CC By 4\.0 license", t) or [None])[0], "footer_related_standards": (re.search(r"Related UN/CEFACT standards: [A-Z, ]+LOCODE", t) or [None])[0]}
st, _, b = get("https://unlocode.unece.org/terms")
t = text(b)
m = re.search(r"The United Nations grants permission to Users.*?within this Site\.", t)
un["terms_page"] = {"status": st, "url": "https://unlocode.unece.org/terms", "grant_sentence": m.group(0) if m else None}
ZURL = "https://unlocode.unece.org/downloads/unlocode-latest.zip"
st, ct, b = get(ZURL)
un["zip"] = {"status": st, "url": ZURL, "bytes": len(b)}
z = zipfile.ZipFile(io.BytesIO(b))
un["zip"]["members"] = [(i.filename, i.file_size, "%04d-%02d-%02d" % i.date_time[:3]) for i in z.infolist()]
rows = []
for n in sorted(z.namelist()):
    if re.search(r"CodeListPart\d\.csv$", n):
        raw = z.read(n)
        try:
            s = raw.decode("utf-8-sig")
        except UnicodeDecodeError:
            s = raw.decode("cp1252", "replace")
        rows += list(csv.reader(io.StringIO(s)))
un["csv_rows"] = len(rows)
entries = [r for r in rows if len(r) >= 11 and r[2].strip()]
unloc = {}
for r in entries:
    code = (r[1] + r[2]).strip().upper()
    # the release sometimes swaps the Function / Status columns: the function string is the 8-character one with dashes or digits
    func = r[6] if re.fullmatch(r"[-0-9B]{8}", r[6] or "") else (r[7] if re.fullmatch(r"[-0-9B]{8}", r[7] or "") else r[6])
    e = unloc.setdefault(code, {"name": r[4] or r[3], "sub": r[5], "function": func, "date": r[8], "coord": r[10], "change": r[0]})
    if r[0] != "X" and e["change"] == "X":
        unloc[code] = {"name": r[4] or r[3], "sub": r[5], "function": func, "date": r[8], "coord": r[10], "change": r[0]}
un["location_entries"] = len(entries)
un["distinct_codes"] = len(unloc)
un["countries"] = len({c[:2] for c in unloc})
un["port_function_codes"] = sum(1 for e in unloc.values() if e["function"][:1] == "1")
un["codes_with_coordinates"] = sum(1 for e in unloc.values() if e["coord"].strip())
un["port_codes_with_coordinates"] = sum(1 for e in unloc.values() if e["function"][:1] == "1" and e["coord"].strip())
un["marked_for_removal"] = sum(1 for e in unloc.values() if e["change"] == "X")
dates = sorted(e["date"] for e in unloc.values() if re.fullmatch(r"\d{4}", e["date"] or "") and e["date"][:2] <= time.strftime("%y"))
un["newest_entry_date_yymm"] = dates[-1] if dates else None
un["us_codes"] = sum(1 for c in unloc if c[:2] == "US")
un["sample"] = {c: unloc[c] for c in ["NLRTM", "SGSIN", "USHOU", "USEPM"] if c in unloc}
st, _, b = get("https://raw.githubusercontent.com/datasets/un-locode/main/datapackage.json")
try:
    dp = json.loads(b)
    un["github_mirror_datapackage"] = {"status": st, "licence_title": dp["licenses"][0]["title"], "source": dp["sources"][0]["path"]}
except Exception:
    un["github_mirror_datapackage"] = {"status": st}
out["unece_unlocode"] = un


def uncoord(s):
    m = re.fullmatch(r"\s*(\d{2})(\d{2})([NS])\s+(\d{3})(\d{2})([EW])\s*", s or "")
    if not m:
        return None
    la = (int(m[1]) + int(m[2]) / 60) * (1 if m[3] == "N" else -1)
    lo = (int(m[4]) + int(m[5]) / 60) * (1 if m[6] == "E" else -1)
    return la, lo


# declared join 1: WPI UN/LOCODE -> UNECE list
j = {"wpi_rows": len(wpi), "wpi_rows_with_code": 0, "resolved": 0, "resolved_with_port_function": 0, "unresolved_samples": [], "distance_km": []}
for r in wpi:
    cs = wpi_codes[r["World_Port_Index_Number"]]
    if not cs:
        continue
    j["wpi_rows_with_code"] += 1
    hit = [c for c in cs if c in unloc]
    if hit:
        j["resolved"] += 1
        if any(unloc[c]["function"][:1] == "1" for c in hit):
            j["resolved_with_port_function"] += 1
        xy = uncoord(unloc[hit[0]]["coord"])
        if xy and r.get("Latitude") is not None:
            j["distance_km"].append(km(xy, (r["Latitude"], r["Longitude"])))
    elif len(j["unresolved_samples"]) < 12:
        j["unresolved_samples"].append({"wpi": r["World_Port_Index_Number"], "port": r["Main_Port_Name"], "code": r["UN_LOCODE"]})
d = j.pop("distance_km")
j["coordinate_agreement"] = {"pairs_with_both_coordinates": len(d), "median_km": round(statistics.median(d), 1) if d else None, "within_10_km": sum(1 for x in d if x <= 10), "within_25_km": sum(1 for x in d if x <= 25), "over_100_km": sum(1 for x in d if x > 100)}
allc = [c for cs in wpi_codes.values() for c in cs]
j["distinct_codes_cited"] = len(set(allc))
j["codes_cited_by_more_than_one_wpi_row"] = sum(1 for c, n in collections.Counter(allc).items() if n > 1)
j["unece_port_function_codes_with_a_wpi_row"] = sum(1 for c in set(allc) if c in unloc and unloc[c]["function"][:1] == "1")
out["join_wpi_unlocode"] = j

# ------------------------------------------------------------------ NOAA Coast Pilot
CPB = "https://nauticalcharts.noaa.gov/publications/coast-pilot/files"
cp = {"books": [], "chapter_fetch_failures": []}
places = []  # GNIS-tagged places that open a paragraph
tot_chars = tot_pars = tot_geo = 0
upd_dates = []
for bk in range(1, 11):
    st, _, b = get(f"{CPB}/CP{bk}.xml")
    s = b.decode("utf-8-sig", "replace")
    ed = (re.search(r"<Edition>(.*?)</Edition>", s) or [0, None])[1]
    yr = (re.search(r"<Year>(.*?)</Year>", s) or [0, None])[1]
    chs = re.findall(r"<Chapter>\s*<Title>(.*?)</Title>\s*<Desc>(.*?)</Desc>\s*<pdfpath>(.*?)</pdfpath>\s*<xmlpath>(.*?)</xmlpath>", s, flags=re.S)
    st2, _, ub = get(f"{CPB}/cp{bk}/updates.html")
    ud = re.findall(r"<td>(\d{2}-[A-Za-z]{3}-\d{2})</td>", ub.decode("utf8", "replace")) if st2 == 200 else []
    ud = sorted(time.strftime("%Y-%m-%d", time.strptime(x, "%d-%b-%y")) for x in ud)
    upd_dates += ud
    binfo = {"book": bk, "status": st, "edition": ed, "year": yr, "description": (re.search(r"<description>(.*?)</description>", s, flags=re.S) or [0, ""])[1].strip(), "chapters_listed": len(chs), "chapters_parsed": 0, "paragraphs": 0, "chars": 0, "geo_tagged": 0, "newest_weekly_update": ud[-1] if ud else None, "weekly_updates_listed": len(ud)}
    for title, cdesc, _, xp in chs:
        if not re.search(r"_C\d+_WEB\.xml$", xp):
            continue
        st, _, xb = get(f"{CPB}/cp{bk}/{xp}")
        if st != 200:
            cp["chapter_fetch_failures"].append({"book": bk, "file": xp, "status": st})
            continue
        x = xb.decode("utf-8-sig", "replace")
        binfo["chapters_parsed"] += 1
        chno = int(re.search(r"_C(\d+)_", xp)[1])
        for pm in re.finditer(r"<paragraph>(.*?)</paragraph>", x, flags=re.S):
            body = pm.group(1)
            pidx = (re.search(r"<paraIndex>\((\d+)\)</paraIndex>", body) or [0, ""])[1]
            ptxt = text(re.sub(r"<paraIndex>.*?</paraIndex>", "", body))
            binfo["paragraphs"] += 1
            binfo["chars"] += len(ptxt)
            geos = list(re.finditer(r"<CP_GEO_LOC\b([^>]*)>", body))
            binfo["geo_tagged"] += len(geos)
            lead = re.match(r"\s*<paraIndex>.*?</paraIndex>\s*<paraText>\s*(?:<Spacer>.*?</Spacer>)?\s*(?:<CP_B>)?\s*<CP_GEO_LOC\b([^>]*)>", body, flags=re.S)
            for g in geos:
                a = dict(re.findall(r'(\w+)="([^"]*)"', g.group(1)))
                try:
                    la, lo = float(a["lat_dec"]), float(a["long_dec"])
                except Exception:
                    continue
                if not (la or lo):
                    continue
                places.append({"book": bk, "chapter": chno, "para": pidx, "name": H.unescape(a.get("feature_name", "")), "class": a.get("feature_class", ""), "state": a.get("state_alpha", ""), "gnis": a.get("source_id", ""), "source": a.get("source", ""), "lat": la, "lon": lo, "lead": bool(lead and lead.group(1) == g.group(1)), "chars": len(ptxt), "text": ptxt})
    tot_chars += binfo["chars"]
    tot_pars += binfo["paragraphs"]
    tot_geo += binfo["geo_tagged"]
    cp["books"].append(binfo)
cp["totals"] = {"books": len(cp["books"]), "chapters_parsed": sum(b["chapters_parsed"] for b in cp["books"]), "paragraphs": tot_pars, "chars": tot_chars, "geo_tagged_mentions": tot_geo, "geo_tagged_with_coordinates": len(places), "distinct_gnis_ids": len({p["gnis"] for p in places if p["gnis"]}), "paragraphs_opening_with_a_tagged_place": sum(1 for p in places if p["lead"]), "newest_weekly_update": max(upd_dates) if upd_dates else None}
cp["feature_classes"] = collections.Counter(p["class"] for p in places).most_common(15)
cp["geo_sources"] = dict(collections.Counter(p["source"] for p in places))
st, _, b = get("https://nauticalcharts.noaa.gov/data/data-licensing.html")
t = text(b)
m = re.search(r"All data acquired by Coast Survey is formally dedicated to the public domain.*?for any purpose\.", t)
cp["licensing_page"] = {"status": st, "url": "https://nauticalcharts.noaa.gov/data/data-licensing.html", "sentence": m.group(0) if m else None}
st, _, b = get("https://nauticalcharts.noaa.gov/publications/coast-pilot/index.html")
t = text(b)
m = re.search(r"All Coast Pilot books are available to download free of charge\.", t)
m2 = re.search(r"Notice: Incomplete and otherwise inaccurate reproductions[^.]*\.", t)
cp["index_page"] = {"status": st, "url": "https://nauticalcharts.noaa.gov/publications/coast-pilot/index.html", "sentence": m.group(0) if m else None, "reproduction_notice": m2.group(0) if m2 else None}
out["noaa_coast_pilot"] = cp

# candidate join: WPI US port <-> Coast Pilot tagged place (same normalised name, <= 25 km)
RADIUS = 25.0
byname = collections.defaultdict(list)
for p in places:
    byname[norm(p["name"])].append(p)
cj = {"radius_km": RADIUS, "wpi_us_ports": len(us), "matched": 0, "name_found_but_farther_than_radius": 0, "matched_opening_a_paragraph": 0, "matched_feature_classes": collections.Counter(), "paragraph_chars": []}
pairs = []
for r in us:
    names = {norm(r.get("Main_Port_Name"))} | {norm(x) for x in re.split(r"[;,/]", r.get("Alternate_Port_Name") or "") if norm(x)}
    names.discard("")
    cands = [p for n in names for p in byname.get(n, [])]
    if not cands or r.get("Latitude") is None:
        continue
    scored = sorted(((km((r["Latitude"], r["Longitude"]), (p["lat"], p["lon"])), not p["lead"], p["class"] != "Populated Place", i, p) for i, p in enumerate(cands)), key=lambda x: (x[0] > RADIUS, x[1], x[2], x[0], x[3]))
    dist, _, _, _, p = scored[0]
    if dist > RADIUS:
        cj["name_found_but_farther_than_radius"] += 1
        continue
    cj["matched"] += 1
    cj["matched_opening_a_paragraph"] += int(p["lead"])
    cj["matched_feature_classes"][p["class"]] += 1
    cj["paragraph_chars"].append(p["chars"])
    pairs.append({"wpi_number": r["World_Port_Index_Number"], "wpi_port": r["Main_Port_Name"], "wpi_alternate": (r.get("Alternate_Port_Name") or "").strip(), "wpi_region": r.get("Region_Name"), "wpi_lat": r["Latitude"], "wpi_lon": r["Longitude"], "wpi_publication": r.get("Sailing_Direction_or_Publication"), "wpi_un_locode": (r.get("UN_LOCODE") or "").strip(), "wpi_harbor_size": r.get("Harbor_Size"), "cp_book": p["book"], "cp_chapter": p["chapter"], "cp_paragraph": p["para"], "cp_place": p["name"], "cp_class": p["class"], "cp_state": p["state"], "cp_gnis_id": p["gnis"], "cp_lat": p["lat"], "cp_lon": p["lon"], "distance_km": round(dist, 1), "cp_opens_paragraph": p["lead"], "cp_paragraph_chars": p["chars"], "cp_excerpt": p["text"][:420]})
pc = cj.pop("paragraph_chars")
cj["matched_feature_classes"] = dict(cj["matched_feature_classes"])
cj["matched_paragraph_chars"] = {"median": int(statistics.median(pc)) if pc else None, "min": min(pc) if pc else None, "max": max(pc) if pc else None, "total": sum(pc)}
cj["wpi_cited_volume_equals_matched_book"] = sum(1 for q in pairs if re.search(r"(\d+)", q["wpi_publication"] or "") and "coast pilot" in (q["wpi_publication"] or "").lower() and int(re.search(r"(\d+)", q["wpi_publication"])[1]) == q["cp_book"])
cj["matched_with_coast_pilot_citation"] = sum(1 for q in pairs if "coast pilot" in (q["wpi_publication"] or "").lower())
random.seed(20261118)
cj["handcheck_pairs"] = random.sample(pairs, min(20, len(pairs)))
out["join_wpi_coast_pilot"] = cj

# ------------------------------------------------------------------ USACE
S7 = "https://services7.arcgis.com/n1YM8pTrFmm7L4hs/arcgis/rest/services"
ua = {}
for key, iid in [("principal_ports_item", "16d570a7aa054943aabf52b0032a3b57"), ("navigation_facilities_item", "db8bdecc473646cd859c625508334483"), ("port_areas_item", "b7fd6cec8d8c43e4a141d24170e6d82f")]:
    u = f"https://www.arcgis.com/sharing/rest/content/items/{iid}?f=json"
    st, _, b = get(u)
    it = json.loads(b) if st == 200 else {}
    ua[key] = {"status": st, "url": u, "owner": it.get("owner"), "title": it.get("title"), "licenseInfo_text": text(it.get("licenseInfo") or ""), "accessInformation": it.get("accessInformation"), "modified": iso(it.get("modified"))}
lays = {}
for key, path in [("principal_ports", "Principal_Ports/FeatureServer/0"), ("ports", "Port_Statistical_Area/FeatureServer/0"), ("port_statistical_areas", "Port_Statistical_Area/FeatureServer/1"), ("docks", "Docks/FeatureServer/0")]:
    st, _, b = get(f"{S7}/{path}?f=json")
    L = json.loads(b) if st == 200 else {}
    lays[key] = {"status": st, "url": f"{S7}/{path}", "copyrightText": L.get("copyrightText"), "description": text(L.get("description") or "")[:330], "data_last_edit": iso((L.get("editingInfo") or {}).get("dataLastEditDate")), "fields": [f["name"] for f in L.get("fields", [])]}
_, pp = arcgis_all(f"{S7}/Principal_Ports/FeatureServer/0", "OBJECTID,RANK,PORT,TYPE,PORTNAME,TOTAL", 2000)
_, pa = arcgis_all(f"{S7}/Port_Statistical_Area/FeatureServer/0", "OBJECTID,FEATURENAME,PORTIDPK,DATA_YEAR", 2000)
_, psa = arcgis_all(f"{S7}/Port_Statistical_Area/FeatureServer/1", "OBJECTID,FEATURENAME,PORTIDPK,DATA_YEAR", 2000)
_, docks = arcgis_all(f"{S7}/Docks/FeatureServer/0", "OBJECTID,LATITUDE,LONGITUDE,NAV_UNIT_ID,UNLOCODE,FAC_TYPE,STATE,PORT,PORT_NAME,PSA,PURPOSE,REMARKS,DEPTH_MIN,DEPTH_MAX,BERTHING_LARGEST,SERVICE_INITIATION_DATE", 2000)
lays["principal_ports"]["rows"] = len(pp)
lays["ports"]["rows"] = len(pa)
lays["port_statistical_areas"]["rows"] = len(psa)
lays["docks"]["rows"] = len(docks)
ua["layers"] = lays
ua["principal_ports_types"] = dict(collections.Counter(r.get("TYPE") for r in pp))
ua["principal_ports_top5"] = [{"rank": r["RANK"], "port_code": r["PORT"], "port": r["PORTNAME"], "total_tons": r["TOTAL"]} for r in sorted(pp, key=lambda r: r.get("RANK") or 999)[:5]]
pa_codes = {str(r.get("PORTIDPK")).strip() for r in pa if r.get("PORTIDPK")} | {str(r.get("PORTIDPK")).strip() for r in psa if r.get("PORTIDPK")}
ua["port_code_within_publisher"] = {"principal_ports_with_code": sum(1 for r in pp if r.get("PORT")), "principal_port_codes_found_in_port_polygons": sum(1 for r in pp if str(r.get("PORT")).strip() in pa_codes), "port_polygon_codes": len(pa_codes), "port_polygon_data_years": dict(collections.Counter(str(r.get("DATA_YEAR")) for r in pa)), "docks_with_port_code": sum(1 for r in docks if (str(r.get("PORT") or "")).strip()), "dock_port_codes_distinct": len({str(r.get("PORT")).strip() for r in docks if (str(r.get("PORT") or "")).strip()}), "dock_port_codes_found_in_port_polygons": len({str(r.get("PORT")).strip() for r in docks if (str(r.get("PORT") or "")).strip()} & pa_codes)}
ua["docks"] = {"fac_types": collections.Counter(r.get("FAC_TYPE") or "" for r in docks).most_common(12), "with_depth_max": sum(1 for r in docks if r.get("DEPTH_MAX") not in (None, "")), "with_berthing_largest": sum(1 for r in docks if r.get("BERTHING_LARGEST") not in (None, "")), "with_purpose_text": sum(1 for r in docks if (r.get("PURPOSE") or "").strip()), "with_remarks_text": sum(1 for r in docks if (r.get("REMARKS") or "").strip()), "purpose_chars_total": sum(len(r.get("PURPOSE") or "") for r in docks), "remarks_chars_total": sum(len(r.get("REMARKS") or "") for r in docks), "states": len({r.get("STATE") for r in docks if r.get("STATE")})}
# declared join 2: USACE dock UNLOCODE (3-character location code) + country -> UNECE list, and -> WPI rows
TERR = {"PR": "PR", "VI": "VI", "GU": "GU", "AS": "AS", "MP": "MP"}
wpi_by_code = collections.defaultdict(list)
for r in wpi:
    for c in wpi_codes[r["World_Port_Index_Number"]]:
        wpi_by_code[c].append(r)
dj = {"docks": len(docks), "docks_with_code": 0, "resolved_in_unece": 0, "resolved_only_with_territory_country_code": 0, "resolved_to_a_wpi_row": 0, "unresolved_code_samples": [], "distance_km": []}
dcodes, dcodes_res, dcodes_wpi = set(), set(), set()
port2wpi = collections.defaultdict(collections.Counter)
for r in docks:
    c3 = (r.get("UNLOCODE") or "").strip().upper()
    if not re.fullmatch(r"[A-Z2-9]{3}", c3):
        continue
    dj["docks_with_code"] += 1
    stt = (r.get("STATE") or "").strip().upper()
    opts = ["US" + c3] + ([TERR[stt] + c3] if stt in TERR else [])
    dcodes.add(opts[0])
    hit = [c for c in opts if c in unloc]
    if hit:
        dj["resolved_in_unece"] += 1
        dcodes_res.add(hit[0])
        if hit[0][:2] != "US":
            dj["resolved_only_with_territory_country_code"] += 1
        xy = uncoord(unloc[hit[0]]["coord"])
        if xy and r.get("LATITUDE"):
            dj["distance_km"].append(km(xy, (r["LATITUDE"], r["LONGITUDE"])))
    elif len(dj["unresolved_code_samples"]) < 10 and opts[0] not in [x["code"] for x in dj["unresolved_code_samples"]]:
        dj["unresolved_code_samples"].append({"code": opts[0], "state": stt})
    w = [c for c in opts if c in wpi_by_code]
    if w:
        dj["resolved_to_a_wpi_row"] += 1
        dcodes_wpi.add(w[0])
        pc_ = str(r.get("PORT") or "").strip()
        if pc_:
            port2wpi[pc_][wpi_by_code[w[0]][0]["World_Port_Index_Number"]] += 1
d = dj.pop("distance_km")
dj["distinct_codes"] = len(dcodes)
dj["distinct_codes_resolved_in_unece"] = len(dcodes_res)
dj["distinct_codes_with_a_wpi_row"] = len(dcodes_wpi)
dj["coordinate_agreement"] = {"pairs_with_both_coordinates": len(d), "median_km": round(statistics.median(d), 1) if d else None, "within_25_km": sum(1 for x in d if x <= 25), "over_100_km": sum(1 for x in d if x > 100)}
ppcodes = {str(r["PORT"]).strip(): r["PORTNAME"] for r in pp if r.get("PORT")}
wname = {r["World_Port_Index_Number"]: r["Main_Port_Name"] for r in wpi}
dj["usace_port_codes_reaching_a_wpi_row_through_dock_codes"] = len(port2wpi)
dj["principal_ports_reaching_a_wpi_row_through_dock_codes"] = sum(1 for c in ppcodes if c in port2wpi)
dj["principal_port_examples"] = [{"usace_port_code": c, "usace_port": ppcodes[c], "wpi_number": port2wpi[c].most_common(1)[0][0], "wpi_port": wname[port2wpi[c].most_common(1)[0][0]], "docks": port2wpi[c].most_common(1)[0][1]} for c in sorted(ppcodes, key=lambda c: -sum(port2wpi[c].values()) if c in port2wpi else 0)[:8] if c in port2wpi]
ua["join_dock_unlocode"] = dj
out["usace"] = ua

# ------------------------------------------------------------------ other candidate members probed
other = {}
for u in ["https://ec.europa.eu/eurostat/web/gisco/geodata/transport-networks", "https://www.marineregions.org/"]:
    st, ct, b = get(u, tries=1)
    other[u] = {"status": st, "content_type": ct, "bytes": len(b)}
out["other_probes_not_measured"] = other
out["http_requests"] = NREQ[0]
with open("port_measure.json", "w", encoding="utf8") as f:
    json.dump(out, f, indent=1, ensure_ascii=False, sort_keys=False)
print(json.dumps({"requests": NREQ[0], "wpi_rows": nga["rows"], "unlocode_codes": un["distinct_codes"], "join_wpi_unlocode": [j["resolved"], j["wpi_rows_with_code"]], "join_wpi_cp": [cj["matched"], cj["wpi_us_ports"]], "join_dock_unlocode": [dj["resolved_in_unece"], dj["docks_with_code"]]}))
