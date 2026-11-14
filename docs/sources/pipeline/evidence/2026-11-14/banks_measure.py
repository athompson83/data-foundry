#!/usr/bin/env python3
"""Screening 2026-11-14: financial-institution-registry.

Re-fetches every member live (stdlib only, declared UA) and writes banks_measure.json
next to this script. Stores identifiers and counts only; individual names in the
Federal Reserve enforcement list are never stored.
"""
import csv, io, json, os, re, time, urllib.error, urllib.request, zipfile, collections

UA = "data-foundry-scout/1.0 (data@mail.proviciency.com)"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "banks_measure.json")


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k):
        return None


def get(u, follow=True, limit=None):
    req = urllib.request.Request(u, headers={"User-Agent": UA})
    opener = urllib.request.build_opener() if follow else urllib.request.build_opener(NoRedirect)
    try:
        with opener.open(req, timeout=120) as f:
            return f.status, (f.read(limit) if limit else f.read()), f.headers
    except urllib.error.HTTPError as e:
        return e.code, e.read(limit or 400000), e.headers


def text(b):
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", b.decode("utf8", "replace")))


out = {"measured_on": "2026-11-14"}

# 1. FDIC BankFind institutions (structured; FED_RSSD, RSSDHCR, NAMEHCR, LEI)
st, b, _ = get("https://api.fdic.gov/banks/institutions?limit=1&format=json&fields=CERT")
out["fdic_institutions_all_total"] = json.loads(b)["meta"]["total"] if st == 200 else st
fields = "CERT,FED_RSSD,RSSDHCR,NAME,CITY,STALP,STNAME,NAMEHCR,CITYHCR,STALPHCR,LEI,CHRTAGNT,REGAGNT,BKCLASS,DATEUPDT"
st, b, _ = get(f"https://api.fdic.gov/banks/institutions?filters=ACTIVE:1&limit=10000&format=json&fields={fields}")
inst = [r["data"] for r in json.loads(b)["data"]]
out["fdic_institutions_active_status"] = st
out["fdic_institutions_active"] = len(inst)
nz = lambda v: v not in (None, "", "0", 0)
out["fdic_active_fill"] = {k: sum(nz(r.get(k)) for r in inst) for k in ["FED_RSSD", "RSSDHCR", "NAMEHCR", "LEI"]}
out["fdic_active_newest_DATEUPDT"] = max((r.get("DATEUPDT") or "") for r in inst)
fdic_by_rssd = {str(r["FED_RSSD"]): r for r in inst if nz(r.get("FED_RSSD"))}

# 2. FDIC structure history events
st, b, _ = get("https://api.fdic.gov/banks/history?limit=500&sort_by=PROCDATE&sort_order=DESC&format=json"
               "&fields=CERT,FI_UNINUM,CHANGECODE,CHANGECODE_DESC,EFFDATE,PROCDATE,ACQ_UNINUM,OUT_UNINUM")
h = json.loads(b)
ev = [r["data"] for r in h["data"]]
out["fdic_history_status"] = st
out["fdic_history_total_events"] = h["meta"]["total"]
out["fdic_history_newest_PROCDATE"] = ev[0].get("PROCDATE") if ev else None
out["fdic_history_sample_change_types"] = collections.Counter(e.get("CHANGECODE_DESC") for e in ev).most_common(12)
out["fdic_history_sample_with_desc"] = f"{sum(bool(e.get('CHANGECODE_DESC')) for e in ev)}/{len(ev)}"

