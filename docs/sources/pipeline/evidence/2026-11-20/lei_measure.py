#!/usr/bin/env python3
"""Round 29 (2026-11-20) screening of the `legal-entity-registry` data type (prefix lei).

Re-fetches live, one request at a time: GLEIF API counts and a seeded sample of UK LEI records
validated at Companies House (RA000585); the Companies House Free Company Data Product (one
495 MB zip, streamed to a temporary file and deleted); SEC company_tickers.json, a seeded sample
of EDGAR submissions, GLEIF name lookups for them, and the newest 10-K of a few of them.
Writes lei_measure.json next to itself: counts, identifiers and organisation names only.
Sole-proprietor LEIs are never written. Stdlib only.
"""
import collections, csv, html, io, json, os, random, re, sys, tempfile, time, urllib.error, urllib.parse, urllib.request, zipfile

UA = "data-foundry-scout/1.0 (data@mail.proviciency.com)"
HERE = os.path.dirname(os.path.abspath(__file__))
N = 0
csv.field_size_limit(10**9)

def fetch(url, timeout=120, to=None):
    """One GET; a dropped connection or 5xx is retried up to 3 times with backoff."""
    global N
    for attempt in range(4):
        N += 1
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Encoding": "identity"})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                if to:
                    to.seek(0); to.truncate()
                    while True:
                        chunk = r.read(1 << 20)
                        if not chunk: break
                        to.write(chunk)
                    body = None
                else:
                    body = r.read()
            time.sleep(0.6)
            return body
        except urllib.error.HTTPError as ex:
            if ex.code < 500 or attempt == 3: raise
        except (urllib.error.URLError, ConnectionError, TimeoutError):
            if attempt == 3: raise
        time.sleep(5 * (attempt + 1))

def gleif(params):
    q = "&".join(f"{urllib.parse.quote(k)}={urllib.parse.quote(str(v))}" for k, v in params.items())
    return json.loads(fetch("https://api.gleif.org/api/v1/lei-records?" + q))

def total(**flt):
    p = {f"filter[{k}]": v for k, v in flt.items()}
    p["page[size]"] = 1
    return gleif(p)["meta"]["pagination"]["total"]

def norm(name):
    s = re.sub(r"[^A-Z0-9 ]", " ", name.upper().replace("&", " AND "))
    s = re.sub(r"\s/[A-Z]{2,3}/?$", "", s)
    toks = [t for t in s.split() if t not in {"THE"}]
    alias = {"CORPORATION": "CORP", "INCORPORATED": "INC", "COMPANY": "CO", "LIMITED": "LTD"}
    return " ".join(alias.get(t, t) for t in toks)

out = {"run_date": "2026-11-20"}

# ---- 1. GLEIF ----
first = gleif({"page[size]": 1})
g = {"golden_copy_publish_date": first["meta"]["goldenCopy"]["publishDate"], "total_lei_records": first["meta"]["pagination"]["total"]}
g["by_entity_status"] = {s: total(**{"entity.status": s}) for s in ("ACTIVE", "INACTIVE")}
g["by_registration_status"] = {s: total(**{"registration.status": s}) for s in ("ISSUED", "LAPSED", "RETIRED", "MERGED", "ANNULLED", "DUPLICATE", "PENDING_TRANSFER", "PENDING_ARCHIVAL")}
g["by_entity_category"] = {s: total(**{"entity.category": s}) for s in ("GENERAL", "FUND", "BRANCH", "SOLE_PROPRIETOR", "RESIDENT_GOVERNMENT_ENTITY", "INTERNATIONAL_ORGANIZATION")}
g["by_jurisdiction_sample"] = {s: total(**{"entity.jurisdiction": s}) for s in ("US", "GB", "DE", "IN", "IT", "NL", "FR", "ES", "CA", "AU")}
pub = json.loads(fetch("https://goldencopy.gleif.org/api/v2/golden-copies/publishes/latest"))["data"]
g["golden_copy_files"] = {k: {"records": pub[k]["full_file"]["csv"]["record_count"], "csv_zip_bytes": pub[k]["full_file"]["csv"]["size"]} for k in ("lei2", "rr", "repex") if k in pub}
g["golden_copy_delta_types"] = sorted(pub["lei2"].get("delta_files", {}))
ra = json.loads(fetch("https://api.gleif.org/api/v1/registration-authorities?page%5Bsize%5D=1"))
g["registration_authorities"] = ra["meta"]["pagination"]["total"]
g["registered_at_RA000585_companies_house"] = total(**{"entity.registeredAt": "RA000585"})
g["validated_at_RA000585_companies_house"] = total(**{"registration.validatedAt": "RA000585"})
out["gleif"] = g

