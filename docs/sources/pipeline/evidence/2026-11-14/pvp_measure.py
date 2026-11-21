#!/usr/bin/env python3
"""Screening 2026-11-14: plant-variety-protections. Fetches every source live (stdlib only).
Run from this directory with: python3 -I pvp_measure.py   -> writes pvp_measure.json
Committed output keeps identifiers (PVP number, PI number, CFIA application number), counts and
denominations only; owner, breeder and agent names and addresses are never written."""
import json, re, time, html as H, urllib.request, urllib.parse, http.cookiejar, collections

UA = "data-foundry-scout/1.0 (data@mail.proviciency.com)"
out = {"run_date": time.strftime("%Y-%m-%d")}
op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))


def get(u, data=None, n=None, headers=None):
    h = {"User-Agent": UA}
    h.update(headers or {})
    try:
        with op.open(urllib.request.Request(u, data=data, headers=h), timeout=120) as f:
            return f.status, f.geturl(), (f.read(n) if n else f.read())
    except urllib.error.HTTPError as e:
        return e.code, u, b""
    except Exception as e:
        return 0, u, str(e).encode()


def text(b, enc="utf8"):
    h = b.decode(enc, "replace")
    h = re.sub(r"(?s)<(script|style).*?</(script|style)>", " ", h)
    return " ".join(H.unescape(re.sub(r"<[^>]+>", " ", h)).split())


# --- 1. USDA AMS PVPO Online Dashboard API (structured) -------------------
API = "https://pvpocomingsoon.scinet.usda.gov/api/amsapi?request="
s, u, b = get(API + "cropkinds")
kinds = json.loads(b) if s == 200 else []
out["pod_cropkinds"] = {"status": s, "count": len(kinds)}
pod = {}
for crop in ("Lentil", "Barley"):
    s, u, b = get(API + "pv&cropKind=" + urllib.parse.quote(crop))
    rows = json.loads(b) if s == 200 else []
    recs = {}
    for r in rows:
        recs.setdefault(r["PVPO_Number"], r)
    v = list(recs.values())
    pod[crop] = v
    issued = [r for r in v if r.get("Issue_Date") not in (None, "NaN")]
    out["pod_" + crop.lower()] = {
        "status": s, "rows": len(rows), "distinct_pvpo_numbers": len(v), "bytes": len(b),
        "fields": sorted(rows[0].keys()) if rows else [],
        "status_values": dict(collections.Counter(r["Status"] for r in v)),
        "with_pi_number": sum(1 for r in v if r.get("Plant_Introduction_Number") not in (None, "NaN", "")),
        "with_upov_code": sum(1 for r in v if r.get("UPOV_Code") not in (None, "NaN", "")),
        "newest_filing_date": max((r["Filing_Date"] for r in v if r.get("Filing_Date") not in (None, "NaN")), default=None),
        "newest_issue_date": max((r["Issue_Date"] for r in issued), default=None),
    }
    time.sleep(1)

# --- 2. USDA AMS Certificate Management System (scanned certificate PDFs, free text) ---
s, u, b = get("https://apps.ams.usda.gov/CMS/")
h = b.decode("utf8", "replace")
out["cms_status"] = s
f = lambda n: H.unescape(re.search(r'name="%s"[^>]*value="([^"]*)"' % n, h).group(1))
m = re.search(r"PostBackOptions\(&quot;([^&]+)&quot;[^>]*>Lentil\s*<", h)
form = urllib.parse.urlencode({"__EVENTTARGET": m.group(1), "__EVENTARGUMENT": "", "__VIEWSTATE": f("__VIEWSTATE"),
                               "__VIEWSTATEGENERATOR": f("__VIEWSTATEGENERATOR"), "__EVENTVALIDATION": f("__EVENTVALIDATION")}).encode()
s, u, b = get("https://apps.ams.usda.gov/CMS/", data=form, headers={"Referer": "https://apps.ams.usda.gov/CMS/"})
pdfs = sorted(set(re.findall(r"AdobeImages/(\d{9})\.pdf", b.decode("utf8", "replace"))))
out["cms_lentil_list"] = {"status": s, "certificate_pdfs": len(pdfs)}
lentil_nums = {f"{r['PVPO_Number']:09d}" for r in pod.get("Lentil", [])}
out["cms_lentil_pdfs_in_pod"] = f"{sum(1 for p in pdfs if p in lentil_nums)}/{len(pdfs)}"
pdf_checks = []
for p in pdfs[-1:]:
    s, u, b = get(f"https://apps.ams.usda.gov/CMS//AdobeImages/{p}.pdf")
    pdf_checks.append({"pv_number": p, "status": s, "bytes": len(b), "is_pdf": b[:5] == b"%PDF-",
                       "scanned": b"Scanner" in b[:4000] or b"PDFScanLib" in b, "pages": len(re.findall(rb"/Type\s*/Page[^s]", b))})
    time.sleep(1)
