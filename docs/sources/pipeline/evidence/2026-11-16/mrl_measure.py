#!/usr/bin/env python3
"""Screening 2026-11-16: pesticide-residue-limits (MRL / tolerance). Fetches every source live (stdlib only).
Run from this directory with: python3 -I mrl_measure.py   -> writes mrl_measure.json (hand-check pairs included; verdicts in mrl_handcheck.json)
Output holds substance names, commodity names, limits, legal citations, CAS numbers and counts only (no personal data).

Members:
  EU Pesticides Database (DG SANTE): MRL XML publications (8 files) + active-substance search, backend/api.
  US 40 CFR part 180 via the eCFR versioner API: one section per pesticide, prose residue definition + commodity/ppm tables.
  Health Canada PMRA: MRL extract (CSV) + active-ingredient extract (CSV, CAS numbers), pesticide-registry-api.
  FSANZ Schedule 20 (Australia New Zealand Food Standards Code) via the Federal Register of Legislation API (docx).
  Codex Alimentarius pesticide index (codex.fao.org): reachability + FAO terms only (non-commercial terms -> parked).
Joins:
  declared: CAS number cited in an eCFR section's text = PMRA active-ingredient CAS number (then PMRA ingredient -> HC MRL chemical).
  candidate: normalised active-substance name, eCFR <-> EU, FSANZ <-> EU, Health Canada <-> EU (pairs written for hand-check).
"""
import json, re, time, gzip, io, csv, zipfile, random, html as H, collections, urllib.request, urllib.error
import xml.etree.ElementTree as ET

UA = "data-foundry-scout/1.0 (data@mail.proviciency.com)"
out = {"run_date": time.strftime("%Y-%m-%d")}
NREQ = [0]


def get(u, data=None, ctype=None, gz=False, timeout=180, tries=2):
    for i in range(tries):
        NREQ[0] += 1
        h = {"User-Agent": UA, "Accept": "*/*"}
        if ctype:
            h["Content-Type"] = ctype
        if gz:
            h["Accept-Encoding"] = "gzip"
        try:
            with urllib.request.urlopen(urllib.request.Request(u, data=data, headers=h), timeout=timeout) as f:
                b = f.read()
                if f.headers.get("Content-Encoding") == "gzip" or b[:2] == b"\x1f\x8b":
                    b = gzip.decompress(b)
                return f.status, f.headers.get("Content-Type", ""), b
        except urllib.error.HTTPError as e:
            if e.code >= 500 and i < tries - 1:
                time.sleep(10)
                continue
            return e.code, e.headers.get("Content-Type", ""), e.read()
        except Exception as e:
            if i == tries - 1:
                return 0, "", str(e).encode()
            time.sleep(5)


def text(b):
    t = re.sub(r"<script.*?</script>|<style.*?</style>", " ", b.decode("utf8", "replace"), flags=re.S)
    return re.sub(r"\s+", " ", H.unescape(re.sub(r"<[^>]+>", " ", t)))


MARK = re.compile(r"\((?:F|R|A|L|\+|F\)\s*\(R)\)", re.I)


def norm(s):
    s = H.unescape(s or "").lower()
    s = MARK.sub(" ", s)
    s = re.split(r";|\s\(|,\s|\s-\s", s.strip())[0]
    return re.sub(r"[^a-z0-9]+", "", s)


def num(s):
    m = re.search(r"\d+(?:\.\d+)?", s or "")
    return float(m.group()) if m else None


CASNUM = re.compile(r"\b(\d{2,7}-\d{2}-\d)\b")


def cas_ok(c):  # CAS check digit
    d = c.replace("-", "")
    return sum(int(x) * (i + 1) for i, x in enumerate(reversed(d[:-1]))) % 10 == int(d[-1])


def cas_in(body):
    t = H.unescape(body)
    return sorted({c for c in CASNUM.findall(t) if cas_ok(c)}) if "CAS" in t else []

