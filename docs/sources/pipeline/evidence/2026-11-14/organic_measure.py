#!/usr/bin/env python3
"""Scout round 2026-11-14: certified-organic-operations screening.

Re-fetches every source live with the declared scout User-Agent and writes
organic_measure.json next to this script. Stdlib only, except that the
certificate-PDF fill rate uses the poppler `pdftotext` binary when present
(recorded as skipped otherwise). Run: python3 -I organic_measure.py

Personal data: many organic operators are sole proprietors whose operation
name is a person's name. This script reads names only in memory to test the
name + postal-code join; the JSON keeps identifiers (Agence BIO numeroBio,
TRACES certificate reference, CFIA row index) and boolean outcomes only.
"""
import json, os, re, random, shutil, subprocess, tempfile, unicodedata, urllib.request, urllib.error, urllib.parse, html, collections

UA = "data-foundry-scout/1.0 (data@mail.proviciency.com)"
HERE = os.path.dirname(os.path.abspath(__file__))
TRACES = "https://webgate.ec.europa.eu/tracesnt/directory/publication/organic-operator"
AGENCEBIO = "https://opendata.agencebio.org/api/gouv/operateurs/"


def get(u, n=None, accept=None):
    h = {"User-Agent": UA}
    if accept:
        h["Accept"] = accept
    try:
        with urllib.request.urlopen(urllib.request.Request(u, headers=h), timeout=90) as f:
            return f.status, (f.read(n) if n else f.read()), f.geturl()
    except urllib.error.HTTPError as e:
        return e.code, e.read(2000), u
    except Exception as e:
        return None, str(e).encode(), u


def jget(u):
    s, b, _ = get(u, accept="application/json")
    if s != 200:
        return s, None
    b = b.strip()
    return s, (json.loads(b) if b[:1] in (b"[", b"{") or b.isdigit() else None)


