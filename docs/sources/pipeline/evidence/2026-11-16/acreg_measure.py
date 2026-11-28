#!/usr/bin/env python3
"""Screening 2026-11-16: aircraft-registrations. Fetches every source live (stdlib only).
Run from this directory with: python3 -I acreg_measure.py   -> writes acreg_measure.json (+ acreg_pairs.json for hand-checking)
Output holds registration marks, ICAO 24-bit addresses, manufacturer/model/serial, dates, organisation-level counts only.
Registrant / owner / operator names and addresses are personal data for individuals: they are COUNTED, never written.
Register "make" is not written into acreg_pairs.json either: for amateur-built aircraft it can be the builder's own name.

Members:
  Transport Canada CCAR (Canadian Civil Aircraft Register) zip: structured register with Mode S binary address.
  CASA (Australia) aircraft register CSV (services.casa.gov.au): structured register, no Mode S field.
  IAA (Ireland) monthly register xlsx: structured register, no Mode S field.
  UK AAIB reports (GOV.UK search API): free-text investigation reports whose registration facet names the aircraft.
  Transport Canada CADORS aircraft table: occurrence reports (narratives in a sibling CSV) citing Canadian and foreign marks.
  FAA SDRS (sdrs.faa.gov query form): service difficulty reports, free-text problem description, N-number + aircraft serial.
  FAA Releasable Aircraft Database (registry.faa.gov): probed only (Akamai 403 from this egress since 2026-10-01).
Joins:
  AAIB registration (EI-/C-/VH-) -> IAA / CCAR / CASA register mark (declared, at the mark level; time-qualified).
  CADORS aircraftregistration -> CCAR mark (same publisher); CADORS foreignaircraftregistration VH-/EI- -> CASA / IAA.
  CCAR Mode S binary -> ICAO 24-bit hex: block and uniqueness checks.
"""
import csv, io, json, re, time, zipfile, urllib.request, urllib.parse, http.cookiejar, html as H
from collections import Counter

UA = "data-foundry-scout/1.0 (data@mail.proviciency.com)"
out = {"run_date": time.strftime("%Y-%m-%d"), "requests": 0}
jar = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))


def get(u, data=None, timeout=300, stream=False, tries=2):
    for i in range(tries):
        out["requests"] += 1
        try:
            r = urllib.request.Request(u, data=data, headers={"User-Agent": UA, "Accept-Encoding": "identity"})
            f = opener.open(r, timeout=timeout)
            if stream:
                return f.status, f.headers, f
            with f:
                return f.status, f.headers, f.read()
        except urllib.error.HTTPError as e:
            if e.code >= 500 and i < tries - 1:
                time.sleep(10)
                continue
            return e.code, e.headers, e.read()
        except Exception as e:
            if i == tries - 1:
                return 0, {}, str(e).encode()
            time.sleep(5)


def text(b):
    t = b.decode("utf-8", "replace") if isinstance(b, bytes) else b
    t = re.sub(r"<script.*?</script>|<style.*?</style>", " ", t, flags=re.S)
    return re.sub(r"\s+", " ", H.unescape(re.sub(r"<[^>]+>", " ", t))).strip()


MODES_COL = re.compile(r"mode.?s|transponder|icao.?(hex|address)|24.?bit", re.I)


def akey(s):
    return re.sub(r"[^A-Z0-9]", "", (s or "").upper())


def type_agrees(aaib_type, make, model):
    """Loose consistency check (not a link rule): the register model's alphanumeric stem or the make's first word
    appears in the AAIB aircraft type text."""
    t = akey(aaib_type)
    stem = akey(model)[:4]
    mk = akey((make or "").split()[0] if make else "")[:5]
    return bool((len(stem) >= 3 and stem in t) or (len(mk) >= 4 and mk in t))


def key(mark):
    """Comparable form of a registration mark: upper case, no hyphen or space."""
    return re.sub(r"[^A-Z0-9]", "", (mark or "").upper())


def iso(d):
    """'2002/05/17' | '17/10/2019' | '2019-10-17' | '17/10/2019 00:00' -> '2019-10-17'."""
    d = (d or "").strip()
    m = re.match(r"(\d{4})[/-](\d{2})[/-](\d{2})", d)
    if m:
        return "-".join(m.groups())
    m = re.match(r"(\d{1,2})/(\d{1,2})/(\d{4})", d)
    return f"{m.group(3)}-{int(m.group(2)):02d}-{int(m.group(1)):02d}" if m else None


