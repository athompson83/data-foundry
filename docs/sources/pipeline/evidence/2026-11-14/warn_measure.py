#!/usr/bin/env python3
"""Scout 2026-11-14: mass-layoff-notices (WARN Act notices). Re-fetches every source live.

Members measured: Texas TWC (data.texas.gov Socrata), California EDD (xlsx),
Washington ESD (ASP.NET table plus per-notice PDF letters), New York DOL (legacy
per-notice PDFs). Join: WA ESD vs CA EDD by normalised employer name with
notice dates within 45 days (candidate; hand-checked rows kept, business names only).
PDF text uses the system `pdftotext` tool through subprocess when available.
No contact names, phones, emails or street addresses are written to the output.
Run: python3 -I warn_measure.py  (writes warn_measure.json next to this script)
"""
import json, re, time, html, io, os, sys, zipfile, datetime, subprocess, shutil, urllib.request, urllib.parse

UA = "data-foundry-scout/1.0 (data@mail.proviciency.com)"
HERE = os.path.dirname(os.path.abspath(__file__))


def get(u, data=None, n=None, tries=3):
    for i in range(tries):
        try:
            r = urllib.request.Request(u, data=data, headers={"User-Agent": UA})
            with urllib.request.urlopen(r, timeout=120) as f:
                return f.status, f.headers.get("Content-Type", ""), (f.read(n) if n else f.read())
        except Exception:  # transient transfer cut-offs through the proxy
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
    p = subprocess.run(["pdftotext", "-layout", "-", "-"], input=b, capture_output=True, timeout=60)
    return p.stdout.decode("utf8", "replace")


SUFFIX = r"\b(inc|incorporated|llc|l l c|ltd|co|corp|corporation|company|lp|llp|plc|the|dba)\b"


def norm(name):
    s = re.sub(r"\(.*?\)", " ", name.lower())
    s = re.sub(r"[^a-z0-9 ]", " ", s.replace("&", " and "))
    s = re.sub(SUFFIX, " ", s)
    return re.sub(r"\s+", " ", s).strip()


def mdY(s):
    return datetime.datetime.strptime(s.strip(), "%m/%d/%Y").date()


out = {"measured_on": datetime.date.today().isoformat(), "user_agent": UA}

# 1. Texas Workforce Commission WARN notices (Socrata 8w53-c4f6)
tx = {}
_, _, b = get("https://data.texas.gov/resource/8w53-c4f6.json?$select=count(*),min(notice_date),max(notice_date)")
tx["stats"] = json.loads(b)[0]
_, _, b = get("https://data.texas.gov/api/views/8w53-c4f6.json")
v = json.loads(b)
tx["columns"] = [c["fieldName"] for c in v.get("columns", [])]
tx["license"] = v.get("license")
tx["attribution"] = v.get("attribution")
tx["rows_updated_at"] = datetime.datetime.utcfromtimestamp(v["rowsUpdatedAt"]).isoformat() if v.get("rowsUpdatedAt") else None
tx["has_free_text"] = False
out["tx_twc"] = tx

# 2. California EDD WARN report (current fiscal-year xlsx)
ca = {"url": "https://edd.ca.gov/siteassets/files/jobs_and_training/warn/warn_report1.xlsx"}
st, ct, b = get(ca["url"])
ca["http"], ca["bytes"] = st, len(b)
z = zipfile.ZipFile(io.BytesIO(b))
ss = [html.unescape(re.sub(rb"<[^>]+>", b"", s).decode()) for s in re.findall(rb"<si>(.*?)</si>", z.read("xl/sharedStrings.xml"), re.S)]
sheets = re.findall(rb'<sheet name="([^"]+)"[^>]*r:id="(rId\d+)"', z.read("xl/workbook.xml"))
rels = dict((i.decode(), t.decode()) for i, t in re.findall(rb'Id="(rId\d+)"[^>]*Target="([^"]+)"', z.read("xl/_rels/workbook.xml.rels")))
rels.update(dict((i.decode(), t.decode()) for t, i in re.findall(rb'Target="([^"]+)"[^>]*Id="(rId\d+)"', z.read("xl/_rels/workbook.xml.rels"))))
ca["sheets"] = [n.decode() for n, _ in sheets]
det = [rels[r.decode()] for n, r in sheets if n.decode().strip() == "Detailed WARN Report"][0]
x = z.read("xl/" + det.lstrip("/").replace("xl/", "")).decode()
rows = []
for r in re.findall(r"<row[^>]*>(.*?)</row>", x, re.S):
    cells = {}
    for c in re.finditer(r'<c r="([A-Z]+)\d+"([^>]*?)(?:/>|>(.*?)</c>)', r, re.S):
        m = re.search(r"<v>(.*?)</v>", c.group(3) or "")
        val = m.group(1) if m else ""
        if 't="s"' in c.group(2) and val:
            val = ss[int(val)]
        cells[c.group(1)] = val
    rows.append(cells)