def text(b):
    t = b.decode("utf8", "replace")
    t = re.sub(r"<script.*?</script>|<style.*?</style>", " ", t, flags=re.S)
    return html.unescape(re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", t)))


def norm(s):
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().casefold()
    s = re.sub(r"\b(sarl|sas|sasu|earl|gaec|sca|scea|sa|eurl|ste|societe)\b", " ", s)
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


out = {"measured_on": "2026-11-14"}

# 1. EU TRACES organic operator certificates (structured JSON, public, no login)
s, total = jget(TRACES + "/for/count")
s1, page = jget(TRACES + "/for/query?max=100")
tr = {"count_http": s, "certificates_total": total, "page_http": s1, "page_rows": len(page or [])}
if page:
    tr["status_on_first_page"] = dict(collections.Counter(r["status"]["id"] for r in page))
    tr["operator_country_on_first_page"] = dict(collections.Counter(r["operator"]["address"]["cityReference"]["country"]["code"] for r in page).most_common(8))
    tr["fill_operatorIdentifier"] = sum(bool(r.get("operatorIdentifier")) for r in page)
    tr["fill_categoriesOfProduct"] = sum(bool(r.get("categoriesOfProduct")) for r in page)
    tr["fill_activities"] = sum(bool(r.get("activities")) for r in page)
    tr["fill_expiresOn"] = sum(bool(r.get("expiresOn")) for r in page)
    tr["newest_lastUpdateOn_first_page"] = max(r.get("lastUpdateOn") or "" for r in page)
    tr["fields"] = sorted(page[0].keys())
s2, _ = jget(TRACES + "/for/query?max=3&offset=1000")
s3, _ = jget(TRACES + "/for/query?max=3&offset=10000")
tr["deep_paging_http"] = {"offset_1000": s2, "offset_10000": s3}
for code in ("TR-BIO", "US-BIO", "CA-BIO"):  # third-country operators present?
    s4, rows = jget(TRACES + "/for/query?max=30&query=" + code)
    tr[f"query_{code}_operator_countries"] = sorted({r["operator"]["address"]["cityReference"]["country"]["code"] for r in rows or []})
out["eu_traces_json"] = tr

# 2. Agence BIO (France) open operator directory (structured, Licence Ouverte v2)
s, first = jget(AGENCEBIO + "?nb=1&debut=0")
ab = {"http": s, "operators_total": int(first["nbTotal"]) if first else None}
s, meta = jget("https://www.data.gouv.fr/api/1/datasets/622f52bb6b1fe2b127f0ce64/")
if meta:
    ab["datagouv_license"] = meta.get("license")
    ab["datagouv_frequency"] = meta.get("frequency")
    ab["datagouv_last_update"] = meta.get("last_update")
    ab["datagouv_resources"] = [(r["title"], r.get("filesize")) for r in meta.get("resources", [])]
random.seed(14)
offsets = sorted(random.sample(range(0, (ab["operators_total"] or 100000) - 10), 10))
sample = []
for o in offsets:
    s, d = jget(AGENCEBIO + f"?nb=5&debut={o}")
    for it in (d or {}).get("items", []):
        sample.append(it)
ab["sample_operators"] = len(sample)
ab["fill_siret"] = sum(bool(it.get("siret")) for it in sample)
ab["fill_certificats"] = sum(bool(it.get("certificats")) for it in sample)
ab["fill_productions"] = sum(bool(it.get("productions")) for it in sample)
ab["fill_gerant_personal_name_field"] = sum(bool((it.get("gerant") or "").strip()) for it in sample)
ab["newest_dateMaj_in_sample"] = max(it.get("dateMaj") or "" for it in sample) if sample else None
out["agence_bio_directory"] = ab

# 3. Join: Agence BIO operator (engaged certificate) -> TRACES certificate by exact normalised name + equal postal code
#    Confirmation (hand-check) attribute: TRACES issuing body code equals the Agence BIO certifier EU code.
rows, checked = [], 0
for it in sample:
    certs = [c for c in it.get("certificats") or [] if c.get("etatCertification") == "ENGAGEE"]
    name = (it.get("raisonSociale") or it.get("denominationcourante") or "").strip()
    pcs = {a.get("codePostal") for a in it.get("adressesOperateurs") or []}
    if not certs or not name or name.strip("0") == "":
        continue
    checked += 1
    s, res = jget(TRACES + "/for/query?max=30&query=" + urllib.parse.quote(name))
    hits = [r for r in res or [] if r["operator"]["address"]["cityReference"]["country"]["code"] == "FR"
            and norm(r["operator"]["name"]) == norm(name)
            and r["operator"]["address"]["cityReference"].get("postalCode") in pcs]
    cb = {re.sub(r"\s+", "", c.get("numeroControleEu") or "") for c in certs}
    rows.append({"numeroBio": it.get("numeroBio"), "traces_http": s,
                 "traces_refs": [h["reference"] for h in hits],
                 "certifier_code_equal": any(re.sub(r"\s+", "", h["issuingBody"]["code"]) in cb for h in hits)})
matched = [r for r in rows if r["traces_refs"]]
out["join_agencebio_traces"] = {
    "rule": "exact normalised operator name AND equal postal code (candidate); confirm by equal certifier EU code",
    "agencebio_engaged_operators_queried": checked,
    "matched": f"{len(matched)}/{checked}",
    "confirmed_by_certifier_code": f"{sum(r['certifier_code_equal'] for r in matched)}/{len(matched)}",
    "rows": rows,
}

# Manual review: the verdicts live in organic_handcheck.json, bound to the exact (numeroBio, TRACES references) pair that
# was reviewed on 2026-11-14 (names and towns read in memory, not stored). A pair found on a later run that is not in
# that file, or whose TRACES references changed, stays unreviewed (Codex review, PR #88).
_hc = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "organic_handcheck.json")))
_verdicts = {(p["numeroBio"], tuple(sorted(p["traces_refs"]))): p["verdict"] for p in _hc["pairs"]}
for r in matched:
    r["hand_check"] = _verdicts.get((r["numeroBio"], tuple(sorted(r["traces_refs"]))), "unreviewed")
_rev = [r for r in matched if r["hand_check"] != "unreviewed"]
out["join_agencebio_traces"]["hand_check"] = {
    "source": "organic_handcheck.json (reviewed " + _hc["reviewed_on"] + ")",
    "correct": sum(r["hand_check"] == "correct" for r in _rev), "checked": len(_rev),
    "unreviewed_matches": len(matched) - len(_rev),
}

# 4. TRACES certificate PDFs (free text: product directory in Part II)
pdf = {"pdftotext": bool(shutil.which("pdftotext"))}
refs = [ref for r in matched for ref in r["traces_refs"]][:10]
if len(refs) < 10 and page:
    refs += [r["reference"] for r in page if r["status"]["id"] == "ISSUED"][: 10 - len(refs)]
res = []
for ref in refs:
    s, b, _ = get(f"{TRACES}/{ref}.pdf")
    row = {"reference": ref, "http": s, "bytes": len(b) if s == 200 else 0}
    if s == 200 and pdf["pdftotext"]:
        with tempfile.NamedTemporaryFile(suffix=".pdf") as f:
            f.write(b); f.flush()
            t = subprocess.run(["pdftotext", "-layout", f.name, "-"], capture_output=True, text=True).stdout
        sec = t.split("II.1 Directory of products", 1)
        body = sec[1].split("II.2", 1)[0] if len(sec) > 1 else ""
        lines = [l.strip() for l in body.splitlines() if l.strip() and not re.search(r"Name of the product|Combined nomenclature|Regulation|Part II|scope of", l)]
        row.update({"has_product_directory": len(sec) > 1, "product_lines": len(lines),
                    "cn_code_lines": sum(bool(re.search(r"\b\d{4}(\s?\d{2}){0,3}\b", l)) for l in lines)})
    res.append(row)