# ---------------------------------------------------------------- 0. FAA Releasable Aircraft Database (probe)
faa = {}
for u in ["https://registry.faa.gov/database/ReleasableAircraft.zip",
          "https://www.faa.gov/licenses_certificates/aircraft_certification/aircraft_registry/releasable_aircraft_download",
          "https://www.faa.gov/av-info/download_SDR"]:
    s, h, b = get(u, timeout=60, tries=1)
    faa[u] = {"status": s, "server": (h.get("Server") if h else None), "akamai_access_denied": b"Access Denied" in b[:2000]}
out["faa_probe"] = faa

# ---------------------------------------------------------------- 1. Transport Canada CCAR
CCAR_URL = "https://wwwapps.tc.gc.ca/Saf-Sec-Sur/2/CCARCS-RIACC/download/ccarcsdb.zip"
s, h, b = get(CCAR_URL)
ccar = {}
o = {"status": s, "bytes": len(b), "last_modified": h.get("Last-Modified") if h else None}
if s == 200:
    z = zipfile.ZipFile(io.BytesIO(b))
    o["files"] = {i.filename: i.file_size for i in z.infolist()}
    rows = [r for r in csv.reader(io.TextIOWrapper(z.open("carscurr.txt"), encoding="latin1")) if len(r) >= 47]
    for r in rows:
        m = r[0].strip()
        mark = ("C-" if len(m) == 4 else "CF-") + m
        ccar[key(mark)] = {"mark": mark, "make": r[3].strip(), "model": r[4].strip(), "serial": r[5].strip(),
                           "status": r[38].strip(), "effective": iso(r[22]), "issued": iso(r[21]),
                           "manufactured": iso(r[31]), "modes_bin": r[42].strip(), "category": r[10].strip()}
    o["records"] = len(rows)
    o["by_status"] = dict(Counter(r[38].strip() for r in rows))
    o["by_category"] = dict(Counter(r[10].strip() for r in rows).most_common(10))
    o["by_flight_authority"] = dict(Counter(r[26].strip() for r in rows).most_common(8))
    o["newest_modified_date"] = max(iso(r[41]) or "" for r in rows)
    o["with_serial"] = sum(1 for r in rows if r[5].strip())
    o["with_type_certificate"] = sum(1 for r in rows if r[37].strip())
    o["with_manufacture_date"] = sum(1 for r in rows if r[31].strip())
    # Mode S: 24-bit binary -> hex; Canada's ICAO block is C00000-C3FFFF
    hexes = []
    for v in ccar.values():
        bb = v["modes_bin"]
        if re.fullmatch(r"[01]{24}", bb) and bb != "0" * 24:
            v["icao24"] = f"{int(bb, 2):06X}"
            hexes.append((v["icao24"], v["status"]))
    o["mode_s_valid_24bit"] = len(hexes)
    o["mode_s_in_canada_block_C00000_C3FFFF"] = sum(1 for x, _ in hexes if 0xC00000 <= int(x, 16) <= 0xC3FFFF)
    reg = [x for x, st in hexes if st == "Registered"]
    o["mode_s_registered"] = len(reg)
    o["mode_s_registered_distinct"] = len(set(reg))
    o["mode_s_examples"] = [{"mark": v["mark"], "icao24": v.get("icao24"), "make": v["make"], "model": v["model"]}
                            for v in list(ccar.values())[:3]]
    own = [r for r in csv.reader(io.TextIOWrapper(z.open("carsownr.txt"), encoding="latin1")) if len(r) >= 19]
    o["owner_rows"] = len(own)
    o["owner_type_counts"] = dict(Counter(r[11].strip() for r in own))  # 1=Individual, 2=Company, M=Manufacturer (names never written)
out["ccar"] = o

