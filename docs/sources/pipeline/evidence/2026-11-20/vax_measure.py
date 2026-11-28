#!/usr/bin/env python3
"""Round 29 (2026-11-20) screening of the `vaccine-products` data type.

Re-fetches live, one request at a time: the CDC IIS code-set downloads (CVX, MVX, trade names,
NDC unit-of-sale and unit-of-use crosswalks), FDA's "Vaccines Licensed for Use in the United
States" page, the newest Purple Book monthly CSV, the openFDA NDC directory restricted to
product_type VACCINE, the openFDA drug label product-type count, DailyMed SPL lookups by NDC
for a seeded sample, the WHO prequalified vaccines CSV export, and the terms pages.
Writes vax_measure.json next to itself. Stdlib only. No label text is written.
"""
import collections, csv, hashlib, html, io, json, os, random, re, time, urllib.error, urllib.parse, urllib.request

UA = "data-foundry-scout/1.0 (data@mail.proviciency.com)"
HERE = os.path.dirname(os.path.abspath(__file__))
N = 0


def get(url, timeout=120):
    global N
    N += 1
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            body, status = r.read(), r.status
    except urllib.error.HTTPError as e:
        body, status = e.read(), e.code
    time.sleep(0.6)
    return status, body


def text_of(page):
    page = re.sub(r"<(script|style).*?</\1>", " ", page, flags=re.S)
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", page)))


def rows(body):
    return [[c.strip() for c in line.split("|")] for line in body.decode("utf-8-sig", "replace").splitlines() if line.strip()]


def ndc11(code):
    """Hyphenated NDC (4-4-2, 5-3-2, 5-4-1 or 5-4-2) -> 11-digit 5-4-2 string, or None."""
    parts = code.strip().split("-")
    if len(parts) != 3 or not all(p.isdigit() for p in parts):
        return None
    a, b, c = parts
    if not (len(a) <= 5 and len(b) <= 4 and len(c) <= 2):
        return None
    return a.zfill(5) + b.zfill(4) + c.zfill(2)


def norm(name):
    return re.sub(r"[^A-Z0-9]", "", name.upper())


out = {"run_date": "2026-11-20", "user_agent": UA}
CDC = "https://www2.cdc.gov/vaccines/iis/iisstandards/downloads/"

# --- CDC code sets -------------------------------------------------------------------------
s, b = get(CDC + "cvx.txt")
cvx = rows(b)
out["cdc_cvx"] = {"status": s, "bytes": len(b), "rows": len(cvx), "distinct_codes": len({r[0] for r in cvx}),
                  "by_status": dict(collections.Counter(r[4] for r in cvx)),
                  "non_vaccine_true": sum(1 for r in cvx if r[5] == "True"),
                  "with_notes": sum(1 for r in cvx if r[3]), "newest_update": max(r[6] for r in cvx)}
cvx_codes = {r[0] for r in cvx}
s, b = get(CDC + "mvx.txt")
mvx = rows(b)
out["cdc_mvx"] = {"status": s, "bytes": len(b), "rows": len(mvx), "by_status": dict(collections.Counter(r[3] for r in mvx)),
                  "newest_update": max(r[4] for r in mvx)}
s, b = get(CDC + "TRADENAME.txt")
tn = rows(b)
out["cdc_tradename"] = {"status": s, "bytes": len(b), "rows": len(tn), "distinct_names": len({r[0] for r in tn}),
                        "by_product_status": dict(collections.Counter(r[6] for r in tn)),
                        "cvx_resolving": sum(1 for r in tn if r[2] in cvx_codes),
                        "mvx_resolving": sum(1 for r in tn if r[4] in {m[0] for m in mvx}),
                        "newest_update": max(r[7] for r in tn)}
s, b = get(CDC + "NDC/NDC_Unit_sale.txt")
sale = rows(b)
s2, b2 = get(CDC + "NDC/NDC_Unit_use.txt")
use = rows(b2)
sale_ndc = {ndc11(r[14]): r for r in sale if ndc11(r[14])}
use_ndc = {ndc11(r[14]): r for r in use if ndc11(r[14])}
out["cdc_ndc"] = {
    "unit_of_sale": {"status": s, "bytes": len(b), "rows": len(sale), "distinct_ndc11": len(sale_ndc),
                     "no_end_date": sum(1 for r in sale if not r[8]), "distinct_cvx": len({r[12] for r in sale}),
                     "cvx_resolving": sum(1 for r in sale if r[12] in cvx_codes), "with_gtin": sum(1 for r in sale if r[15]),
                     "newest_update": max(r[11] for r in sale)[:10]},
    "unit_of_use": {"status": s2, "bytes": len(b2), "rows": len(use), "distinct_ndc11": len(use_ndc),
                    "no_end_date": sum(1 for r in use if not r[8]), "cvx_resolving": sum(1 for r in use if r[11] in cvx_codes),
                    "newest_update": max(r[15] for r in use)[:10]},
}

