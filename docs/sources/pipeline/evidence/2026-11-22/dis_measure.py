#!/usr/bin/env python3
"""Round 31 (2026-11-22): US federal disaster declarations. OpenFEMA Disaster Declarations Summaries (v2,
full history), the FEMA and SBA declaration notices in the Federal Register (API metadata from
2025-01-01, with GovInfo text for the hand-check sample). Writes dis_measure.json. Stdlib only."""
import collections, datetime, html, json, random, re, urllib.error, urllib.parse
from scoutlib import get, status, write

out = {"run_date": "2026-11-22"}
C = collections.Counter
STATES = {"Alabama": "AL", "Alaska": "AK", "Arizona": "AZ", "Arkansas": "AR", "California": "CA", "Colorado": "CO", "Connecticut": "CT", "Delaware": "DE", "District of Columbia": "DC", "Florida": "FL", "Georgia": "GA", "Hawaii": "HI", "Idaho": "ID", "Illinois": "IL", "Indiana": "IN", "Iowa": "IA", "Kansas": "KS", "Kentucky": "KY", "Louisiana": "LA", "Maine": "ME", "Maryland": "MD", "Massachusetts": "MA", "Michigan": "MI", "Minnesota": "MN", "Mississippi": "MS", "Missouri": "MO", "Montana": "MT", "Nebraska": "NE", "Nevada": "NV", "New Hampshire": "NH", "New Jersey": "NJ", "New Mexico": "NM", "New York": "NY", "North Carolina": "NC", "North Dakota": "ND", "Ohio": "OH", "Oklahoma": "OK", "Oregon": "OR", "Pennsylvania": "PA", "Rhode Island": "RI", "South Carolina": "SC", "South Dakota": "SD", "Tennessee": "TN", "Texas": "TX", "Utah": "UT", "Vermont": "VT", "Virginia": "VA", "Washington": "WA", "West Virginia": "WV", "Wisconsin": "WI", "Wyoming": "WY", "Puerto Rico": "PR", "Guam": "GU", "American Samoa": "AS", "Virgin Islands": "VI", "Northern Mariana Islands": "MP"}

# --- OpenFEMA Disaster Declarations Summaries: every row, paged ------------------------------------------
BASE = "https://www.fema.gov/api/open/v2/DisasterDeclarationsSummaries?"
SEL = "$select=id,femaDeclarationString,disasterNumber,state,declarationType,declarationDate,incidentType,declarationTitle,incidentBeginDate,incidentEndDate,designatedArea,fipsStateCode,fipsCountyCode,ihProgramDeclared,iaProgramDeclared,paProgramDeclared,hmProgramDeclared,tribalRequest,lastRefresh"
rows, skip, reported = [], 0, None
while True:
    d = json.loads(get(f"dds_{skip:06d}.json", BASE + SEL + f"&$orderby=id&$top=10000&$skip={skip}&$inlinecount=allpages"))
    reported = d["metadata"]["count"]
    page = d["DisasterDeclarationsSummaries"]
    rows += page
    skip += 10000
    if len(page) < 10000 or skip > 200000:
        break
by_num = collections.defaultdict(list)
for r in rows:
    by_num[r["disasterNumber"]].append(r)
first = {n: v[0] for n, v in by_num.items()}
year = lambda r: r["declarationDate"][:4]
recent = {n: r for n, r in first.items() if year(r) in ("2025", "2026")}
out["openfema_declarations_summaries"] = {
    "count_reported": reported, "rows_fetched": len(rows), "distinct_row_ids": len({r["id"] for r in rows}), "distinct_disaster_numbers": len(by_num),
    "disasters_by_type": dict(C(r["declarationType"] for r in first.values()).most_common()),
    "disasters_with_more_than_one_state": sum(1 for v in by_num.values() if len({r["state"] for r in v}) > 1),
    "disasters_with_more_than_one_declaration_type": sum(1 for v in by_num.values() if len({r["declarationType"] for r in v}) > 1),
    "declaration_date_min": min(r["declarationDate"] for r in rows)[:10], "declaration_date_max": max(r["declarationDate"] for r in rows)[:10],
    "disasters_by_incident_type_top": dict(C(r["incidentType"] for r in first.values()).most_common(10)),
    "rows_with_county_fips": sum(1 for r in rows if r["fipsCountyCode"] not in (None, "", "000")),
    "rows_with_incident_end_date": sum(1 for r in rows if r["incidentEndDate"]),
    "disasters_declared_2025": sum(1 for r in first.values() if year(r) == "2025"), "disasters_declared_2026": sum(1 for r in first.values() if year(r) == "2026"),
    "declared_2025_2026_by_type": dict(C(r["declarationType"] for r in recent.values()).most_common()),
    "rows_for_disasters_declared_2025_2026": sum(len(by_num[n]) for n in recent),
    "newest_last_refresh": max(r["lastRefresh"] for r in rows),
    "newest_declaration": max(first.values(), key=lambda r: (r["declarationDate"], r["disasterNumber"]))["femaDeclarationString"],
}