# seeded sample of RA000585 records: 3 pages of 200
random.seed(20261120)
pages_total = g["registered_at_RA000585_companies_house"] // 200
# the API refuses deep pagination beyond 10,000 results, so pages are drawn from the first 50
pages = sorted(random.sample(range(1, 51), 3))
sample = []
skipped_sole = 0
for p in pages:
    d = gleif({"filter[entity.registeredAt]": "RA000585", "page[size]": 200, "page[number]": p})
    for rec in d["data"]:
        a = rec["attributes"]; e = a["entity"]
        if e["category"] == "SOLE_PROPRIETOR":
            skipped_sole += 1
            continue
        sample.append({"lei": a["lei"], "registered_as": e["registeredAs"], "entity_status": e["status"], "registration_status": a["registration"]["status"],
                       "category": e["category"], "corroboration": a["registration"]["corroborationLevel"], "legal_name": e["legalName"]["name"]})
out["gleif_uk_sample"] = {"pages_of_200": pages, "records": len(sample), "sole_proprietor_records_skipped": skipped_sole,
                          "by_entity_status": dict(collections.Counter(s["entity_status"] for s in sample)),
                          "by_registration_status": dict(collections.Counter(s["registration_status"] for s in sample)),
                          "by_category": dict(collections.Counter(s["category"] or "none" for s in sample))}

# ---- 2. Companies House Free Company Data Product ----
page = fetch("https://download.companieshouse.gov.uk/en_output.html").decode("utf-8", "replace")
one = re.search(r'BasicCompanyDataAsOneFile-(\d{4}-\d{2}-\d{2})\.zip', page).group(0)
parts = re.findall(r'BasicCompanyData-\d{4}-\d{2}-\d{2}-part\d+_\d+\.zip', page)
ch = {"snapshot_file": one, "multi_part_files": len(set(parts)), "page_last_updated": (re.search(r"Last Updated:\s*([0-9/]+)", re.sub(r"<[^>]+>", " ", page)) or [None, None])[1]}
numbers = {}
status = collections.Counter(); cat = collections.Counter(); country = collections.Counter()
newest_inc = ""; rows = 0; short_rows = 0; with_sic = 0; with_prev = 0
with tempfile.NamedTemporaryFile(suffix=".zip") as tmp:
    fetch("https://download.companieshouse.gov.uk/" + one, timeout=1800, to=tmp)
    tmp.flush()
    ch["zip_bytes"] = os.path.getsize(tmp.name)
    with zipfile.ZipFile(tmp.name) as z:
        info = z.infolist()[0]
        ch["csv_bytes"] = info.file_size
        with z.open(info) as f:
            rd = csv.reader(io.TextIOWrapper(f, encoding="utf-8", errors="replace"))
            header = [h.strip() for h in next(rd)]
            ix = {h: i for i, h in enumerate(header)}
            ch["columns"] = len(header)
            for r in rd:
                if len(r) < len(header):
                    short_rows += 1
                    continue
                rows += 1
                num = r[ix["CompanyNumber"]].strip()
                st = r[ix["CompanyStatus"]]
                numbers[num] = (st, r[ix["CompanyName"]].strip())
                status[st] += 1; cat[r[ix["CompanyCategory"]]] += 1; country[r[ix["CountryOfOrigin"]]] += 1
                d = r[ix["IncorporationDate"]]
                if len(d) == 10:
                    iso = d[6:] + "-" + d[3:5] + "-" + d[:2]
                    if iso > newest_inc: newest_inc = iso
                if r[ix["SICCode.SicText_1"]].strip() and not r[ix["SICCode.SicText_1"]].startswith("None"): with_sic += 1
                if r[ix["PreviousName_1.CompanyName"]].strip(): with_prev += 1