# ---------------------------------------------------------------- 1. EU Pesticides Database
B = "https://ec.europa.eu/food/plant/pesticides/eu-pesticides-database/backend/api"
s, ct, b = get(B + "/mrl/download")
out["eu_download_list"] = {"status": s, "files": json.loads(b) if s == 200 else None}
eu = {}  # pest_res_id -> {name, entry_force, regulation, products: [(code,name,mrl,appdate)]}
eu_rows = eu_ft = 0
eu_appdates = []
for f in (out["eu_download_list"]["files"] or []):
    s, ct, b = get(B + "/mrl/download/link?filename=" + f["file"], timeout=300)
    if s != 200:
        out.setdefault("eu_errors", []).append({"file": f["file"], "status": s})
        continue
    root = ET.fromstring(b)
    for sub in root.iter("Substances"):
        rid = (sub.findtext("Pest_res_id") or "").strip()
        rec = eu.setdefault(rid, {"name": (sub.findtext("Name") or "").strip(), "entry_force": sub.findtext("entry_force"), "regulation": sub.findtext("directive"), "products": []})
        for p in sub.findall("Product"):
            eu_rows += 1
            if p.find("MRL_ft") is not None:
                eu_ft += 1
            ad = p.findtext("ApplicationDate") or ""
            m = re.fullmatch(r"(\d{2})/(\d{2})/(\d{4})", ad.strip())
            if m:
                eu_appdates.append(f"{m.group(3)}-{m.group(2)}-{m.group(1)}")
            rec["products"].append(((p.findtext("Product_code") or "").strip(), (p.findtext("Product_name") or "").strip(), (p.findtext("MRL") or "").strip(), ad.strip()))
    time.sleep(2)
out["eu_residue_definitions"] = len(eu)
out["eu_mrl_rows"] = eu_rows
out["eu_rows_with_mrl_footnote_text"] = eu_ft
out["eu_newest_application_date_le_run"] = max([d for d in eu_appdates if d <= out["run_date"]], default=None)
out["eu_future_application_dates"] = sum(1 for d in eu_appdates if d > out["run_date"])
out["eu_distinct_product_codes"] = len({p[0] for r in eu.values() for p in r["products"]})
out["eu_regulations_cited"] = len({r["regulation"] for r in eu.values()})
out["eu_sample"] = [{"pest_res_id": k, "name": v["name"], "regulation": v["regulation"], "entry_force": v["entry_force"], "first_product": v["products"][0] if v["products"] else None} for k, v in list(eu.items())[:3]]
s, ct, b = get(B + "/active_substance/search", data=json.dumps({k: [] for k in "type status legislation authorisedIn hazardClass classification approvalFrom approvalTo expiryFrom expiryTo cfs adi_from adi_to arfd_from arfd_to aoel_from aoel_to aaoel_from aaoel_to".split()}).encode(), ctype="application/json")
if s == 200:
    asp = json.loads(b)["payload"]
    out["eu_active_substances"] = {"count": len(asp), "by_status": dict(collections.Counter(x["AS_STATUS"] for x in asp)), "fields": sorted(asp[0].keys()), "has_cas_field": any("CAS" in k for k in asp[0])}
else:
    out["eu_active_substances"] = {"status": s}
s, ct, b = get(B + "/active_substance/details/548")  # Chlorpyrifos
if s == 200:
    d = json.loads(b)["payload"]
    out["eu_details_sample"] = {"basicDetails_fields": sorted(d["basicDetails"][0].keys()), "ECHA_ID": d["basicDetails"][0].get("ECHA_ID"), "status": d["basicDetails"][0].get("AS_STATUS"), "mrl_legislation_rows": len(d.get("mrl") or [])}
# the datalake API that carries CAS numbers
s, ct, b = get("https://api.datalake.sante.service.ec.europa.eu/sante/pesticides/active-substances?format=json&SUBSTANCE_NAME=Chlorpyrifos&api-version=v3.0", timeout=90)
out["eu_datalake_api_v3_probe"] = {"status": s, "body": b[:160].decode("utf8", "replace")}

