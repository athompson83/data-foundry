#!/usr/bin/env python3
"""Screening 2026-11-14: merger-control-cases.

Re-fetches every member live (stdlib only, declared UA) and writes mergers_measure.json
next to this script. Joins between authorities are party-name + date-window CANDIDATES
only; HAND_CHECK records the reviewer's verdict on the printed pairs (identifiers only).
"""
import json, os, re, time, unicodedata, urllib.error, urllib.request, datetime, html

UA = "data-foundry-scout/1.0 (data@mail.proviciency.com)"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "mergers_measure.json")


def get(u, limit=None):
    req = urllib.request.Request(u, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=180) as f:
            return f.status, (f.read(limit) if limit else f.read()), f.headers
    except urllib.error.HTTPError as e:
        return e.code, e.read(200000), e.headers


def strip(b):
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", b if isinstance(b, str) else b.decode("utf8", "replace"))))


STOP = set("""the a an of and for in by plc ltd limited inc corp corporation group holdings holding co company sa s a ag nv bv
gmbh se spa llc lp sas ab as oy kg certain assets business businesses merger inquiry acquisition acquired completed anticipated
joint venture jv uk international global us de la le from part parts its other""".split())


def toks(party):
    p = unicodedata.normalize("NFKD", party).encode("ascii", "ignore").decode().lower()
    w = [x for x in re.findall(r"[a-z0-9]+", p) if len(x) >= 3 and x not in STOP]
    return w[0] if w else None


def parties(title):
    t = re.sub(r"\(.*?\)", " ", title)
    t = re.sub(r"\b(merger inquiry|merger|inquiry)\b.*$", "", t, flags=re.I)
    return [x for x in (toks(p) for p in re.split(r"\s/\s|/", t)) if x]


def d(s):
    try:
        return datetime.date.fromisoformat(s[:10])
    except Exception:
        return None


out = {"measured_on": "2026-11-14"}

# 1. European Commission merger cases (open data JSON; decision PDFs are the free text)
st, b, _ = get("https://compcases-open-data-portal-files-prod.s3.eu-west-1.amazonaws.com/case-data-M.json")
ec = json.loads(b)
out["ec_status"], out["ec_bytes"], out["ec_cases"] = st, len(b), len(ec)
ecr = []
pdfs = 0
for k, v in ec.items():
    m = v["metadata"]
    nd = (m.get("caseNotificationDate") or [None])[0]
    links = [a["metadata"]["attachmentLink"][0] for dec in v.get("decisions", []) for a in dec.get("decisionAttachments", [])
             if a["metadata"].get("attachmentLink")]
    pdfs += bool(links)
    ecr.append({"case": k, "title": (m.get("caseTitle") or [""])[0], "notified": nd, "links": links[:1]})
out["ec_newest_notification"] = max(r["notified"] for r in ecr if r["notified"])
out["ec_cases_with_decision_document"] = f"{pdfs}/{len(ec)}"
out["ec_cases_with_sector"] = sum(bool(v["metadata"].get("caseSectors")) for v in ec.values())
recent_links = [r["links"][0] for r in sorted(ecr, key=lambda r: r["notified"] or "", reverse=True) if r["links"]][:3]
out["ec_decision_document_probe"] = []
for u in recent_links:
    s2, b2, h2 = get(u, 2048)
    out["ec_decision_document_probe"].append({"url": u, "status": s2, "type": h2.get("Content-Type") if h2 else None})
st, b, _ = get("https://data.europa.eu/api/hub/search/datasets/cc7e224e-6569-40f0-8037-d3389aa0fae7")
meta = json.loads(b)["result"]
out["ec_dataset_licence"] = [x.get("license", {}).get("id") for x in meta.get("distributions", [])]
out["ec_dataset_modified"] = meta.get("modified")

# 2. UK CMA merger cases (GOV.UK search API; description and page body are free text)
cma = []
for start in (0, 1000, 2000):
    st, b, _ = get("https://www.gov.uk/api/search.json?filter_format=cma_case&filter_case_type=mergers&count=1000"
                   f"&start={start}&fields=title,link,opened_date,closed_date,outcome_type,description,public_timestamp")
    j = json.loads(b)
    out["cma_total"] = j["total"]
    cma += j["results"]
    if start + 1000 >= j["total"]:
        break
out["cma_fetched"] = len(cma)
out["cma_description_fill"] = f"{sum(bool((r.get('description') or '').strip()) for r in cma)}/{len(cma)}"
out["cma_opened_date_fill"] = f"{sum(bool(r.get('opened_date')) for r in cma)}/{len(cma)}"
out["cma_newest_public_timestamp"] = max(r.get("public_timestamp") or "" for r in cma)
bl = []
for r in sorted(cma, key=lambda r: r.get("public_timestamp") or "", reverse=True)[:3]:
    st, b, _ = get("https://www.gov.uk/api/content" + r["link"])
    bl.append({"link": r["link"], "status": st, "body_chars": len(json.loads(b)["details"].get("body", "")) if st == 200 else 0})