ch.update({"rows": rows, "rows_skipped_as_short": short_rows, "distinct_company_numbers": len(numbers), "by_status": dict(status.most_common()), "by_category": dict(cat.most_common(8)),
           "countries_of_origin": len(country), "newest_incorporation_date": newest_inc, "rows_with_sic_text": with_sic, "rows_with_previous_name": with_prev,
           "column_names": header})
out["companies_house"] = ch

def chnum(v):
    v = (v or "").strip().upper().replace(" ", "")
    return v.zfill(8) if v.isdigit() else (v[:2] + v[2:].zfill(6) if re.fullmatch(r"[A-Z]{2}\d+", v) else v)

hit = []; miss = []; same_name = 0
for s in sample:
    n = chnum(s["registered_as"])
    if n in numbers:
        hit.append(s)
        if norm(numbers[n][1]) == norm(s["legal_name"]): same_name += 1
    else:
        miss.append(s)
active = [s for s in sample if s["entity_status"] == "ACTIVE"]
out["join_gleif_companies_house"] = {
    "sampled_gleif_records": len(sample), "resolved_in_bulk_file": len(hit),
    "active_entities_sampled": len(active), "active_entities_resolved": sum(1 for s in active if chnum(s["registered_as"]) in numbers),
    "inactive_entities_sampled": len(sample) - len(active), "inactive_entities_resolved": sum(1 for s in sample if s["entity_status"] != "ACTIVE" and chnum(s["registered_as"]) in numbers),
    "resolved_with_same_normalised_legal_name": same_name,
    "resolved_companies_house_status": dict(collections.Counter(numbers[chnum(s["registered_as"])][0] for s in hit)),
    "unresolved_by_entity_status": dict(collections.Counter(s["entity_status"] for s in miss)),
    "unresolved_examples": [{"lei": s["lei"], "registered_as": s["registered_as"], "entity_status": s["entity_status"]} for s in miss[:10]],
    "resolved_identifiers": [[s["lei"], chnum(s["registered_as"])] for s in hit],
    "note": "the bulk file lists live companies only, so dissolved companies cannot resolve",
}
del numbers

# ---- 3. SEC EDGAR ----
tick = json.loads(fetch("https://www.sec.gov/files/company_tickers.json"))
ciks = sorted({v["cik_str"] for v in tick.values()})
sec = {"ticker_rows": len(tick), "distinct_ciks": len(ciks)}
random.seed(20261120)
pick = random.sample(ciks, 60)
subs = []
for c in pick:
    d = json.loads(fetch(f"https://data.sec.gov/submissions/CIK{c:010d}.json"))
    biz = (d.get("addresses") or {}).get("business") or {}
    rec = d["filings"]["recent"]
    tenk = next(((rec["accessionNumber"][i], rec["primaryDocument"][i], rec["filingDate"][i]) for i, f in enumerate(rec["form"]) if f == "10-K"), None)
    subs.append({"cik": c, "name": d["name"], "entity_type": d.get("entityType"), "sic": d.get("sic"), "sic_description": d.get("sicDescription"),
                 "state_of_incorporation": d.get("stateOfIncorporation"), "business_city": biz.get("city"), "business_state": biz.get("stateOrCountry"),
                 "lei_field": d.get("lei"), "description_chars": len(d.get("description") or ""), "ein_present": bool(d.get("ein")),
                 "former_names": len(d.get("formerNames") or []), "newest_filing": max(rec["filingDate"]) if rec["filingDate"] else None, "tenk": tenk})
sec["sampled_submissions"] = len(subs)
sec["with_lei_field_populated"] = sum(1 for s in subs if s["lei_field"])
sec["with_description_populated"] = sum(1 for s in subs if s["description_chars"])
sec["with_sic"] = sum(1 for s in subs if s["sic"])
sec["with_ein"] = sum(1 for s in subs if s["ein_present"])
sec["with_state_of_incorporation"] = sum(1 for s in subs if s["state_of_incorporation"])
sec["with_10k_in_recent_filings"] = sum(1 for s in subs if s["tenk"])
sec["by_entity_type"] = dict(collections.Counter(s["entity_type"] for s in subs))
sec["newest_filing_date_in_sample"] = max(s["newest_filing"] for s in subs if s["newest_filing"])
out["sec"] = sec