# ---------------------------------------------------------------- 2. CASA (Australia)
CASA_URL = "https://services.casa.gov.au/CSV/acrftreg.csv"
s, h, b = get(CASA_URL)
casa = {}
o = {"status": s, "bytes": len(b), "last_modified": h.get("Last-Modified") if h else None}
if s == 200:
    rows = list(csv.DictReader(io.StringIO(b.decode("utf-8-sig", "replace"))))
    o["records"] = len(rows)
    o["fields"] = list(rows[0].keys())
    o["has_mode_s_field"] = any(MODES_COL.search(k) for k in rows[0].keys())
    for r in rows:
        mark = "VH-" + r["Mark"].strip()
        casa[key(mark)] = {"mark": mark, "make": r["Manu"].strip(), "model": r["Model"].strip(), "serial": r["Serial"].strip(),
                           "first_registered": iso(r["Datefirstreg"]), "holder_since": iso(r["regholdCommdate"]),
                           "year": r["Yearmanu"].strip(), "icao_type": r["ICAOtypedesig"].strip(), "reg_type": r["regType"].strip()}
    o["by_reg_type"] = dict(Counter(r["regType"].strip() for r in rows))
    o["suspended"] = dict(Counter(r["suspendstatus"].strip() for r in rows).most_common(5))
    o["with_icao_type_designator"] = sum(1 for r in rows if r["ICAOtypedesig"].strip())
    o["with_serial"] = sum(1 for r in rows if r["Serial"].strip())
    o["newest_holder_commencement"] = max(iso(r["regholdCommdate"]) or "" for r in rows)
    o["newest_first_registration"] = max(iso(r["Datefirstreg"]) or "" for r in rows)
    o["with_registration_holder"] = sum(1 for r in rows if r["regholdname"].strip())  # counted, never written
    o["with_IDERA_authorised_party"] = sum(1 for r in rows if r.get("IDERA_Authorised_Party", "").strip())
out["casa"] = o

# ---------------------------------------------------------------- 3. IAA (Ireland) newest monthly register
IAA_PAGE = "https://www.iaa.ie/general-aviation/aircraft-registration-leasing/current-aircraft-register-and-monthly-changes"
s, h, b = get(IAA_PAGE)
links = re.findall(r'href="(https://www\.iaa\.ie/docs/default-source/publications/aircraft-registration/[^"]+\.xlsx[^"]*)"', b.decode("utf8", "replace"))
iaa = {}
o = {"page_status": s, "xlsx_links_on_page": len(links), "newest_link": H.unescape(links[0]) if links else None}
if links:
    s, h, b = get(H.unescape(links[0]))
    o["status"], o["bytes"] = s, len(b)
    z = zipfile.ZipFile(io.BytesIO(b))
    ss = [H.unescape(re.sub(r"<[^>]+>", "", x)) for x in re.findall(r"<si>(.*?)</si>", z.read("xl/sharedStrings.xml").decode(), re.S)]
    sheet = z.read("xl/worksheets/sheet1.xml").decode()
    table = []
    for row in re.findall(r"<row[^>]*>(.*?)</row>", sheet, re.S):
        cells = {}
        for ref, attrs, val in re.findall(r'<c r="([A-Z]+)\d+"([^>]*?)(?:/>|>(?:<v>(.*?)</v>)?)', row):
            cells[ref] = ss[int(val)] if 't="s"' in attrs and val else val
        table.append(cells)
    hi = next(i for i, r in enumerate(table) if "Registration Mark" in r.values())
    o["sheet_title"] = " ".join(v for v in table[0].values() if v) if hi else None
    head, table = table[hi], table[hi:]
    cols = {v: k for k, v in head.items()}
    o["columns"] = list(head.values())

    def cell(r, name):
        return (r.get(cols.get(name, "?")) or "").strip()

    def xl_date(v):
        if re.fullmatch(r"\d+(\.\d+)?", v or ""):
            return time.strftime("%Y-%m-%d", time.gmtime((float(v) - 25569) * 86400))
        return iso(v)

    data = [r for r in table[1:] if cell(r, "Registration Mark")]
    for r in data:
        mark = cell(r, "Registration Mark")
        iaa[key(mark)] = {"mark": mark, "make": cell(r, "Aircraft producer"), "model": cell(r, "Aircraft Model"),
                          "serial": cell(r, "Aircraft Serial Number"), "registered": xl_date(cell(r, "Registration date")),
                          "year": cell(r, "Year of Manufacture"), "category": cell(r, "Category")}
    o["records"] = len(data)
    o["by_category"] = dict(Counter(v["category"] for v in iaa.values()).most_common(8))
    o["newest_registration_date"] = max(v["registered"] or "" for v in iaa.values())
    o["with_registered_owner"] = sum(1 for r in data if cell(r, "Registered Owner"))  # counted, never written
    o["with_charge_lodged"] = sum(1 for r in data if cell(r, "Aircraft Charge Lodged"))
    o["has_mode_s_field"] = any(MODES_COL.search(c or "") for c in head.values())
