#!/usr/bin/env python3
"""Screening 2026-11-15: geographical-indications. Fetches every source live (stdlib only).
Run from this directory with: python3 -I gi_measure.py   -> writes gi_measure.json
Output holds register identifiers, protected names (public register entries), counts and field lists only.
Control-authority and producer-group contact fields (address, email, phone) are counted, never written.

Members:
  EU eAmbrosia API (DG AGRI), webgate.ec.europa.eu/eambrosia-api: structured register + specification attachments.
  UK GI schemes (Defra), GOV.UK search + content API: structured metadata + product specification PDFs.
  WIPO Lisbon Express, lisbon-express.wipo.int/api/v1: appellations of origin / GIs with prose area, legal basis.
  New Zealand GI register (IPONZ), xlsx export.
  Swiss BLW GUB/GGA geodata layers (api3.geo.admin.ch).
Joins (all name-based, so mode candidate; pairs are written for hand-checking):
  UK entries carrying an EU registration date -> eAmbrosia by normalised name; then the same EU registration date.
  Lisbon AO -> eAmbrosia by normalised name + same origin country.
  NZ (Part 4 EU FTA) -> eAmbrosia by normalised name + same country.
"""
import json, re, time, unicodedata, urllib.request, urllib.parse, zipfile, io, html as H
import xml.etree.ElementTree as ET

UA = "data-foundry-scout/1.0 (data@mail.proviciency.com)"
out = {"run_date": time.strftime("%Y-%m-%d")}


def get(u, tries=3, data=None, timeout=300):
    for i in range(tries):
        try:
            r = urllib.request.Request(u, data=data, headers={"User-Agent": UA, "Accept-Encoding": "identity"})
            with urllib.request.urlopen(r, timeout=timeout) as f:
                return f.status, f.geturl(), f.headers.get("Content-Type", ""), f.read()
        except urllib.error.HTTPError as e:
            if e.code >= 500 and i < tries - 1:
                time.sleep(15)
                continue
            return e.code, u, e.headers.get("Content-Type", ""), e.read()
        except Exception as e:
            if i == tries - 1:
                return 0, u, "", str(e).encode()
            time.sleep(5)


def norm(s):
    s = unicodedata.normalize("NFKD", s or "")
    s = "".join(c for c in s if not unicodedata.combining(c)).lower()
    return re.sub(r"[^a-z0-9]+", "", s)


def names_of(s):
    """A register name often joins language versions with ' / '."""
    parts = [p.strip() for p in re.split(r"\s+/\s+|/\s+|\s+/", s or "") if p.strip()]
    return {norm(p) for p in parts + [s or ""] if norm(p)}


def dmy(s):  # eAmbrosia "21-10-2011" -> "2011-10-21"
    m = re.fullmatch(r"(\d{2})-(\d{2})-(\d{4})", s or "")
    return f"{m.group(3)}-{m.group(2)}-{m.group(1)}" if m else None


# ---------------------------------------------------------------- 1. EU eAmbrosia
eu = []
s, u, ct, b = get("https://webgate.ec.europa.eu/eambrosia-api/")
out["eu_api_doc"] = {"status": s, "version": (re.findall(r"Version:\s*([\d.]+)", b.decode("utf8", "replace")) or [None])[0]}
page, total_pages = 0, 1
while page < total_pages:
    s, u, ct, b = get(f"https://webgate.ec.europa.eu/eambrosia-api/api/geographical-indications?size=1000&page={page}")
    if s != 200:
        out.setdefault("eu_errors", []).append({"page": page, "status": s})
        break
    d = json.loads(b)
    total_pages = d["totalPages"]
    out["eu_total_elements"] = d["totalElements"]
    eu += d["content"]
    page += 1
    time.sleep(2)
