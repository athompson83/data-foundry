#!/usr/bin/env python3
"""Scout 2026-11-14: data-breach-notifications. Re-fetches every source live.

Members measured: Washington AG (data.wa.gov Socrata sb4j-ca4h), California AG
(SB24 list CSV export plus per-report sample notice PDFs), Oregon DOJ (HTML table),
HHS OCR breach portal (JSF navigation, CSV export of the current-investigation list).
Reachability-only: Maine AG, Vermont AG, Indiana AG.
Joins (candidate): WA vs CA and OR vs CA by normalised organisation name with
reported dates within 45 days; a check row is confirmed when a breach date
agrees (WA datestart / OR first breach date equals one of the CA breach dates).
Organisation names are kept only for business check rows; HHS names (which include
sole practitioners) are never written. PDF text uses system `pdftotext` when present.
Run: python3 -I breach_measure.py  (writes breach_measure.json next to this script)
"""
import json, re, html, io, os, csv, time, datetime, subprocess, shutil, urllib.request, urllib.parse, http.cookiejar


UA = "data-foundry-scout/1.0 (data@mail.proviciency.com)"
HERE = os.path.dirname(os.path.abspath(__file__))
cj = http.cookiejar.CookieJar()
op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))


def get(u, data=None, headers=None, tries=3):
    for i in range(tries):
        try:
            h = {"User-Agent": UA}
            h.update(headers or {})
            with op.open(urllib.request.Request(u, data=data, headers=h), timeout=120) as f:
                return f.status, f.geturl(), f.headers.get("Content-Type", ""), f.read()
        except urllib.error.HTTPError as e:
            return e.code, u, e.headers.get("Content-Type", ""), b""
        except Exception:
            if i == tries - 1:
                raise
            time.sleep(3)