# candidate join: normalised SEC conformed name equals a GLEIF legal name returned by the legalName filter
pairs = []; nohit = []
for s in subs:
    q = re.sub(r"\s*/[A-Za-z]{2,3}/?\s*$", "", s["name"])
    d = gleif({"filter[entity.legalName]": q, "page[size]": 10})
    cands = [r["attributes"] for r in d["data"] if r["attributes"]["entity"]["category"] != "SOLE_PROPRIETOR" and norm(r["attributes"]["entity"]["legalName"]["name"]) == norm(q)]
    if cands:
        for a in cands[:3]:
            e = a["entity"]
            pairs.append({"cik": s["cik"], "sec_name": s["name"], "sec_state_of_incorporation": s["state_of_incorporation"], "sec_business_city": s["business_city"], "sec_business_state": s["business_state"],
                          "lei": a["lei"], "gleif_legal_name": e["legalName"]["name"], "gleif_jurisdiction": e["jurisdiction"], "gleif_hq_city": e["headquartersAddress"]["city"],
                          "gleif_hq_region": e["headquartersAddress"]["region"], "gleif_entity_status": e["status"], "candidates_for_this_cik": len(cands)})
    else:
        nohit.append(s["cik"])
out["join_sec_gleif_name"] = {"sec_entities_sampled": len(subs), "sec_entities_with_a_normalised_name_match": len({p["cik"] for p in pairs}),
                              "pairs": pairs, "ciks_without_match": nohit}

# free text: the newest 10-K of up to 15 sampled filers
docs = []
for s in [x for x in subs if x["tenk"]][:15]:
    acc, doc, date = s["tenk"]
    url = f"https://www.sec.gov/Archives/edgar/data/{s['cik']}/{acc.replace('-', '')}/{doc}"
    try:
        raw = fetch(url, timeout=180).decode("utf-8", "replace")
    except Exception as ex:
        docs.append({"cik": s["cik"], "accession": acc, "error": type(ex).__name__}); continue
    t = re.sub(r"(?s)<(script|style)[^>]*>.*?</\1>", " ", raw)
    t = re.sub(r"(?s)<ix:header>.*?</ix:header>", " ", t)
    t = re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", t))).replace("\xa0", " ")
    starts = [m.start() for m in re.finditer(r"(?i)\bItem\s*1\s*[\.\:\-—–]?\s*Business\b", t)]
    best = 0
    for st in starts:
        m = re.search(r"(?i)\bItem\s*1A\s*[\.\:\-—–]?\s*Risk\s+Factors\b|\bItem\s*2\s*[\.\:\-—–]?\s*Properties\b", t[st + 50:])
        if m: best = max(best, m.start() + 50)
    docs.append({"cik": s["cik"], "accession": acc, "filing_date": date, "document_text_chars": len(t), "item_1_business_chars": best})
ok = [d for d in docs if d.get("item_1_business_chars", 0) >= 1000]
lens = sorted(d["item_1_business_chars"] for d in ok)
out["sec_10k_business_text"] = {"documents_fetched": len([d for d in docs if "error" not in d]), "with_item_1_business_section_of_1000_chars_or_more": len(ok),
                                "median_item_1_chars": lens[len(lens) // 2] if lens else None, "documents": docs}
for s in subs: s.pop("tenk", None)
out["sec_sample"] = subs
out["requests"] = N
json.dump(out, open(os.path.join(HERE, "lei_measure.json"), "w"), indent=1, sort_keys=True)
brief = {k: v for k, v in out.items() if k not in ("sec_sample",)}
brief["join_gleif_companies_house"] = {k: v for k, v in out["join_gleif_companies_house"].items() if k != "resolved_identifiers"}
brief["companies_house"] = {k: v for k, v in ch.items() if k != "column_names"}
print(json.dumps(brief, indent=1)[:14000])