out["cma_body_probe"] = bl

# 3. US FTC early termination notices (HTML listing; robots Crawl-delay 5, so one page only)
st, b, _ = get("https://www.ftc.gov/legal-library/browse/early-termination-notices")
s = b.decode("utf8", "replace")
out["ftc_et_status"] = st
pages = [int(x) for x in re.findall(r"[?&]page=(\d+)", s)]
items = re.findall(r'href="/legal-library/browse/early-termination-notices/(\d+)"', s)
out["ftc_et_first_page_items"] = len(set(items))
out["ftc_et_last_page_index"] = max(pages) if pages else None
out["ftc_et_estimated_notices"] = (max(pages) + 1) * len(set(items)) if pages else None
t = strip(s)
out["ftc_et_first_page_sample"] = re.findall(r"Early Termination Notices (\d{8}): .*? Date ([A-Z][a-z]+ \d{1,2}, \d{4})", t)[:5]

# 4. ACCC acquisitions register (from July 2025; MN numbers, ABN, ANZSIC, description)
st, b, _ = get("https://www.accc.gov.au/public-registers/acquisitions-and-mergers-registers/acquisitions-register")
s = b.decode("utf8", "replace")
slugs = list(dict.fromkeys(re.findall(r'href="/public-registers/acquisitions-and-mergers-registers/acquisitions-register/([^"?#]+)"', s)))
pages = [int(x) for x in re.findall(r"[?&]page=(\d+)", s)]
out["accc_status"], out["accc_first_page_items"] = st, len(slugs)
out["accc_last_page_index"] = max(pages) if pages else None
det = []
for sl in slugs[:5]:
    time.sleep(1)
    st, b, _ = get("https://www.accc.gov.au/public-registers/acquisitions-and-mergers-registers/acquisitions-register/" + sl)
    t = strip(b)
    det.append({"slug": sl, "status": st, "mn": (re.findall(r"\bMN-\d+\b", t) or [None])[0],
                "has_anzsic": "ANZSIC" in t, "has_description": bool(re.search(r"ANZSIC code\(s\).{0,300}? Description \S", t))})
out["accc_detail_probe"] = det

