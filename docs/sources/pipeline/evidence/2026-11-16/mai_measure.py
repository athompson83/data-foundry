#!/usr/bin/env python3
"""Screening 2026-11-16: marine-accident-investigations. Fetches every source live (stdlib only; PDF text via the
poppler `pdftotext` binary through subprocess when it is installed).
Run from this directory with: python3 -I mai_measure.py   -> writes mai_measure.json
Output holds report numbers, case numbers, IMO numbers, vessel names (ships, not people), dates and counts only.
Report PDFs are read for IMO numbers and never written out.

Members:
  UK MAIB reports: GOV.UK search API (filter_format=maib_report) + content API + report PDFs.
  US NTSB marine reports: ntsb.gov SharePoint list API (Reports list, Mode = Marine) + report PDFs.
  Norway NSIA marine reports: nsia.no/Marine/Published-reports pages with a typed "Facts" table (IMO number, vessel,
  occurrence date, accident category, vessel type, register) + prose summary and safety recommendations.
  Germany BSU investigation reports: bsu-bund.de per-year report tables (case number, issue date, prose description
  naming the vessel in capitals and the occurrence date) + English report PDFs.
Probed, not members: TSB Canada MARSIS CSVs (403 from the Azure gateway), Bahamas Maritime Authority (legal notice
forbids copying), NTSB CAROL (moved behind my.ntsb.gov sign-in / developer keys), IMO GISIS casualties (login).
Joins:
  NSIA IMO number -> IMO numbers printed in the MAIB / NTSB report PDF for the reports whose title names the same
  vessel (declared IMO number match), and the same occurrence date (+-3 days) for same-event checks.
  BSU <-> MAIB: BSU vessel name (capitals) in a MAIB title with the same occurrence date +-3 days, then the IMO
  numbers printed in both PDFs (declared IMO number confirmation of the same-event candidates).
  MAIB <-> NTSB: vessel name in the NTSB title (<em>) found in a MAIB title with the same occurrence date +-3 days.
"""
import datetime as dt, html as H, json, os, re, shutil, subprocess, sys, tempfile, time, urllib.parse, urllib.request

UA = "data-foundry-scout/1.0 (data@mail.proviciency.com)"
out = {"run_date": time.strftime("%Y-%m-%d"), "requests": 0}
CACHE = sys.argv[sys.argv.index("--cache") + 1] if "--cache" in sys.argv else None  # development only
PDFTOTEXT = shutil.which("pdftotext")


def get(u, headers=None, tries=3, timeout=180):
    key = None
    if CACHE:
        os.makedirs(CACHE, exist_ok=True)
        key = os.path.join(CACHE, re.sub(r"[^A-Za-z0-9]+", "_", u)[-200:])
        if os.path.exists(key):
            with open(key, "rb") as f:
                return 200, f.read()
    for i in range(tries):
        try:
            out["requests"] += 1
            r = urllib.request.Request(u, headers={"User-Agent": UA, "Accept-Encoding": "identity", **(headers or {})})
            with urllib.request.urlopen(r, timeout=timeout) as f:
                body = f.read()
            if key:
                with open(key, "wb") as f:
                    f.write(body)
            time.sleep(0.5)
            return 200, body
        except urllib.error.HTTPError as e:
            if e.code >= 500 and i < tries - 1:
                time.sleep(10)
                continue
            return e.code, b""
        except Exception as e:
            if i == tries - 1:
                return 0, str(e).encode()
            time.sleep(5)


def imo_valid(s):
    if not re.fullmatch(r"\d{7}", s) or s.startswith("0"):
        return False
    return sum(int(s[i]) * (7 - i) for i in range(6)) % 10 == int(s[6])


def pdf_imos(body):
    """Check-digit-valid 7-digit numbers on a line that says IMO (or the line after it)."""
    if not PDFTOTEXT or not body.startswith(b"%PDF"):
        return None
    with tempfile.TemporaryDirectory() as d:
        p = os.path.join(d, "r.pdf")
        with open(p, "wb") as f:
            f.write(body)
        txt = subprocess.run([PDFTOTEXT, "-layout", "-l", "40", p, "-"], capture_output=True, timeout=120).stdout.decode("utf-8", "replace")
    lines = txt.splitlines()
    found = set()
    for i, ln in enumerate(lines):
        if re.search(r"\bIMO\b", ln):
            for n in re.findall(r"(?<!\d)(\d{7})(?!\d)", ln + " " + (lines[i + 1] if i + 1 < len(lines) else "")):
                if imo_valid(n):
                    found.add(n)
    return sorted(found)


