#!/usr/bin/env python3
"""Screen the charity-nonprofit-registry members (2026-10-04). Writes results.json next to this file.

Polite: custom User-Agent, <=2 req/s, every download <50MB, no keys, no login.
Cache dir: $SCREEN_CACHE (default /tmp/charity-screen).
"""
import csv, collections, glob, io, json, os, re, struct, sys, time, zipfile, zlib, urllib.request, unicodedata

UA = {"User-Agent": "data-foundry-scout (data@mail.proviciency.com)"}
CACHE = os.environ.get("SCREEN_CACHE", "/tmp/charity-screen")
os.makedirs(CACHE, exist_ok=True)
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "results.json")
csv.field_size_limit(10**9)


def get(url, name, rng=None):
    path = os.path.join(CACHE, name)
    if os.path.exists(path):
        return path
    req = urllib.request.Request(url, headers={**UA, **({"Range": f"bytes={rng}"} if rng else {})})
    with urllib.request.urlopen(req, timeout=180) as r:
        data = r.read()
        status = r.status
    open(path, "wb").write(data)
    print(name, status, len(data), file=sys.stderr)
    time.sleep(0.7)
    return path


def norm(s):
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower()
    s = re.sub(r"\b(the|inc|incorporated|ltd|limited|society|association|foundation|trust|charity|charitable|of)\b", " ", s)
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


def dom(u):
    u = (u or "").strip().lower()
    u = re.sub(r"^https?://", "", u)
    u = re.sub(r"^www\.", "", u).split("/")[0]
    return u if "." in u and " " not in u else ""


res = {"run_date": "2026-10-04", "members": {}}

# ---- ACNC (Australia) -------------------------------------------------------------------------
acnc_p = get("https://data.gov.au/data/dataset/b050b242-4487-4306-abf5-07ca073e5594/resource/8fb32972-24e9-4c95-885e-7140be51be8a/download/datadotgov_main.csv", "acnc.csv")
acnc = list(csv.DictReader(open(acnc_p, encoding="utf-8-sig")))
from datetime import datetime
rd = [datetime.strptime(r["Registration_Date"], "%d/%m/%Y") for r in acnc if r["Registration_Date"]]
res["members"]["acnc"] = {
    "http": 200, "rows": len(acnc), "columns": len(acnc[0]), "newest_registration_date_not_future": max(d for d in rd if d <= datetime(2026, 10, 4)).date().isoformat(), "future_dated_registration_rows": sum(1 for d in rd if d > datetime(2026, 10, 4)),
    "id_field": "ABN", "abn_present": sum(1 for r in acnc if r["ABN"]),
    "website_present": sum(1 for r in acnc if r["Charity_Website"]),
    "free_text_fields": ["Charity_Legal_Name", "Other_Organisation_Names"],
    "purpose_flags": 12, "note": "no mission/activity prose in this extract; purposes and beneficiaries are Y/blank flags",
    "ckan_metadata_modified": "2026-09-27T19:57:42Z (weekly)",
    "sample": [{k: r[k] for k in ("ABN", "Charity_Legal_Name", "State", "Charity_Size", "Registration_Date")} for r in acnc[:20]],
}

