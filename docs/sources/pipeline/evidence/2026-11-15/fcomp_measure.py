#!/usr/bin/env python3
"""Screening 2026-11-15: food-composition-reference. Fetches every source live (stdlib only).
Run from this directory with: python3 -I fcomp_measure.py   -> writes fcomp_measure.json
Output holds food identifiers, generic food descriptions, field names and counts only (no personal data).

Members screened:
  USDA FoodData Central SR Legacy (CSV, 2018-04) and Foundation Foods (JSON + CSV, 2026-10-29)
  Health Canada Canadian Nutrient File 2026 (open.canada.ca food_name.csv: USDA_NDB_Code, Comment_EN)
  FSANZ Australian Food Composition Database Release 3 (Food Details xlsx: Sampling Details prose)
  UK CoFID 2021 (GOV.UK xlsx: Description, Main data references, Footnote)
  ANSES CIQUAL (data.gouv.fr record; ciqual.anses.fr downloads), NZ FOODfiles (terms), DTU Frida (app shell)
Joins:
  CNF USDA_NDB_Code -> SR Legacy / Foundation NDB_number (declared: CNF cites the USDA NDB number)
  AFCD Sampling Details "FDC ID nnnnnn" -> FDC fdc_id (declared: AFCD cites the FDC ID)
"""
import csv, io, json, re, time, zipfile, html as H, difflib
import urllib.request, urllib.error
import xml.etree.ElementTree as ET

UA = "data-foundry-scout/1.0 (data@mail.proviciency.com)"
out = {"run_date": time.strftime("%Y-%m-%d")}


def get(u, tries=3):
    for i in range(tries):
        try:
            r = urllib.request.Request(u, headers={"User-Agent": UA, "Accept-Encoding": "identity"})
            with urllib.request.urlopen(r, timeout=180) as f:
                return f.status, f.geturl(), f.read()
        except urllib.error.HTTPError as e:
            if e.code >= 500 and i < tries - 1:
                time.sleep(10)
                continue
            return e.code, u, e.read()
        except Exception as e:
            if i == tries - 1:
                return 0, u, str(e).encode()
            time.sleep(3)
        finally:
            time.sleep(1)


def text(b):
    t = H.unescape(re.sub(r"<[^>]+>", " ", b.decode("utf8", "replace")))
    return " ".join(t.split())


def has(t, q):
    return q in t


def xlsx_rows(b, sheet_name):
    z = zipfile.ZipFile(io.BytesIO(b))
    NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
    RNS = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"
    strs = []
    if "xl/sharedStrings.xml" in z.namelist():
        for si in ET.fromstring(z.read("xl/sharedStrings.xml")).iter(NS + "si"):
            strs.append("".join(t.text or "" for t in si.iter(NS + "t")))
    wb = ET.fromstring(z.read("xl/workbook.xml"))
    rels = ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))
    rmap = {r.get("Id"): r.get("Target") for r in rels}
    target = None
    for s in wb.iter(NS + "sheet"):
        if s.get("name") == sheet_name:
            target = rmap[s.get(RNS + "id")]
    target = "xl/" + target.lstrip("/").replace("xl/", "")
    rows = []
    for row in ET.fromstring(z.read(target)).iter(NS + "row"):
        vals = {}
        for c in row.findall(NS + "c"):
            col = re.match(r"[A-Z]+", c.get("r")).group(0)
            idx = 0
            for ch in col:
                idx = idx * 26 + ord(ch) - 64
            v = c.find(NS + "v")
            if v is None:
                t = c.find(".//" + NS + "t")
                val = t.text if t is not None else ""
            else:
                val = strs[int(v.text)] if c.get("t") == "s" else v.text
            vals[idx - 1] = val or ""
        if vals:
            rows.append([vals.get(i, "") for i in range(max(vals) + 1)])
    return rows


def norm(s):
    return re.sub(r"[^a-z0-9]+", " ", (s or "").lower()).strip()