# --- FDA licensed vaccines page ----------------------------------------------------------
s, b = get("https://www.fda.gov/vaccines-blood-biologics/vaccines/vaccines-licensed-use-united-states")
page = b.decode("utf-8", "replace")
fda_rows = []
for tr in re.findall(r"<tr.*?</tr>", page, flags=re.S):
    cells = [re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", td))).strip() for td in re.findall(r"<td.*?</td>", tr, flags=re.S)]
    if len(cells) >= 2:
        fda_rows.append(cells[:2])
current = re.search(r"Content current as of:\s*([0-9/]+)", text_of(page))
fda_trade = collections.defaultdict(list)
for product, trade in fda_rows:
    for piece in re.split(r"\s*(?:;|\bor\b|,)\s*", trade):
        if piece and norm(piece) != "NOTRADENAME":
            fda_trade[norm(piece)].append((product, piece))
out["fda_licensed_list"] = {"status": s, "bytes": len(b), "rows": len(fda_rows),
                            "rows_without_trade_name": sum(1 for _, t in fda_rows if norm(t) == "NOTRADENAME"),
                            "distinct_trade_names": len(fda_trade),
                            "package_insert_or_product_links": len(set(re.findall(r'href="(/vaccines-blood-biologics/[^"#]+)"', page))),
                            "content_current_as_of": current.group(1) if current else None}

# --- Purple Book ---------------------------------------------------------------------------
s, b = get("https://purplebooksearch.fda.gov/downloads")
links = re.findall(r'href="(https://www\.accessdata\.fda\.gov/drugsatfda_docs/PurpleBook/(\d{4})/purplebook-search-([A-Za-z]+)-data-download\.csv)"', b.decode("utf-8", "replace"))
MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"]
links.sort(key=lambda l: (int(l[1]), MONTHS.index(l[2].lower())))
pb_url = links[-1][0]
s, b = get(pb_url)
pb = list(csv.reader(io.StringIO(b.decode("utf-8-sig", "replace"))))
hdr_i = [i for i, r in enumerate(pb) if r and r[0] == "N/R/U"]
hdr = pb[hdr_i[-1]]
full = [dict(zip(hdr, r)) for r in pb[hdr_i[-1] + 1:] if len(r) == len(hdr) and r[2]]
pb_bla = {r["BLA Number"].strip() for r in full}
out["fda_purple_book"] = {"download_page_links": len(links), "newest_file": pb_url, "status": s, "bytes": len(b), "title": pb[0][0],
                          "change_rows": hdr_i[-1] - hdr_i[0] - 1 if len(hdr_i) > 1 else 0, "product_rows": len(full),
                          "by_center": dict(collections.Counter(r["Center"] for r in full)), "distinct_bla_numbers": len(pb_bla),
                          "by_licensure": dict(collections.Counter(r["Licensure"] for r in full).most_common(6))}

# --- openFDA ---------------------------------------------------------------------------------
s, b = get("https://api.fda.gov/drug/label.json?count=openfda.product_type.exact")
d = json.loads(b)
out["openfda_label_product_types"] = {"status": s, "last_updated": d["meta"]["last_updated"], "counts": {x["term"]: x["count"] for x in d["results"]}}
s, b = get("https://api.fda.gov/drug/label.json?search=" + urllib.parse.quote('openfda.product_type:"VACCINE"') + "&limit=1")
out["openfda_label_vaccine_query"] = {"status": s, "body": json.loads(b).get("error", {}).get("message", "matches")}
s, b = get("https://api.fda.gov/drug/ndc.json?search=product_type:VACCINE&limit=1000")
d = json.loads(b)
prods = d["results"]
of_pkg, of_inner, of_app, of_brand = {}, set(), set(), collections.defaultdict(set)
for p in prods:
    of_app.add(re.sub(r"\D", "", p.get("application_number", "")))
    of_brand[norm(p.get("brand_name_base") or p.get("brand_name") or "")].add(p.get("labeler_name", ""))
    for pk in p.get("packaging", []):
        n = ndc11(pk.get("package_ndc", ""))
        if n:
            of_pkg[n] = p["product_ndc"]
        for inner in re.findall(r"\((\d{4,5}-\d{3,4}-\d{1,2})\)", pk.get("description", "")):
            if ndc11(inner):
                of_inner.add(ndc11(inner))
of_all = set(of_pkg) | of_inner
out["openfda_ndc_vaccines"] = {"status": s, "last_updated": d["meta"]["last_updated"], "total": d["meta"]["results"]["total"], "fetched": len(prods),
                               "distinct_package_ndc": len(of_pkg), "distinct_ndc_incl_inner_packages": len(of_all),
                               "distinct_application_numbers": len(of_app - {""}), "distinct_brand_bases": len(of_brand),
                               "distinct_labelers": len({p.get("labeler_name") for p in prods}),
                               "with_spl_id": sum(1 for p in prods if p.get("spl_id")),
                               "marketing_category": dict(collections.Counter(p.get("marketing_category") for p in prods))}

# --- joins ---------------------------------------------------------------------------------------
live_sale = {n for n, r in sale_ndc.items() if not r[8]}
live_use = {n for n, r in use_ndc.items() if not r[8]}
out["join_ndc_cdc_openfda"] = {
    "cdc_unit_of_sale_all": [len(set(sale_ndc) & of_all), len(sale_ndc)],
    "cdc_unit_of_sale_no_end_date": [len(live_sale & of_all), len(live_sale)],
    "cdc_unit_of_use_all": [len(set(use_ndc) & of_all), len(use_ndc)],
    "cdc_unit_of_use_no_end_date": [len(live_use & of_all), len(live_use)],
    "openfda_package_ndc_in_cdc_sale_or_use": [len(set(of_pkg) & (set(sale_ndc) | set(use_ndc))), len(of_pkg)],
    "unmatched_live_sale_examples": sorted(live_sale - of_all)[:10],
    "unmatched_openfda_examples": sorted(set(of_pkg) - set(sale_ndc) - set(use_ndc))[:10],
}
out["join_bla_openfda_purple_book_same_publisher"] = [len((of_app - {""}) & pb_bla), len(of_app - {""})]

cdc_active = collections.defaultdict(list)
for r in tn:
    if r[6] == "Active":
        cdc_active[norm(r[0])].append(r)
matched = sorted(set(cdc_active) & set(fda_trade))
out["join_trade_name_cdc_fda_list"] = {"cdc_active_distinct_names": len(cdc_active), "fda_distinct_trade_names": len(fda_trade),
                                       "matched": [len(matched), len(cdc_active)],
                                       "cdc_only_examples": sorted(cdc_active[k][0][0] for k in set(cdc_active) - set(fda_trade))[:25],
                                       "fda_only_examples": sorted(fda_trade[k][0][1] for k in set(fda_trade) - set(cdc_active))[:25]}
random.seed(20261120)
out["trade_name_handcheck_sample"] = [
    {"cdc_trade_name": cdc_active[k][0][0], "cdc_cvx": cdc_active[k][0][2], "cdc_cvx_short": cdc_active[k][0][1], "cdc_manufacturer": cdc_active[k][0][3],
     "fda_trade_name": fda_trade[k][0][1], "fda_product_name": fda_trade[k][0][0]}
    for k in random.sample(matched, min(20, len(matched)))]
brand_matched = sorted(set(cdc_active) & (set(of_brand) - {""}))
out["join_trade_name_cdc_openfda_ndc"] = [len(brand_matched), len(cdc_active)]

# --- DailyMed (free text) -------------------------------------------------------------------
random.seed(20261120)
sample = random.sample(sorted(live_sale), 20)
dm = []
for n in sample:
    native = "-".join(sale_ndc[n][1:4])  # the labeler-product-package segments as the FDA assigned them
    s, b = get("https://dailymed.nlm.nih.gov/dailymed/services/v2/spls.json?ndc=" + native)
    j = json.loads(b) if s == 200 else {}
    hit = (j.get("data") or [None])[0]
    rec = {"cdc_ndc11": n, "ndc_native": native, "cvx": sale_ndc[n][12], "status": s, "setid": hit and hit["setid"], "spl_version": hit and hit["spl_version"],
           "published": hit and hit["published_date"]}
    if hit:
        s, x = get("https://dailymed.nlm.nih.gov/dailymed/services/v2/spls/" + hit["setid"] + ".xml")
        xml = x.decode("utf-8", "replace")
        rec["xml_status"], rec["xml_bytes"] = s, len(x)
        rec["section_codes"] = len(set(re.findall(r'<section[^>]*>\s*(?:<id[^>]*/>\s*)?<code code="([^"]+)"', xml)))
        rec["prose_chars"] = len(text_of(re.sub(r"<observationMedia.*?</observationMedia>", " ", xml, flags=re.S)))
        rec["cites_ndc_in_text"] = native in xml
    dm.append(rec)
found = [r for r in dm if r["setid"]]
chars = sorted(r["prose_chars"] for r in found if r.get("xml_status") == 200)
out["dailymed_sample"] = {"sampled_cdc_live_sale_ndcs": len(dm), "resolved_to_spl": [len(found), len(dm)], "distinct_setids": len({r["setid"] for r in found}),
                          "prose_chars_median": chars[len(chars) // 2] if chars else None, "prose_chars_min": chars[0] if chars else None,
                          "prose_chars_max": chars[-1] if chars else None, "ndc_cited_in_label": sum(1 for r in found if r.get("cites_ndc_in_text")), "records": dm}
s, b = get("https://dailymed.nlm.nih.gov/dailymed/services/v2/spls.json?doctype=53406-6&pagesize=1")
out["dailymed_doctype_filter"] = {"status": s, "total_elements": json.loads(b)["metadata"]["total_elements"], "db_published_date": json.loads(b)["metadata"]["db_published_date"]}

# --- WHO prequalified vaccines (measured for the rights verdict; not a member) ------------
s, b = get("https://extranet.who.int/prequal/vaccines/prequalified/export?page&_format=csv")
who = list(csv.DictReader(io.StringIO(b.decode("utf-8-sig", "replace"))))
whon = collections.defaultdict(set)
for r in who:
    whon[norm(r.get("Commercial Name", ""))].add(r.get("Manufacturer", ""))
dates = sorted(time.strptime(r[next(iter(r))].strip(), "%d/%m/%Y") for r in who if re.fullmatch(r"\d\d/\d\d/\d{4}", r[next(iter(r))].strip()))
out["who_prequalified"] = {"status": s, "bytes": len(b), "rows": len(who), "distinct_commercial_names": len(whon),
                           "distinct_manufacturers": len({r.get("Manufacturer") for r in who}), "distinct_vaccine_types": len({r.get("Vaccine Type") for r in who}),
                           "newest_prequalification": time.strftime("%Y-%m-%d", dates[-1]) if dates else None,
                           "names_also_cdc_active_trade_names": [len((set(whon) - {""}) & set(cdc_active)), len(set(whon) - {""})]}

# --- terms -----------------------------------------------------------------------------------------
TERMS = {
    "https://www.cdc.gov/other/agencymaterials.html": ["Most of the information on the CDC and ATSDR websites is not subject to copyright, is in the public domain, and may be freely used or reproduced without obtaining copyright permission.",
                                                       "Attribution to the agency that developed the material must be provided in your use of the materials."],
    "https://www.fda.gov/about-fda/about-website/website-policies": ["They are in the public domain and may be republished, reprinted and otherwise used freely by anyone without the need to obtain permission from FDA."],
    "https://open.fda.gov/terms/": ["Unless otherwise noted, the content, data, documentation, code, and related materials on openFDA is public domain and made available with a Creative Commons CC0 1.0 Universal dedication.",
                                    "Some data on openFDA may not be public domain, such as copies of copyrightable works made available to the FDA by private entities."],
    "https://www.nlm.nih.gov/web_policies.html": ["Transmission or reproduction of copyrighted items (beyond that allowed by fair use as defined in the U.S. copyright laws) requires the written permission of the copyright holders."],
    "https://www.who.int/about/policies/publishing/copyright": ["Permission is required for commercial uses and licensing of WHO materials, such as using the material in the context of a commercial activity."],
}
out["terms"] = {}
for url, quotes in TERMS.items():
    s, b = get(url)
    t = text_of(b.decode("utf-8", "replace"))
    out["terms"][url] = {"status": s, "bytes": len(b), "sha256": hashlib.sha256(b).hexdigest(), "quotes_found_verbatim": {q[:60]: (q in t) for q in quotes}}

out["requests"] = N
json.dump(out, open(os.path.join(HERE, "vax_measure.json"), "w"), indent=1, sort_keys=True)
print(json.dumps({k: v for k, v in out.items() if k not in ("dailymed_sample", "trade_name_handcheck_sample")}, indent=1)[:9000])
print(json.dumps(out["dailymed_sample"]["resolved_to_spl"]), out["dailymed_sample"]["prose_chars_median"], out["dailymed_sample"]["ndc_cited_in_label"])
