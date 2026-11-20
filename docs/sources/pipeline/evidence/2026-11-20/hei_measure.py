#!/usr/bin/env python3
"""Round 29 (2026-11-20) screening of `higher-education-institutions` (prefix hei).

Re-fetches live, one request at a time: NCES IPEDS HD2024 (directory) and IC2024, HEAD of the
IPEDS Access databases (mission-statement table), the College Scorecard institution file, the
newest ROR data dump on Zenodo, the Office for Students register download and two Wikidata
SPARQL queries (P1771 IPEDS ID, P6782 ROR ID, P4971 UKPRN). Writes hei_measure.json next to
itself. Stdlib only. Names of people (IPEDS CHFNM/CHFTITLE) and e-mail addresses are never read
into the output; committed samples hold identifiers, institution names and counts only.
"""
import collections, csv, html, io, json, os, random, re, time, urllib.error, urllib.parse, urllib.request, zipfile

UA = "data-foundry-scout/1.0 (data@mail.proviciency.com)"
HERE = os.path.dirname(os.path.abspath(__file__))
N = 0
csv.field_size_limit(10**9)


def fetch(url, method="GET", accept="*/*", timeout=600):
    global N
    N += 1
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": accept}, method=method)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        body = r.read() if method == "GET" else b""
        headers = dict(r.headers)
    time.sleep(0.7)
    return body, headers


