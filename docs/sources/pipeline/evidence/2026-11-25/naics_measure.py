#!/usr/bin/env python3
"""Round 34 (2026-11-25): industry classification codes. Reads the US Census Bureau 2022 NAICS descriptions
workbook, the Statistics Canada NAICS Canada 2022 structure file, the BLS QCEW industry titles file and the
SBA size-standards table as codified in 13 CFR 121.201 (eCFR). Joins are on the NAICS code. Writes
naics_measure.json. Stdlib only."""
import collections, csv, io, random, re, zipfile, html
import xml.etree.ElementTree as ET
import scoutlib as s
from termslib import check

out = {"run_date": "2026-11-25"}
NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}

def xlsx_rows(body):
    z = zipfile.ZipFile(io.BytesIO(body))
    shared = ["".join(t.text or "" for t in si.iter("{%s}t" % NS["m"])) for si in ET.fromstring(z.read("xl/sharedStrings.xml")).findall("m:si", NS)]
    sheet = sorted(n for n in z.namelist() if n.startswith("xl/worksheets/sheet"))[0]
    rows = []
    for row in ET.fromstring(z.read(sheet)).iter("{%s}row" % NS["m"]):
        cells = {}
        for c in row.findall("m:c", NS):
            col = re.match(r"[A-Z]+", c.get("r")).group(0)
            v = c.find("m:v", NS)
            if c.get("t") == "inlineStr":
                cells[col] = "".join(t.text or "" for t in c.iter("{%s}t" % NS["m"]))
            elif v is not None:
                cells[col] = shared[int(v.text)] if c.get("t") == "s" else v.text
        rows.append(cells)
    return rows

norm = lambda t: re.sub(r"[^a-z0-9]+", " ", re.sub(r"T$", "", (t or "").strip()).lower()).strip()