def text(s):
    s = re.sub(r"<script.*?</script>|<style.*?</style>", " ", s, flags=re.S)
    return H.unescape(re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", s))).strip()


def norm(s):
    return re.sub(r"[^a-z0-9]+", " ", (s or "").lower()).strip()


def days(a, b):
    try:
        return abs((dt.date.fromisoformat(a) - dt.date.fromisoformat(b)).days)
    except Exception:
        return None


# ---------------------------------------------------------------- 1. UK MAIB (GOV.UK)
maib = []
for start in (0, 1000):
    st, b = get(f"https://www.gov.uk/api/search.json?filter_format=maib_report&count=1000&start={start}"
                "&fields=title,link,public_timestamp,date_of_occurrence,vessel_type,report_type")
    maib += json.loads(b)["results"]
cnt = lambda xs: dict(sorted(((k, xs.count(k)) for k in set(xs)), key=lambda kv: -kv[1]))
out["maib"] = {
    "total": len(maib),
    "newest_published": max(x["public_timestamp"][:10] for x in maib),
    "oldest_occurrence": min(x["date_of_occurrence"] for x in maib if x.get("date_of_occurrence")),
    "newest_occurrence": max(x["date_of_occurrence"] for x in maib if x.get("date_of_occurrence")),
    "with_date_of_occurrence": sum(1 for x in maib if x.get("date_of_occurrence")),
    "vessel_type": cnt([v for x in maib for v in (x.get("vessel_type") or ["(none)"])]),
    "report_type": cnt([v for x in maib for v in (x.get("report_type") or ["(none)"])]),
    "published_per_year": cnt([x["public_timestamp"][:4] for x in maib]),
}


def maib_pdf_imos(link):
    st, b = get("https://www.gov.uk/api/content" + link)
    if st != 200:
        return {"content_status": st}
    d = json.loads(b)
    pdfs = [a["url"] for a in d["details"].get("attachments", []) if a.get("url", "").lower().endswith(".pdf")]
    body = d["details"].get("body", "")
    res = {"pdfs": len(pdfs), "body_chars": len(text(body)), "has_recommendations": "recommendation" in body.lower()}
    if pdfs:
        st, pb = get(pdfs[0])
        res["imos"] = pdf_imos(pb) if st == 200 else None
        res["pdf_bytes"] = len(pb)
    return res


# IMO coverage on the 15 newest merchant-vessel (>=100 GT) reports
merchant = sorted([x for x in maib if "merchant-vessel-100-gross-tons-or-over" in (x.get("vessel_type") or [])],
                  key=lambda x: x["public_timestamp"], reverse=True)[:15]
ms = [dict(link=x["link"], **maib_pdf_imos(x["link"])) for x in merchant]
out["maib"]["merchant_sample"] = {"checked": len(ms), "with_pdf": sum(1 for x in ms if x.get("pdfs")),
                                  "with_imo": sum(1 for x in ms if x.get("imos")),
                                  "with_recommendations_in_body": sum(1 for x in ms if x.get("has_recommendations")),
                                  "median_body_chars": sorted(x.get("body_chars", 0) for x in ms)[len(ms) // 2],
                                  "rows": [{"link": x["link"], "imos": x.get("imos")} for x in ms]}

# ---------------------------------------------------------------- 2. US NTSB marine reports (SharePoint list API)
FIELDS = ["NTSBAccidentID", "NTSBReportNumber", "Title", "NTSB_x0020_Title", "Report_x0020_Date_x0020_Adopted",
          "Accident_x0020_Date", "Accident_x0020_Location_x0020__x002d__x0020_City",
          "Accident_x0020_Location_x0020__x002d__x0020_State", "Accident_x0020_Location_x0020__x002d__x0020_Country", "Modified"]
u = ("https://www.ntsb.gov/investigations/AccidentReports/_api/web/Lists/Reports/items?%24top=500"
     "&%24orderby=Report_x0020_Date_x0020_Adopted%20desc&%24expand=File&%24filter=Mode%20eq%20%27Marine%27")
ntsb = []
while u:
    st, b = get(u, {"Accept": "application/json;odata=verbose"})
    d = json.loads(b)["d"]
    for x in d["results"]:
        r = {k: x.get(k) for k in FIELDS}
        r["file"] = (x.get("File") or {}).get("ServerRelativeUrl")
        em = [H.unescape(re.sub(r"<[^>]+>", "", s)).replace("​", "").strip() for s in re.findall(r"<em>(.*?)</em>", r["NTSB_x0020_Title"] or "")]
        if not em:  # older titles put the vessel name in capitals
            em = [s for s in re.findall(r"\b([A-Z0-9][A-Z0-9'.\-]+(?:\s+[A-Z0-9][A-Z0-9'.\-]+)*)\b", r["Title"] or "") if len(s) >= 4 and s not in ("USCG", "NTSB")]
        r["vessels"] = [s for s in em if len(s) >= 3]
        ntsb.append(r)
    u = d.get("__next")
series = [re.match(r"[A-Z]+", (x["NTSBReportNumber"] or "?")).group(0) for x in ntsb]
out["ntsb"] = {
    "total": len(ntsb),
    "series": cnt(series),
    "with_case_number": sum(1 for x in ntsb if re.fullmatch(r"[A-Z]{3}\d{2}[A-Z]{2}\d{3}", x["NTSBAccidentID"] or "")),
    "with_accident_date": sum(1 for x in ntsb if x["Accident_x0020_Date"]),
    "with_pdf": sum(1 for x in ntsb if (x["file"] or "").lower().endswith(".pdf")),
    "with_vessel_name_in_title": sum(1 for x in ntsb if x["vessels"]),
    "newest_adopted": max((x["Report_x0020_Date_x0020_Adopted"] or "")[:10] for x in ntsb),
    "oldest_adopted": min((x["Report_x0020_Date_x0020_Adopted"] or "9999")[:10] for x in ntsb),
    "newest_modified": max((x["Modified"] or "")[:10] for x in ntsb),
    "adopted_per_year_recent": {y: sum(1 for x in ntsb if (x["Report_x0020_Date_x0020_Adopted"] or "").startswith(y)) for y in ("2022", "2023", "2024", "2025", "2026")},
}


def ntsb_pdf_imos(x):
    st, b = get("https://www.ntsb.gov" + urllib.parse.quote(x["file"]))
    return pdf_imos(b) if st == 200 else None


ns = [x for x in ntsb if (x["NTSBReportNumber"] or "").startswith("MIR")][:15]
nrows = [{"report": x["NTSBReportNumber"], "case": x["NTSBAccidentID"], "imos": ntsb_pdf_imos(x)} for x in ns]
out["ntsb"]["mir_sample"] = {"checked": len(nrows), "with_imo": sum(1 for r in nrows if r["imos"]), "rows": nrows}

# ---------------------------------------------------------------- 3. Norway NSIA marine reports
paths = []
for p in range(0, 6):
    st, b = get(f"https://nsia.no/Marine/Published-reports?page={p}")
    for m in re.findall(r'href="(/Marine/Published-reports/\d{4}-\d{2}[^"?#]*)"', b.decode("utf-8", "replace")):
        if m not in paths:
            paths.append(m)
nsia = []
for pth in paths:
    st, b = get("https://nsia.no" + pth)
    s = b.decode("utf-8", "replace")
    facts = {text(k): text(v) for k, v in re.findall(r"<tr>\s*<td>(.*?)</td>\s*<td>(.*?)</td>\s*</tr>", s, re.S)}
    occ = re.fullmatch(r"(\d{2})\.(\d{2})\.(\d{4})", facts.get("Occurrence date", ""))
    pub = re.search(r"<p>Published (\d{2})\.(\d{2})\.(\d{4})</p>", s)
    nsia.append({
        "path": pth, "status": st,
        "report_no": (re.search(r"Marine report (\d{4}/\d{2}[^<\s]*)", text(s)) or [None, None])[1],
        "imo": [n for n in re.findall(r"\d{7}", facts.get("IMO number", "")) if imo_valid(n)],
        "imo_raw": facts.get("IMO number"),
        "vessel": facts.get("Name of vessel"),
        "occurrence": f"{occ[3]}-{occ[2]}-{occ[1]}" if occ else None,
        "published": f"{pub[3]}-{pub[2]}-{pub[1]}" if pub else None,
        "category": facts.get("Accident category"), "vessel_type": facts.get("Vessel type"), "register": facts.get("Register"),
        "area": facts.get("Area"),
        "has_pdf": "SHT-Report-ReportFile" in s,
        "safety_recommendations": len(re.findall(r"Safety recommendation Marine No", s)),
    })
out["nsia"] = {
    "total": len(nsia),
    "ok": sum(1 for x in nsia if x["status"] == 200),
    "with_facts_table": sum(1 for x in nsia if x["vessel"] or x["occurrence"]),
    "with_valid_imo": sum(1 for x in nsia if x["imo"]),
    "imo_field_present_but_invalid": sum(1 for x in nsia if x["imo_raw"] and not x["imo"]),
    "distinct_imos": len({i for x in nsia for i in x["imo"]}),
    "with_occurrence_date": sum(1 for x in nsia if x["occurrence"]),
    "with_report_pdf": sum(1 for x in nsia if x["has_pdf"]),
    "with_safety_recommendations": sum(1 for x in nsia if x["safety_recommendations"]),
    "safety_recommendations_total": sum(x["safety_recommendations"] for x in nsia),
    "newest_published": max((x["published"] or "") for x in nsia),
    "oldest_published": min((x["published"] or "9999") for x in nsia),
    "category": cnt([x["category"] or "(none)" for x in nsia]),
    "register": cnt([x["register"] or "(none)" for x in nsia]),
    "area": cnt([x["area"] or "(none)" for x in nsia]),
}

# ---------------------------------------------------------------- 4. Germany BSU investigation reports (per-year tables)
MONTHS = {m: i + 1 for i, m in enumerate(["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"])}
bsu = []
for y in range(2003, 2027):
    u = ("https://www.bsu-bund.de/EN/Publications/Unfallberichte/Unfallberichte_node.html" if y == 2026 else
         f"https://www.bsu-bund.de/EN/Publications/Unfallberichte/_functions/unfallberichte_table_{y}.html?nn=223962")
    st, b = get(u)
    s = b.decode("utf-8", "replace")
    for row in re.findall(r"<tr>\s*<td class=\"(?:odd|even)\">(.*?)</tr>", s, re.S):
        cells = re.findall(r"<td[^>]*>(.*?)</td>", "<td>" + row, re.S)
        if len(cells) < 3:
            continue
        a = re.search(r'href="([^"]+\.pdf[^"]*)"[^>]*>(.*?)</a>', cells[1], re.S)
        desc = text(re.split(r"<p><a ", cells[2])[0])
        occ = re.findall(r"\b(?:on|of)\s+(\d{1,2})\s+(" + "|".join(MONTHS) + r")\s+(\d{4})", desc)
        caps = [c.strip() for c in re.findall(r"\b([A-Z0-9][A-Z0-9'\.\-]+(?:\s+[A-Z0-9][A-Z0-9'\.\-]+)*)\b", desc)
                if len(c.strip()) >= 3 and not re.fullmatch(r"[0-9 .\-]+|NOK|BSU|MAIB|GPS|AIS|VTS|RIB|LNG|LPG|SOLAS", c.strip())]
        rep = text(a.group(2)) if a else text(cells[1])
        bsu.append({"table": y, "issued": "-".join(reversed(text(cells[0]).split("."))), "report": re.sub(r"\s*\(PDF.*", "", rep),
                    "case": (re.search(r"(?<![\d/])(\d{1,4}/\d{2})(?!\d)", rep) or [None, None])[1],
                    "pdf": "https://www.bsu-bund.de" + H.unescape(a.group(1)) if a else None, "vessels": caps,
                    "occurrence": f"{occ[0][2]}-{MONTHS[occ[0][1]]:02d}-{int(occ[0][0]):02d}" if occ else None,
                    "summary_chars": len(desc), "maib_in_file": bool(a and "MAIB" in a.group(1))})
out["bsu"] = {
    "rows": len(bsu),
    "with_pdf": sum(1 for x in bsu if x["pdf"]),
    "with_case_number": sum(1 for x in bsu if x["case"]),
    "distinct_case_numbers": len({x["case"] for x in bsu if x["case"]}),
    "with_vessel_name_in_capitals": sum(1 for x in bsu if x["vessels"]),
    "with_occurrence_date_in_text": sum(1 for x in bsu if x["occurrence"]),
    "newest_issued": max(x["issued"] for x in bsu),
    "oldest_issued": min(x["issued"] for x in bsu),
    "issued_per_year_recent": {y: sum(1 for x in bsu if x["issued"].startswith(y)) for y in ("2022", "2023", "2024", "2025", "2026")},
    "maib_report_files_hosted": [x["report"] for x in bsu if x["maib_in_file"]],
}

# ---------------------------------------------------------------- 5. Probed, not members (one request each)
probes = {}
for k, u in {"tsb_marsis_csv": "https://www.tsb.gc.ca/sites/default/files/stats/MARSISdb_MDOTW_VW_OCCURRENCE_PUBLIC.csv",
             "tsb_ckan_record": "https://open.canada.ca/data/api/action/package_show?id=ad8d1b73-df09-4521-9bdb-61c529328218",
             "ntsb_carol_old_url": "https://data.ntsb.gov/carol-main-public/basic-search",
             "imo_gisis_casualties": "https://gisis.imo.org/Public/MCI/Default.aspx",
             "bma_legal_notice": "https://www.bahamasmaritime.com/information/legal-notice/"}.items():
    r = urllib.request.Request(u, headers={"User-Agent": UA})
    try:
        out["requests"] += 1
        with urllib.request.urlopen(r, timeout=60) as f:
            body = f.read().decode("utf-8", "replace")
            probes[k] = {"status": f.status, "final_url": f.geturl(), "bytes": len(body)}
            if k == "bma_legal_notice":
                probes[k]["forbids_copying"] = "may not be copied or retransmitted in any form unless expressly permitted" in text(body)
            if k == "tsb_ckan_record":
                d = json.loads(body)["result"]
                probes[k].update(license=d.get("license_title"), frequency=d.get("frequency"), resources=len(d["resources"]),
                                 resource_hosts=sorted({urllib.parse.urlparse(x["url"]).netloc for x in d["resources"]}))
            if k == "imo_gisis_casualties":
                probes[k]["login_redirect"] = "WebLogin" in f.geturl()
    except urllib.error.HTTPError as e:
        probes[k] = {"status": e.code, "server": e.headers.get("Server")}
    except Exception as e:
        probes[k] = {"status": 0, "error": str(e)[:120]}
out["probes"] = probes

# ---------------------------------------------------------------- 6. Joins
def name_hits(vessel, titles):
    v = norm(vessel)
    if len(v) < 4:
        return []
    pat = re.compile(r"(?:^| )" + re.escape(v) + r"(?: |$)")
    return [t for t in titles if pat.search(norm(t["title"]))]


# 4a. NSIA vessel -> MAIB title naming the same vessel; confirm with the IMO number printed in the MAIB PDF
maib_titles = [{"title": x["title"], "link": x["link"], "occ": x.get("date_of_occurrence")} for x in maib]
pairs = []
for x in nsia:
    for v in re.split(r"\s*(?:/|,| and | og )\s*", x["vessel"] or ""):
        for t in name_hits(v, maib_titles):
            pairs.append({"nsia": x["report_no"], "nsia_vessel": v, "nsia_imo": x["imo"], "nsia_occurrence": x["occurrence"],
                          "maib_link": t["link"], "maib_title": t["title"], "maib_occurrence": t["occ"],
                          "days_apart": days(x["occurrence"], t["occ"])})
for p in [q for q in pairs if q["days_apart"] is not None and q["days_apart"] <= 30][:15]:
    r = maib_pdf_imos(p["maib_link"])
    p["maib_imos"] = r.get("imos")
    p["imo_match"] = bool(p["nsia_imo"]) and bool(set(p["nsia_imo"]) & set(r.get("imos") or []))
out["join_nsia_maib"] = {"nsia_reports": len(nsia), "nsia_with_imo": out["nsia"]["with_valid_imo"],
                         "name_pairs": len(pairs), "pairs_checked_against_pdf": sum(1 for p in pairs if "maib_imos" in p),
                         "imo_matches": sum(1 for p in pairs if p.get("imo_match")),
                         "same_event_within_3_days": sum(1 for p in pairs if p["days_apart"] is not None and p["days_apart"] <= 3),
                         "pairs": pairs}

# 4b. NSIA vessel -> NTSB title naming the same vessel; confirm with the IMO number in the NTSB PDF
npairs = []
nt = [{"title": " ; ".join(x["vessels"]) + " ; " + (x["Title"] or ""), "x": x} for x in ntsb]
for x in nsia:
    for v in re.split(r"\s*(?:/|,| and | og )\s*", x["vessel"] or ""):
        for t in name_hits(v, nt):
            y = t["x"]
            npairs.append({"nsia": x["report_no"], "nsia_vessel": v, "nsia_imo": x["imo"], "nsia_occurrence": x["occurrence"],
                           "ntsb_report": y["NTSBReportNumber"], "ntsb_case": y["NTSBAccidentID"], "ntsb_title": y["Title"],
                           "ntsb_occurrence": (y["Accident_x0020_Date"] or "")[:10], "file": y["file"],
                           "days_apart": days(x["occurrence"], (y["Accident_x0020_Date"] or "")[:10])})
for p in [q for q in npairs if q["days_apart"] is not None and q["days_apart"] <= 30][:10]:
    p["ntsb_imos"] = ntsb_pdf_imos({"file": p.pop("file")}) if p.get("file") else None
    p["imo_match"] = bool(p["nsia_imo"]) and bool(set(p["nsia_imo"]) & set(p.get("ntsb_imos") or []))
for p in npairs:
    p.pop("file", None)
out["join_nsia_ntsb"] = {"name_pairs": len(npairs), "imo_matches": sum(1 for p in npairs if p.get("imo_match")),
                         "same_event_within_3_days": sum(1 for p in npairs if p["days_apart"] is not None and p["days_apart"] <= 3),
                         "pairs": npairs}

# 4c. MAIB <-> NTSB: NTSB vessel name in a MAIB title and the same occurrence date +-3 days
mpairs = []
for y in ntsb:
    for v in y["vessels"]:
        for t in name_hits(v, maib_titles):
            dd = days((y["Accident_x0020_Date"] or "")[:10], t["occ"])
            mpairs.append({"ntsb_report": y["NTSBReportNumber"], "ntsb_case": y["NTSBAccidentID"], "vessel": v,
                           "ntsb_occurrence": (y["Accident_x0020_Date"] or "")[:10], "maib_link": t["link"],
                           "maib_occurrence": t["occ"], "days_apart": dd, "_file": y["file"]})
same = [p for p in mpairs if p["days_apart"] is not None and p["days_apart"] <= 3]
for p in same[:10]:
    p["maib_imos"] = maib_pdf_imos(p["maib_link"]).get("imos")
    p["ntsb_imos"] = ntsb_pdf_imos({"file": p["_file"]}) if p["_file"] else None
for p in mpairs:
    p.pop("_file", None)
out["join_maib_ntsb"] = {"name_pairs": len(mpairs), "same_event_within_3_days": len(same), "same_event_pairs": same}

# 4d. BSU <-> MAIB and BSU <-> NSIA: a BSU vessel name (capitals in the description) in the other title/vessel field
#     and the same occurrence date +-3 days; IMO numbers read from both PDFs for the same-event pairs.
def bsu_pdf_imos(x):
    st, b = get(x["pdf"])
    return pdf_imos(b) if st == 200 else None


bpairs = []
for x in bsu:
    for v in x["vessels"]:
        for t in name_hits(v, maib_titles):
            dd = days(x["occurrence"], t["occ"])
            bpairs.append({"bsu_case": x["case"], "bsu_report": x["report"], "vessel": v, "bsu_occurrence": x["occurrence"],
                           "maib_link": t["link"], "maib_title": t["title"], "maib_occurrence": t["occ"], "days_apart": dd, "_x": x})
bsame = [p for p in bpairs if p["days_apart"] is not None and p["days_apart"] <= 3]
uniq = {}
for p in bsame:
    uniq.setdefault((p["bsu_case"], p["bsu_report"], p["maib_link"]), p)
bsame = list(uniq.values())
for p in bsame[:25]:
    p["maib_imos"] = maib_pdf_imos(p["maib_link"]).get("imos")
    p["bsu_imos"] = bsu_pdf_imos(p["_x"])
    p["imo_match"] = bool(set(p["maib_imos"] or []) & set(p["bsu_imos"] or []))
for p in bpairs:
    p.pop("_x", None)
out["join_bsu_maib"] = {"bsu_rows": len(bsu), "name_pairs": len(bpairs), "same_event_pairs": len(bsame),
                        "same_event_pairs_with_both_pdfs_read": sum(1 for p in bsame if p.get("maib_imos") is not None and p.get("bsu_imos") is not None),
                        "same_event_pairs_with_imo_in_both": sum(1 for p in bsame if p.get("maib_imos") and p.get("bsu_imos")),
                        "imo_matches": sum(1 for p in bsame if p.get("imo_match")),
                        "pairs": bsame}
# 4d'. MAIB "overseas-report" and Red Ensign Group pages cite the foreign board's report URL in the body: resolve the
#      cited BSU report file against the BSU tables (declared: the cited URL names the counterpart record).
cites = []
for x in maib:
    if (x.get("report_type") or [""])[0] not in ("overseas-report", "investigation-report-on-behalf-of-red-ensign-group"):
        continue
    st, b = get("https://www.gov.uk/api/content" + x["link"])
    body = json.loads(b)["details"].get("body", "") if st == 200 else ""
    hrefs = [H.unescape(h) for h in re.findall(r'href="(https?://[^"]+)"', body)]
    ext = sorted({urllib.parse.urlparse(h).netloc.lower() for h in hrefs if "gov.uk" not in urllib.parse.urlparse(h).netloc})
    bsu_file = [re.search(r"/([^/?]+\.pdf)", h).group(1) for h in hrefs if "bsu-bund.de" in h and re.search(r"/([^/?]+\.pdf)", h)]
    hit = [y["case"] for y in bsu if y["pdf"] and any(f in y["pdf"] for f in bsu_file)]
    cites.append({"link": x["link"], "report_type": x["report_type"][0], "occurrence": x.get("date_of_occurrence"),
                  "external_hosts": ext, "bsu_files_cited": bsu_file, "bsu_case_resolved": hit})
out["join_maib_cites"] = {"maib_overseas_or_reg_pages": len(cites),
                          "citing_an_external_report": sum(1 for c in cites if c["external_hosts"]),
                          "hosts": cnt([h for c in cites for h in c["external_hosts"]]),
                          "citing_bsu": sum(1 for c in cites if c["bsu_files_cited"]),
                          "bsu_citations_resolved_to_bsu_table": sum(1 for c in cites if c["bsu_case_resolved"]),
                          "rows": cites}

nsia_t = [{"title": " ".join(re.split(r"\s*/\s*", x["vessel"] or "")) , "x": x} for x in nsia]
bn = []
for x in bsu:
    for v in x["vessels"]:
        for t in name_hits(v, nsia_t):
            y = t["x"]
            dd = days(x["occurrence"], y["occurrence"])
            if dd is not None and dd <= 3:
                bn.append({"bsu_case": x["case"], "vessel": v, "bsu_occurrence": x["occurrence"], "nsia": y["report_no"],
                           "nsia_imo": y["imo"], "nsia_occurrence": y["occurrence"]})
out["join_bsu_nsia"] = {"same_event_pairs": len(bn), "pairs": bn}

# 4e. Every IMO seen per publisher, and IMOs seen by more than one publisher
seen = {"MAIB": set(), "NTSB": set(), "NSIA": set()}
for r in out["maib"]["merchant_sample"]["rows"]:
    seen["MAIB"] |= set(r["imos"] or [])
for p in pairs + [q for q in same]:
    seen["MAIB"] |= set(p.get("maib_imos") or [])
for r in nrows:
    seen["NTSB"] |= set(r["imos"] or [])
for p in npairs + same:
    seen["NTSB"] |= set(p.get("ntsb_imos") or [])
for x in nsia:
    seen["NSIA"] |= set(x["imo"])
seen["BSU"] = set()
for p in bsame:
    seen["MAIB"] |= set(p.get("maib_imos") or [])
    seen["BSU"] |= set(p.get("bsu_imos") or [])
multi = sorted(i for i in set().union(*seen.values()) if sum(i in s for s in seen.values()) > 1)
out["imo_overlap"] = {"distinct_imos": {k: len(v) for k, v in seen.items()},
                      "in_more_than_one_publisher": [{"imo": i, "publishers": [k for k, v in seen.items() if i in v]} for i in multi]}
out["nsia_rows"] = [{k: x[k] for k in ("report_no", "imo", "vessel", "occurrence", "published", "category", "vessel_type", "register")} for x in nsia]
out["ntsb_rows_recent"] = [{k: x[k] for k in ("NTSBReportNumber", "NTSBAccidentID", "Report_x0020_Date_x0020_Adopted", "Accident_x0020_Date")} | {"vessels": x["vessels"]} for x in ntsb[:25]]

with open("mai_measure.json", "w") as f:
    json.dump(out, f, indent=1, ensure_ascii=False)
print(json.dumps({k: v for k, v in out.items() if k not in ("nsia_rows", "ntsb_rows_recent")}, indent=1, ensure_ascii=False)[:6000])