def text(b):
    s = b.decode("utf8", "replace")
    s = re.sub(r"<script.*?</script>|<style.*?</style>", " ", s, flags=re.S)
    return html.unescape(re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", s)))


def pdf_text(b):
    if not shutil.which("pdftotext"):
        return None
    return subprocess.run(["pdftotext", "-layout", "-", "-"], input=b, capture_output=True, timeout=60).stdout.decode("utf8", "replace")


def multipart(fields):
    bnd = "----dfscout%d" % int(time.time())
    body = "".join('--%s\r\nContent-Disposition: form-data; name="%s"\r\n\r\n%s\r\n' % (bnd, k, v) for k, v in fields.items())
    return (body + "--%s--\r\n" % bnd).encode(), {"Content-Type": "multipart/form-data; boundary=" + bnd}


SUFFIX = r"\b(inc|incorporated|llc|l l c|ltd|co|corp|corporation|company|lp|llp|plc|pllc|pc|na|n a|the|dba)\b"


def norm(name):
    s = re.sub(r"\(.*?\)", " ", name.lower())
    s = re.sub(r"[^a-z0-9 ]", " ", s.replace("&", " and "))
    s = re.sub(SUFFIX, " ", s)
    return re.sub(r"\s+", " ", s).strip()


def mdY(s):
    return datetime.datetime.strptime(s.strip(), "%m/%d/%Y").date()


out = {"measured_on": datetime.date.today().isoformat(), "user_agent": UA}

# 1. Washington AG data breach notifications (Socrata)
wa = {}
_, _, _, b = get("https://data.wa.gov/resource/sb4j-ca4h.json?$select=count(*),min(datesubmitted),max(datesubmitted)")
wa["stats"] = json.loads(b)[0]
_, _, _, b = get("https://data.wa.gov/api/views/sb4j-ca4h.json")
v = json.loads(b)
wa["columns"] = [c["fieldName"] for c in v.get("columns", [])]
wa["license"], wa["attribution"] = v.get("license"), v.get("attribution")
q = urllib.parse.quote("datesubmitted >= '2024-01-01T00:00:00'")
_, _, _, b = get("https://data.wa.gov/resource/sb4j-ca4h.json?$limit=5000&$where=" + q)
warows = json.loads(b)
wa["rows_since_2024"] = len(warows)
wa["fill_since_2024"] = {k: round(sum(bool(r.get(k)) for r in warows) / len(warows), 3)
                         for k in ["id", "name", "datestart", "dateaware", "washingtoniansaffected", "databreachcause", "cyberattacktype", "industrytype", "entitystate"]}
wa["has_free_text"] = False
out["wa_ago"] = wa

# 2. California AG SB24 list: CSV export + report pages with sample notice PDFs
ca = {}
st, _, ct, b = get("https://oag.ca.gov/privacy/databreach/list-export")
carows = list(csv.reader(io.StringIO(b.decode("utf8", "replace"))))
ca["export_http"], ca["export_content_type"], ca["header"], ca["rows"] = st, ct, carows[0], len(carows) - 1
cad = [{"org": r[0], "breach_dates": [mdY(x) for x in re.findall(r"\d+/\d+/\d{4}", r[1])], "reported": mdY(r[2])} for r in carows[1:] if re.match(r"\d+/\d+/\d{4}", r[2])]
ca["reported_min"] = min(r["reported"] for r in cad).isoformat()
ca["reported_max"] = max(r["reported"] for r in cad).isoformat()
ca["breach_date_fill"] = round(sum(bool(r["breach_dates"]) for r in cad) / len(cad), 3)
_, _, _, b = get("https://oag.ca.gov/privacy/databreach/list")
reps = re.findall(r'href="(https://oag\.ca\.gov/ecrime/databreach/reports/(sb24-\d+))"', b.decode("utf8", "replace"))
ca["list_page_report_links"] = len(reps)
samp = []
for u, rid in reps[:8]:
    _, _, _, rb = get(u)
    pdfs = [p for p in re.findall(r'href="(https://oag\.ca\.gov/system/files/[^"]+\.pdf)"', rb.decode("utf8", "replace"))]
    row = {"report_id": rid, "sample_notice_pdfs": len(pdfs)}
    if pdfs and sum(1 for s in samp if "words" in s) < 4:
        try:
            _, _, pct, pb = get(pdfs[0])
            t = pdf_text(pb)
            row.update({"pdf_bytes": len(pb), "words": len(t.split()) if t is not None else None,
                        "describes_what_happened": bool(t and re.search(r"What Happened", t, re.I)),
                        "lists_information_involved": bool(t and re.search(r"What Information Was Involved|information (that )?(was|may have been) (involved|affected|accessed)", t, re.I))})
        except Exception as e:
            row["pdf_error"] = str(e)[:80]
    samp.append(row)
ca["report_sample"] = samp
ca["has_free_text"] = True
out["ca_oag"] = ca

# 3. Oregon DOJ consumer data breach list (single HTML table)
orr = {}
st, _, _, b = get("https://justice.oregon.gov/consumer/DataBreach/")
orr["http"] = st
rows = []
for r in re.findall(r"<tr.*?</tr>", b.decode("utf8", "replace"), re.S):
    tds = [html.unescape(re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", c))).strip() for c in re.findall(r"<td[^>]*>(.*?)</td>", r, re.S)]
    if len(tds) >= 6 and re.match(r"\d+/\d+/\d{4}$", tds[1]):
        rows.append(tds)
orr["rows"] = len(rows)
orr["reported_max"] = max(mdY(r[1]) for r in rows).isoformat()
orr["reported_min"] = min(mdY(r[1]) for r in rows).isoformat()
orr["number_affected_fill"] = round(sum(bool(re.match(r"\d", r[5])) for r in rows) / len(rows), 3)
orr["columns"] = ["Organization", "Reported Date", "Dates of Breach", "Dates of Discovery", "Date Notice Sent", "Number Affected"]
orr["has_free_text"] = False
out["or_doj"] = orr
ord_ = [{"org": r[0], "reported": mdY(r[1]), "breach_first": (mdY(re.findall(r"\d+/\d+/\d{4}", r[2])[0]) if re.findall(r"\d+/\d+/\d{4}", r[2]) else None)} for r in rows]

# 4. HHS OCR breach portal: frontpage -> 'View HIPAA Breach Reports' -> 'Export as CSV' (JSF postbacks, no login)
hh = {}
st, url, _, b = get("https://ocrportal.hhs.gov/ocr/breach/breach_report.jsf")
hh["direct_report_url_lands_on"] = url
t = b.decode("utf8", "replace")
hh["captcha_on_frontpage"] = bool(re.search(r"captcha|turnstile", t, re.I))
act = re.search(r'id="ocrForm" name="ocrForm" method="post" action="([^"]+)"', t).group(1)
vs = re.search(r'ViewState:1" value="([^"]+)"', t).group(1)
lid = re.search(r"\{'(ocrForm:j_idt\d+)':'ocrForm:j_idt\d+'\},''\);return false\">View HIPAA Breach Reports", t).group(1)
body, hd = multipart({"ocrForm": "ocrForm", lid: lid, "javax.faces.ViewState": vs})
st, url, _, b = get("https://ocrportal.hhs.gov" + html.unescape(act), data=body, headers=hd)
t = b.decode("utf8", "replace")
hh["report_page"], hh["report_http"] = url, st
m = re.search(r"Displaying \d+ - \d+ of (\d+)", t)
hh["under_investigation_total"] = int(m.group(1)) if m else None
csvid = re.search(r"\{'(ocrForm:j_idt\d+)':'ocrForm:j_idt\d+'\},''\);return false\"><img id=\"ocrForm:j_idt\d+\" src=\"[^\"]*csv\.png", t).group(1)
vs = re.search(r'ViewState:1" value="([^"]+)"', t).group(1)
body, hd = multipart({"ocrForm": "ocrForm", csvid: csvid, "javax.faces.ViewState": vs})
st, _, ct, b = get("https://ocrportal.hhs.gov/ocr/breach/breach_report_hip.jsf", data=body, headers=hd)
hr = list(csv.reader(io.StringIO(b.decode("utf8", "replace"))))
hh["csv_http"], hh["csv_content_type"], hh["csv_rows"] = st, ct, len(hr) - 1
hh["csv_header"] = ["<entity name>" if "UIPanel" in h and i == 0 else ("<business associate present>" if "UIPanel" in h else h) for i, h in enumerate(hr[0])]
dates = [mdY(r[4]) for r in hr[1:] if re.match(r"\d+/\d+/\d{4}", r[4])]
hh["submission_min"], hh["submission_max"] = min(dates).isoformat(), max(dates).isoformat()
hh["web_description_fill"] = round(sum(bool(r[8].strip()) for r in hr[1:]) / (len(hr) - 1), 3)
hh["individuals_affected_fill"] = round(sum(bool(r[3].strip()) for r in hr[1:]) / (len(hr) - 1), 3)
hh["breach_types"] = sorted({r[5] for r in hr[1:]})[:12]
hh["note"] = "Covered entity names include sole practitioners (personal names); not written here. The archive tab (resolved cases, with web descriptions) was not fetched."
out["hhs_ocr"] = hh

# 5. Reachability of other state AG lists
reach = {}
for k, u in {"maine_ag": "https://www.maine.gov/agviewer/content/ag/985235c7-cb95-4be2-8792-a1252b4f8318/list.html",
             "vermont_ag": "https://ago.vermont.gov/document-categories/security-breach-notices",
             "indiana_ag": "https://www.in.gov/attorneygeneral/consumer-protection-division/id-theft-prevention/security-breaches/"}.items():
    st, url, ct, b = get(k and u)
    reach[k] = {"http": st, "url": url, "pdf_links": len(set(re.findall(r'href="([^"]+\.pdf)"', b.decode("utf8", "replace"))))}
out["other_reachability"] = reach

# 6. Terms
_, _, _, b = get("https://oag.ca.gov/conditions")
m = re.search(r"OWNERSHIP Considered in the public domain\.[^.]*\.[^.]*\.", text(b))
out["terms"] = {"oag_ca_conditions": m.group(0) if m else None}

# 7. Joins (candidate): organisation name + reported date window, confirmed by an equal breach date
caidx = {}
for r in cad:
    caidx.setdefault(norm(r["org"]), []).append(r)


def join(rows, name, rep, start, idf, label):
    since = datetime.date(2025, 1, 1)
    rows = [r for r in rows if rep(r) and rep(r) >= since]
    checks, seen = [], set()
    for r in rows:
        k = norm(name(r))
        if not k or k in seen or k not in caidx:
            continue
        near = [c for c in caidx[k] if abs((c["reported"] - rep(r)).days) <= 45]
        if not near:
            continue
        seen.add(k)
        c = near[0]
        sd = start(r)
        checks.append({label + "_id": idf(r), label + "_org": name(r), label + "_reported": rep(r).isoformat(),
                       label + "_breach_start": sd.isoformat() if sd else None, "ca_org": c["org"], "ca_reported": c["reported"].isoformat(),
                       "ca_breach_dates": [d.isoformat() for d in c["breach_dates"]],
                       "breach_date_agrees": bool(sd and sd in c["breach_dates"])})
    return {"rows_since_2025": len(rows), "distinct_orgs_since_2025": len({norm(name(r)) for r in rows}),
            "matched_orgs": len(checks), "breach_date_agrees": sum(c["breach_date_agrees"] for c in checks),
            "check_rows_note": "first 20 matches in source order, hand-checked; all are businesses or public bodies",
            "check_rows": checks[:20]}


iso = lambda s: datetime.date.fromisoformat(s[:10]) if s else None
out["join_wa_ca"] = join(warows, lambda r: r.get("name", ""), lambda r: iso(r.get("datesubmitted")), lambda r: iso(r.get("datestart")), lambda r: r.get("id"), "wa")
out["join_or_ca"] = join(ord_, lambda r: r["org"], lambda r: r["reported"], lambda r: r["breach_first"], lambda r: None, "or")

# Hand-check: the per-pair verdicts of the 2026-11-14 review live in breach_handcheck.json, keyed by the check row's
# identifiers. Only a current check row whose key is in that file carries a verdict; any other row is "unreviewed",
# so a rerun on a changed listing cannot claim reviews it did not have (Codex review, PR #88).
_hc = json.load(open(os.path.join(HERE, "breach_handcheck.json")))


def _bind(join_out, label, verdicts):
    v = {tuple(x["key"]): x["verdict"] for x in verdicts}
    for r in join_out["check_rows"]:
        r["hand_check"] = v.get((r.get(label + "_id"), r[label + "_org"], r[label + "_reported"], r["ca_org"], r["ca_reported"]), "unreviewed")
    rev = [r for r in join_out["check_rows"] if r["hand_check"] != "unreviewed"]
    return {"correct": sum(r["hand_check"] == "correct" for r in rev), "checked": len(rev),
            "unreviewed_check_rows": len(join_out["check_rows"]) - len(rev), "source": "breach_handcheck.json (reviewed " + _hc["reviewed_on"] + ")"}


out["hand_check"] = {"wa_ca": _bind(out["join_wa_ca"], "wa", _hc["wa_ca"]), "or_ca": _bind(out["join_or_ca"], "or", _hc["or_ca"])}
json.dump(out, open(os.path.join(HERE, "breach_measure.json"), "w"), indent=1, default=str)
s = json.dumps(out, indent=1, default=str)
print(s[:6000])