# ---------------------------------------------------------------- 2. US eCFR 40 CFR part 180
s, ct, b = get("https://www.ecfr.gov/api/versioner/v1/titles.json")
t40 = [t for t in json.loads(b)["titles"] if t["number"] == 40][0]
out["us_title40"] = t40
s, ct, b = get("https://www.ecfr.gov/api/versioner/v1/versions/title-40.json?part=180")
vers = json.loads(b)["content_versions"]
vm = json.loads(b)["meta"]
out["us_part180_versions"] = {"result_count": vm.get("result_count"), "latest_amendment_date": vm.get("latest_amendment_date"), "first_page_oldest": min(v["amendment_date"] for v in vers)}
s, ct, b = get(f"https://www.ecfr.gov/api/versioner/v1/full/{t40['up_to_date_as_of']}/title-40.xml?part=180", gz=True, timeout=300)
x = b.decode("utf8")
secs = re.findall(r'<DIV8 N="(180\.\d+)" TYPE="SECTION".*?<HEAD>(.*?)</HEAD>(.*?)</DIV8>', x, re.S)
us = {}
cas_secs = {}
for n, h, body in secs:
    head = re.sub(r"<[^>]+>", "", H.unescape(h)).replace("§", "").strip()
    head = re.sub(r"^\s*180\.\d+\s+", "", head)
    if cas_in(body):
        cas_secs[n] = cas_in(body)
    if "olerance" not in head or "xempt" in head:
        continue
    chem = head.split(";")[0].strip()
    rows = []
    for tb in re.findall(r"<TBODY>(.*?)</TBODY>", body, re.S):
        for tr in re.findall(r"<TR>(.*?)</TR>", tb, re.S):
            tds = [re.sub(r"\s+", " ", H.unescape(re.sub(r"<[^>]+>", "", c))).strip() for c in re.findall(r"<TD[^>]*>(.*?)</TD>", tr, re.S)]
            if len(tds) >= 2 and num(tds[1]) is not None:
                rows.append(tds)
    cas = cas_in(body)
    cita = re.findall(r"<CITA[^>]*>(.*?)</CITA>", body, re.S)
    us[n] = {"chemical": chem, "rows": rows, "cas": cas, "fr_citations": len(re.findall(r"\d+ FR \d+", " ".join(cita)))}
out["us_sections_total"] = len(secs)
out["us_tolerance_sections"] = len(us)
out["us_tolerance_rows"] = sum(len(v["rows"]) for v in us.values())
out["us_sections_citing_cas"] = len(cas_secs)
out["us_tolerance_sections_citing_cas"] = sum(1 for n in cas_secs if n in us)
out["us_distinct_cas_cited"] = len({c for cs in cas_secs.values() for c in cs})
out["us_sections_with_expiration_column"] = sum(1 for n, h, body in secs if re.search(r"<TH[^>]*>\s*Expiration", body))
out["us_sample"] = {k: {"chemical": us[k]["chemical"], "rows": len(us[k]["rows"]), "cas": us[k]["cas"]} for k in ["180.342", "180.589"] if k in us}

# ---------------------------------------------------------------- 3. Health Canada (PMRA) MRL + ingredient extracts
HC = "https://pest-control.canada.ca/pesticide-registry-api/api/extract/"
s, ct, b = get(HC + "mrl", timeout=300)
hc_rows = list(csv.DictReader(io.StringIO(b.decode("cp1252"))))
out["ca_mrl_extract"] = {"status": s, "rows": len(hc_rows), "columns": list(hc_rows[0].keys()) if hc_rows else None, "chemicals": len({r["Chemical Common Name"] for r in hc_rows})}
dates = []
for r in hc_rows:
    for d in re.findall(r"\((\d{1,2} [A-Z][a-z]+ \d{4})\)", r.get("Established Via") or ""):
        try:
            dates.append(time.strftime("%Y-%m-%d", time.strptime(d, "%d %B %Y")))
        except ValueError:
            pass
out["ca_mrl_newest_established_date"] = max(dates) if dates else None
out["ca_mrl_rows_with_dated_basis"] = len(dates)
out["ca_mrl_basis_kinds"] = dict(collections.Counter(re.sub(r"[\d\s()]+.*$", "", (r.get("Established Via") or "")[:22]).strip() or "?" for r in hc_rows).most_common(6))
time.sleep(2)
s, ct, b = get(HC + "ingredient", timeout=300)
ing = list(csv.reader(io.StringIO(b.decode("cp1252"))))
ing_hdr, ing = ing[0], ing[1:]
ci = ing_hdr.index("CAS number")
cas2ing = collections.defaultdict(set)
for r in ing:
    for c in re.findall(r"\d{2,7}-\d{2}-\d", r[ci] or ""):
        cas2ing[c].add(r[0])
out["ca_ingredient_extract"] = {"status": s, "rows": len(ing), "columns": ing_hdr, "with_cas": sum(1 for r in ing if re.search(r"\d{2,7}-\d{2}-\d", r[ci] or ""))}
hc_chem = collections.defaultdict(list)
for r in hc_rows:
    hc_chem[norm(r["Chemical Common Name"])].append(r)
ing_norm = {norm(r[0]) for r in ing}
out["ca_mrl_chemicals_found_in_ingredient_list"] = f"{sum(1 for k in hc_chem if k in ing_norm)}/{len(hc_chem)}"

