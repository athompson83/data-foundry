#!/usr/bin/env python3
"""Round 31 (2026-11-22): airworthiness directives. FAA final-rule ADs listed by the Federal Register API
(Office of the Federal Register) with their text read from govinfo.gov (the federalregister.gov full-text
URLs answer a "Request Access" page from this egress), the EASA Safety Publications Tool list and AD pages,
and reachability probes of the FAA Dynamic Regulatory System and Transport Canada CAWIS. The declared join is
the EASA AD number an FAA AD cites, resolved against the EASA tool. Writes awd_measure.json. Stdlib only."""
import collections, html, json, os, random, re, time, urllib.error, urllib.parse
from scoutlib import get, status, write

out = {"run_date": "2026-11-22"}
CACHE = os.environ.get("SCOUT_CACHE")
N_TEXTS = 150          # newest FAA ADs whose text is read from govinfo
N_EASA_PAGES = 60      # bound on EASA AD pages fetched
EASA_LIST_PAGES = 5


def polite(name, url, pause=1.0):
    """get() with an extra pause when the body is not already in the same-day cache; None on an HTTP error."""
    cached = CACHE and os.path.exists(os.path.join(CACHE, name))
    try:
        body = get(name, url, timeout=120)
    except urllib.error.HTTPError as e:
        time.sleep(pause)
        return e.code
    if not cached:
        time.sleep(pause)
    return body


def text_of(markup):
    t = re.sub(r"<script.*?</script>|<style.*?</style>", " ", markup, flags=re.S)
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", t))).strip()


# --- Federal Register API: FAA rules of 2026 matching "Airworthiness Directives" ----------------------
FIELDS = ["document_number", "title", "publication_date", "abstract", "effective_on", "docket_ids", "raw_text_url", "html_url"]
def fr_url(page):
    q = [("conditions[agencies][]", "federal-aviation-administration"), ("conditions[type][]", "RULE"),
         ("conditions[term]", '"Airworthiness Directives"'), ("conditions[publication_date][gte]", "2026-01-01"),
         ("per_page", "1000"), ("order", "newest"), ("page", str(page))] + [("fields[]", f) for f in FIELDS]
    return "https://www.federalregister.gov/api/v1/documents.json?" + urllib.parse.urlencode(q)

docs, page, api_count = [], 1, None
while True:
    j = json.loads(get(f"fr_api_2026_p{page}.json", fr_url(page)))
    api_count = j.get("count")
    docs += j.get("results", [])
    if not j.get("next_page_url") or page >= 5:
        break
    page += 1
ads = [d for d in docs if d["title"].startswith("Airworthiness Directives")]
ads.sort(key=lambda d: (d["publication_date"], d["document_number"]), reverse=True)
out["federal_register_api"] = {
    "query": "agency federal-aviation-administration, type RULE, term \"Airworthiness Directives\", publication_date >= 2026-01-01",
    "api_count": api_count, "results_read": len(docs), "pages_read": page,
    "title_starts_with_airworthiness_directives": len(ads),
    "other_titles_sample": sorted({d["title"] for d in docs if not d["title"].startswith("Airworthiness Directives")})[:5],
    "by_publication_month": dict(sorted(collections.Counter(d["publication_date"][:7] for d in ads).items())),
    "with_abstract": sum(1 for d in ads if (d.get("abstract") or "").strip()),
    "with_effective_on": sum(1 for d in ads if d.get("effective_on")),
    "with_docket_id": sum(1 for d in ads if d.get("docket_ids")),
    "newest_publication_date": ads[0]["publication_date"], "oldest_publication_date": ads[-1]["publication_date"],
    "distinct_document_numbers": len({d["document_number"] for d in ads}),
    "top_title_subjects": dict(collections.Counter(d["title"].split(";", 1)[-1].strip() for d in ads).most_common(8)),
    "fields_requested": FIELDS,
}
# federalregister.gov full text from this egress
def blocked_page(name, url):
    """What a federalregister.gov page outside the API answers: an HTTP error code, or the title of the page served."""
    body = polite(name, url, pause=2.0)
    if isinstance(body, int):
        return {"url": url, "http_status": body}
    return {"url": url, "http_status": 200, "bytes": len(body), "page_title": (re.search(rb"<title>(.*?)</title>", body, re.S) or [b"", b""])[1].decode("utf-8", "replace").strip()}