web = json.loads(get("femaweb_declarations.json", "https://www.fema.gov/api/open/v1/FemaWebDisasterDeclarations?$top=10000&$inlinecount=allpages&$select=disasterNumber,declarationType,stateCode,declarationDate,incidentType,disasterName,closeoutDate"))
wrows = web["FemaWebDisasterDeclarations"]
wnums = {r["disasterNumber"] for r in wrows}
out["femaweb_declarations"] = {
    "count_reported": web["metadata"]["count"], "rows_fetched": len(wrows), "distinct_disaster_numbers": len(wnums),
    "disaster_numbers_also_in_summaries": len(wnums & set(by_num)), "disaster_numbers_only_in_femaweb": len(wnums - set(by_num)), "disaster_numbers_only_in_summaries": len(set(by_num) - wnums),
    "by_type": dict(C(r["declarationType"] for r in wrows).most_common()),
}

# --- Federal Register notices, FEMA and SBA, published from 2025-01-01 -----------------------------------
FIELDS = "".join("&fields%5B%5D=" + f for f in ("title", "abstract", "document_number", "publication_date", "html_url", "raw_text_url", "full_text_xml_url", "docket_ids", "type", "action", "agency_names"))
def fr(slug):
    docs, page = [], 1
    while True:
        d = json.loads(get(f"fr_{slug.split('-')[0]}_p{page}.json", "https://www.federalregister.gov/api/v1/documents.json?conditions%5Bagencies%5D%5B%5D=" + slug + "&conditions%5Btype%5D%5B%5D=NOTICE&conditions%5Bpublication_date%5D%5Bgte%5D=2025-01-01&per_page=1000&order=oldest&page=" + str(page) + FIELDS))
        docs += d.get("results") or []
        if not d.get("next_page_url"):
            return d["count"], docs
        page += 1

NUM = re.compile(r"FEMA-(\d{4})-(DR|EM|FM)")
def cited(doc):
    text = " ".join([doc.get("title") or "", doc.get("abstract") or ""] + (doc.get("docket_ids") or []))
    return sorted({(int(n), t) for n, t in NUM.findall(text)})
def dated(doc):
    m = re.search(r"dated\s+([A-Z][a-z]+ \d{1,2}, \d{4})", doc.get("abstract") or "")
    return datetime.datetime.strptime(m.group(1), "%B %d, %Y").strftime("%Y-%m-%d") if m else None
def named_state(doc, sba):
    t = doc.get("title") or ""
    name = (re.search(r"for the (?:State|Commonwealth|Territory) of ([A-Za-z .]+?)\s*$", t) or re.search(r"for ([A-Za-z .]+?)\s*$", t)) if sba else re.match(r"([^;]+);", t)
    name = name.group(1).strip() if name else None
    return STATES.get(name) or STATES.get((name or "").replace("U.S. ", "").replace("Commonwealth of the ", "").replace("the ", ""))