# ---------------------------------------------------------------- 4. FSANZ Schedule 20 (Federal Register of Legislation)
L = "https://api.prod.legislation.gov.au/v1/"
s, ct, b = get(L + "versions?$filter=titleId%20eq%20'F2015L00468'&$orderby=start%20desc&$top=1")
v = json.loads(b)["value"][0]
out["au_latest_version"] = {k: v[k] for k in ("registerId", "start", "registeredAt", "compilationNumber", "status")}
out["au_latest_amended_by"] = [r["affectedByTitle"]["titleId"] for r in v.get("reasons", []) if r.get("affectedByTitle")]
s, ct, b = get(L + "titles?$filter=contains(name,'Schedule%2020')&$count=true&$top=1")
out["au_schedule20_titles_incl_variations"] = json.loads(b).get("@odata.count")
s, ct, b = get(L + "documents/find(titleid='F2015L00468',asatspecification='Latest',type='Primary',format='Word',uniqueTypeNumber=0,volumeNumber=0,rectificationVersionNumber=0)", timeout=300)
docx = zipfile.ZipFile(io.BytesIO(b)).read("word/document.xml").decode("utf8")
paras = [H.unescape("".join(re.findall(r"<w:t[^>]*>([^<]*)</w:t>", p))).strip() for p in re.findall(r"<w:p[ >].*?</w:p>", docx, re.S)]
au = {}
cur = None
for i, p in enumerate(paras):
    m = re.match(r"Agvet chemical:\s*(.+)", p)
    if m:
        cur = m.group(1).strip()
        au[cur] = {"residue": None, "rows": []}
        continue
    if cur and p.startswith("Permitted residue"):
        au[cur]["residue"] = p.split(":", 1)[-1].strip()
        continue
    if cur and re.fullmatch(r"T?\*?\d+(?:\.\d+)?", p) and i and paras[i - 1] and not re.fullmatch(r"T?\*?\d+(?:\.\d+)?", paras[i - 1]):
        au[cur]["rows"].append((paras[i - 1], p))
out["au_docx_bytes"] = len(b)
out["au_agvet_chemicals"] = len(au)
out["au_mrl_rows"] = sum(len(a["rows"]) for a in au.values())
out["au_temporary_T_rows"] = sum(1 for a in au.values() for r in a["rows"] if r[1].startswith("T"))

# ---------------------------------------------------------------- 5. Codex (reachability + terms) -- parked
s, ct, b = get("https://codex.fao.org/codex-texts/codex-online-databases/pesticides-residues/pesticide-index")
idx = re.findall(r'pestId=([0-9a-f-]+)"[^>]*>\s*([^<]+?)\s*</a>', b.decode("utf8", "replace"))
out["codex_pesticide_index"] = {"status": s, "pesticides": len(idx)}
s, ct, b = get("https://www.fao.org/contact-us/terms/en/")
ft = text(b)
q = "may be copied, printed and downloaded for private study, research and teaching purposes, and for use in non-commercial products or services"
out["codex_fao_terms"] = {"status": s, "non_commercial_quote_present": q in ft}

# ---------------------------------------------------------------- 6. other terms checks
terms = {
    "https://commission.europa.eu/legal-notice_en": "This means that reuse is allowed, provided appropriate credit is given and changes are indicated.",
    "https://www.govinfo.gov/about/policies": "Copyright protection under this title is not available for any work of the United States Government",
    "https://open.canada.ca/en/open-government-licence-canada": "The Information Provider grants you a worldwide, royalty-free, perpetual, non-exclusive licence to use the Information, including for commercial purposes, subject to the terms below.",
}
out["terms_checks"] = {}
for u, q in terms.items():
    s, ct, b = get(u)
    out["terms_checks"][u] = {"status": s, "quote_present": q in text(b)}
s, ct, b = get("https://data.europa.eu/api/hub/search/datasets/pesticides")
if s == 200:
    d = json.loads(b).get("result", {})
    out["eu_data_europa_distribution_licences"] = sorted({(x.get("license") or {}).get("id", "") for x in d.get("distributions", [])})