# ---------------- terms pages (verbatim quotes checked for presence) ----------------
terms = {}
s, u, b = get("https://fdc.nal.usda.gov/")
t = text(b)
terms["usda_fdc"] = {"url": u, "status": s,
                     "quote_present": has(t, "USDA FoodData Central data are in the public domain and they are not copyrighted. They are published under CC0 1.0 Universal (CC0 1.0)")}
s, u, b = get("https://open.canada.ca/en/open-government-licence-canada")
t = text(b)
terms["ogl_canada"] = {"url": u, "status": s,
                       "quote_present": has(t, "You are free to: Copy, modify, publish, translate, adapt, distribute or otherwise use the Information in any medium, mode or format for any lawful purpose.")}
s, u, b = get("https://www.foodstandards.gov.au/copyright")
t = text(b)
i = t.find("Unless expressly noted otherwise")
terms["fsanz"] = {"url": u, "status": s, "excerpt": t[i:i + 420] if i >= 0 else None,
                  "commercial_clause_present": has(t, "for commercial and non-commercial purposes")}
s, u, b = get("https://www.gov.uk/government/publications/composition-of-foods-integrated-dataset-cofid")
t = text(b)
terms["gov_uk_cofid_page"] = {"url": u, "status": s,
                              "ogl_footer_present": has(t, "All content is available under the Open Government Licence v3.0 , except where otherwise stated") or has(t, "All content is available under the Open Government Licence v3.0, except where otherwise stated"),
                              "last_updated": (re.search(r"Last updated: (\d+ \w+ \d{4})", t) or [None, None])[1]}
s, u, b = get("https://www.foodcomposition.co.nz/terms")
t = text(b)
terms["nz_foodfiles"] = {"url": u, "status": s,
                         "no_modify_present": has(t, "You must not modify any part of the FOODfiles™ Data"),
                         "reserve_present": has(t, "you may not reproduce any of our intellectual property, in whole or in part, without our prior specific written permission")}
s, u, b = get("https://www.foodcomposition.co.nz/foodfiles/")
terms["nz_foodfiles"]["download_formats"] = sorted(set(re.findall(r'href="/downloads/[^"]+\.(\w+)"', b.decode("utf8", "replace"))))
out["terms"] = terms

# ---------------- USDA FDC SR Legacy ----------------
s, u, b = get("https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_sr_legacy_food_csv_2018-04.zip")
z = zipfile.ZipFile(io.BytesIO(b))
base = "FoodData_Central_sr_legacy_food_csv_2018-04/"
names = z.namelist()
sr_food = {r["fdc_id"]: r for r in csv.DictReader(io.TextIOWrapper(z.open(base + "food.csv"), "utf8"))}
sr_ndb = {r["NDB_number"]: r["fdc_id"] for r in csv.DictReader(io.TextIOWrapper(z.open(base + "sr_legacy_food.csv"), "utf8"))}
n_fn = sum(1 for _ in z.open(base + "food_nutrient.csv")) - 1
out["usda_sr_legacy"] = {"status": s, "bytes": len(b), "files": len(names), "foods": len(sr_food),
                         "ndb_numbers": len(sr_ndb), "food_nutrient_rows": n_fn,
                         "publication_dates": sorted({r["publication_date"] for r in sr_food.values()})}
sr_fdc_ids = set(sr_food)

# ---------------- USDA FDC Foundation Foods ----------------
s, u, b = get("https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_foundation_food_csv_2026-10-29.zip")
fz = zipfile.ZipFile(io.BytesIO(b))
fcsv = [n.split("/")[-1] for n in fz.namelist() if n.endswith(".csv")]
ff_rows = list(csv.DictReader(io.TextIOWrapper(fz.open([n for n in fz.namelist() if n.endswith("/foundation_food.csv")][0]), "utf8")))
ma = [n for n in fz.namelist() if n.endswith("/market_acquisition.csv")]
ma_rows = list(csv.DictReader(io.TextIOWrapper(fz.open(ma[0]), "utf8"))) if ma else []
s2, u2, b2 = get("https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_foundation_food_json_2026-10-29.zip")
jz = zipfile.ZipFile(io.BytesIO(b2))
fj = json.loads(jz.read(jz.namelist()[0]))
foods = fj.get("FoundationFoods", [])
pubs = sorted({f.get("publicationDate", "") for f in foods})
ff_ndb = {}
for f in foods:
    if f.get("ndbNumber"):
        ff_ndb[str(f["ndbNumber"])] = f