out["eu_records_fetched"] = len(eu)
if eu:
    from collections import Counter
    out["eu_fields"] = sorted(eu[0].keys())
    out["eu_registration_fields"] = sorted((eu[0].get("registration") or {}).keys())
    out["eu_by_product_type"] = dict(Counter(x.get("productType") for x in eu))
    out["eu_by_gi_type"] = dict(Counter(x.get("giType") for x in eu))
    out["eu_by_status"] = dict(Counter((x.get("registration") or {}).get("status") for x in eu))
    out["eu_third_country"] = sum(1 for x in eu if x.get("thirdCountry"))
    out["eu_top_countries"] = Counter((x.get("countries") or [None])[0] for x in eu).most_common(15)
    out["eu_with_file_number"] = sum(1 for x in eu if (x.get("registration") or {}).get("fileNumber"))
    out["eu_file_number_examples"] = [x["registration"]["fileNumber"] for x in eu[:5] if x.get("registration")]
    out["eu_with_spec_document"] = sum(1 for x in eu if (x.get("registration") or {}).get("document"))
    out["eu_with_amendments"] = sum(1 for x in eu if x.get("amendment"))
    out["eu_with_cn_code"] = sum(1 for x in eu if x.get("cnClassification"))
    out["eu_newest_modification"] = max(x.get("modificationDateTime") or "" for x in eu)
    out["eu_control_authority_with_email_or_phone"] = sum(
        1 for x in eu for c in (x.get("controlAuthority") or []) if c.get("email") or c.get("phone"))
    out["eu_recognised_producer_entries"] = sum(1 for x in eu if x.get("recognisedProducer"))
    # one specification attachment: is it a PDF (free text)?
    doc = next(((x["registration"]["document"][0]) for x in eu if (x.get("registration") or {}).get("document")), None)
    if doc:
        s, u, ct, b = get(doc["uri"], timeout=120)
        out["eu_spec_attachment_sample"] = {"name": doc["text"], "status": s, "content_type": ct, "bytes": len(b),
                                            "is_pdf": b[:5] == b"%PDF-"}
eu_by_name = {}
for x in eu:
    for n in (x.get("protectedNames") or []) + (x.get("transcriptions") or []):
        for k in names_of(n):
            eu_by_name.setdefault(k, []).append(x)

# ---------------------------------------------------------------- 2. UK GI schemes on GOV.UK
uk = []
F = "title,link,registered_name,country_of_origin,status,protection_type,register,date_registration,date_registration_eu,class_category,reason_for_protection,date_application,public_timestamp"
start = 0
while True:
    s, u, ct, b = get(f"https://www.gov.uk/api/search.json?filter_format=protected_food_drink_name&count=1000&start={start}&fields={F}")
    if s != 200:
        out["uk_error"] = s
        break
    d = json.loads(b)
    uk += d["results"]
    out["uk_total"] = d["total"]
    start += 1000
    if start >= d["total"]:
        break
    time.sleep(1)
from collections import Counter
out["uk_fetched"] = len(uk)
out["uk_by_status"] = dict(Counter(r.get("status") for r in uk))
out["uk_by_register"] = dict(Counter(r.get("register") for r in uk))
out["uk_by_reason"] = dict(Counter(r.get("reason_for_protection") for r in uk))
out["uk_with_eu_registration_date"] = sum(1 for r in uk if r.get("date_registration_eu"))
out["uk_newest_public_timestamp"] = max(r.get("public_timestamp") or "" for r in uk)
out["uk_metadata_fields"] = F.split(",")
# content API sample: product specification PDFs and change-history notes (free text)
samp = {}
for slug in ["english-whisky-slash-english-whiskey", "cornish-clotted-cream", "roquefort", "scotch-whisky"]:
    s, u, ct, b = get(f"https://www.gov.uk/api/content/protected-food-drink-names/{slug}")
    if s == 200:
        d = json.loads(b)
        det = d.get("details", {})
        samp[slug] = {"status": s, "attachments": [a.get("content_type") for a in det.get("attachments", [])],
                      "spec_pdf_links_in_body": len(re.findall(r"assets\.publishing\.service\.gov\.uk/media/[^\"]+\.pdf", det.get("body", ""))),
                      "change_history_notes": len(det.get("change_history", [])),
                      "metadata_keys": sorted(det.get("metadata", {}).keys())}
    else:
        samp[slug] = {"status": s}
    time.sleep(1)
out["uk_content_samples"] = samp
out["uk_eu_file_number_in_metadata"] = any("file" in k for v in samp.values() for k in v.get("metadata_keys", []))