out["iaa"] = o

# ---------------------------------------------------------------- 4. UK AAIB reports (GOV.UK search API)
aaib = []
start, total = 0, 1
while start < total:
    q = urllib.parse.urlencode({"filter_format": "aaib_report", "count": 1000, "start": start, "order": "-public_timestamp",
                                "fields": "title,link,registration,aircraft_type,date_of_occurrence,aircraft_category,report_type,public_timestamp"})
    s, h, b = get("https://www.gov.uk/api/search.json?" + q)
    if s != 200:
        out.setdefault("aaib_errors", []).append({"start": start, "status": s})
        break
    d = json.loads(b)
    total = d["total"]
    aaib += d["results"]
    start += 1000
    time.sleep(1)
REG = re.compile(r"\b(G-[A-Z]{4}|EI-[A-Z]{3}|C-[FGI][A-Z]{3}|CF-[A-Z]{3}|VH-[A-Z]{3}|N[1-9][0-9]{0,4}[A-Z]{0,2}|[A-Z0-9]{1,2}-[A-Z0-9]{3,5})\b")
o = {"total": total, "fetched": len(aaib), "newest_published": max((r.get("public_timestamp") or "") for r in aaib) if aaib else None,
     "newest_occurrence": max((r.get("date_of_occurrence") or "") for r in aaib) if aaib else None}
o["by_report_type"] = dict(Counter(str(r.get("report_type")) for r in aaib).most_common(8))
marks = []
for r in aaib:
    regs = sorted(set(REG.findall((r.get("registration") or "").upper())))
    for m in regs:
        marks.append((m, r))
o["reports_with_registration_mark"] = len({r["link"] for _, r in marks})
o["marks_cited"] = len(marks)
pref = Counter(("N" if re.fullmatch(r"N\d.*", m) else m.split("-")[0] + "-") for m, _ in marks)
o["marks_by_prefix"] = dict(pref.most_common(25))
registers = {"EI-": ("iaa", iaa), "C-": ("ccar", ccar), "CF-": ("ccar", ccar), "VH-": ("casa", casa)}
join = {}
pairs = []
for m, r in marks:
    p = m.split("-")[0] + "-"
    if p not in registers:
        continue
    name, reg = registers[p]
    j = join.setdefault(name, {"cited": 0, "resolved": 0, "cited_occurrence_2015_on": 0, "resolved_occurrence_2015_on": 0,
                               "registered_on_or_before_occurrence": 0, "registered_after_occurrence": 0, "type_agrees": 0})
    j["cited"] += 1
    recent = (r.get("date_of_occurrence") or "") >= "2015"
    j["cited_occurrence_2015_on"] += recent
    v = reg.get(key(m))
    if not v:
        continue
    j["resolved"] += 1
    j["resolved_occurrence_2015_on"] += recent
    j["type_agrees"] += type_agrees(r.get("aircraft_type"), v["make"], v["model"])
    rd = v.get("first_registered") or v.get("effective") or v.get("registered")
    occ = (r.get("date_of_occurrence") or "")[:10]
    if rd and occ and rd <= occ:
        j["registered_on_or_before_occurrence"] += 1
    elif rd and occ:
        j["registered_after_occurrence"] += 1
    pairs.append({"register": name, "mark": m, "aaib_link": "https://www.gov.uk" + r["link"], "aaib_aircraft_type": r.get("aircraft_type"),
                  "occurrence": occ, "register_model": v["model"], "register_serial": v["serial"],
                  "register_date": rd, "register_status": v.get("status"),
                  "register_manufactured": v.get("manufactured") or v.get("year"), "type_agrees_auto": type_agrees(r.get("aircraft_type"), v["make"], v["model"])})
