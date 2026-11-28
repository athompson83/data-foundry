#!/usr/bin/env python3
"""Screening 2026-11-16: nuclear-power-reactors. Fetches every source live (stdlib only).
Run from this directory with: python3 -I nuc_measure.py   -> writes nuc_measure.json and nuc_pairs.json
Output holds reactor identifiers (NRC docket numbers, licence numbers, EIA plant codes, PRIS ids), unit and
organisation names, dates and counts only. Event narratives are counted, never copied; the names of NRC officers
and notifying individuals in the event blocks are never parsed or written.

Members:
  NRC List of Power Reactor Units (HTML table: unit, docket, licence, type, location, operator, region)
  NRC reactors-operating.xlsx dataset (docket, licence dates, licence expiry, MWt, MWe, capacity factors)
  NRC facility-finder unit pages (current licence expiry, MWt), sampled
  NRC Power Reactor Status Report, last 365 days (daily percent power per unit, pipe-delimited text)
  NRC Event Notification Reports (one HTML page per day, free-text event narratives)
  IAEA PRIS (pris-stats.iaea.org JSON behind the public PRIS Analytics app: every reactor worldwide)
  EIA Form EIA-860 2025 (generator sheet, nuclear generators with EIA plant code and generator ID)
Joins:
  NRC status unit name  -> NRC unit list name (exact; same publisher)
  NRC event facility+unit+state -> NRC unit list (same publisher)
  NRC xlsx "Plant Name, Unit Number" -> PRIS alternateName (US reactors), candidate; thermal power compared
  NRC unit (name, state, unit number) -> EIA-860 nuclear generator (plant name, state, generator ID), candidate
"""
import json, re, time, io, zipfile, html as H, urllib.request, urllib.error
import xml.etree.ElementTree as ET
from collections import Counter

UA = "data-foundry-scout/1.0 (data@mail.proviciency.com)"
out = {"run_date": time.strftime("%Y-%m-%d")}
NREQ = [0]


def get(u, tries=3, timeout=300):
    for i in range(tries):
        NREQ[0] += 1
        try:
            r = urllib.request.Request(u, headers={"User-Agent": UA, "Accept-Encoding": "identity"})
            with urllib.request.urlopen(r, timeout=timeout) as f:
                b = f.read()
                time.sleep(1)
                return f.status, f.geturl(), f.headers.get("Content-Type", ""), b
        except urllib.error.HTTPError as e:
            if e.code >= 500 and i < tries - 1:
                time.sleep(10)
                continue
            return e.code, u, e.headers.get("Content-Type", ""), e.read()
        except Exception as e:
            if i == tries - 1:
                return 0, u, "", str(e).encode()
            time.sleep(5)


def text(b):
    t = b.decode("utf8", "replace")
    t = re.sub(r"<(script|style).*?</\1>", "", t, flags=re.S)
    t = re.sub(r"<[^>]+>", " ", t)
    return re.sub(r"\s+", " ", H.unescape(t)).strip()


NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}


def xlsx_rows(data):
    z = zipfile.ZipFile(io.BytesIO(data))
    ss = []
    if "xl/sharedStrings.xml" in z.namelist():
        for si in ET.fromstring(z.read("xl/sharedStrings.xml")).findall("m:si", NS):
            ss.append("".join(t.text or "" for t in si.iter("{%s}t" % NS["m"])))
    root = ET.fromstring(z.read("xl/worksheets/sheet1.xml"))
    rows = []
    for r in root.iter("{%s}row" % NS["m"]):
        row = {}
        for c in r.findall("m:c", NS):
            col = re.match(r"[A-Z]+", c.get("r")).group()
            v = c.find("m:v", NS)
            t = c.get("t")
            if t == "s" and v is not None:
                val = ss[int(v.text)]
            elif t == "inlineStr":
                val = "".join(x.text or "" for x in c.iter("{%s}t" % NS["m"]))
            else:
                val = v.text if v is not None else None
            row[col] = val
        rows.append(row)
    return rows