# 5. Competition Bureau Canada monthly report of concluded merger reviews (HTML table, OGL-Canada)
st, b, _ = get("https://ised-isde.canada.ca/site/competition-bureau-canada/en/mergers-and-acquisitions/monthly-report-concluded-merger-reviews")
rows = re.findall(r"<tr[^>]*>(.*?)</tr>", b.decode("utf8", "replace"), re.S)
ca = []
for r in rows:
    c = [strip(x).strip() for x in re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", r, re.S)]
    if len(c) >= 5 and re.match(r"\d{4}-\d{2}-\d{2}", c[1]):
        ca.append({"parties": c[0], "opened": c[1], "concluded": c[2], "naics": c[3], "outcome": c[4]})
out["ca_status"], out["ca_rows"] = st, len(ca)
out["ca_newest_opened"] = max(r["opened"] for r in ca) if ca else None
out["ca_oldest_opened"] = min(r["opened"] for r in ca) if ca else None
out["ca_outcomes"] = sorted({r["outcome"] for r in ca})[:10]
st, b, _ = get("https://open.canada.ca/data/api/action/package_show?id=c85cc13e-c571-4b02-845c-897e8e63db4d")
out["ca_open_canada_licence"] = json.loads(b)["result"].get("license_title")

# 6. Candidate joins: same transaction at two authorities (party first-token pair + date window)
ec_idx = [(r["case"], set(parties(r["title"])), d(r["notified"])) for r in ecr if r["notified"]]


def join(rows, title_key, date_key, ident, window=400):
    hits = []
    for r in rows:
        p = parties(r[title_key])
        dt = d(r.get(date_key) or "")
        if len(p) < 2 or not dt:
            continue
        for case, ps, nd in ec_idx:
            if p[0] in ps and p[1] in ps and abs((nd - dt).days) <= window:
                hits.append({"ec_case": case, "other": r[ident], "other_date": str(dt), "ec_notified": str(nd)})
    return hits


cma_since = [r for r in cma if (r.get("opened_date") or "") >= "2015-01-01"]
j1 = join(cma_since, "title", "opened_date", "link")
out["join_ec_cma_candidates"] = f"{len({h['other'] for h in j1})}/{len(cma_since)} CMA merger cases opened since 2015 have an EC case with both party tokens within 400 days"
out["join_ec_cma_rows"] = j1[:40]
for i, r in enumerate(ca):
    r["row"] = f"ca-{r['opened']}-{i}"
j2 = join(ca, "parties", "opened", "row")
out["join_ec_ca_candidates"] = f"{len({h['other'] for h in j2})}/{len(ca)} Canada concluded reviews have an EC case with both party tokens within 400 days"
out["join_ec_ca_rows"] = j2[:40]

# Reviewer verdicts on the first 20 candidate pairs of each join, read on 2026-11-14 by comparing both
# records' parties and dates. False = a different transaction: the restructured Microsoft/Activision deal
# (ex-cloud streaming rights) is a new CMA case; "green" and "telus" tokens matched unrelated deals.
# Canada row ids are page positions on the 2026-11-14 snapshot and shift as the report grows.
HAND_CHECK_CMA = {
    ("M.12591", "/cma-cases/ocs-slash-mitie-merger-inquiry"): True,
    ("M.12399", "/cma-cases/the-brinks-company-slash-ncr-atleos-corporation-merger-inquiry"): True,
    ("M.12269", "/cma-cases/akzonobel-slash-axalta-merger-inquiry"): True,
    ("M.11974", "/cma-cases/vandemoortele-slash-delifrance-merger-inquiry"): True,
    ("M.10646", "/cma-cases/microsoft-slash-activision-blizzard-merger-inquiry"): True,
    ("M.12278", "/cma-cases/paramount-slash-warner-bros-discovery-merger-inquiry"): True,
    ("M.10646", "/cma-cases/microsoft-slash-activision-blizzard-ex-cloud-streaming-rights-merger-inquiry"): False,
    ("M.10149", "/cma-cases/korean-air-slash-asiana-airlines-merger-inquiry"): True,
    ("M.12026", "/cma-cases/evri-slash-dhl-merger-inquiry"): True,
    ("M.11033", "/cma-cases/adobe-slash-figma-merger-inquiry"): True,
    ("M.11481", "/cma-cases/synopsys-slash-ansys-merger-inquiry"): True,
    ("M.12236", "/cma-cases/subsea7-slash-saipem-merger-inquiry"): True,
    ("M.12078", "/cma-cases/suzano-slash-kimberly-clark-jv-merger-inquiry"): True,
    ("M.9969", "/cma-cases/veolia-slash-suez-merger-inquiry"): True,
    ("M.12006", "/cma-cases/global-payments-slash-worldpay-merger-inquiry"): True,
    ("M.10560", "/cma-cases/sika-ag-slash-mbcc-group-merger-inquiry"): True,
    ("M.9987", "/cma-cases/nvidia-slash-arm-merger-inquiry"): True,
    ("M.10615", "/cma-cases/booking-holdings-inc-slash-etraveli-group-ab-merger-inquiry"): True,
    ("M.10966", "/cma-cases/cochlear-slash-oticon-merger-inquiry"): True,
    ("M.9871", "/cma-cases/liberty-global-plc-telefonica-s-a-merger-inquiry"): True,
}
HAND_CHECK_CA = {
    ("M.11111", "ca-2023-04-04-12"): True,
    ("M.11091", "ca-2023-03-21-19"): True,
    ("M.11206", "ca-2023-07-13-56"): True,
    ("M.11255", "ca-2023-08-10-68"): True,
    ("M.11225", "ca-2023-08-01-75"): True,
    ("M.11143", "ca-2023-07-18-91"): True,
    ("M.11204", "ca-2023-06-13-126"): True,
    ("M.11288", "ca-2023-10-06-133"): True,
    ("M.11320", "ca-2023-11-22-159"): True,
    ("M.11385", "ca-2023-12-20-177"): True,
    ("M.11486", "ca-2024-05-10-242"): True,
    ("M.11514", "ca-2024-05-13-244"): True,
    ("M.11947", "ca-2024-06-10-264"): False,
    ("M.11621", "ca-2024-07-10-284"): True,
    ("M.12133", "ca-2024-07-15-290"): False,
    ("M.11728", "ca-2024-09-06-328"): True,
    ("M.11746", "ca-2024-10-07-345"): True,
    ("M.11732", "ca-2024-10-09-346"): True,
    ("M.11773", "ca-2024-10-11-348"): True,
    ("M.10646", "ca-2022-03-23-358"): True,
}


def review(rows, verdicts):
    seen = {(h["ec_case"], h["other"]): h for h in rows}
    checked = [dict(seen[k], correct=v) for k, v in verdicts.items() if k in seen]
    return {"checked": len(checked), "correct": sum(c["correct"] for c in checked), "rows": checked}


out["hand_check_ec_cma"] = review(j1, HAND_CHECK_CMA)
out["hand_check_ec_ca"] = review(j2, HAND_CHECK_CA)

json.dump(out, open(OUT, "w"), indent=1, default=str)
print(json.dumps({k: v for k, v in out.items() if not k.endswith("_rows")}, indent=1, default=str)[:5000])