o["join_to_registers"] = join
out["aaib"] = o
json.dump(pairs, open("acreg_pairs.json", "w"), indent=1, ensure_ascii=False)

# ---------------------------------------------------------------- 5. Transport Canada CADORS aircraft table (streamed)
CAD = "https://opendatatc.tc.canada.ca/CADORS_Aircraft_Information.csv"
s, h, f = get(CAD, stream=True, timeout=600)
o = {"status": s}
if s == 200:
    o["last_modified"] = h.get("Last-Modified")
    rd = csv.DictReader(io.TextIOWrapper(f, encoding="utf-8-sig", errors="replace", newline=""))
    n = ca = ca_res = 0
    years = Counter()
    fpref = Counter()
    fj = {"casa": [0, 0], "iaa": [0, 0]}
    cad_marks = set()
    for r in rd:
        n += 1
        years[r["cadorsnumber"][:4]] += 1
        m = key(r.get("aircraftregistration"))
        if m and m not in ("NA", "UNKNOWN", "UNK"):
            ca += 1
            mk = ("C" + m) if len(m) == 4 else ("CF" + m) if len(m) == 3 else m
            if mk in ccar:
                ca_res += 1
                cad_marks.add(mk)
        fm = (r.get("foreignaircraftregistration") or "").strip().upper()
        if fm:
            fk = key(fm)
            p = "N" if re.fullmatch(r"N[1-9][0-9A-Z]{0,5}", fk) else (fm.split("-")[0] + "-" if "-" in fm else fk[:2] + "?")
            fpref[p] += 1
            if fk.startswith("VH") and len(fk) == 5:
                fj["casa"][1] += 1
                fj["casa"][0] += fk in casa
            if fk.startswith("EI") and len(fk) == 5:
                fj["iaa"][1] += 1
                fj["iaa"][0] += fk in iaa
    f.close()
    o.update({"aircraft_rows": n, "with_canadian_mark": ca, "canadian_mark_resolves_to_ccar": ca_res,
              "distinct_ccar_marks_cited": len(cad_marks), "rows_by_year_newest": sorted(years.items())[-5:],
              "foreign_registration_by_prefix": dict(fpref.most_common(15)),
              "foreign_vh_resolves_to_casa": f"{fj['casa'][0]}/{fj['casa'][1]}", "foreign_ei_resolves_to_iaa": f"{fj['iaa'][0]}/{fj['iaa'][1]}"})
out["cadors"] = o
out["mode_s_cross_country"] = {"registers_publishing_icao24": [n for n, d in (("ccar", out["ccar"]), ("casa", out["casa"]), ("iaa", out["iaa"])) if d.get("mode_s_valid_24bit") or d.get("has_mode_s_field")],
                               "note": "Only CCAR publishes the 24-bit address among the reachable registers; FAA MASTER (MODE S CODE HEX) is 403 from this egress, so no cross-country overlap is measurable."}

# ---------------------------------------------------------------- 6. FAA SDRS (ASP.NET query form, one 3-day window + 10 details)
sd = {}
s, h, b = get("https://sdrs.faa.gov/Query.aspx")
sd["query_page_status"] = s
P = "ctl00$pageContentPlaceHolder$"


def hidden(page):
    return {m.group(1): H.unescape(m.group(2)) for m in re.finditer(r'<input[^>]*name="(__[^"]+)"[^>]*value="([^"]*)"', page)}