def as_dicts(rows, header_index):
    h = rows[header_index]
    return [{h[k]: v for k, v in r.items() if k in h} for r in rows[header_index + 1:]]


def excel_date(v):
    try:
        n = int(float(v))
        return time.strftime("%Y-%m-%d", time.gmtime((n - 25569) * 86400))
    except (TypeError, ValueError):
        m = re.fullmatch(r"(\d{2})/(\d{2})/(\d{4})", (v or "").strip())
        return f"{m.group(3)}-{m.group(1)}-{m.group(2)}" if m else None


def norm(s):
    s = (s or "").lower().replace("&", " and ")
    s = re.sub(r"\bsaint\b", "st", s)
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


NUM = {"one": "1", "two": "2", "three": "3", "four": "4", "i": "1", "ii": "2", "iii": "3"}


# ---------------------------------------------------------------- 1. NRC unit list (HTML)
NRC = "https://www.nrc.gov"
s, u, ct, b = get(NRC + "/reactors/operating/list-power-reactor-units.html")
out["nrc_list"] = {"status": s, "final_url": u, "bytes": len(b)}
units = []
for m in re.finditer(r'<tr><td scope="row"><p><a href="(/facilities-safety/facility-finder/reactors/[^"]+)">(.*?)</a><br>\s*(\d{8})</p></td>(.*?)</tr>', b.decode("utf8", "replace"), re.S):
    cells = [text(c.encode()) for c in re.findall(r"<td>(.*?)</td>", m.group(4), re.S)]
    loc = cells[2] if len(cells) > 2 else ""
    st = re.search(r"\b([A-Z]{2})$", loc)
    units.append({"page": m.group(1), "unit": text(m.group(2).encode()), "docket": m.group(3), "licence": cells[0] if cells else None,
                  "type": cells[1] if len(cells) > 1 else None, "state": st.group(1) if st else None,
                  "operator": cells[3] if len(cells) > 3 else None, "region": cells[4] if len(cells) > 4 else None})
out["nrc_list"].update({"units": len(units), "by_type": dict(Counter(x["type"] for x in units)),
                        "distinct_dockets": len({x["docket"] for x in units}), "distinct_operators": len({x["operator"] for x in units}),
                        "with_state": sum(1 for x in units if x["state"]), "sample": units[:3]})

# ---------------------------------------------------------------- 2. NRC reactors-operating.xlsx
XLSX = NRC + "/sites/default/files/doc_library/cdn/legacy/reading-rm/doc-collections/datasets/reactors-operating.xlsx"
s, u, ct, b = get(XLSX)
nx = [r for r in as_dicts(xlsx_rows(b), 0) if r.get("Docket Number")] if s == 200 else []
out["nrc_xlsx"] = {"status": s, "bytes": len(b), "rows": len(nx), "fields": sorted(nx[0].keys()) if nx else [],
                   "year_of_update": dict(Counter(r.get("Year of Update") for r in nx)),
                   "with_licence_expiry": sum(1 for r in nx if r.get("Operating License Expires")),
                   "dockets_in_html_list": sum(1 for r in nx if r["Docket Number"] in {x["docket"] for x in units})}
xl_by_docket = {r["Docket Number"]: r for r in nx}