out["usda_foundation"] = {
    "csv_status": s, "csv_bytes": len(b), "csv_files": sorted(fcsv), "csv_has_food_csv": "food.csv" in fcsv,
    "csv_has_food_nutrient_csv": "food_nutrient.csv" in fcsv, "csv_foundation_food_rows": len(ff_rows),
    "csv_footnotes_nonempty": sum(1 for r in ff_rows if r["footnote"].strip()),
    "csv_market_acquisition_rows": len(ma_rows),
    "json_status": s2, "json_bytes": len(b2), "json_foods": len(foods),
    "json_foods_with_ndb": len(ff_ndb),
    "json_food_nutrients_total": sum(len(f.get("foodNutrients", [])) for f in foods),
    "json_newest_publication_date": max(pubs, key=lambda d: (d[-4:], d)) if pubs else None,
    "json_fields": sorted(foods[0].keys()) if foods else [],
    "ndb_also_in_sr_legacy": sum(1 for k in ff_ndb if k in sr_ndb),
}
ff_fdc_ids = {str(f["fdcId"]) for f in foods}

# ---------------- Health Canada CNF 2026 ----------------
s, u, b = get("https://open.canada.ca/data/api/3/action/package_show?id=1b6139bd-ed7e-4043-bc28-ff00e10f3109")
pkg = json.loads(b)["result"] if s == 200 else {}
out["cnf_package"] = {"status": s, "title": pkg.get("title_translated", {}).get("en") or pkg.get("title"),
                      "license_id": pkg.get("license_id"), "metadata_modified": pkg.get("metadata_modified"),
                      "resources": len(pkg.get("resources", []))}
s, u, b = get("https://open.canada.ca/data/dataset/1b6139bd-ed7e-4043-bc28-ff00e10f3109/resource/e1ffee62-58cb-4e3e-b359-115c658388ad/download/food_name.csv")
cnf = list(csv.DictReader(io.StringIO(b.decode("utf-8-sig", "replace"))))
dates = sorted(r["Food_Last_Updated_Date"] for r in cnf if r.get("Food_Last_Updated_Date"))
with_ndb = [r for r in cnf if r["USDA_NDB_Code"].strip()]
comments = [r for r in cnf if r["Comment_EN"].strip()]
out["cnf_2026"] = {"status": s, "bytes": len(b), "foods": len(cnf), "columns": list(cnf[0].keys()) if cnf else [],
                   "newest_food_last_updated": dates[-1] if dates else None,
                   "updated_in_2026": sum(1 for d in dates if d.startswith("2026")),
                   "with_usda_ndb_code": len(with_ndb), "with_comment_en": len(comments),
                   "comment_examples": [c["Comment_EN"][:160] for c in comments[:5]]}

# Join 1 (declared): CNF USDA_NDB_Code -> SR Legacy NDB_number, Foundation ndbNumber.
def ndbkey(x):
    x = x.strip()
    return str(int(float(x))) if re.fullmatch(r"\d+(\.0+)?", x) else x