def measure(count, docs, sba):
    citing = [d for d in docs if cited(d)]
    links = [(d, n, t) for d in citing for n, t in cited(d)]
    ok = [(d, n, t) for d, n, t in links if n in by_num]
    same_type = [(d, n, t) for d, n, t in ok if first[n]["declarationType"] == t]
    with_state = [(d, n, t) for d, n, t in same_type if named_state(d, sba)]
    with_date = [(d, n, t) for d, n, t in same_type if dated(d)]
    return citing, same_type, {
        "count_reported": count, "notices_fetched": len(docs), "publication_date_min": min(d["publication_date"] for d in docs), "publication_date_max": max(d["publication_date"] for d in docs),
        "notices_citing_a_fema_disaster_number": len(citing), "notices_citing_more_than_one": sum(1 for d in citing if len(cited(d)) > 1),
        "citations": len(links), "citations_resolving_to_a_summaries_disaster_number": len(ok), "citations_resolving_with_the_same_declaration_type": len(same_type),
        "notices_with_every_cited_number_resolved": sum(1 for d in citing if all(n in by_num and first[n]["declarationType"] == t for n, t in cited(d))),
        "unresolved_citations": sorted({f"FEMA-{n}-{t}" for d, n, t in links if (d, n, t) not in same_type})[:20],
        "distinct_disaster_numbers_cited": len({n for _, n, _ in links}), "cited_by_type": dict(C(t for _, _, t in links).most_common()),
        "resolved_with_state_named_in_title": len(with_state), "of_those_state_equal": sum(1 for d, n, t in with_state if named_state(d, sba) in {r["state"] for r in by_num[n]}),
        "resolved_with_a_dated_phrase_in_abstract": len(with_date), "of_those_declaration_date_equal": sum(1 for d, n, t in with_date if dated(d) == first[n]["declarationDate"][:10]),
        "date_differences_sample": [[d["document_number"], f"FEMA-{n}-{t}", dated(d), first[n]["declarationDate"][:10]] for d, n, t in with_date if dated(d) != first[n]["declarationDate"][:10]][:8],
        "notices_with_abstract": sum(1 for d in docs if (d.get("abstract") or "").strip()),
        "citing_notices_by_kind": dict(C(re.sub(r"^[^;]*;\s*", "", re.sub(r"\s+(?:for|of) (?:the )?(?:State|Commonwealth|Territory|U\.S\.).*$", "", re.sub(r"No\. \d+", "No. N", d["title"]))) for d in citing).most_common(8)),
    }

fema_count, fema_docs = fr("federal-emergency-management-agency")
sba_count, sba_docs = fr("small-business-administration")
fema_citing, fema_links, out["federal_register_fema_notices"] = measure(fema_count, fema_docs, False)
sba_citing, sba_links, out["federal_register_sba_notices"] = measure(sba_count, sba_docs, True)
sba_numbers = [x for d in sba_citing for x in (d.get("docket_ids") or []) if re.search(r"Disaster Declaration #", x)]
out["federal_register_sba_notices"]["citing_notices_with_an_sba_declaration_number_docket"] = sum(1 for d in sba_citing if any("Disaster Declaration #" in x for x in d.get("docket_ids") or []))
out["federal_register_sba_notices"]["sba_docket_sample"] = sba_numbers[:3]

# Reverse direction: disasters declared in 2025 and 2026 that a notice published from 2025-01-01 cites.
fn, sn = {n for _, n, _ in fema_links}, {n for _, n, _ in sba_links}
rev = {}
for t in ("DR", "EM", "FM"):
    ns = {n for n, r in recent.items() if r["declarationType"] == t}
    rev[t] = {"disasters_declared_2025_2026": len(ns), "cited_by_a_fema_notice": len(ns & fn), "cited_by_an_sba_notice": len(ns & sn), "cited_by_either": len(ns & (fn | sn))}
out["fema_disaster_number_join"] = {
    "rule": "FEMA-<number>-<DR|EM|FM> read from the notice title, abstract and docket ids; resolved to OpenFEMA disasterNumber with the same declarationType",
    "fema_notices": {"matched": out["federal_register_fema_notices"]["citations_resolving_with_the_same_declaration_type"], "total": out["federal_register_fema_notices"]["citations"]},
    "sba_notices": {"matched": out["federal_register_sba_notices"]["citations_resolving_with_the_same_declaration_type"], "total": out["federal_register_sba_notices"]["citations"]},
    "reverse_by_type": rev,
    "recent_major_disasters_not_cited_by_any_notice_sample": sorted(first[n]["femaDeclarationString"] for n, r in recent.items() if r["declarationType"] == "DR" and n not in fn | sn)[:12],
}

# --- Hand-check sample: 20 FEMA notices, with the notice text from GovInfo -------------------------------
def govinfo_text(doc):
    url = f"https://www.govinfo.gov/content/pkg/FR-{doc['publication_date']}/html/{doc['document_number']}.htm"
    try:
        b = get(f"govinfo_{doc['document_number']}.htm", url, timeout=120)
    except urllib.error.HTTPError as e:
        return url, None, e.code
    return url, re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", b.decode("utf-8", "replace")))), 200