# 3. Federal Reserve Large Commercial Banks release (Bank ID = RSSD)
st, b, _ = get("https://www.federalreserve.gov/releases/lbr/current/lrg_bnk_lst.txt")
lb = b.decode("latin-1")
out["fed_lbr_status"] = st
m = re.search(r"As of ([A-Z][a-z]+ \d{1,2}, \d{4})", lb)
out["fed_lbr_as_of"] = m.group(1) if m else None
rows = re.findall(r"^.{27}\s+(\d+)\s+(\d{3,10})\s{2,}\S", lb, re.M)
ids = [r[1] for r in rows]
out["fed_lbr_banks"] = len(ids)
hit = [i for i in ids if i in fdic_by_rssd]
out["join_lbr_bankid_to_fdic_fed_rssd"] = f"{len(hit)}/{len(ids)}"
out["join_lbr_sample_rows"] = [{"rssd": i, "fdic_cert": fdic_by_rssd[i]["CERT"]} for i in hit[:20]]
out["join_lbr_unmatched_rssd_sample"] = [i for i in ids if i not in fdic_by_rssd][:20]

# 4. NCUA credit union call report (FOICU carries RSSD)
st, b, _ = get("https://ncua.gov/files/publications/analysis/call-report-data-2026-06.zip")
out["ncua_status"] = st
out["ncua_zip_bytes"] = len(b)
z = zipfile.ZipFile(io.BytesIO(b))
out["ncua_files"] = len(z.infolist())
foicu = list(csv.DictReader(io.TextIOWrapper(z.open("FOICU.txt"), encoding="latin-1")))
out["ncua_credit_unions"] = len(foicu)
out["ncua_cycle_date"] = foicu[0]["CYCLE_DATE"] if foicu else None
out["ncua_rssd_fill"] = f"{sum(nz(r['RSSD'].strip()) for r in foicu)}/{len(foicu)}"
out["ncua_rssd_overlap_fdic_fed_rssd"] = sum(r["RSSD"].strip() in fdic_by_rssd for r in foicu)

# 5. Federal Reserve enforcement actions (free text: press release + attached order PDF)
st, b, _ = get("https://www.federalreserve.gov/supervisionreg/files/enforcementactions.csv")
ea = list(csv.DictReader(io.StringIO(b.decode("utf-8-sig"))))
out["fed_ea_status"] = st
out["fed_ea_rows"] = len(ea)
out["fed_ea_newest"] = max(r["Effective Date"] for r in ea)
orgs = [r for r in ea if not r["Individual"].strip() and r["Banking Organization"].strip()]
out["fed_ea_banking_org_rows"] = len(orgs)
out["fed_ea_individual_rows_excluded"] = len(ea) - len(orgs)
state_abbr = {r["STNAME"].upper(): r["STALP"] for r in inst}


def norm(s):
    s = s.upper().replace("&", " AND ")
    s = re.sub(r"[.,'\"()]", " ", s)
    s = re.sub(r"\bINCORPORATED\b", "INC", s)
    s = re.sub(r"\bNATIONAL ASSOCIATION\b", "NA", s)
    s = re.sub(r"^THE\s+", "", s.strip())
    return re.sub(r"\s+", " ", s).strip()


idx = collections.defaultdict(list)
for r in inst:
    idx[(norm(r["NAME"]), (r["CITY"] or "").upper(), r["STALP"])].append(("bank", r))
    if r.get("NAMEHCR"):
        idx[(norm(r["NAMEHCR"]), (r.get("CITYHCR") or "").upper(), r.get("STALPHCR"))].append(("holding", r))
recent = [r for r in orgs if r["Effective Date"] >= "2016-01-01"]
matches = []
for r in recent:
    first = r["Banking Organization"].split(";")[0].strip()
    parts = [p.strip() for p in first.split(",")]
    if len(parts) < 3:
        continue
    name, city, state = ", ".join(parts[:-2]), parts[-2].upper(), state_abbr.get(parts[-1].upper())
    c = idx.get((norm(name), city, state))
    if c:
        role, i = c[0]
        matches.append({"fed_ea_url": r["URL"], "effective": r["Effective Date"], "role": role,
                        "fdic_cert": i["CERT"], "fed_rssd": i["FED_RSSD"], "rssdhcr": i.get("RSSDHCR")})
out["join_fed_ea_to_fdic_name_city_state"] = f"{len(matches)}/{len(recent)} banking-organization actions since 2016"
out["join_fed_ea_check_rows"] = matches[:15]