# --- US Census Bureau: 2022 NAICS descriptions ---------------------------------------------------------
rows = xlsx_rows(s.get("census_2022_naics_descriptions.xlsx", "https://www.census.gov/naics/2022NAICS/2022_NAICS_Descriptions.xlsx"))
header, body = rows[0], rows[1:]
census = {str(r.get("A", "")).strip(): {"title": (r.get("B") or "").strip(), "description": (r.get("C") or "").strip()} for r in body if r.get("A")}
desc = [v["description"] for v in census.values() if v["description"] and v["description"] != "NULL"]
out["census_naics_2022"] = {
    "header": header, "rows": len(body), "distinct_codes": len(census),
    "by_code_length": dict(sorted(collections.Counter(len(k) if "-" not in k else 2 for k in census).items())),
    "with_description": len(desc), "description_characters": sum(map(len, desc)),
    "median_description_characters": sorted(map(len, desc))[len(desc) // 2],
    "descriptions_with_cross_references": sum(1 for d in desc if "Cross-References" in d),
    "descriptions_with_illustrative_examples": sum(1 for d in desc if "Illustrative Examples" in d),
    "example": {"code": "311811", **census.get("311811", {})},
}
six = {k for k in census if len(k) == 6}

# --- Statistics Canada: NAICS Canada 2022 structure ---------------------------------------------------
sc_text = s.get("statcan_naics_2022_structure.csv", "https://www.statcan.gc.ca/en/statistical-programs/document/naics-scian-2022-structure-v1-eng.csv").decode("utf-8-sig")
sc = list(csv.DictReader(io.StringIO(sc_text)))
statcan = {r["Code"].strip(): r for r in sc}
defs = [r["Class definition"] for r in sc if r.get("Class definition")]
out["statcan_naics_canada_2022"] = {
    "columns": list(sc[0].keys()), "rows": len(sc), "by_level": dict(collections.Counter(r["Hierarchical structure"] for r in sc)),
    "with_definition": len(defs), "definition_characters": sum(map(len, defs)),
}
def level_join(n):
    us = {k for k in census if len(k) == n and "-" not in k}
    ca = {k for k in statcan if len(k) == n and "-" not in k}
    both = us & ca
    same = sum(1 for k in both if norm(census[k]["title"]) == norm(statcan[k]["Class title"]))
    return {"us_codes": len(us), "canada_codes": len(ca), "shared_codes": len(both), "shared_with_identical_normalised_title": same}
out["join_census_statcan_by_code_length"] = {str(n): level_join(n) for n in (2, 3, 4, 5, 6)}
upto5_us = {k for k in census if 3 <= len(k) <= 5}
upto5 = sorted(k for k in upto5_us if k in statcan)
out["join_census_statcan_3_to_5_digits"] = {"us_codes": len(upto5_us), "found_in_naics_canada": len(upto5),
    "identical_normalised_title": sum(1 for k in upto5 if norm(census[k]["title"]) == norm(statcan[k]["Class title"]))}

# --- BLS QCEW industry titles -------------------------------------------------------------------------
try:
    bls = list(csv.DictReader(io.StringIO(s.get("bls_qcew_industry_titles.csv", "https://data.bls.gov/cew/doc/titles/industry/industry_titles.csv").decode("utf-8-sig"))))
    b6 = {r["industry_code"] for r in bls if re.fullmatch(r"\d{6}", r["industry_code"])}
    out["bls_qcew_industry_titles"] = {"rows": len(bls), "six_digit_numeric_codes": len(b6),
        "other_codes": len(bls) - len(b6), "sample": bls[:3] + bls[-2:]}
    out["join_bls_census_six_digit"] = {"bls_six_digit_codes": len(b6), "found_in_census_2022": len(b6 & six),
        "census_2022_six_digit_codes": len(six), "census_codes_found_in_bls": len(six & b6),
        "bls_codes_not_in_census_2022_sample": sorted(b6 - six)[:10]}
    bls_title = {r["industry_code"]: r["industry_title"] for r in bls}
except Exception as e:
    out["bls_qcew_industry_titles"] = {"error": type(e).__name__, "detail": str(e)[:200]}
    bls_title = {}

# --- eCFR: 13 CFR 121.201, SBA size standards by NAICS code -------------------------------------------
import gzip, urllib.request
def ecfr(name, url):
    # The eCFR API refuses uncompressed responses, so this one request sends Accept-Encoding: gzip.
    import os, hashlib, time
    path = os.path.join(s.CACHE, name) if s.CACHE else None
    if path and os.path.exists(path):
        body = open(path, "rb").read(); s.REUSED.append(name)
    else:
        s.REQUESTS += 1
        req = urllib.request.Request(url, headers={"User-Agent": s.UA, "Accept-Encoding": "gzip"})
        with urllib.request.urlopen(req, timeout=120) as r:
            body = r.read()
            if r.headers.get("Content-Encoding") == "gzip":
                body = gzip.decompress(body)
        time.sleep(0.5)
        if path:
            open(path, "wb").write(body)
    s.FETCHED[name] = {"url": url, "bytes": len(body), "sha256": hashlib.sha256(body).hexdigest()}
    return body
titles = __import__("json").loads(ecfr("ecfr_titles.json", "https://www.ecfr.gov/api/versioner/v1/titles.json"))
t13 = next(t for t in titles["titles"] if t["number"] == 13)
sec = ecfr("ecfr_13cfr121_201.xml", f"https://www.ecfr.gov/api/versioner/v1/full/{t13['up_to_date_as_of']}/title-13.xml?part=121&section=121.201").decode("utf-8")
cell = lambda x: re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", x))).strip()
sba = {}
table_rows = re.findall(r"<TR>(.*?)</TR>", sec, flags=re.S)
for tr in table_rows:
    tds = [cell(td) for td in re.findall(r"<TD[^>]*>(.*?)</TD>", tr, flags=re.S)]
    if len(tds) >= 3 and re.fullmatch(r"\d{6}", tds[0]):
        sba.setdefault(tds[0], {"title": tds[1], "millions_of_dollars": tds[2], "employees": tds[3] if len(tds) > 3 else ""})
out["ecfr_13cfr_121_201"] = {
    "title_13_up_to_date_as_of": t13["up_to_date_as_of"], "latest_amended_on": t13["latest_amended_on"], "section_characters": len(sec),
    "table_rows": len(table_rows), "distinct_six_digit_codes_with_a_size_standard": len(sba),
    "with_a_dollar_standard": sum(1 for v in sba.values() if re.search(r"\d", v["millions_of_dollars"])),
    "with_an_employee_standard": sum(1 for v in sba.values() if re.search(r"\d", v["employees"])),
    "footnote_paragraph_characters": len(cell(sec.split("Footnotes", 1)[1])) if "Footnotes" in sec else 0,
    "example": {"code": "311811", **sba.get("311811", {})},
}
out["join_sba_table_census_six_digit"] = {"sba_table_codes": len(sba), "found_in_census_2022": len(set(sba) & six),
    "not_found": sorted(set(sba) - six)[:15], "census_six_digit_codes_without_a_size_standard": len(six - set(sba)),
    "census_without_standard_sample": sorted(six - set(sba))[:8],
    "identical_normalised_title": sum(1 for k in set(sba) & six if norm(sba[k]["title"]) == norm(census[k]["title"]))}

random.seed(20261125)
pick = random.sample(sorted(set(sba) & six), 20)
out["handcheck_sample_sba_census"] = [{"code": k, "census_title": census[k]["title"], "ecfr_row_title": sba[k]["title"],
    "bls_title": bls_title.get(k), "size_standard": (sba[k]["millions_of_dollars"] or sba[k]["employees"])} for k in pick]
pick2 = random.sample(upto5, 20)
out["handcheck_sample_statcan_census"] = [{"code": k, "census_title": census[k]["title"], "statcan_title": statcan[k]["Class title"]} for k in pick2]

out["terms"] = {
    "census": check("terms_census.html", "https://www.census.gov/about/policies/citation.html", [], ("public domain", "copyright", "permission")),
    "statcan": check("terms_statcan.html", "https://www.statcan.gc.ca/en/reference/licence", [], ("commercial", "royalty-free", "acknowledge")),
    "bls": check("terms_bls.html", "https://www.bls.gov/bls/linksite.htm", [], ("public domain", "copyright", "permission")),
    "ecfr": check("terms_govinfo.html", "https://www.govinfo.gov/about/policies", ["By virtue of the foregoing, public documents can generally be reprinted without legal restriction."], ()),
}
s.write(__file__, out)