out["federal_register_full_text_probe"] = blocked_page("fr_full_text_probe.html", ads[0]["raw_text_url"])

# --- govinfo.gov: text of the newest N_TEXTS FAA ADs ------------------------------------------------
EASA_RE = re.compile(r"EASA (?:Emergency )?AD (\d{4}-\d{4}(?:R\d+)?(?:-E)?)")
TC_RE = re.compile(r"Transport Canada (?:Emergency )?AD (CF-\d{4}-\d{2,3}(?:R\d+)?)")
texts, text_errors = {}, []
for d in ads[:N_TEXTS]:
    dn = d["document_number"]
    body = polite(f"govinfo_{dn}.htm", f"https://www.govinfo.gov/content/pkg/FR-{d['publication_date']}/html/{dn}.htm", pause=0.5)
    if isinstance(body, int):
        text_errors.append({"document_number": dn, "publication_date": d["publication_date"], "http_status": body})
        continue
    texts[dn] = text_of(body.decode("utf-8", "replace"))
rows = []
for d in ads[:N_TEXTS]:
    t = texts.get(d["document_number"])
    if t is None:
        continue
    head = re.search(r"Amendment (39-\d+); AD (\d{4}-\d{2}-\d{2}(?:R\d+)?)\]", t)
    rows.append({
        "document_number": d["document_number"], "publication_date": d["publication_date"], "title": d["title"],
        "abstract": d.get("abstract") or "", "chars": len(t),
        "ad_number": head.group(2) if head else None, "amendment": head.group(1) if head else None,
        "docket": (re.search(r"Docket No\. (FAA-\d{4}-\d+)", t) or [None, None])[1],
        "effective_sentence": bool(re.search(r"This AD is effective [A-Z][a-z]+ \d{1,2}, \d{4}", t)),
        "compliance_paragraph": bool(re.search(r"\([a-z]\) Compliance", t)),
        "applicability_paragraph": bool(re.search(r"\([a-z]\) Applicability", t)),
        "compliance_time_phrases": len(re.findall(r"\b(?:[Ww]ithin|[Bb]efore (?:the )?accumulat\w+|at intervals not to exceed) (?:the next )?[\d,]+ (?:days|months|years|flight hours|flight cycles|hours time-in-service|hours|cycles|landings)", t)),
        "replaces_ad": sorted(set(re.findall(r"(?:supersed\w+|replac\w+|remov\w+) (?:AD|Airworthiness Directive \(AD\)) (\d{4}-\d{2}-\d{2}(?:R\d+)?)", t))),
        "easa_ads": sorted(set(EASA_RE.findall(t))), "tc_ads": sorted(set(TC_RE.findall(t))),
        "anac_ads": sorted(set(re.findall(r"ANAC (?:Emergency )?AD (\d{4}-\d{2}-\d{2}(?:R\d+)?)", t))),
        "mentions_mcai": "MCAI" in t,
    })