if s == 200:
    page = b.decode("utf-8", "replace")
    form = hidden(page)
    for fld in re.findall(r'name="(ctl00\$pageContentPlaceHolder\$tb[^"]+)"', page):
        form[fld] = ""
    form[P + "tbDifficultyDateFrom"], form[P + "tbDifficultyDateTo"], form[P + "btnQuery"] = "10/01/2026", "10/03/2026", "Query"
    s, h, b = get("https://sdrs.faa.gov/Query.aspx", urllib.parse.urlencode(form).encode())
    res = b.decode("utf-8", "replace")
    sd["window"] = "2026-10-01..2026-10-03 (difficulty date)"
    m = re.search(r"returned ([\d,]+) records", res)
    sd["records_in_window"] = int(m.group(1).replace(",", "")) if m else None
    rows = []
    for tr in re.findall(r"<tr align=\"center\">(.*?)</tr>", res, re.S):
        tds = [text(x) for x in re.findall(r"<td[^>]*>(.*?)</td>", tr, re.S)]
        if len(tds) >= 8:
            rows.append({"control": tds[1], "operator": tds[2], "date": tds[3], "n_number": tds[4], "make": tds[5], "model": tds[6], "jasc": tds[7]})
    sd["rows_parsed"] = len(rows)
    nn = [r["n_number"] for r in rows]
    sd["with_registration"] = sum(1 for x in nn if x)
    sd["registration_matches_us_n_grammar"] = sum(1 for x in nn if re.fullmatch(r"[1-9][0-9]{0,4}[A-Z]{0,2}", x))
    sd["placeholder_12345_or_0"] = sum(1 for x in nn if x in ("12345", "0", "00000", "NONE", "UNK"))
    sd["distinct_registrations"] = len(set(nn))
    sd["with_operator_designator"] = sum(1 for r in rows if r["operator"])
    sd["examples"] = rows[:5]
    det = []
    post = hidden(res)
    for i in range(min(10, len(rows))):
        post2 = dict(post)
        post2["__EVENTTARGET"] = f"{P}dgQueryResults$ctl{i + 2:02d}$ctl00"
        post2["__EVENTARGUMENT"] = ""
        s, h, b = get("https://sdrs.faa.gov/Query.aspx", urllib.parse.urlencode(post2).encode())
        t = text(b)
        pd = re.search(r"4\. Problem Description \(Note:[^)]*\)\s*(.*?)\s*5\. Specific Part", t)
        ac = re.search(r"\(a\) Aircraft (.*?) \(b\) Engine", t)
        det.append({"status": s, "control_number": (re.search(r"Unique Control # (\S+)", t) or [None, None])[1],
                    "problem_description_chars": len(pd.group(1)) if pd else 0,
                    "aircraft_make_model_serial_hours_cycles": ac.group(1) if ac else None})
        time.sleep(1)
    sd["details_fetched"] = len(det)
    sd["details_with_problem_text"] = sum(1 for d in det if d["problem_description_chars"] > 0)
    sd["details_median_problem_chars"] = sorted(d["problem_description_chars"] for d in det)[len(det) // 2] if det else 0
    sd["details_with_aircraft_serial"] = sum(1 for d in det if d["aircraft_make_model_serial_hours_cycles"] and len(d["aircraft_make_model_serial_hours_cycles"].split()) >= 3)
    sd["details"] = det
out["sdrs"] = sd

# ---------------------------------------------------------------- 7. Terms pages
terms = {}
for name, u, pats in [
    ("ccar", "https://wwwapps.tc.gc.ca/Saf-Sec-Sur/2/CCARCS-RIACC/DDZip.aspx?lang=eng",
     ["Canada hereby grants you a royalty-free, non-exclusive, world-wide, non-assignable licence to use, reproduce, extract, modify, translate, further develop and distribute",
      "Reproduced and distributed with the permission of the Government of Canada.",
      "you shall not merge or link the data made available through the GC Open Data Portal with any product or database for the purpose of identifying an individual"]),
    ("govuk", "https://www.gov.uk/help/terms-conditions", ["You can reproduce content published on GOV.UK under the OGL as long as you follow the licence"]),
    ("iaa", "https://www.iaa.ie/home/footer-tools/disclaimer", ["give no guarantees, undertakings or warranties concerning the accuracy, completeness or up to date nature of the information provided"]),
    ("casa_copyright", "https://www.casa.gov.au/about-us/standard-page/copyright", []),
]:
    s, h, b = get(u, timeout=60, tries=1)
    t = text(b) if s == 200 else ""
    terms[name] = {"url": u, "status": s, "quotes_found": {p[:60]: (p.replace("’", "'") in t.replace("’", "'")) for p in pats}}
out["terms"] = terms

json.dump(out, open("acreg_measure.json", "w"), indent=1, ensure_ascii=False)
print(json.dumps({k: (v if k in ("requests", "faa_probe") else "ok") for k, v in out.items()}, indent=1))