m_sr = [r for r in with_ndb if ndbkey(r["USDA_NDB_Code"]) in sr_ndb]
m_ff = [r for r in with_ndb if ndbkey(r["USDA_NDB_Code"]) in ff_ndb]
sample = []
step = max(1, len(m_sr) // 20)
for r in m_sr[::step][:20]:
    sr = sr_food[sr_ndb[ndbkey(r["USDA_NDB_Code"])]]
    ratio = difflib.SequenceMatcher(None, norm(r["Food_Description_EN"]), norm(sr["description"])).ratio()
    sample.append({"cnf_food_code": r["Food_Code"], "usda_ndb": ndbkey(r["USDA_NDB_Code"]), "sr_fdc_id": sr["fdc_id"],
                   "cnf_description": r["Food_Description_EN"][:90], "sr_description": sr["description"][:90],
                   "desc_ratio": round(ratio, 2)})
out["join_cnf_ndb_to_sr_legacy"] = {"matched": len(m_sr), "total": len(with_ndb),
                                    "to_foundation_matched": len(m_ff),
                                    "sample_description_ratio_ge_0_6": sum(1 for x in sample if x["desc_ratio"] >= 0.6),
                                    "sample": sample}

# ---------------- FSANZ AFCD Release 3 ----------------
s, u, b = get("https://www.foodstandards.gov.au/science-data/food-nutrient-databases/afcd/data-files")
links = sorted(set(re.findall(r'href="([^"]+\.(?:xlsx|pdf))"', b.decode("utf8", "replace"))))
out["afcd_files_page"] = {"status": s, "files": [l.split("/")[-1] for l in links],
                          "page_last_updated": (re.search(r"Page last updated: (\d+ \w+ \d{4})", text(b)) or [None, None])[1]}
s, u, b = get("https://www.foodstandards.gov.au/sites/default/files/2025-12/AFCD%20Release%203%20-%20Food%20Details.xlsx")
rows = xlsx_rows(b, "Food details")
hi = next(i for i, r in enumerate(rows) if r and r[0] == "Public Food Key")
hdr = rows[hi]
afcd = [dict(zip(hdr, r)) for r in rows[hi + 1:] if r and r[0].strip()]
derivs = {}
for r in afcd:
    derivs[r.get("Derivation", "")] = derivs.get(r.get("Derivation", ""), 0) + 1
cites = []
for r in afcd:
    for m in re.finditer(r"FDC ID[s]?\s*(?:no\.?|number)?\s*:?\s*(\d{5,7})", r.get("Sampling Details", ""), re.I):
        cites.append((r["Public Food Key"], m.group(1)))
sd = [r for r in afcd if r.get("Sampling Details", "").strip()]
out["afcd_release3"] = {"status": s, "bytes": len(b), "foods": len(afcd), "columns": hdr,
                        "derivation_counts": derivs, "with_sampling_details": len(sd),
                        "sampling_details_mean_chars": round(sum(len(r["Sampling Details"]) for r in sd) / max(1, len(sd))),
                        "mentions_usda": sum(1 for r in sd if "USDA" in r["Sampling Details"]),
                        "foods_citing_fdc_id": len({k for k, _ in cites}), "fdc_id_citations": len(cites)}
# Join 2 (declared): AFCD cited FDC ID -> FDC fdc_id (SR Legacy or Foundation).
in_sr = [c for c in cites if c[1] in sr_fdc_ids]
in_ff = [c for c in cites if c[1] in ff_fdc_ids]
asample = []
afk = {r["Public Food Key"]: r for r in afcd}
for k, fid in in_sr[:: max(1, len(in_sr) // 20)][:20]:
    ratio = difflib.SequenceMatcher(None, norm(afk[k]["Food Name"]), norm(sr_food[fid]["description"])).ratio()
    asample.append({"afcd_key": k, "fdc_id": fid, "afcd_name": afk[k]["Food Name"][:90],
                    "sr_description": sr_food[fid]["description"][:90], "desc_ratio": round(ratio, 2)})
out["join_afcd_fdcid_to_fdc"] = {"matched_sr_legacy": len(in_sr), "matched_foundation": len(in_ff),
                                 "matched_either": len([c for c in cites if c[1] in sr_fdc_ids or c[1] in ff_fdc_ids]),
                                 "total_citations": len(cites), "unmatched_ids": sorted({c[1] for c in cites if c[1] not in sr_fdc_ids and c[1] not in ff_fdc_ids})[:20],
                                 "unmatched_ids_that_are_sr_ndb_numbers": sorted({c[1].lstrip("0") for c in cites if c[1] not in sr_fdc_ids and c[1] not in ff_fdc_ids and c[1].lstrip("0") in sr_ndb}),
                                 "sample": asample}

# ---------------- UK CoFID 2021 ----------------
s, u, b = get("https://assets.publishing.service.gov.uk/media/60538b91e90e07527df82ae4/McCance_Widdowsons_Composition_of_Foods_Integrated_Dataset_2021..xlsx")
rows = xlsx_rows(b, "1.3 Proximates")
hdr = rows[0]
cof = [dict(zip(hdr, r)) for r in rows[1:] if r and re.match(r"\d", r[0] or "")]
refs = [r for r in cof if r.get("Main data references", "").strip()]
out["uk_cofid_2021"] = {"status": s, "bytes": len(b), "foods": len(cof), "columns_first_12": hdr[:12],
                        "with_description": sum(1 for r in cof if r.get("Description", "").strip()),
                        "with_main_data_references": len(refs),
                        "references_citing_usda": sum(1 for r in refs if "USDA" in r["Main data references"] or "SR2" in r["Main data references"]),
                        "references_citing_ndb_number": sum(1 for r in refs if re.search(r"NDB|FDC ID", r["Main data references"])),
                        "with_footnote": sum(1 for r in cof if r.get("Footnote", "").strip()),
                        "examples": [{"code": r["Food Code"], "description": r.get("Description", "")[:80], "cites_usda": "USDA" in r["Main data references"]} for r in refs[:4]]}

# Join 3 (candidate): CoFID foods whose Main data references cite USDA SR -> best SR Legacy description match.
def toks(x):
    return " ".join(sorted(set(norm(x).split())))


sr_list = [(fid, toks(r["description"])) for fid, r in sr_food.items()]
cj = []
for r in refs:
    if "USDA" in r["Main data references"] or "SR2" in r["Main data references"]:
        q = toks(r["Food Name"])
        best = max(sr_list, key=lambda x: difflib.SequenceMatcher(None, q, x[1]).ratio())
        ratio = difflib.SequenceMatcher(None, q, best[1]).ratio()
        cj.append({"cofid_code": r["Food Code"], "cofid_name": r["Food Name"][:90], "sr_fdc_id": best[0],
                   "sr_description": sr_food[best[0]]["description"][:90], "ratio": round(ratio, 2)})
out["join_cofid_name_to_sr_legacy"] = {"cofid_rows_citing_usda": len(cj),
                                       "proposed_ratio_ge_0_6": sum(1 for x in cj if x["ratio"] >= 0.6), "pairs": cj}

# ---------------- ANSES CIQUAL, DTU Frida ----------------
s, u, b = get("https://www.data.gouv.fr/api/1/datasets/5369a15fa3a729239d2065b7/")
d = json.loads(b) if s == 200 else {}
out["ciqual"] = {"datagouv_status": s, "title": d.get("title"), "license": d.get("license"),
                 "last_modified": d.get("last_modified"), "resource_urls": [r["url"] for r in d.get("resources", [])][:4]}
s, u, b = get("https://ciqual.anses.fr/cms/sites/default/files/inline-files/XML_2020_07_07.zip")
out["ciqual"]["download_status"] = s
s, u, b = get("https://frida.fooddata.dk/")
out["frida"] = {"status": s, "final_url": u, "app_shell": b"Loading..." in b[:3000], "bytes": len(b)}

with open("fcomp_measure.json", "w") as f:
    json.dump(out, f, indent=1, ensure_ascii=False)
print(json.dumps({k: (v if not isinstance(v, dict) else {kk: vv for kk, vv in v.items() if kk not in ("sample", "examples", "columns", "json_fields")}) for k, v in out.items()}, indent=1, ensure_ascii=False)[:6000])