lens = sorted(r["chars"] for r in rows)
out["govinfo_ad_text"] = {
    "newest_ads_requested": min(N_TEXTS, len(ads)), "texts_read": len(rows), "not_available": text_errors,
    "publication_date_range": [min(r["publication_date"] for r in rows), max(r["publication_date"] for r in rows)],
    "characters": sum(lens), "median_characters": lens[len(lens) // 2],
    "with_ad_number_and_amendment_in_heading": sum(1 for r in rows if r["ad_number"]),
    "distinct_ad_numbers": len({r["ad_number"] for r in rows if r["ad_number"]}),
    "with_docket_number": sum(1 for r in rows if r["docket"]),
    "with_effective_date_sentence": sum(1 for r in rows if r["effective_sentence"]),
    "with_applicability_paragraph": sum(1 for r in rows if r["applicability_paragraph"]),
    "with_compliance_paragraph": sum(1 for r in rows if r["compliance_paragraph"]),
    "with_a_numeric_compliance_time_phrase": sum(1 for r in rows if r["compliance_time_phrases"]),
    "numeric_compliance_time_phrases": sum(r["compliance_time_phrases"] for r in rows),
    "naming_an_faa_ad_they_supersede_replace_or_remove": sum(1 for r in rows if r["replaces_ad"]),
    "mentioning_mcai": sum(1 for r in rows if r["mentions_mcai"]),
    "citing_an_easa_ad": sum(1 for r in rows if r["easa_ads"]),
    "citing_a_transport_canada_ad": sum(1 for r in rows if r["tc_ads"]),
    "citing_an_anac_ad": sum(1 for r in rows if r["anac_ads"]),
    "sample": [{k: r[k] for k in ("document_number", "ad_number", "amendment", "docket", "title", "easa_ads", "tc_ads")} for r in rows[:6]],
}

# --- EASA Safety Publications Tool: newest list pages -----------------------------------------------
def parse_tree(fragment):
    return {"tc_holders": [text_of(x) for x in re.findall(r'<li class="tc_holder"[^>]*>\s*([^<]+)', fragment)],
            "types": [text_of(x) for x in re.findall(r'<li class="type"[^>]*>\s*([^<]+)', fragment)],
            "models": [text_of(x) for x in re.findall(r'<li class="model"[^>]*>\s*([^<]+)', fragment)]}

easa_rows, easa_total = [], None
for p in range(1, EASA_LIST_PAGES + 1):
    body = polite(f"easa_list_p{p}.html", "https://ad.easa.europa.eu/" if p == 1 else f"https://ad.easa.europa.eu/page-{p}")
    if isinstance(body, int):
        out.setdefault("easa_list_errors", []).append({"page": p, "http_status": body}); continue
    h = body.decode("utf-8", "replace")
    m = re.search(r"out of a total of (\d+) publications", h)
    easa_total = int(m.group(1)) if m else easa_total
    for tr in re.findall(r"<tr onmouseover=.*?</tr>\s*(?=<tr onmouseover=|</table>|</tbody>)", h, flags=re.S):
        num = re.search(r'href="https://ad\.easa\.europa\.eu/ad/([^"]+)" class="easa_cd"', tr)
        if not num:
            continue
        dates = re.findall(r"\b(\d{4}-\d{2}-\d{2})\b", text_of(re.sub(r"<a [^>]*>.*?</a>", " ", tr, flags=re.S)))
        issuer = re.search(r'flags/[a-z]+\.gif" alt="([^"]*)"', tr)
        cells = re.findall(r'<td class="cell-default">(.*?)</td>', tr, flags=re.S)
        tree = parse_tree(tr)
        easa_rows.append({"number": num.group(1), "issued_by": issuer.group(1) if issuer else None,
                          "issue_date": dates[0] if dates else None, "subject": text_of(cells[1]) if len(cells) > 1 else "",
                          "tc_holders": tree["tc_holders"], "types": tree["types"], "models": len(tree["models"]),
                          "attachments": len(re.findall(r"/blob/", tr))})
kind = lambda n: "foreign AD (US-)" if n.startswith("US-") else "foreign AD (CF-)" if n.startswith("CF-") else "EASA AD" if re.match(r"\d{4}-\d{4}", n) else "EASA proposed AD (PAD)" if re.match(r"\d{2}-\d{3}", n) else "other"
out["easa_tool_list"] = {
    "total_publications_stated": easa_total, "list_pages_read": EASA_LIST_PAGES, "rows_parsed": len(easa_rows),
    "distinct_numbers": len({r["number"] for r in easa_rows}),
    "by_kind": dict(collections.Counter(kind(r["number"]) for r in easa_rows).most_common()),
    "by_issuer_flag": dict(collections.Counter(r["issued_by"] for r in easa_rows).most_common()),
    "issue_date_range": [min(r["issue_date"] for r in easa_rows if r["issue_date"]), max(r["issue_date"] for r in easa_rows if r["issue_date"])],
    "with_issue_date": sum(1 for r in easa_rows if r["issue_date"]), "with_subject": sum(1 for r in easa_rows if r["subject"]),
    "with_tc_holder": sum(1 for r in easa_rows if r["tc_holders"]), "with_type": sum(1 for r in easa_rows if r["types"]),
    "with_model": sum(1 for r in easa_rows if r["models"]), "with_attachment": sum(1 for r in easa_rows if r["attachments"]),
    "sample": easa_rows[:5],
}

# --- Declared join: EASA AD number cited by an FAA AD, resolved against the EASA tool --------------
pairs = sorted({(r["ad_number"] or r["document_number"], e) for r in rows for e in r["easa_ads"]})
cited = sorted({e for _, e in pairs})
random.seed(20261122)
to_fetch = sorted(random.sample(cited, N_EASA_PAGES)) if len(cited) > N_EASA_PAGES else cited
easa_pages, unresolved = {}, []
for num in to_fetch:
    body = polite(f"easa_ad_{num}.html", f"https://ad.easa.europa.eu/ad/{num}")
    if isinstance(body, int):
        unresolved.append({"easa_ad": num, "http_status": body}); continue
    h = body.decode("utf-8", "replace")
    t = text_of(h)
    m = re.search(r"Number\s+" + re.escape(num) + r"\s+Issued by\s+(.*?)\s+Issue date\s+(\d{4}-\d{2}-\d{2})", t)
    if not m:
        unresolved.append({"easa_ad": num, "http_status": 200, "reason": "page does not state this number"}); continue
    title = re.search(re.escape(num) + r" : (.*?) Print Download", t)
    tree = parse_tree(h)
    easa_pages[num] = {"issued_by": m.group(1).replace("\xa0", " ").strip(), "issue_date": m.group(2), "subject": title.group(1) if title else "",
                       "effective_date": (re.search(r"Effective date\s+(\d{4}-\d{2}-\d{2})", t) or [None, None])[1],
                       "ata_chapter": (re.search(r"ATA Chapter\s+(\d+)", t) or [None, None])[1],
                       "tc_holders": tree["tc_holders"], "types": tree["types"], "models": len(tree["models"]),
                       "supersedure": (re.search(r"Supersedure\s+(.*?)\s+Publication\(s\)", t) or [None, ""])[1][:200]}
by_row = {(r["ad_number"] or r["document_number"]): r for r in rows}
resolved_pairs = [(a, e) for a, e in pairs if e in easa_pages]
out["easa_ad_number_join"] = {
    "faa_ads_read": len(rows), "faa_ads_citing_an_easa_ad": sum(1 for r in rows if r["easa_ads"]),
    "faa_ad_to_easa_ad_pairs": len(pairs), "distinct_easa_ad_numbers_cited": len(cited),
    "easa_ad_numbers_looked_up": len(to_fetch), "resolved_to_an_easa_tool_page_stating_that_number": len(easa_pages),
    "unresolved": unresolved,
    "resolved_by_issuer": dict(collections.Counter(p["issued_by"] for p in easa_pages.values()).most_common()),
    "resolved_with_tc_holder_and_type": sum(1 for p in easa_pages.values() if p["tc_holders"] and p["types"]),
    "resolved_with_effective_date": sum(1 for p in easa_pages.values() if p["effective_date"]),
    "resolved_with_ata_chapter": sum(1 for p in easa_pages.values() if p["ata_chapter"]),
    "resolved_stating_a_supersedure": sum(1 for p in easa_pages.values() if "supersedes" in p["supersedure"]),
    "resolved_issue_year": dict(sorted(collections.Counter(n[:4] for n in easa_pages).items())),
    "faa_ads_with_at_least_one_resolved_easa_ad": len({a for a, _ in resolved_pairs}),
    "pairs_with_both_sides_read": len(resolved_pairs),
}
# Reverse direction, from the list pages only: FAA ADs the EASA tool republishes under a US- number.
faa_numbers = {r["ad_number"] for r in rows if r["ad_number"]}
us_rows = sorted({r["number"] for r in easa_rows if r["number"].startswith("US-")})
out["faa_ad_number_in_easa_tool"] = {
    "us_prefixed_rows_on_list_pages": len(us_rows),
    "whose_faa_ad_number_is_in_the_govinfo_sample": sum(1 for n in us_rows if n[3:] in faa_numbers),
    "not_in_sample": [n for n in us_rows if n[3:] not in faa_numbers][:10],
    "cf_prefixed_rows_on_list_pages": len({r["number"] for r in easa_rows if r["number"].startswith("CF-")}),
    "cf_numbers_also_cited_by_an_faa_ad_in_the_sample": sorted({r["number"] for r in easa_rows if r["number"].startswith("CF-")} & {t for r in rows for t in r["tc_ads"]}),
}

# --- Probes: FAA DRS and Transport Canada CAWIS ----------------------------------------------------
drs = get("drs_home.html", "https://drs.faa.gov/")
drs2 = get("drs_ad_doctype.html", "https://drs.faa.gov/browse/ADFRAWD/doctypeDetails")
out["faa_drs_probe"] = {
    "home_bytes": len(drs), "ad_doctype_path_bytes": len(drs2), "same_body_on_both_paths": drs == drs2,
    "home_title": (re.search(rb"<title>(.*?)</title>", drs) or [b"", b""])[1].decode(), "has_app_root_element": b"<app-root" in drs,
    "visible_text_characters": len(text_of(drs.decode("utf-8", "replace"))),
    "api_data_pull_status_without_key": status("https://drs.faa.gov/api/drs/data-pull/ADFRAWD"),
}
tc_robots = get("tc_robots.txt", "https://wwwapps.tc.gc.ca/robots.txt").decode("utf-8", "replace")
out["transport_canada_cawis_probe"] = {
    "robots_txt": tc_robots.strip(), "robots_disallows_everything": bool(re.search(r"User-agent: \*\s+Disallow: /\s*$", tc_robots.strip())),
    "note": "Two CAWIS pages (the language chooser and AD_h.aspx?lang=eng, both HTTP 200) were fetched by hand before robots.txt was read; nothing further was requested from the host and neither body is used here.",
}

# --- Terms pages -----------------------------------------------------------------------------------
QUOTES = {
    "easa_disclaimer.html": ("https://ad.easa.europa.eu/disclaimer", "Reproduction is authorised, provided the source is acknowledged, save where otherwise stated."),
    "govinfo_policies.html": ("https://www.govinfo.gov/about/policies", "By virtue of the foregoing, public documents can generally be reprinted without legal restriction."),
    "canada_terms.html": ("https://www.canada.ca/en/transparency/terms.html", "Unless otherwise specified, you may not reproduce materials on this site, in whole or in part, for the purposes of commercial redistribution without prior written permission from the copyright administrator."),
}
out["terms"] = {}
for name, (url, quote) in QUOTES.items():
    t = text_of(get(name, url).decode("utf-8", "replace"))
    out["terms"][url] = {"quote": quote, "quote_found_verbatim": quote in t}
out["terms"]["https://www.federalregister.gov/reader-aids/policy/legal-status"] = blocked_page("fr_legal_status.html", "https://www.federalregister.gov/reader-aids/policy/legal-status")

# --- Hand-check sample ------------------------------------------------------------------------------
random.seed(20261122)
out["handcheck_sample"] = [{
    "faa_ad": a, "fr_document_number": by_row[a]["document_number"], "faa_title": by_row[a]["title"], "faa_abstract_start": by_row[a]["abstract"][:260],
    "easa_ad": e, "easa_issued_by": easa_pages[e]["issued_by"], "easa_subject": easa_pages[e]["subject"],
    "easa_tc_holders": easa_pages[e]["tc_holders"], "easa_types": easa_pages[e]["types"][:8],
} for a, e in random.sample(resolved_pairs, min(20, len(resolved_pairs)))]
write(__file__, out)