# ---------------------------------------------------------------- 7. joins
# declared: eCFR CAS -> PMRA ingredient CAS
matched = {n: [c for c in cs if c in cas2ing] for n, cs in cas_secs.items()}
hit = [n for n, cs in matched.items() if cs]
to_mrl = [n for n in hit if any(norm(i) in hc_chem for c in matched[n] for i in cas2ing[c])]
allcas = sorted({c for cs in cas_secs.values() for c in cs})
out["join_us_cas_to_ca_ingredient_cas_by_section"] = f"{len(hit)}/{len(cas_secs)}"
out["join_us_cas_to_ca_ingredient_cas_by_cas"] = f"{sum(1 for c in allcas if c in cas2ing)}/{len(allcas)}"
out["join_us_cas_to_ca_mrl_chemical_by_section"] = f"{len(to_mrl)}/{len(cas_secs)}"
out["join_us_tolerance_sections_cas_to_ca"] = f"{sum(1 for n in hit if n in us)}/{sum(1 for n in cas_secs if n in us)}"
out["join_us_tolerance_sections_cas_to_ca_mrl_chemical"] = f"{sum(1 for n in to_mrl if n in us)}/{sum(1 for n in cas_secs if n in us)}"
out["us_tolerance_sections_citing_cas_list"] = {n: {"chemical": us[n]["chemical"], "cas": cas_secs[n]} for n in cas_secs if n in us}
out["join_us_cas_examples"] = [{"cfr": n, "us_chemical": us[n]["chemical"] if n in us else "(exemption section)", "cas": matched[n], "pmra_ingredient": sorted(i for c in matched[n] for i in cas2ing[c])} for n in hit[:12]]

eun = collections.defaultdict(list)
for rid, r in eu.items():
    eun[norm(r["name"])].append(rid)
usn = collections.defaultdict(list)
for n, r in us.items():
    usn[norm(r["chemical"])].append(n)
aun = {norm(k): k for k in au}
out["join_us_name_to_eu"] = f"{sum(1 for k in usn if k in eun)}/{len(usn)} distinct eCFR tolerance chemicals"
out["join_au_name_to_eu"] = f"{sum(1 for k in aun if k in eun)}/{len(aun)} FSANZ agvet chemicals"
out["join_ca_name_to_eu"] = f"{sum(1 for k in hc_chem if k in eun)}/{len(hc_chem)} Health Canada MRL chemicals"
out["join_au_name_to_us"] = f"{sum(1 for k in aun if k in usn)}/{len(aun)} FSANZ agvet chemicals"
# a 4-jurisdiction substance: present in all
four = sorted(k for k in usn if k in eun and k in aun and k in hc_chem)
out["substances_in_all_four"] = len(four)

# worked example: chlorpyrifos on apples
ex = {}
k = "chlorpyrifos"
ex["US 40 CFR " + usn[k][0]] = [r for r in us[usn[k][0]]["rows"] if r[0].lower().startswith("apple")]
ex["EU pest_res_id " + eun[k][0]] = [p for p in eu[eun[k][0]]["products"] if p[1].lower() == "apples"]
ex["CA Health Canada"] = [[r["Food Commodity"], r["MRL Value (ppm)"], r["Established Via"]] for r in hc_chem.get(k, []) if "apple" in r["Food Commodity"].lower()]
ak = aun.get(k)
ex["AU FSANZ Schedule 20"] = [r for r in au[ak]["rows"] if "pome" in r[0].lower() or "apple" in r[0].lower()] if ak else None
out["example_chlorpyrifos_apples"] = ex

rnd = random.Random(20261116)
pairs = []
for label, src in (("us-eu", [(usn[k][0], us[usn[k][0]]["chemical"], eun[k][0], eu[eun[k][0]]["name"]) for k in usn if k in eun]),
                   ("au-eu", [(aun[k], aun[k], eun[k][0], eu[eun[k][0]]["name"]) for k in aun if k in eun]),
                   ("ca-eu", [(k, hc_chem[k][0]["Chemical Common Name"], eun[k][0], eu[eun[k][0]]["name"]) for k in hc_chem if k in eun])):
    for a_id, a_name, e_id, e_name in rnd.sample(src, min(20, len(src))):
        pairs.append({"join": label, "a_id": a_id, "a_name": a_name, "eu_pest_res_id": e_id, "eu_name": e_name})
out["handcheck_pairs"] = pairs  # verdicts in mrl_handcheck.json
out["requests"] = NREQ[0]
json.dump(out, open("mrl_measure.json", "w"), indent=1, ensure_ascii=False)
print(json.dumps({k: v for k, v in out.items() if k.startswith("join") or k.startswith("us_tol")}, indent=1, ensure_ascii=False))