# Reviewer verdicts (2026-11-14): the Fed-named organisation is the FDIC bank itself (role "bank") or the
# bank's holding company (role "holding", link at RSSDHCR level, not to a specific subsidiary bank).
HAND_CHECK = {
    ("/newsevents/pressreleases/enforcement20260820b.htm", 58088): True,
    ("/newsevents/pressreleases/enforcement20251106a.htm", 15362): True,
    ("/newsevents/pressreleases/enforcement20251106a.htm", 17451): True,
    ("/newsevents/pressreleases/enforcement20250320a.htm", 18053): True,
    ("/newsevents/pressreleases/enforcement20250320a.htm", 1484): True,
    ("/newsevents/pressreleases/enforcement20241203a.htm", 3818): True,
    ("/newsevents/pressreleases/enforcement20241003a.htm", 30182): True,
    ("/newsevents/pressreleases/enforcement20240904a.htm", 1105): True,
    ("https://www.federalreserve.gov/newsevents/pressreleases/enforcement20240723a.htm", 8850): True,
    ("/newsevents/pressreleases/enforcement20240719a.htm", 30943): True,
    ("/newsevents/pressreleases/enforcement20240710a.htm", 7213): True,
    ("https://www.federalreserve.gov/newsevents/pressreleases/enforcement20240314a.htm", 8122): True,
    ("https://www.federalreserve.gov/newsevents/pressreleases/enforcement20240314a.htm", 21761): True,
    ("https://www.federalreserve.gov/newsevents/pressreleases/enforcement20240213a.htm", 58563): True,
    ("/newsevents/pressreleases/enforcement20231019a.htm", 34699): True,
}
chk = [dict(m, correct=HAND_CHECK[(m["fed_ea_url"], m["fdic_cert"])]) for m in matches if (m["fed_ea_url"], m["fdic_cert"]) in HAND_CHECK]
out["hand_check_fed_ea_fdic"] = {"checked": len(chk), "correct": sum(c["correct"] for c in chk)}

# Free-text fill: press release pages with an attached order document
pr = [r for r in recent if "pressreleases" in r["URL"]][:12]
att = []
for r in pr:
    u = r["URL"] if r["URL"].startswith("http") else "https://www.federalreserve.gov" + r["URL"]
    s2, b2, _ = get(u)
    att.append({"url": u, "status": s2, "has_pdf": bool(re.search(r'href="[^"]+\.pdf"', b2.decode("utf8", "replace")))})
    time.sleep(1)
out["fed_ea_press_release_pdf_fill"] = f"{sum(a['has_pdf'] for a in att)}/{len(att)}"
out["fed_ea_press_release_sample"] = att

# 6. FFIEC National Information Center and OCC lists (reachability only)
st, b, _ = get("https://www.ffiec.gov/npw/FinancialReport/DataDownload")
out["ffiec_nic_status"] = st
out["ffiec_nic_captcha_marker"] = bool(re.search(r"captcha", b.decode("utf8", "replace"), re.I))
st, b, hd = get("https://www.occ.gov/topics/charters-and-licensing/financial-institution-lists/index-financial-institution-lists.html", follow=False)
out["occ_lists_status"] = st
out["occ_lists_location"] = hd.get("Location") if hd else None
st, b, _ = get("https://apps.occ.gov/EASearch/api/WebSearch/Count")
out["occ_ea_count_status"] = st
out["occ_ea_count"] = b.decode("utf8", "replace")[:40]

# 7. Terms
st, b, _ = get("https://www.federalreserve.gov/disclaimer.htm")
m = re.search(r"Unless otherwise indicated, information on Board.s website is in the public domain[^.]*\.", text(b))
out["fed_terms"] = m.group(0) if m else st

json.dump(out, open(OUT, "w"), indent=1, default=str)
print(json.dumps(out, indent=1, default=str)[:6000])