def norm(name):
    s = name.lower().replace("&", " and ")
    s = re.sub(r"[^a-z0-9 ]", " ", s)
    s = re.sub(r"\b(the|of|at|in|and)\b", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def domain(url):
    u = (url or "").strip().lower()
    if not u:
        return ""
    if "//" not in u:
        u = "http://" + u
    host = urllib.parse.urlparse(u).hostname or ""
    return host[4:] if host.startswith("www.") else host


out = {"run_date": "2026-11-20"}

# 1. IPEDS HD2024 (directory information) and IC2024 (institutional characteristics)
body, hdr = fetch("https://nces.ed.gov/ipeds/datacenter/data/HD2024.zip")
z = zipfile.ZipFile(io.BytesIO(body))
member = z.namelist()[0]
hd = list(csv.DictReader(io.TextIOWrapper(z.open(member), encoding="utf-8-sig", errors="replace")))
hd_by = {r["UNITID"].strip(): r for r in hd}
CONTROL = {"1": "public", "2": "private not-for-profit", "3": "private for-profit", "-3": "not available"}
ICLEVEL = {"1": "four or more years", "2": "at least 2 but less than 4 years", "3": "less than 2 years", "-3": "not available"}
out["ipeds_hd"] = {
    "file": member, "zip_bytes": len(body), "last_modified": hdr.get("Last-Modified"),
    "member_date": "%04d-%02d-%02d" % z.infolist()[0].date_time[:3],
    "rows": len(hd), "distinct_unitid": len(hd_by), "fields": len(hd[0]),
    "by_control": dict(collections.Counter(CONTROL.get(r["CONTROL"].strip(), r["CONTROL"]) for r in hd).most_common()),
    "by_level": dict(collections.Counter(ICLEVEL.get(r["ICLEVEL"].strip(), r["ICLEVEL"]) for r in hd).most_common()),
    "currently_active": sum(1 for r in hd if r["CYACTIVE"].strip() == "1"),
    "degree_granting": sum(1 for r in hd if r["DEGGRANT"].strip() == "1"),
    "with_opeid": sum(1 for r in hd if r["OPEID"].strip() not in ("", "-2", "-1")),
    "with_ein": sum(1 for r in hd if r["EIN"].strip() not in ("", "-2", "-1")),
    "with_uei": sum(1 for r in hd if r["UEIS"].strip() not in ("", "-2", "-1")),
    "with_web_address": sum(1 for r in hd if r["WEBADDR"].strip()),
    "with_coordinates": sum(1 for r in hd if r["LATITUDE"].strip() not in ("", "0")),
    "states_and_territories": len({r["STABBR"] for r in hd}),
    "person_fields_not_read": ["CHFNM", "CHFTITLE"],
}
body, hdr = fetch("https://nces.ed.gov/ipeds/datacenter/data/IC2024.zip")
z = zipfile.ZipFile(io.BytesIO(body))
ic = list(csv.DictReader(io.TextIOWrapper(z.open(z.namelist()[0]), encoding="utf-8-sig", errors="replace")))
out["ipeds_ic"] = {"file": z.namelist()[0], "rows": len(ic), "unitid_in_hd": sum(1 for r in ic if r["UNITID"].strip() in hd_by)}

# 2. Mission statements live only in the Access database (table ICyyyymission): size by HEAD, not parsed here.
out["ipeds_access_databases"] = {}
for label, url in (("2024-25 provisional", "https://nces.ed.gov/ipeds/tablefiles/zipfiles/IPEDS_2024-25_Provisional.zip"),
                   ("2023-24 final", "https://nces.ed.gov/ipeds/tablefiles/zipfiles/IPEDS_2023-24_Final.zip")):
    _, hdr = fetch(url, method="HEAD")
    out["ipeds_access_databases"][label] = {"url": url, "content_length": int(hdr.get("Content-Length", 0)), "last_modified": hdr.get("Last-Modified")}
out["ipeds_access_databases"]["mission_table"] = (
    "not parsed: the mission statement text and URL (table IC2023mission in IPEDS202324.accdb, documented in "
    "IPEDS202324Tablesdoc.xlsx: 'Mission statements provided manually are limited to 2,000 characters or less') are "
    "published only inside the Access database; no Access reader was available in the scout session, so the share of "
    "institutions with mission text was not measured")

# 3. College Scorecard, most recent institution-level file (link read from the data page)
page, _ = fetch("https://collegescorecard.ed.gov/data/")
page = page.decode("utf-8", "replace")
sc_url = re.search(r'https://[^"]*Most-Recent-Cohorts-Institution[^"]*\.zip', page).group(0)
text = re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", page)))
upd = re.search(r"last updated ([A-Z][a-z]+ \d{1,2}, \d{4})", text)
body, hdr = fetch(sc_url)
z = zipfile.ZipFile(io.BytesIO(body))
name = [n for n in z.namelist() if n.endswith(".csv") and not n.startswith("__")][0]
rd = csv.reader(io.TextIOWrapper(z.open(name), encoding="utf-8-sig", errors="replace"))
head = next(rd)
ix = {c: head.index(c) for c in ("UNITID", "OPEID", "INSTNM", "STABBR", "ACCREDAGENCY", "INSTURL", "MAIN")}
sc = {}
for row in rd:
    sc[row[ix["UNITID"]].strip()] = {k: row[i].strip() for k, i in ix.items()}
both = [u for u in sc if u in hd_by]
out["scorecard"] = {
    "url": sc_url, "zip_bytes": len(body), "page_last_updated": upd.group(1) if upd else None,
    "rows": len(sc), "columns": len(head),
    "with_accrediting_agency": sum(1 for v in sc.values() if v["ACCREDAGENCY"] not in ("", "NULL", "NA")),
    "distinct_accrediting_agencies": len({v["ACCREDAGENCY"] for v in sc.values() if v["ACCREDAGENCY"] not in ("", "NULL", "NA")}),
    "main_campus_rows": sum(1 for v in sc.values() if v["MAIN"] == "1"),
}
out["join_scorecard_unitid_ipeds"] = {
    "scorecard_unitids": len(sc), "in_ipeds_hd2024": len(both), "ipeds_hd_rows_in_scorecard": len(both), "ipeds_hd_rows": len(hd_by),
    "same_opeid_8_digits": sum(1 for u in both if sc[u]["OPEID"].zfill(8) == hd_by[u]["OPEID"].strip().zfill(8)),
    "same_state": sum(1 for u in both if sc[u]["STABBR"] == hd_by[u]["STABBR"]),
    "sample_unmatched_scorecard_unitids": sorted(u for u in sc if u not in hd_by)[:20],
}

# 4. ROR data dump (newest record of the ror-data Zenodo community)
meta, _ = fetch("https://zenodo.org/api/records?communities=ror-data&sort=mostrecent&size=1", accept="application/json")
hit = json.loads(meta)["hits"]["hits"][0]
f = hit["files"][0]
body, _ = fetch(f["links"]["self"])
z = zipfile.ZipFile(io.BytesIO(body))
csv_name = [n for n in z.namelist() if n.endswith(".csv")][0]
ror = {}
for r in csv.DictReader(io.TextIOWrapper(z.open(csv_name), encoding="utf-8")):
    ror[r["id"].rsplit("/", 1)[-1]] = r
del body
us_edu = {k: r for k, r in ror.items() if r["locations.geonames_details.country_code"] == "US" and "education" in r["types"]}
out["ror"] = {
    "zenodo_record": hit["links"].get("self_html") or hit["links"]["self"], "title": hit["metadata"]["title"],
    "publication_date": hit["metadata"]["publication_date"], "licence": hit["metadata"].get("license", {}).get("id"),
    "file": f["key"], "zip_bytes": f["size"], "releases_in_community": json.loads(meta)["hits"]["total"],
    "records": len(ror), "by_status": dict(collections.Counter(r["status"] for r in ror.values()).most_common()),
    "type_education": sum(1 for r in ror.values() if "education" in r["types"]),
    "us_education": len(us_edu), "gb_education": sum(1 for r in ror.values() if r["locations.geonames_details.country_code"] == "GB" and "education" in r["types"]),
    "countries": len({r["locations.geonames_details.country_code"] for r in ror.values()}),
    "with_wikidata_id": sum(1 for r in ror.values() if r["external_ids.type.wikidata.all"].strip()),
    "with_isni": sum(1 for r in ror.values() if r["external_ids.type.isni.all"].strip()),
    "with_website": sum(1 for r in ror.values() if r["links.type.website"].strip()),
    "newest_last_modified": max(r["admin.last_modified.date"] for r in ror.values()),
    "external_id_types_in_csv": sorted({c.split(".")[2] for c in next(iter(ror.values())) if c.startswith("external_ids.type.")}),
}

# 5. Office for Students register (England)
body, hdr = fetch("https://register-api.officeforstudents.org.uk/api/Download")
z = zipfile.ZipFile(io.BytesIO(body))
ss = [html.unescape(re.sub(r"<[^>]+>", "", m)) for m in re.findall(r"<si>(.*?)</si>", z.read("xl/sharedStrings.xml").decode("utf-8"), re.S)]
sheets = re.findall(r'<sheet [^>]*name="([^"]+)"', z.read("xl/workbook.xml").decode("utf-8"))


def sheet_rows(path):
    rows = []
    for row in re.findall(r"<row [^>]*>(.*?)</row>", z.read(path).decode("utf-8"), re.S):
        cells = {}
        for ref, attrs, inner in re.findall(r'<c r="([A-Z]+)\d+"([^>]*?)(?:/>|>(.*?)</c>)', row, re.S):
            v = re.search(r"<v>(.*?)</v>", inner or "", re.S)
            if v is None:
                continue
            cells[ref] = ss[int(v.group(1))] if 't="s"' in attrs else html.unescape(v.group(1))
        rows.append(cells)
    return rows


reg = sheet_rows("xl/worksheets/sheet1.xml")
hrow = next(i for i, r in enumerate(reg) if any("UKPRN" in str(v) for v in r.values()))
cols = {v.strip(): k for k, v in reg[hrow].items()}
col = lambda needle: next(k for name, k in cols.items() if needle in name)
c_ukprn, c_name, c_cat, c_dap, c_title = col("UKPRN"), col("legal name"), col("Category"), col("degree awarding powers held"), col("right to use")
cond_cols = [k for name, k in cols.items() if "Specific condition" in name]
prov = [r for r in reg[hrow + 1:] if re.fullmatch(r"\d{8}", str(r.get(c_ukprn, "")).strip())]
ofs = {r[c_ukprn].strip(): r for r in prov}
cond_text = [str(r.get(k, "")) for r in prov for k in cond_cols if str(r.get(k, "")).strip() and not str(r.get(k, "")).strip().lower().startswith(("none", "not applicable", "n/a"))]
out["ofs_register"] = {
    "xlsx_bytes": len(body), "sheets": sheets, "columns": len(cols), "providers": len(prov), "distinct_ukprn": len(ofs),
    "by_category": dict(collections.Counter(str(r.get(c_cat, "")).strip()[:60] for r in prov).most_common()),
    "by_degree_awarding_powers": dict(collections.Counter(str(r.get(c_dap, "")).strip()[:60] for r in prov).most_common(8)),
    "with_university_title": sum(1 for r in prov if str(r.get(c_title, "")).strip().lower().startswith("yes")),
    "providers_with_specific_condition_text": sum(1 for r in prov if any(str(r.get(k, "")).strip() and not str(r.get(k, "")).strip().lower().startswith(("none", "not applicable", "n/a")) for k in cond_cols)),
    "specific_condition_cells": len(cond_text), "specific_condition_characters": sum(len(t) for t in cond_text),
    "other_sheet_rows": {sheets[i]: max(0, len(sheet_rows("xl/worksheets/sheet%d.xml" % (i + 1))) - 1) for i in range(1, len(sheets))},
    "contact_fields_not_read": ["Provider's email address", "Provider's contact address"],
}

# 6. Wikidata: items with an IPEDS ID (P1771), their ROR ID (P6782); items with a UKPRN (P4971) and ROR ID


def sparql(q):
    # The query service announced a limit of one request a minute on 2026-11-20: wait and retry on HTTP 429.
    for attempt in range(8):
        try:
            body, _ = fetch("https://query.wikidata.org/sparql?" + urllib.parse.urlencode({"query": q}), accept="application/sparql-results+json", timeout=120)
            break
        except urllib.error.HTTPError as e:
            if e.code != 429 or attempt == 7:
                raise
            time.sleep(70)
    time.sleep(65)
    return [{k: v["value"] for k, v in b.items()} for b in json.loads(body)["results"]["bindings"]]


wd_ipeds = sparql("SELECT ?i ?u ?r WHERE { ?i wdt:P1771 ?u . OPTIONAL { ?i wdt:P6782 ?r } }")
wd_ukprn = sparql("SELECT ?i ?k ?r WHERE { ?i wdt:P4971 ?k . OPTIONAL { ?i wdt:P6782 ?r } }")
unit_vals = {b["u"].strip() for b in wd_ipeds}
items = collections.defaultdict(lambda: {"u": set(), "r": set()})
for b in wd_ipeds:
    q = b["i"].rsplit("/", 1)[-1]
    items[q]["u"].add(b["u"].strip())
    if b.get("r"):
        items[q]["r"].add(b["r"].strip())
pairs = sorted({(u, r) for it in items.values() for u in it["u"] for r in it["r"]})
ror_cited = {r for it in items.values() for r in it["r"]}
good = [(u, r) for u, r in pairs if u in hd_by and r in ror]
unit_to_ror = collections.defaultdict(set)
ror_to_unit = collections.defaultdict(set)
for u, r in good:
    unit_to_ror[u].add(r)
    ror_to_unit[r].add(u)
out["wikidata"] = {
    "items_with_ipeds_id": len(items), "distinct_ipeds_ids": len(unit_vals),
    "items_with_ipeds_id_and_ror_id": sum(1 for it in items.values() if it["r"]),
    "items_with_more_than_one_ipeds_id": sum(1 for it in items.values() if len(it["u"]) > 1),
    "items_with_ukprn": len({b["i"] for b in wd_ukprn}), "distinct_ukprn": len({b["k"].strip() for b in wd_ukprn}),
    "items_with_ukprn_and_ror_id": len({b["i"] for b in wd_ukprn if b.get("r")}),
}
out["join_wikidata_ipeds_id"] = {"distinct_ipeds_ids_in_wikidata": len(unit_vals), "resolve_in_ipeds_hd2024": sum(1 for u in unit_vals if u in hd_by),
                                 "ipeds_hd_rows_named_by_wikidata": sum(1 for u in hd_by if u in unit_vals), "ipeds_hd_rows": len(hd_by),
                                 "sample_unresolved": sorted(u for u in unit_vals if u not in hd_by)[:15]}
out["join_wikidata_ror_id"] = {"distinct_ror_ids_cited_with_an_ipeds_id": len(ror_cited), "resolve_in_ror_dump": sum(1 for r in ror_cited if r in ror),
                               "resolved_status": dict(collections.Counter(ror[r]["status"] for r in ror_cited if r in ror)),
                               "sample_unresolved": sorted(r for r in ror_cited if r not in ror)[:15]}
out["bridge_ipeds_ror_through_wikidata"] = {
    "pairs_in_wikidata": len(pairs), "pairs_resolving_on_both_sides": len(good),
    "ipeds_units_bridged": len(unit_to_ror), "ror_records_bridged": len(ror_to_unit),
    "units_with_more_than_one_ror": sum(1 for v in unit_to_ror.values() if len(v) > 1),
    "ror_with_more_than_one_unit": sum(1 for v in ror_to_unit.values() if len(v) > 1),
    "same_state": sum(1 for u, r in good if hd_by[u]["STABBR"] == ror[r]["locations.geonames_details.country_subdivision_code"]),
    "same_web_domain": sum(1 for u, r in good if domain(hd_by[u]["WEBADDR"]) and domain(hd_by[u]["WEBADDR"]) == domain(ror[r]["links.type.website"])),
    "same_normalised_name": sum(1 for u, r in good if norm(hd_by[u]["INSTNM"]) == norm(ror[r]["names.types.ror_display"])),
}
# second, independent path: the Wikidata item id that ROR itself records
wd_by_q = {q: it for q, it in items.items()}
ror_q = [(k, q.strip()) for k, r in ror.items() for q in re.split(r"[;,]\s*", r["external_ids.type.wikidata.all"]) if q.strip()]
via = [(k, q) for k, q in ror_q if q in wd_by_q]
out["join_ror_wikidata_qid"] = {"ror_records_with_a_wikidata_id": len({k for k, _ in ror_q}), "ror_wikidata_ids_naming_an_item_with_an_ipeds_id": len(via),
                                "of_which_item_cites_the_same_ror_id_back": sum(1 for k, q in via if k in wd_by_q[q]["r"])}
uk_vals = {b["k"].strip() for b in wd_ukprn}
uk_pairs = {(b["k"].strip(), b["r"].strip()) for b in wd_ukprn if b.get("r")}
out["join_wikidata_ukprn_ofs"] = {"ofs_ukprns": len(ofs), "ofs_ukprns_named_by_wikidata": sum(1 for k in ofs if k in uk_vals),
                                  "ofs_ukprns_bridged_to_a_ror_record": len({k for k, r in uk_pairs if k in ofs and r in ror})}

# 7. Candidate join: normalised institution name + state, IPEDS HD <-> ROR (US, type education)
ror_idx = collections.defaultdict(list)
for k, r in us_edu.items():
    names = [r["names.types.ror_display"]] + [re.sub(r"^[a-z_]+:\s*", "", n) for fld in ("names.types.label", "names.types.alias") for n in r[fld].split(";") if n.strip()]
    for nm in {norm(n) for n in names if n.strip()}:
        ror_idx[(nm, r["locations.geonames_details.country_subdivision_code"])].append(k)
cand = {}
for u, r in hd_by.items():
    hits = sorted(set(ror_idx.get((norm(r["INSTNM"]), r["STABBR"]), [])))
    if hits:
        cand[u] = hits
single = {u: h[0] for u, h in cand.items() if len(h) == 1}
out["candidate_name_state_ipeds_ror"] = {
    "ipeds_hd_rows": len(hd_by), "us_education_ror_records": len(us_edu),
    "ipeds_rows_with_a_ror_name_state_match": len(cand), "with_exactly_one_match": len(single),
    "of_single_matches_with_a_wikidata_bridge": sum(1 for u in single if u in unit_to_ror),
    "single_matches_equal_to_the_wikidata_bridge": sum(1 for u, k in single.items() if u in unit_to_ror and k in unit_to_ror[u]),
    "single_matches_contradicting_the_wikidata_bridge": sum(1 for u, k in single.items() if u in unit_to_ror and k not in unit_to_ror[u]),
    "single_matches_with_no_wikidata_bridge": sum(1 for u in single if u not in unit_to_ror),
    "same_web_domain_among_single_matches": sum(1 for u, k in single.items() if domain(hd_by[u]["WEBADDR"]) and domain(hd_by[u]["WEBADDR"]) == domain(ror[k]["links.type.website"])),
}
rng = random.Random(20261120)
pool = sorted(u for u in single if u not in unit_to_ror)  # the pairs only the candidate join proposes
sample = rng.sample(pool, 20)
out["handcheck_sample_seed"] = 20261120
out["handcheck_sample"] = [{
    "unitid": u, "ipeds_name": hd_by[u]["INSTNM"], "ipeds_city": hd_by[u]["CITY"], "ipeds_state": hd_by[u]["STABBR"], "ipeds_web_domain": domain(hd_by[u]["WEBADDR"]),
    "ror_id": single[u], "ror_name": ror[single[u]]["names.types.ror_display"], "ror_city": ror[single[u]]["locations.geonames_details.name"],
    "ror_web_domain": domain(ror[single[u]]["links.type.website"]), "ror_status": ror[single[u]]["status"],
} for u in sample]
out["sample_declared_bridges"] = [{"unitid": u, "ror_id": r, "ipeds_name": hd_by[u]["INSTNM"], "ror_name": ror[r]["names.types.ror_display"]} for u, r in rng.sample(good, 25)]
out["requests"] = N
json.dump(out, open(os.path.join(HERE, "hei_measure.json"), "w"), indent=1, sort_keys=True, ensure_ascii=False)
print(json.dumps({k: v for k, v in out.items() if not k.startswith(("handcheck_sample", "sample_"))}, indent=1)[:9000])