pdf["sampled"] = len(res)
pdf["http_200"] = sum(r["http"] == 200 for r in res)
pdf["with_product_lines"] = sum((r.get("product_lines") or 0) > 0 for r in res)
pdf["rows"] = res
out["eu_traces_certificate_pdfs"] = pdf

# 5. CFIA cancelled organic certifications (canada.ca page, enforcement table)
s, b, _ = get("https://inspection.canada.ca/en/food-labels/organic-products/cancelled-organic-certifications")
h = b.decode("utf8", "replace")
trs = re.findall(r"<tr>(.*?)</tr>", h, re.S)
cells = [[html.unescape(re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", c))).strip() for c in re.findall(r"<td[^>]*>(.*?)</td>", r, re.S)] for r in trs]
cells = [c for c in cells if len(c) >= 5]
dates = sorted(c[4] for c in cells if re.match(r"\d{4}-\d{2}-\d{2}", c[4]))
m = re.search(r'dateModified[^>]*>\s*(\d{4}-\d{2}-\d{2})', h)
eu = re.compile(r"\b(Austria|Belgium|Bulgaria|Croatia|Cyprus|Czech|Denmark|Estonia|Finland|France|Germany|Greece|Hungary|Ireland|Italy|Latvia|Lithuania|Luxembourg|Malta|Netherlands|Poland|Portugal|Romania|Slovakia|Slovenia|Spain|Sweden)\s*\(", re.I)
out["cfia_cancelled_certifications"] = {
    "http": s, "header": [re.sub(r"\s+", " ", re.sub("<[^>]+>", "", x)).strip() for x in re.findall(r"<th[^>]*>(.*?)</th>", h, re.S)][:5],
    "rows": len(cells), "earliest_action": dates[0] if dates else None, "latest_action": dates[-1] if dates else None,
    "page_date_modified": m.group(1) if m else None,
    "region_counts": dict(collections.Counter(c[0] for c in cells)),
    "action_counts": dict(collections.Counter(c[3] for c in cells).most_common(6)),
    "holder_cell_with_parenthesised_certifier": sum(bool(re.search(r"\([^)]*\)\s*$", c[1])) for c in cells),
    "rows_located_in_eu_member_state": sum(bool(eu.search(c[1])) for c in cells),
}
s, b, _ = get("https://www.canada.ca/en/transparency/terms.html")
t = text(b)
out["cfia_cancelled_certifications"]["terms_http"] = s
out["cfia_cancelled_certifications"]["terms_quote"] = (re.search(r"Unless otherwise specified, you may not reproduce materials on this site[^.]*\.", t) or [None])[0]

# 6. USDA Organic INTEGRITY Database
s, b, u = get("https://organic.ams.usda.gov/integrity/")
s2, b2, _ = get("https://organic.ams.usda.gov/integrity/js/api.js")
s3, _, _ = get("https://organicapi.ams.usda.gov/IntegrityPubDataServices/OidPublicDataService.svc?api_key=DEMO_KEY")
s4, b4, _ = get("https://organicapi.ams.usda.gov/IntegrityPubDataServices/OidPublicDataService.svc")
s5, b5, _ = get("https://organic.ams.usda.gov/integrity/api/reports/formats")
out["usda_oid"] = {
    "site_http": s, "site_is_blazor_server": b"blazor.server.js" in b,
    "api_js_names_data_service": b"OidPublicDataService.svc" in b2,
    "data_service_demo_key_http": s3, "data_service_no_key_http": s4,
    "data_service_no_key_error": (re.search(rb'"code"\s*:\s*"([A-Z_]+)"', b4) or [b"", b""])[1].decode(),
    "telerik_report_service_formats_http": s5,
    "note": "Data History snapshots and search export are rendered by the Blazor server UI (SignalR); no static download URL was found",
}

json.dump(out, open(os.path.join(HERE, "organic_measure.json"), "w"), indent=1, default=str, ensure_ascii=False)
print(json.dumps({k: (v if k != "join_agencebio_traces" else {kk: vv for kk, vv in v.items() if kk != "rows"}) for k, v in out.items()}, indent=1, default=str, ensure_ascii=False)[:7000])