# ---------------------------------------------------------------- 3. facility-finder pages (sample of 20)
fpages = []
for x in units[:: max(1, len(units) // 20)][:20]:
    s, u, ct, b = get(NRC + x["page"])
    t = text(b)
    exp = re.search(r"License Expires:\s*(\d{2}/\d{2}/\d{4})", t)
    dk = re.search(r"Docket Number:\s*(\d{8})", t)
    mwt = re.search(r"Licensed MWt:\s*([\d,]+)", t)
    xl = xl_by_docket.get(x["docket"], {})
    fpages.append({"docket": x["docket"], "status": s, "page_docket": dk.group(1) if dk else None,
                   "licence_expires": excel_date(exp.group(1)) if exp else None,
                   "xlsx_licence_expires": excel_date(xl.get("Operating License Expires")),
                   "licensed_mwt": mwt.group(1).replace(",", "") if mwt else None, "xlsx_mwt": xl.get("Licensed MWt")})
out["nrc_facility_pages"] = {"fetched": len(fpages), "ok": sum(1 for p in fpages if p["status"] == 200),
                             "docket_agrees": sum(1 for p in fpages if p["page_docket"] == p["docket"]),
                             "with_expiry": sum(1 for p in fpages if p["licence_expires"]),
                             "expiry_differs_from_xlsx": sum(1 for p in fpages if p["licence_expires"] and p["licence_expires"] != p["xlsx_licence_expires"]),
                             "mwt_differs_from_xlsx": sum(1 for p in fpages if p["licensed_mwt"] and p["licensed_mwt"] != p["xlsx_mwt"]),
                             "pages": fpages}

# ---------------------------------------------------------------- 4. NRC power reactor status, 365 days
s, u, ct, b = get(NRC + "/reading-rm/doc-collections/event-status/reactor-status/powerreactorstatusforlast365days.txt")
lines = [l.split("|") for l in b.decode("utf8", "replace").splitlines()[1:] if l.count("|") == 2]
dates = sorted({time.strftime("%Y-%m-%d", time.strptime(l[0].split()[0], "%m/%d/%Y")) for l in lines})
st_units = sorted({l[1].strip() for l in lines})
newest = dates[-1] if dates else None
latest = {l[1].strip(): int(l[2]) for l in lines if time.strftime("%Y-%m-%d", time.strptime(l[0].split()[0], "%m/%d/%Y")) == newest}
out["nrc_status"] = {"status": s, "final_url": u, "bytes": len(b), "rows": len(lines), "days": len(dates), "oldest": dates[0] if dates else None,
                     "newest": newest, "units": len(st_units), "units_on_newest_day": len(latest),
                     "newest_day_at_100": sum(1 for v in latest.values() if v == 100), "newest_day_at_0": sum(1 for v in latest.values() if v == 0)}
list_names = {x["unit"]: x for x in units}
st_match = [n for n in st_units if n in list_names]
out["join_status_to_list"] = {"matched": len(st_match), "total": len(st_units), "unmatched": [n for n in st_units if n not in list_names]}

# ---------------------------------------------------------------- 5. NRC event notification reports
s, u, ct, b = get(NRC + "/reading-rm/doc-collections/event-status/event/2026/")
days = sorted(set(re.findall(r'href="([^"]*event-notification-reports/2026/(\d{8})en)"', b.decode("utf8", "replace"))), key=lambda x: x[1])
out["nrc_events_index"] = {"status": s, "final_url": u, "daily_pages_2026": len(days), "first": days[0][1] if days else None, "last": days[-1][1] if days else None}
sample = days[:: max(1, len(days) // 30)]
events, pr = [], []
for href, d in sample:
    s, u, ct, b = get(NRC + href if href.startswith("/") else href)
    t = text(b)
    blocks = re.split(r"(?=Event Number: \d+)", t)[1:]
    for blk in blocks:
        en = re.match(r"Event Number: (\d+)", blk).group(1)
        is_pr = "Power Reactor Unit Info" in blk or re.search(r"\bFacility: ", blk[:200]) is not None
        txt = blk.split("Event Text", 1)[1] if "Event Text" in blk else ""
        events.append({"day": d, "event": en, "power_reactor": is_pr, "narrative_chars": len(txt), "has_docket_field": bool(re.search(r"Docket: \d", blk))})
        if is_pr:
            fac = re.search(r"Facility: (.*?) Region:", blk)
            stt = re.search(r"State: ([A-Z]{2})", blk)
            us = re.search(r"Unit: ((?:\[\d*\]\s*)+)", blk)
            cfr = re.search(r"10 CFR Section: (.*?) Person \(Organization\)", blk)
            scram = re.search(r"Current RX Mode (\d) (\S+)", blk)
            pr.append({"day": d, "event": en, "facility": fac.group(1).strip() if fac else None, "state": stt.group(1) if stt else None,
                       "units": re.findall(r"\[(\d+)\]", us.group(1)) if us else [], "cfr": cfr.group(1).strip()[:120] if cfr else None,
                       "scram_code": scram.group(2) if scram else None})
out["nrc_events_sample"] = {"days_fetched": len(sample), "events": len(events), "power_reactor_events": len(pr),
                            "distinct_facilities": len({p["facility"] for p in pr}),
                            "power_reactor_with_docket_field": sum(1 for e in events if e["power_reactor"] and e["has_docket_field"]),
                            "median_narrative_chars": sorted(e["narrative_chars"] for e in events)[len(events) // 2] if events else 0,
                            "cfr_sections": dict(Counter((p["cfr"] or "").split(" - ")[0] for p in pr).most_common(12)),
                            "scram_codes": dict(Counter(p["scram_code"] for p in pr))}


GENERIC = {"nuclear", "power", "plant", "station", "generating", "generation", "steam", "electric", "unit", "units", "no", "the", "pseg",
           "talenenergy", "energy", "center", "clean", "atomic", "project", "nc", "and", "of",
           # shared geographic words that alone would pair Hope Creek with Wolf Creek or Nine Mile Point with Point Beach
           "point", "creek", "valley", "river", "island", "bay", "canyon", "mile", "cliffs", "peak", "bend", "county"}


def site_key(name):
    w = norm(name).split()
    while w and (w[-1].isdigit() or w[-1] in NUM or w[-1] == "unit"):
        w.pop()
    return " ".join(w)


def unit_number(name):
    m = re.search(r"(?:-|\s)(\d+)\s*$", (name or "").strip())
    return m.group(1) if m else None


def same_site(a, b):
    """Distinctive-token overlap between two site names, or one squashed name inside the other (La Salle / LaSalle)."""
    ta = {t for t in site_key(a).split() if len(t) >= 3 and t not in GENERIC}
    tb = {t for t in site_key(b).split() if len(t) >= 3 and t not in GENERIC}
    sa, sb = "".join(sorted(ta)), "".join(site_key(b).split())
    return bool(ta & tb) or (len(sa) >= 5 and sa in sb) or (len("".join(site_key(a).split())) >= 5 and "".join(site_key(a).split()) in sb)


# the HTML list's location is distance from a reference city, which can be in a neighbouring state (Catawba: Charlotte, NC);
# the xlsx Location starts with the plant's own town and state, so prefer it.
for x in units:
    loc = (xl_by_docket.get(x["docket"]) or {}).get("Location") or ""
    m = re.match(r"[^(]*?,\s*([A-Z]{2})\b", loc)
    x["plant_state"] = m.group(1) if m else x["state"]
out["nrc_list"]["plant_state_differs_from_reference_city_state"] = sum(1 for x in units if x["plant_state"] != x["state"])


def nrc_units_for(facility, state, un):
    c = [x for x in units if x["plant_state"] == state and same_site(x["unit"], facility)]
    if un:
        c = [x for x in c if unit_number(x["unit"]) == un] or ([] if len(c) != 1 else c)
    return c


ev_hits, ev_total = 0, 0
for p in pr:
    p["dockets"] = []
    for un in p["units"]:
        ev_total += 1
        c = nrc_units_for(p["facility"], p["state"], un)
        p["dockets"].append(c[0]["docket"] if len(c) == 1 else None)
        ev_hits += len(c) == 1
out["join_events_to_list"] = {"matched": ev_hits, "total": ev_total,
                              "unmatched": sorted({(p["facility"], p["state"]) for p in pr if None in p["dockets"]})}

# status unit names that are not spelled as on the list (Harris 1 / Shearon Harris 1): site token plus unit number, no state in the file
st2 = {}
for n in st_units:
    if n in list_names:
        st2[n] = list_names[n]["docket"]
        continue
    c = [x for x in units if same_site(x["unit"], n) and unit_number(x["unit"]) == unit_number(n)]
    st2[n] = c[0]["docket"] if len(c) == 1 else None
out["join_status_to_list"]["with_site_token_and_unit_number"] = {"matched": sum(1 for v in st2.values() if v), "total": len(st_units),
                                                                 "unmatched": [n for n, v in st2.items() if not v]}

# ---------------------------------------------------------------- 6. IAEA PRIS
PRIS = "https://pris-stats.iaea.org"
s, u, ct, b = get(PRIS + "/country/countries/")
countries = json.loads(b)["items"] if s == 200 else []
pris = []
for c in countries:
    s, u, ct, b = get(f"{PRIS}/reactor/reactors-by-code/{c['countryCode']}")
    if s == 200:
        pris += json.loads(b).get("items") or []
out["pris"] = {"countries": len(countries), "reactors": len(pris), "by_status": dict(Counter(r.get("statusName") for r in pris)),
               "countries_with_reactors": len({r["countryCode"] for r in pris}),
               "operational_by_country_top": dict(Counter(r["countryCode"] for r in pris if r.get("statusName") == "Operational").most_common(10)),
               "fields": sorted(pris[0].keys()) if pris else [],
               "us_reactors": sum(1 for r in pris if r["countryCode"] == "US"),
               "us_operational": sum(1 for r in pris if r["countryCode"] == "US" and r.get("statusName") == "Operational"),
               "with_alternate_name": sum(1 for r in pris if r.get("alternateName"))}

if pris:
    s, u, ct, b = get(f"{PRIS}/reactor/reactor-by-id/{pris[0]['id']}")
    out["pris"]["detail_sample"] = {"id": pris[0]["id"], "status": s, "lifetime_factor_report_year": ((json.loads(b) if s == 200 else {}).get("lifetimeFactor") or {}).get("reportYear")}

# join: NRC unit -> PRIS US reactor that is operational or suspended, by distinctive site token plus unit number
pus = [r for r in pris if r["countryCode"] == "US" and r.get("statusName") in ("Operational", "Suspended Operation")]
pairs_pris = []
for x in units:
    un = unit_number(x["unit"])
    c = [r for r in pus if any(same_site(x["unit"], n) for n in (r.get("unitName"), r.get("alternateName"), r.get("siteName")) if n)]
    if un:
        c = [r for r in c if unit_number(r["unitName"]) == un] or ([] if len(c) != 1 else c)
    xl = xl_by_docket.get(x["docket"], {})
    one = c[0] if len(c) == 1 else None
    pairs_pris.append({"docket": x["docket"], "nrc_unit": x["unit"], "nrc_mwt": xl.get("Licensed MWt"),
                       "nrc_commercial_operation": excel_date(xl.get("Commercial Operation")),
                       "pris_id": one["id"] if one else None, "pris_unit": one["unitName"] if one else None,
                       "pris_site": one["siteName"] if one else None, "pris_mwt": one.get("thermalPower") if one else None,
                       "pris_commercial": (one.get("commercialDate") or "")[:10] if one else None, "candidates": len(c)})
m = [p for p in pairs_pris if p["pris_id"]]
out["join_nrc_to_pris"] = {"matched": len(m), "total": len(pairs_pris), "distinct_pris_ids": len({p["pris_id"] for p in m}),
                           "with_nrc_xlsx_row": sum(1 for p in m if p["nrc_mwt"]),
                           "mwt_equal": sum(1 for p in m if p["nrc_mwt"] and str(p["pris_mwt"]) == str(p["nrc_mwt"])),
                           "commercial_date_equal": sum(1 for p in m if p["nrc_commercial_operation"] and p["pris_commercial"] == p["nrc_commercial_operation"]),
                           "unmatched": [p["nrc_unit"] for p in pairs_pris if not p["pris_id"]],
                           "pris_us_operational_not_in_nrc_list": sorted({r["unitName"] for r in pus} - {p["pris_unit"] for p in m})}

# ---------------------------------------------------------------- 7. EIA-860 2025 nuclear generators
s, u, ct, b = get("https://www.eia.gov/electricity/data/eia860/xls/eia8602025.zip")
out["eia860"] = {"status": s, "content_type": ct, "bytes": len(b)}
eia = []
if s == 200 and b[:2] == b"PK":
    z = zipfile.ZipFile(io.BytesIO(b))
    gens = as_dicts(xlsx_rows(z.read("3_1_Generator_Y2025.xlsx")), 1)
    eia = [g for g in gens if g.get("Energy Source 1") == "NUC"]
    out["eia860"].update({"generators": len(gens), "nuclear_generators": len(eia), "nuclear_plants": len({g["Plant Code"] for g in eia}),
                          "nuclear_status": dict(Counter(g.get("Status") for g in eia))})


def eia_match(x):
    un = unit_number(x["unit"])
    plants = {}
    for g in eia:
        if g["State"] == x["plant_state"] and same_site(x["unit"], g["Plant Name"]):
            plants.setdefault(g["Plant Code"], []).append(g)
    if len(plants) != 1:
        return None, len(plants)
    gl = list(plants.values())[0]
    if un:
        hit = [g for g in gl if g["Generator ID"].lstrip("0") == un]
        if len(hit) == 1:
            return hit[0], 1
    site_units = [y for y in units if y["plant_state"] == x["plant_state"] and same_site(y["unit"], x["unit"])]
    if len(gl) == 1 and len(site_units) == 1:
        return gl[0], 1
    return None, len(gl)


pairs_eia = []
for x in units:
    g, n = eia_match(x)
    xl = xl_by_docket.get(x["docket"], {})
    pairs_eia.append({"docket": x["docket"], "nrc_unit": x["unit"], "state": x["plant_state"], "nrc_mwe": xl.get("Capacity MWe"),
                      "nrc_commercial_year": (excel_date(xl.get("Commercial Operation")) or "")[:4] or None,
                      "eia_plant_code": g["Plant Code"] if g else None, "eia_plant": g["Plant Name"] if g else None,
                      "eia_generator": g["Generator ID"] if g else None, "eia_nameplate_mw": g["Nameplate Capacity (MW)"] if g else None,
                      "eia_operating_year": g["Operating Year"] if g else None})
me = [p for p in pairs_eia if p["eia_plant_code"]]
out["join_nrc_to_eia"] = {"matched": len(me), "total": len(pairs_eia), "distinct_eia_generators": len({(p["eia_plant_code"], p["eia_generator"]) for p in me}),
                          "eia_nuclear_generators_unmatched": len(eia) - len({(p["eia_plant_code"], p["eia_generator"]) for p in me}),
                          "operating_year_equals_commercial_year": sum(1 for p in me if p["eia_operating_year"] == p["nrc_commercial_year"]),
                          "unmatched": [p["nrc_unit"] for p in pairs_eia if not p["eia_plant_code"]],
                          "eia_nuclear_generators_not_in_nrc_list": sorted({(g["Plant Name"], g["Generator ID"]) for g in eia} - {(p["eia_plant"], p["eia_generator"]) for p in me})}

# ---------------------------------------------------------------- 8. terms pages
for k, url, needle in [("nrc_terms", NRC + "/about-nrc/site-disclaimer", "U.S. Government Work"),
                       ("eia_terms", "https://www.eia.gov/about/copyrights_reuse.php", "public domain"),
                       ("iaea_terms", "https://nucleus.iaea.org/Pages/Others/Disclaimer.aspx", "commercial and non-commercial")]:
    s, u, ct, b = get(url)
    t = text(b)
    i = t.find(needle)
    out[k] = {"url": url, "status": s, "found": i >= 0, "context": t[max(0, i - 250): i + 350] if i >= 0 else None}

out["requests"] = NREQ[0]
json.dump(out, open("nuc_measure.json", "w"), indent=1, ensure_ascii=False)
json.dump({"nrc_to_pris": pairs_pris, "nrc_to_eia": pairs_eia, "events_power_reactor": pr}, open("nuc_pairs.json", "w"), indent=1, ensure_ascii=False)
print(json.dumps({k: v for k, v in out.items() if k.startswith("join") or k in ("requests",)}, indent=1))