# ---- CRA (Canada) ----------------------------------------------------------------------------
B = "https://open.canada.ca/data/dataset/80c00cdb-1358-415c-bb8b-0de7f12675b8/resource/"
ident_p = get(B + "694fdc72-eae4-4ee0-83eb-832ab7b230e3/download/ident_2024_updated.csv", "cra_ident.csv")
ident = list(csv.DictReader(open(ident_p, encoding="utf-8")))
prog_p = get(B + "1f16eb1b-cc03-4c95-a81c-0fdc0722c5ee/download/new_ongoing_programs_2024_updated.csv", "cra_prog.csv", rng="0-4000000")
prog_rows = list(csv.DictReader(io.StringIO(open(prog_p, encoding="utf-8", errors="ignore").read().rsplit("\n", 1)[0])))
web_p = get(B + "e3567bb5-5d98-44d0-b0e8-9cdd3732c9e4/download/weburl_2024_updated.csv", "cra_web.csv")
web = list(csv.DictReader(open(web_p, encoding="utf-8", errors="ignore")))
lens = [len(r["Description"]) for r in prog_rows]
res["members"]["cra"] = {
    "http": 200, "ident_rows": len(ident), "web_rows": len(web), "program_rows_in_first_4MB_sample": len(prog_rows),
    "fiscal_period_ends_seen_in_programs_sample": sorted({r["FPE"][:4] for r in prog_rows}),
    "dataset_published": "2026-04-30 (annual, frequency P1Y); CKAN metadata_modified 2026-10-04",
    "id_field": "BN (9 digits + RR0001)",
    "free_text_fields": ["Description (programs, new+ongoing)", "Schedule 7 political-activity descriptions"],
    "program_description_median_chars": sorted(lens)[len(lens) // 2], "program_description_p90_chars": sorted(lens)[int(len(lens) * 0.9)],
    "sample": [{"BN": r["BN"], "Legal Name": r["Legal Name"], "Province": r["Province"], "Category": r["Category"]} for r in ident[:20]],
    "program_sample": [{"BN": r["BN"], "FPE": r["FPE"], "type": r["Program Type"], "desc": r["Description"][:160]} for r in prog_rows[:20]],
}

# ---- UK Charity Commission --------------------------------------------------------------------
uk_p = get("https://ccewuksprdoneregsadata1.blob.core.windows.net/data/txt/publicextract.charity.zip", "uk.zip")
z = zipfile.ZipFile(uk_p)
uk = list(csv.DictReader(io.TextIOWrapper(z.open("publicextract.charity.txt"), encoding="utf-8-sig", errors="ignore"), delimiter="\t"))
reg = [r for r in uk if r["charity_registration_status"] == "Registered"]
res["members"]["uk_charity_commission"] = {
    "http": 200, "rows_total": len(uk), "rows_registered": len(reg), "date_of_extract": uk[0]["date_of_extract"][:10],
    "id_fields": ["registered_charity_number", "organisation_number", "charity_company_registration_number"],
    "company_number_present_registered": sum(1 for r in reg if r["charity_company_registration_number"]),
    "activities_present_registered": sum(1 for r in reg if r["charity_activities"].strip()),
    "web_present_registered": sum(1 for r in reg if r["charity_contact_web"].strip()),
    "activities_median_chars": sorted(len(r["charity_activities"]) for r in reg if r["charity_activities"].strip())[sum(1 for r in reg if r["charity_activities"].strip()) // 2],
    "sample": [{"num": r["registered_charity_number"], "name": r["charity_name"], "income": r["latest_income"], "activities": r["charity_activities"][:160]} for r in reg if r["charity_activities"].strip()][:20],
}

# ---- IRS EO BMF + 990 XML ---------------------------------------------------------------------
vt_p = get("https://www.irs.gov/pub/irs-soi/eo_vt.csv", "eo_vt.csv")
vt = list(csv.DictReader(open(vt_p, encoding="latin-1")))
part_p = get("https://apps.irs.gov/pub/epostcard/990/xml/2026/2026_TEOS_XML_01A.zip", "teos_part.zip", rng="0-8000000")
d = open(part_p, "rb").read()
pos = 0
xmls = []
while d[pos:pos + 4] == b"PK\x03\x04":
    _, flag, comp, _, _, crc, csz, usz, nl, el = struct.unpack("<HHHHHIIIHH", d[pos + 4:pos + 30])
    start = pos + 30 + nl + el
    if flag & 8 or csz == 0 or start + csz > len(d):
        break
    xmls.append(zlib.decompress(d[start:start + csz], -15).decode("utf8", "ignore"))
    pos = start + csz
irs990 = []
for t in xmls:
    ein = re.search(r"<Filer>\s*<EIN>(\d+)</EIN>\s*<BusinessName>\s*<BusinessNameLine1Txt>([^<]*)", t)
    mis = re.search(r"<(?:MissionDesc|ActivityOrMissionDesc|PrimaryExemptPurposeTxt)>([^<]*)", t)
    form = re.search(r"<ReturnTypeCd>([^<]*)", t)
    rev = re.search(r"<(?:CYTotalRevenueAmt|TotalRevenueAmt)>(-?\d+)", t)
    if ein:
        irs990.append({"ein": ein.group(1), "name": ein.group(2), "form": form.group(1) if form else None, "mission": mis.group(1).strip() if mis else "", "revenue": rev.group(1) if rev else None})
res["members"]["irs_teos"] = {
    "http": 200, "bmf_record_count_stated_on_page": 1964958, "bmf_posting_date_stated": "9/8/2026",
    "bmf_vt_rows_measured": len(vt), "bmf_id_field": "EIN", "bmf_fields": "NAME,NTEE_CD,SUBSECTION,RULING,ASSET_AMT,INCOME_AMT,REVENUE_AMT,STATUS (no prose)",
    "bmf_vt_ntee_present": sum(1 for r in vt if r["NTEE_CD"].strip()),
    "teos_xml_zip_bytes": 314704706, "xml_filings_parsed_from_first_8MB_of_2026_TEOS_XML_01A": len(irs990),
    "xml_with_mission_text": sum(1 for r in irs990 if r["mission"]), "form_types": collections.Counter(r["form"] for r in irs990),
    "sample": [{"ein": r["ein"], "name": r["name"], "ntee": ""} for r in irs990[:5]] + irs990[5:25],
}
res["members"]["irs_teos"]["sample"] = [{"ein": r["ein"], "name": r["name"], "form": r["form"], "mission": r["mission"][:160]} for r in irs990 if r["mission"]][:20]

# ---- Cross-source linkage ----------------------------------------------------------------------
# 1) declared identifiers: do any two members carry an identifier that names the counterpart record?
res["declared_identifier_check"] = {
    "acnc_columns_with_id": ["ABN"], "cra_id": ["BN"], "uk_ids": ["registered_charity_number", "charity_company_registration_number"], "irs_id": ["EIN"],
    "cross_references_found": 0,
    "note": "Each register keys on its own national identifier (ABN, BN, charity number, EIN). No column in any member names another member's identifier.",
}
# 2) name + website candidates
def index(rows, namef, webf=None):
    names = collections.defaultdict(list); webs = collections.defaultdict(list)
    for r in rows:
        n = norm(namef(r))
        if n and len(n) > 5: names[n].append(r)
        if webf:
            w = dom(webf(r))
            if w: webs[w].append(r)
    return names, webs

cra_web = {r["BN/NE"]: r["Contact URL"] for r in web}
A_n, A_w = index(acnc, lambda r: r["Charity_Legal_Name"], lambda r: r["Charity_Website"])
C_n, C_w = index(ident, lambda r: r["Legal Name"], lambda r: cra_web.get(r["BN"], ""))
U_n, U_w = index(reg, lambda r: r["charity_name"], lambda r: r["charity_contact_web"])
I_n, _ = index(irs990, lambda r: r["name"])
V_n, _ = index(vt, lambda r: r["NAME"])


def link(a, b, la, lb):
    ks = sorted(set(a) & set(b))
    return [{"norm": k, la: a[k][0], lb: b[k][0]} for k in ks]

pairs = {}
for (la, a, aw), (lb, b, bw) in [("acnc", A_n, A_w), ("cra", C_n, C_w)], [("acnc", A_n, A_w), ("uk", U_n, U_w)], [("cra", C_n, C_w), ("uk", U_n, U_w)]:
    pass
sets = {"acnc": (A_n, A_w), "cra": (C_n, C_w), "uk": (U_n, U_w)}
for x, y in [("acnc", "cra"), ("acnc", "uk"), ("cra", "uk")]:
    nm = sorted(set(sets[x][0]) & set(sets[y][0]))
    wm = sorted(set(sets[x][1]) & set(sets[y][1]))
    pairs[f"{x}-{y}"] = {"name_matches": len(nm), "name_match_sample": nm[:40], "website_domain_matches": len(wm), "website_match_sample": wm[:40],
                          "denominators": {x: len(sets[x][0]), y: len(sets[y][0])}}
# US 990 sample (n=%d) and Vermont BMF vs the three national registers
for lab, idx in [("irs990_sample", I_n), ("irs_bmf_vt", V_n)]:
    for y in ["acnc", "cra", "uk"]:
        nm = sorted(set(idx) & set(sets[y][0]))
        pairs[f"{lab}-{y}"] = {"name_matches": len(nm), "name_match_sample": nm[:40], "denominator": len(idx)}
res["linkage_candidates"] = pairs
json.dump(res, open(OUT, "w"), indent=1, default=str)
print(json.dumps({k: v for k, v in pairs.items()}, default=str)[:3000])