out["cms_pdf_checks"] = pdf_checks

# --- 3. USDA ARS GRIN-Global accession pages: PI number -> IPR block cites the PVP number ---
by_pi = [r for c in ("Lentil", "Barley") for r in pod.get(c, [])
         if r.get("Plant_Introduction_Number") not in (None, "NaN", "") and r["Status"] == "Certificate Issued"]
by_pi.sort(key=lambda r: r["PVPO_Number"])
step = max(1, len(by_pi) // 20)
sample = by_pi[::step][:20]
checks = []
for r in sample:
    pi = re.sub(r"^PI\s*", "", str(r["Plant_Introduction_Number"]).strip()).split(".")[0]
    s, u, b = get("https://npgsweb.ars-grin.gov/gringlobal/accessiondetail?accid=" + urllib.parse.quote("PI " + pi))
    t = text(b)
    cited = re.findall(r"PVP (\d{9})", t)
    cv = re.search(r"Cultivar: '([^']+)'", t)
    ped = re.search(r"Pedigree (.{0,40})", t)
    checks.append({"pvpo_number": r["PVPO_Number"], "pi_number": pi, "status": s,
                   "grin_cites_pvp": cited[:2], "pvp_number_equal": f"{r['PVPO_Number']:09d}" in cited,
                   "denomination_equal": bool(cv) and cv.group(1).strip().lower() == str(r["Variety_Name"]).strip().lower(),
                   "pod_denomination": r["Variety_Name"], "grin_cultivar": cv.group(1) if cv else None,
                   "grin_has_narrative_text": "Narrative" in t})
    time.sleep(1.0)
out["grin_join_sampled"] = len(checks)
out["grin_join_pvp_number_equal"] = f"{sum(c['pvp_number_equal'] for c in checks)}/{len(checks)}"
out["grin_join_denomination_equal"] = f"{sum(c['denomination_equal'] for c in checks)}/{len(checks)}"
out["grin_join_checks"] = checks

# --- 4. CFIA Plant Breeders' Rights (HTML pages, free-text variety descriptions) ---
s, u, b = get("https://active.inspection.gc.ca/english/plaveg/pbrpov/cropreport/gsae.shtml")
apps = sorted(set(re.findall(r'href="([a-z]+/app\d+e\.shtml)"', b.decode("latin1"))))
out["cfia_botanical_A"] = {"status": s, "application_pages_listed": len(apps)}
cf = []
for a in apps[:: max(1, len(apps) // 6)][:6]:
    s, u, b = get("https://active.inspection.gc.ca/english/plaveg/pbrpov/cropreport/" + a)
    t = text(b, "latin1")
    g = lambda pat: (re.search(pat, t) or [None, None])[1]
    cf.append({"page": a, "status": s, "application_number": g(r"Application Number: (\S+)"),
               "certificate_number": g(r"Certificate Number: (\d+)"), "grant_date": g(r"Grant of Rights Date: (\S+)"),
               "has_description": "Variety Description" in t,
               "description_chars": len(t.split("Variety Description", 1)[1]) if "Variety Description" in t else 0,
               "has_breeding_history": "Breeding History" in t})
    time.sleep(1)
out["cfia_sample"] = cf
s, u, b = get("https://www.canada.ca/en/transparency/terms.html")
t = text(b)
i = t.find("Commercial reproduction")
out["cfia_terms"] = {"status": s, "commercial_clause": t[i:i + 230] if i >= 0 else None}

# --- 5. EU CPVO and UPOV PLUTO (access check only) -------------------------
s, u, b = get("https://online.plantvarieties.eu/")
out["cpvo_variety_finder"] = {"status": s, "bytes": len(b), "spa_shell": b"main." in b and b"<div id" in b,
                              "recaptcha_marker": b"grecaptcha" in b}
s, u, b = get("https://pluto.upov.int/user/en/")
out["upov_pluto"] = {"status": s, "final_url": u, "bytes": len(b), "spa_shell": len(b) < 20000}

json.dump(out, open("pvp_measure.json", "w"), indent=1, default=str)
print(json.dumps({k: v for k, v in out.items() if k not in ("grin_join_checks",)}, indent=1, default=str)[:6000])