# Join UK -> EU by name, then EU registration date equality
uk_eu = [r for r in uk if r.get("date_registration_eu")]
pairs, matched, date_eq = [], 0, 0
for r in uk_eu:
    cands = {id(x): x for k in names_of(r.get("registered_name") or r.get("title")) for x in eu_by_name.get(k, [])}
    if cands:
        matched += 1
        same = [x for x in cands.values() if dmy((x.get("registration") or {}).get("registrationDate")) == r["date_registration_eu"]]
        if same:
            date_eq += 1
        x = (same or list(cands.values()))[0]
        pairs.append({"uk_link": r["link"], "uk_name": r.get("registered_name"), "uk_country": r.get("country_of_origin"),
                      "uk_type": r.get("protection_type"), "uk_class": r.get("class_category"), "uk_date_registration_eu": r["date_registration_eu"],
                      "eu_gi": x["giIdentifier"], "eu_file_number": (x.get("registration") or {}).get("fileNumber"),
                      "eu_names": x.get("protectedNames"), "eu_country": x.get("countries"), "eu_type": x.get("giType"),
                      "eu_product_type": x.get("productType"), "eu_registration_date": dmy((x.get("registration") or {}).get("registrationDate")),
                      "same_eu_date": bool(same), "eu_candidates": len(cands)})