ca["title_cell"] = rows[0].get("A", "").replace("\r\n", " ")[:80]
ca["header"] = [rows[1].get(k, "").replace("\r\n", " ") for k in "ABCDEFGHI"]
data = [r for r in rows[2:] if r.get("B", "").isdigit() and r.get("E")]
xl = lambda n: datetime.date(1899, 12, 30) + datetime.timedelta(days=int(float(n)))
ca["rows"] = len(data)
ca["notice_date_min"] = min(xl(r["B"]) for r in data).isoformat()
ca["notice_date_max"] = max(xl(r["B"]) for r in data).isoformat()
ca["industry_fill"] = round(sum(bool(r.get("I")) for r in data) / len(data), 3)
ca["layoff_closure_values"] = sorted({r.get("F", "") for r in data})[:10]
ca["has_free_text"] = False
out["ca_edd"] = ca

# 3. Washington ESD WARN database (ASP.NET grid; Notice column links a PDF letter)
wa = {"url": "https://fortress.wa.gov/esd/file/WARN/Public/SearchWARN.aspx"}
_, _, b = get(wa["url"])
pages, warows = 0, []


def parse_wa(b):
    t = b.decode("utf8", "replace")
    res = []
    for r in re.findall(r"<tr>(.*?)</tr>", t, re.S):
        tds = re.findall(r"<td[^>]*>(.*?)</td>", r, re.S)
        if len(tds) != 8:
            continue
        cols = [html.unescape(re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", c))).strip() for c in tds[:7]]
        if not re.match(r"\d+/\d+/\d{4}$", cols[6]):
            continue
        f = re.search(r"DownloadFile\.aspx\?file=([0-9a-f-]+\.pdf)", tds[7])
        res.append({"company": cols[0], "layoff_start": cols[2], "workers": cols[3], "closure_layoff": cols[4],
                    "type": cols[5], "received": cols[6], "notice_file": f.group(1) if f else None})
    return t, res


t, res = parse_wa(b)
warows += res
pages = 1
MAXP = 12
while pages < MAXP:
    form = {k: v for k, v in re.findall(r'<input type="hidden" name="([^"]+)" id="[^"]*" value="([^"]*)"', t)}
    form = {k: html.unescape(v) for k, v in form.items()}
    form["__EVENTTARGET"] = "ucPSW$gvMain"
    form["__EVENTARGUMENT"] = "Page$%d" % (pages + 1)
    try:
        _, _, b = get(wa["url"], data=urllib.parse.urlencode(form).encode())
    except Exception as e:
        wa["paging_error"] = str(e)
        break
    t, res = parse_wa(b)
    if not res:
        break
    warows += res
    pages += 1
wa["pages_fetched"] = pages
wa["rows_fetched"] = len(warows)
wa["page_size"] = len(parse_wa(get(wa["url"])[2])[1])
wa["received_max"] = max(mdY(r["received"]) for r in warows).isoformat()
wa["received_min_in_fetched"] = min(mdY(r["received"]) for r in warows).isoformat()
wa["notice_pdf_fill"] = round(sum(bool(r["notice_file"]) for r in warows) / len(warows), 3)
pdfs = []
for r in [r for r in warows if r["notice_file"]][:8]:
    if sum(1 for p in pdfs if "words" in p) >= 4:
        break
    try:
        _, ct, pb = get("https://fortress.wa.gov/esd/file/WARN/Public/DownloadFile.aspx?file=%s&download=1" % r["notice_file"])
    except Exception as e:  # some letters are multi-MB scans; record the failure and move on
        pdfs.append({"notice_file": r["notice_file"], "error": str(e)[:80]})
        continue
    tx_ = pdf_text(pb)
    pdfs.append({"notice_file": r["notice_file"], "content_type": ct, "bytes": len(pb),
                 "words": len(tx_.split()) if tx_ is not None else None,
                 "mentions_warn_act": bool(tx_ and re.search(r"Worker Adjustment and Retraining|WARN", tx_)),
                 "states_reason_or_separation": bool(tx_ and re.search(r"clos|separat|layoff|lay off|eliminat|reduction", tx_, re.I))})
wa["notice_pdf_sample"] = pdfs
wa["has_free_text"] = True
out["wa_esd"] = wa

# 4. New York DOL legacy WARN notices (one PDF per notice; 2026 notices only in a Tableau dashboard)
ny = {"url": "https://dol.ny.gov/legacy-warn-notices"}
_, _, b = get(ny["url"])
links = sorted(set(re.findall(r'href="\s*(/warn-[^"]+)"', b.decode("utf8", "replace"))) - {"/warn-dashboard", "/warn-notice-pdf-instructions"})
ny["notice_links"] = len(links)
s = []
for l in links[:6]:
    _, ct, pb = get("https://dol.ny.gov" + l)
    t_ = pdf_text(pb) if pb[:4] == b"%PDF" else None
    s.append({"path": l[:80], "is_pdf": pb[:4] == b"%PDF", "words": len(t_.split()) if t_ else None,
              "has_fein": bool(t_ and re.search(r"FEIN NUM:\s*\d{2}-?\d{7}", t_)),
              "has_event_number": bool(t_ and re.search(r"Event Number:\s*\d{4}-\d{4}", t_)),
              "has_reason": bool(t_ and re.search(r"Reason For (Closure|Layoff|Dislocation)", t_, re.I)),
              "has_naics_industry": bool(t_ and re.search(r"Industry Type:\s*\d{2}", t_))})
ny["pdf_sample"] = s
_, _, b = get("https://dol.ny.gov/warn-dashboard")
ny["dashboard_is_tableau_public"] = b"public.tableau.com/views/WorkerAdjustmentRetrainingNotificationWARN" in b
try:
    st, ct, b = get("https://public.tableau.com/views/WorkerAdjustmentRetrainingNotificationWARN/WARN.csv")
    ny["tableau_csv"] = {"http": st, "content_type": ct}
except Exception as e:
    ny["tableau_csv"] = {"error": str(e)[:120]}
out["ny_dol"] = ny

# 5. Terms
terms = {}
_, _, b = get("https://edd.ca.gov/en/about_edd/conditions_of_use")
m = re.search(r"Most of the information on this website is considered public[^.]*\.", text(b))
terms["edd_conditions_of_use"] = m.group(0) if m else None
out["terms"] = terms

# 6. Join: WA ESD vs CA EDD, normalised employer name, notice dates within 45 days
caidx = {}
for r in data:
    caidx.setdefault(norm(r["E"]), []).append(r)
wa_in_window = [r for r in warows if mdY(r["received"]) >= datetime.date.fromisoformat(ca["notice_date_min"])]
checks, seen = [], set()
for r in wa_in_window:
    k = norm(r["company"])
    if not k or k in seen or k not in caidx:
        continue
    d = mdY(r["received"])
    near = [c for c in caidx[k] if abs((xl(c["B"]) - d).days) <= 45]
    if not near:
        continue
    seen.add(k)
    c = near[0]
    checks.append({"wa_company": r["company"], "wa_received": r["received"], "wa_type": r["closure_layoff"] + " " + r["type"],
                   "wa_notice_file": r["notice_file"], "ca_company": c["E"], "ca_notice_date": xl(c["B"]).isoformat(),
                   "ca_type": c.get("F"), "ca_industry": (c.get("I") or "")[:40], "ca_rows_same_name_in_window": len(near)})
distinct_wa = len({norm(r["company"]) for r in wa_in_window})
out["join_wa_ca"] = {"wa_rows_in_ca_window": len(wa_in_window), "wa_distinct_employers_in_window": distinct_wa,
                     "matched_employers": len(checks), "check_rows": checks}

# Hand-check (2026-11-14, reviewer read every check row): 6/6 rows are the same corporate employer in both
# states; 5/6 share the same notice date and type (one multi-state event); Uber differs by 42 days, so it is
# the same employer but a separate notice event.
out["hand_check"] = {"wa_ca_employer": {"correct": 6, "checked": 6}, "wa_ca_same_event": {"correct": 5, "checked": 6}}
json.dump(out, open(os.path.join(HERE, "warn_measure.json"), "w"), indent=1, default=str)
print(json.dumps(out, indent=1, default=str)[:7000])