random.seed(20261122)
sample = random.sample(sorted(fema_links, key=lambda x: (x[0]["document_number"], x[1])), 20)
hs = []
for d, n, t in sample:
    url, text, code = govinfo_text(d)
    r = first[n]
    m = re.search(r"resulting from (.{0,160}?)(?: is of sufficient| are of sufficient|\.)", text or "")
    hs.append({
        "fr_document_number": d["document_number"], "fr_publication_date": d["publication_date"], "fr_title": d["title"], "fr_cited": f"FEMA-{n}-{t}",
        "fr_dated": dated(d), "fr_state_in_title": named_state(d, False),
        "govinfo_url": url, "govinfo_http_status": code, "govinfo_characters": len(text) if text else None,
        "govinfo_text_cites_the_number": (f"FEMA-{n}-{t}" in text) if text else None, "govinfo_incident_phrase": m.group(1).strip() if m else None,
        "openfema_declaration_string": r["femaDeclarationString"], "openfema_states": sorted({x["state"] for x in by_num[n]}), "openfema_declaration_date": r["declarationDate"][:10],
        "openfema_incident_type": r["incidentType"], "openfema_declaration_title": r["declarationTitle"], "openfema_designated_areas": len(by_num[n]),
    })
out["handcheck_sample"] = hs
out["govinfo_text_for_sample"] = {"fetched": sum(1 for h in hs if h["govinfo_http_status"] == 200), "of": len(hs), "median_characters": sorted(h["govinfo_characters"] or 0 for h in hs)[len(hs) // 2], "citing_the_number_in_text": sum(1 for h in hs if h["govinfo_text_cites_the_number"])}

# --- Terms -------------------------------------------------------------------------------------------------
GQ = "Copyright protection under this title is not available for any work of the United States Government"
gov = get("terms_govinfo.html", "https://www.govinfo.gov/about/policies").decode("utf-8", "replace")
meta = json.loads(get("openfema_datasets.json", "https://www.fema.gov/api/open/v1/OpenFemaDataSets?$filter=" + urllib.parse.quote("name eq 'IpawsArchivedAlerts' or name eq 'DisasterDeclarationsSummaries' or name eq 'FemaWebDisasterDeclarations'")))["OpenFemaDataSets"]
dm = next(r for r in meta if r["name"] == "DisasterDeclarationsSummaries")
FQ = "FEMA's citation requirements for datasets (API usage or file downloads) can be found on the OpenFEMA Terms and Conditions page, Citing Data section: https://www.fema.gov/about/openfema/terms-conditions."
FQ2 = "This is raw, unedited data from FEMA's National Emergency Management Information System (NEMIS) and as such is subject to a small percentage of human error."
out["terms"] = [
    {"url": "https://www.govinfo.gov/about/policies", "quote": GQ, "quote_found_verbatim_in_body": GQ in gov},
    {"url": "https://www.fema.gov/api/open/v1/OpenFemaDataSets", "quote": FQ, "quote_found_verbatim_in_body": FQ in dm["description"], "note": "dataset description in the OpenFEMA catalogue API; it points to the terms page, which could not be read"},
    {"url": "https://www.fema.gov/api/open/v1/OpenFemaDataSets", "quote": FQ2, "quote_found_verbatim_in_body": FQ2 in dm["description"]},
]
out["openfema_catalog"] = {"record_count": dm["recordCount"], "temporal": dm["temporal"], "accrual_periodicity": dm["accrualPeriodicity"], "license_field": dm["license"], "last_dataset_refresh": dm["lastDataSetRefresh"]}
fr_page = get("terms_fr_legal.html", "https://www.federalregister.gov/reader-aids/policy/legal-status").decode("utf-8", "replace")
out["terms_not_readable"] = {
    "https://www.fema.gov/about/openfema/terms-conditions": status("https://www.fema.gov/about/openfema/terms-conditions"),
    "https://www.federalregister.gov/reader-aids/policy/legal-status": "HTTP 200 with a 'Request Access' CAPTCHA page" if "Request Access" in fr_page else "readable",
    "https://www.federalregister.gov/documents/full_text/text/ (raw_text_url)": "HTTP 200 with a 'Request Access' CAPTCHA page" if "Request Access" in get("p_fr_raw.txt", "https://www.federalregister.gov/documents/full_text/text/2026/05/06/2026-08897.txt").decode("utf-8", "replace") else "readable",
}
write(__file__, out)