out["join_uk_to_eu"] = {"uk_entries_with_eu_date": len(uk_eu), "name_matched": matched, "name_and_eu_date_equal": date_eq}
step = max(1, len(pairs) // 20)
out["join_uk_to_eu_sample_pairs"] = pairs[::step][:20]

# ---------------------------------------------------------------- 3. WIPO Lisbon Express
lis, off = [], 0
s, u, ct, b = get("https://lisbon-express.wipo.int/api/v1/import-info")
out["lisbon_import_info"] = json.loads(b).get("response") if s == 200 else {"status": s}
if s == 200 and out["lisbon_import_info"].get("lastUpdated"):
    out["lisbon_last_updated_utc"] = time.strftime("%Y-%m-%d", time.gmtime(out["lisbon_import_info"]["lastUpdated"] / 1000))
while True:
    s, u, ct, b = get(f"https://lisbon-express.wipo.int/api/v1/search?offset={off}&limit=500&keywords=*&searchType=ANY&sortBy=key")
    if s != 200:
        out["lisbon_error"] = s
        break
    d = json.loads(b)
    recs = [r["_source"] for r in d.get("records", [])]
    lis += recs
    out["lisbon_total"] = d.get("total")
    off += 500
    if not recs or off >= d.get("total", 0):
        break
    time.sleep(2)
out["lisbon_fetched"] = len(lis)
if lis:
    out["lisbon_fields"] = sorted(lis[0].keys())
    out["lisbon_by_kind"] = dict(Counter(r.get("kind") for r in lis))
    out["lisbon_by_origin"] = Counter((r.get("contractingPartyOrigin") or {}).get("code") for r in lis).most_common(15)
    out["lisbon_with_area_text"] = sum(1 for r in lis if (r.get("areagr") or {}).get("contents_en"))
    out["lisbon_with_legal_basis_text"] = sum(1 for r in lis if (r.get("legalar") or {}).get("contents_en"))
    out["lisbon_with_refusals"] = sum(1 for r in lis if (r.get("refusal") or {}).get("contents"))
    out["lisbon_with_current_info_pdf"] = sum(1 for r in lis if (r.get("current_info_doc") or {}).get("doc"))
    out["lisbon_area_text_median_chars"] = sorted(len((r.get("areagr") or {}).get("contents_en") or "") for r in lis)[len(lis) // 2]
    out["lisbon_eu_file_number_cited"] = sum(1 for r in lis if re.search(r"\b(PDO|PGI)-[A-Z]{2}-[A-Z]?\d{3,5}\b", json.dumps(r)))
    out["lisbon_newest_pubdate"] = max(r.get("pubdate") or "" for r in lis)
lp, lm = [], 0
for r in lis:
    cc = ((r.get("contractingPartyOrigin") or {}).get("code") or "").lower()
    nm = (r.get("name") or {}).get("contents") or []
    keys = {k for n in nm for k in names_of(n)}
    c = {id(x): x for k in keys for x in eu_by_name.get(k, []) if cc in (x.get("countries") or [])}
    if c:
        lm += 1
        x = list(c.values())[0]
        lp.append({"lisbon_no": (r.get("number") or {}).get("contents"), "lisbon_name": nm, "lisbon_origin": cc,
                   "lisbon_product": (r.get("productgr") or {}).get("contents_en"), "lisbon_date": (r.get("registration") or {}).get("date", {}).get("contents"),
                   "eu_gi": x["giIdentifier"], "eu_file_number": (x.get("registration") or {}).get("fileNumber"),
                   "eu_names": x.get("protectedNames"), "eu_product_type": x.get("productType"), "eu_type": x.get("giType"),
                   "eu_cn": [c2.get("cnText") for c2 in (x.get("cnClassification") or [])]})
eu_origin = {"at", "be", "bg", "hr", "cy", "cz", "dk", "ee", "fi", "fr", "de", "gr", "hu", "ie", "it", "lv", "lt", "lu", "mt", "nl", "pl", "pt", "ro", "sk", "si", "es", "se"}
out["join_lisbon_to_eu"] = {"lisbon_records": len(lis),
                            "lisbon_records_from_eu_states": sum(1 for r in lis if ((r.get("contractingPartyOrigin") or {}).get("code") or "").lower() in eu_origin),
                            "matched_name_and_country": lm}
step = max(1, len(lp) // 20)
out["join_lisbon_to_eu_sample_pairs"] = lp[::step][:20]
# Declared: Lisbon "Legal basis" prose (EU as Contracting Party, Geneva Act) cites the EU file number, e.g. "PDO-ES-0087".
eu_files = {(x.get("registration") or {}).get("fileNumber"): x for x in eu}
FN = re.compile(r"\b(?:PDO|PGI)-[A-Z]{2}-[A-Z]?\d{3,5}\b")
cited, found, same_name, dp = 0, 0, 0, []
for r in lis:
    fns = FN.findall(json.dumps(r.get("legalar") or {}))
    if not fns:
        continue
    cited += 1
    fn = fns[0]
    x = eu_files.get(fn)
    if x:
        found += 1
        nm = {k for n in (r.get("name") or {}).get("contents") or [] for k in names_of(n)}
        ek = {k for n in (x.get("protectedNames") or []) + (x.get("transcriptions") or []) for k in names_of(n)}
        same_name += bool(nm & ek)
    if len(dp) < 20 and len(dp) < cited:
        dp.append({"lisbon_no": (r.get("number") or {}).get("contents"), "lisbon_origin": (r.get("contractingPartyOrigin") or {}).get("code"),
                   "lisbon_name": (r.get("name") or {}).get("contents"), "cited_eu_file_number": fn,
                   "eu_gi": x["giIdentifier"] if x else None, "eu_names": x.get("protectedNames") if x else None})
out["join_lisbon_cited_eu_file_number"] = {"lisbon_records_citing_eu_file_number": cited, "cited_number_exists_in_eambrosia": found,
                                           "of_which_same_normalised_name": same_name,
                                           "by_origin": dict(Counter((r.get("contractingPartyOrigin") or {}).get("code") for r in lis if FN.search(json.dumps(r.get("legalar") or {}))))}
out["join_lisbon_cited_eu_file_number_sample"] = dp[::max(1, len(dp) // 20)][:20]

# ---------------------------------------------------------------- 4. New Zealand IPONZ GI register (xlsx export)
s, u, ct, b = get("https://www.iponz.govt.nz/get-ip/geographical-indications/register/downloadExport")
out["nz_export"] = {"status": s, "content_type": ct, "bytes": len(b)}
nz = []
if s == 200 and b[:2] == b"PK":
    z = zipfile.ZipFile(io.BytesIO(b))
    M = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
    ss = ["".join(t.text or "" for t in si.iter(M + "t")) for si in ET.fromstring(z.read("xl/sharedStrings.xml")).findall(M + "si")]
    rows = []
    for r in ET.fromstring(z.read("xl/worksheets/sheet1.xml")).iter(M + "row"):
        row = {}
        for c in r.findall(M + "c"):
            col = re.match(r"[A-Z]+", c.get("r")).group(0)
            v = c.find(M + "v")
            row[col] = ss[int(v.text)] if c.get("t") == "s" and v is not None else (v.text if v is not None else "")
        rows.append(row)
    hi = next(i for i, r in enumerate(rows) if r.get("A") == "IP Number")
    hdr = rows[hi]
    for r in rows[hi + 1:]:
        if (r.get("A") or "").isdigit():
            nz.append({hdr[k]: v for k, v in r.items() if k in hdr})
    out["nz_header"] = list(hdr.values())
out["nz_rows"] = len(nz)
out["nz_by_category"] = dict(Counter(r.get("Category") for r in nz))
out["nz_by_type"] = dict(Counter(r.get("Type") for r in nz))
out["nz_by_status"] = dict(Counter(r.get("Status") for r in nz))
xl = [float(r["Last Modified"]) for r in nz if re.fullmatch(r"[\d.]+", r.get("Last Modified") or "")]
if xl:
    out["nz_newest_last_modified"] = time.strftime("%Y-%m-%d", time.gmtime((max(xl) - 25569) * 86400))
CN = {"France": "fr", "Italy": "it", "Spain": "es", "Portugal": "pt", "Greece": "gr", "Germany": "de", "Austria": "at",
      "Hungary": "hu", "Czechia": "cz", "Slovakia": "sk", "Slovenia": "si", "Croatia": "hr", "Bulgaria": "bg", "Romania": "ro",
      "Cyprus": "cy", "Poland": "pl", "Belgium": "be", "Netherlands": "nl", "Luxembourg": "lu", "Ireland": "ie", "Denmark": "dk",
      "Sweden": "se", "Finland": "fi", "Lithuania": "lt", "Latvia": "lv", "Estonia": "ee", "Malta": "mt"}
nzp, nzm = [], 0
nz_eu = [r for r in nz if r.get("Primary Country") in CN]
for r in nz_eu:
    cc = CN[r["Primary Country"]]
    c = {id(x): x for k in names_of(r.get("GI Name")) for x in eu_by_name.get(k, []) if cc in (x.get("countries") or [])}
    if c:
        nzm += 1
        x = list(c.values())[0]
        nzp.append({"nz_ip_number": r.get("IP Number"), "nz_name": r.get("GI Name"), "nz_country": r.get("Primary Country"),
                    "nz_type": r.get("Type"), "nz_class": r.get("Product Class"), "eu_gi": x["giIdentifier"],
                    "eu_file_number": (x.get("registration") or {}).get("fileNumber"), "eu_names": x.get("protectedNames"),
                    "eu_product_type": x.get("productType"), "eu_type": x.get("giType")})
out["join_nz_to_eu"] = {"nz_rows_with_eu_primary_country": len(nz_eu), "matched_name_and_country": nzm}
step = max(1, len(nzp) // 20)
out["join_nz_to_eu_sample_pairs"] = nzp[::step][:20]

# ---------------------------------------------------------------- 5. Swiss BLW GUB/GGA geodata layers
ch = {}
for lyr in ["kaese", "fleisch", "pflanzen", "spirituosen", "konditoreiwaren"]:
    q = f"https://api3.geo.admin.ch/rest/services/api/MapServer/find?layer=ch.blw.ursprungsbezeichnungen-{lyr}&searchField=objektcode&searchText=1&contains=true&returnGeometry=false"
    s, u, ct, b = get(q)
    try:
        res = json.loads(b).get("results", [])
    except Exception:
        res = []
    ch[lyr] = {"status": s, "features_with_code_containing_1": len(res),
               "distinct_names": len({r["attributes"].get("objekt_d") for r in res}),
               "attribute_fields": sorted(res[0]["attributes"].keys()) if res else []}
    time.sleep(1)
out["ch_blw_layers"] = ch
s, u, ct, b = get("https://ckan.opendata.swiss/api/3/action/package_search?q=Ursprungsbezeichnungen")
try:
    out["ch_opendata_packages"] = [(p["name"], p.get("modified") or p.get("metadata_modified")) for p in json.loads(b)["result"]["results"]]
except Exception:
    out["ch_opendata_packages"] = {"status": s}

# ---------------------------------------------------------------- 6. other registers: reachability only
other = {}
for k, url in [("wine_australia_register", "https://www.wineaustralia.com/labelling/register-of-protected-gis-and-other-terms"),
               ("ipindia_gi_registry", "https://search.ipindia.gov.in/GIRPublic/Application/Status"),
               ("uspto_gi_page", "https://www.uspto.gov/ip-policy/trademark-policy/geographical-indications-gi-protection-us"),
               ("cipo_gi_list", "https://ised-isde.canada.ca/site/canadian-intellectual-property-office/en/trademarks/geographical-indications/list-geographical-indications"),
               ("wipo_global_brand_db_gi", "https://branddb.wipo.int/branddb/en/?type=ao")]:
    s, u, ct, b = get(url, tries=1, timeout=60)
    t = b.decode("utf8", "replace")
    other[k] = {"status": s, "final_url": u, "altcha_or_captcha": bool(re.search(r"altcha|captcha", t, re.I)),
                "register_pdf_links": re.findall(r'href="([^"]*Register[^"]*\.pdf)"', t)[:3]}
    time.sleep(1)
out["other_registers"] = other

json.dump(out, open("gi_measure.json", "w"), indent=1, ensure_ascii=False)
print(json.dumps({k: v for k, v in out.items() if not k.endswith("pairs")}, indent=1, ensure_ascii=False)[:6000])
