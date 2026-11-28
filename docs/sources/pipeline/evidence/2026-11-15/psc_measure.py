#!/usr/bin/env python3
"""Screening 2026-11-15: port-state-detentions. Fetches every source live (stdlib only).
Run from this directory with: python3 -I psc_measure.py   -> writes psc_measure.json
Output holds IMO numbers, dates, ports, flags, counts and field lists only (no company or person names).

Members:
  Transport Canada PSC detention list (wwwapps.tc.gc.ca): yearly lists + per-IMO detention history pages.
  UK MCA monthly "Foreign flagged ships detained in the UK" press releases (GOV.UK content API): prose per detention.
  Mediterranean MoU current detentions (EMSA THETIS-Med public REST JSON).
  Paris MoU current detentions (EMSA THETIS public REST JSON) and Tokyo MOU APCIS monthly detention list:
    measured, but their terms forbid reuse (RED), so they are context only.
  USCG, AMSA, Indian Ocean MoU, Black Sea MoU, Caribbean MoU, Abuja MoU, Equasis: reachability only.
Join (declared): IMO number. A UK- or Med-detained IMO is looked up in Transport Canada's per-IMO detention history.
"""
import json, re, time, urllib.request, urllib.parse, html as H
from collections import Counter

UA = "data-foundry-scout/1.0 (data@mail.proviciency.com)"
out = {"run_date": time.strftime("%Y-%m-%d")}


def get(u, data=None, tries=2, timeout=90):
    for i in range(tries):
        try:
            r = urllib.request.Request(u, data=data, headers={"User-Agent": UA, "Accept-Encoding": "identity"})
            with urllib.request.urlopen(r, timeout=timeout) as f:
                return f.status, f.geturl(), f.read()
        except urllib.error.HTTPError as e:
            if e.code >= 500 and i < tries - 1:
                time.sleep(10)
                continue
            return e.code, u, e.read()
        except Exception as e:
            if i == tries - 1:
                return 0, u, str(e).encode()
            time.sleep(5)


def text(s):
    return " ".join(H.unescape(re.sub(r"<[^>]+>", " ", s)).split())


def rows(s):
    return [[text(c) for c in re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", r, flags=re.S | re.I)]
            for r in re.findall(r"<tr[^>]*>(.*?)</tr>", s, flags=re.S | re.I)]


IMO = re.compile(r"^[1-9]\d{6}$")

# ---------------------------------------------------------------- 1. Transport Canada
TC = "https://wwwapps.tc.gc.ca/Saf-Sec-Sur/4/PSCQ-SRPSC/eng/detentions/"
tc = {}
for year in (2024, 2025, 2026):
    recs, n, total = [], 1, None
    while True:
        u = f"{TC}search-results?Year={year}" if n == 1 else f"{TC}search-results/{n}?Year={year}"
        s, fu, b = get(u)
        t = b.decode("utf8", "replace")
        if s != 200:
            tc[year] = {"status": s}
            break
        m = re.search(r"Showing items \d+ through (\d+) of (\d+)", text(t))
        total = int(m.group(2)) if m else 0
        for r in rows(t):
            if len(r) >= 7 and IMO.match(r[0]):
                recs.append({"imo": r[0], "flag": r[2], "type": r[3], "detained": r[4], "released": r[5], "port": r[6]})
        if not m or int(m.group(1)) >= total:
            break
        n += 1
        time.sleep(1)
    tc[year] = {"total_reported": total, "parsed": len(recs), "records": recs}
    time.sleep(1)
out["tc_years"] = {y: {k: v for k, v in d.items() if k != "records"} for y, d in tc.items()}
tc_all = [r for d in tc.values() for r in d.get("records", [])]
out["tc_newest_detention"] = max((r["detained"] for r in tc_all), default=None)
out["tc_ports_2026"] = Counter(r["port"] for r in tc.get(2026, {}).get("records", [])).most_common(10)
out["tc_flags_2026"] = Counter(r["flag"] for r in tc.get(2026, {}).get("records", [])).most_common(10)
out["tc_2026_records"] = [{k: r[k] for k in ("imo", "flag", "detained", "released", "port")} for r in tc.get(2026, {}).get("records", [])]


def tc_history(imo):
    s, fu, b = get(f"{TC}details/{imo}")
    if s != 200:
        return {"status": s, "detentions": []}
    t = b.decode("utf8", "replace")
    i = t.find("Days under Detention")
    det = []
    for r in rows(t[i:] if i > 0 else ""):
        if len(r) >= 5 and re.match(r"\d{4}-\d{2}-\d{2}", r[0]):
            det.append({"detained": r[0], "released": r[1], "days": r[2], "port": r[4], "deficiency_items": len(re.findall(r"\S", r[5])) > 0 if len(r) > 5 else False})
    return {"status": s, "detentions": det}


samp = {}
for r in tc.get(2026, {}).get("records", [])[:5]:
    h = tc_history(r["imo"])
    samp[r["imo"]] = {"status": h["status"], "detentions_listed": len(h["detentions"]),
                      "with_deficiency_text": sum(1 for d in h["detentions"] if d["deficiency_items"])}
    time.sleep(1)
out["tc_detail_samples"] = samp

# ---------------------------------------------------------------- 2. UK MCA monthly detention press releases
s, fu, b = get("https://www.gov.uk/api/search.json?filter_organisations=maritime-and-coastguard-agency&filter_format=press_release"
               "&count=1000&order=-public_timestamp&fields=title,link,public_timestamp")
res = json.loads(b)["results"] if s == 200 else []
rel = [r for r in res if re.search(r"(?i)ships detained in the UK", r["title"])]
out["mca_press_releases_total"] = len(res)
out["mca_detention_releases"] = len(rel)
out["mca_newest_release"] = max((r["public_timestamp"][:10] for r in rel), default=None)
out["mca_oldest_release"] = min((r["public_timestamp"][:10] for r in rel), default=None)
mca = []
for r in rel:
    s, fu, b = get("https://www.gov.uk/api/content" + r["link"])
    if s != 200:
        continue
    t = text(json.loads(b)["details"].get("body", ""))
    blocks = re.split(r"Vessel Name:", t)[1:]
    for blk in blocks:
        m = re.search(r"IMO(?: number)?:?\s*(\d{7})", blk)
        dm = re.search(r"Date and place of detention:\s*(\d{1,2} \w+ \d{4})\s*at\s*([A-Z][\w' -]+?)\s+Summary", blk)
        mca.append({"release": r["link"].rsplit("/", 1)[-1], "imo": m.group(1) if m else None,
                    "detained": dm.group(1) if dm else None, "port": dm.group(2) if dm else None,
                    "grounds_rows": len(re.findall(r"\b\d{5}\s*[–-]", blk)), "prose_chars": len(blk)})
    time.sleep(1)
out["mca_detentions_parsed"] = len(mca)
out["mca_with_imo"] = sum(1 for x in mca if x["imo"])
out["mca_with_date_and_port"] = sum(1 for x in mca if x["detained"])
out["mca_with_deficiency_codes"] = sum(1 for x in mca if x["grounds_rows"])
out["mca_median_prose_chars"] = sorted(x["prose_chars"] for x in mca)[len(mca) // 2] if mca else None
out["mca_records"] = [{k: x[k] for k in ("release", "imo", "detained", "port", "grounds_rows")} for x in mca]

# ---------------------------------------------------------------- 3. EMSA THETIS public REST: Med MoU (and Paris MoU, RED)
def thetis(ctx):
    s, fu, b = get(f"https://portal.emsa.europa.eu/o/{ctx}/rest/detention/getCurrentDetentions.json")
    if s != 200:
        return {"status": s}, []
    d = json.loads(b)
    rs = d.get("results", [])
    recs = [{"imo": x.get("imoNumber"), "detained": x.get("detentionDate"),
             "port": (x.get("detentionPort") or {}).get("name"),
             "authority": (x.get("detentionReportingAuthority") or {}).get("description"),
             "flag": (x.get("flag") or {}).get("description")} for x in rs]
    dates = [re.sub(r"(\d{2})/(\d{2})/(\d{4})", r"\3-\2-\1", r["detained"] or "") for r in recs]
    return {"status": s, "current_detentions": len(rs), "fields": sorted(rs[0].keys()) if rs else [],
            "newest_detention": max(dates, default=None), "oldest_detention": min(dates, default=None),
            "by_authority": Counter(r["authority"] for r in recs).most_common(20)}, recs


out["med_mou_thetis"], med = thetis("portlet-thetismed-public")
out["med_mou_records"] = med
time.sleep(1)
out["paris_mou_thetis"], paris = thetis("portlet-public")
out["paris_mou_imos"] = [r["imo"] for r in paris]

# ---------------------------------------------------------------- 4. Tokyo MOU APCIS monthly list (RED; context only)
tok = []
for mon in ("09", "10"):
    body = urllib.parse.urlencode({"Mode": "DetList", "MOU": "TMOU", "Auth": "", "Src": "online", "Type": "Auth",
                                   "Month": mon, "Year": "2026", "SaveFile": ""}).encode()
    s, fu, b = get("https://apcis.tmou.org/isss/public_apcis.php?Mode=DetList", data=body)
    t = b.decode("utf8", "replace")
    n = 0
    for r in rows(t[t.find("DETENTION LIST"):]):
        if len(r) >= 14 and IMO.match(r[1]):
            tok.append({"month": f"2026-{mon}", "imo": r[1], "flag": r[3], "place": r[10], "detained": r[11],
                        "released": r[12], "deficiency_codes": len(re.findall(r"\b\d{5} - ", r[13]))})
            n += 1
    out.setdefault("tokyo_mou_2026_months", {})[mon] = {"status": s, "rows": n}
    time.sleep(2)
out["tokyo_with_deficiency_codes"] = sum(1 for x in tok if x["deficiency_codes"])

# ---------------------------------------------------------------- 5. Joins on IMO number
tc_imos = {r["imo"] for r in tc_all}
# (a) UK MCA detained IMOs -> Transport Canada per-IMO detention history
mca_imos = sorted({x["imo"] for x in mca if x["imo"]})
hits = {}
for imo in mca_imos:
    h = tc_history(imo)
    hits[imo] = {"status": h["status"], "tc_detentions": [(d["detained"], d["port"]) for d in h["detentions"]]}
    time.sleep(1)
m = [i for i, h in hits.items() if h["tc_detentions"]]
out["join_mca_to_tc_history"] = {"mca_imos": len(mca_imos), "imos_with_tc_detention": len(m),
                                 "statuses": dict(Counter(h["status"] for h in hits.values())),
                                 "matched": {i: hits[i]["tc_detentions"] for i in m}}
# (b) Med MoU current IMOs -> TC per-IMO history
med_imos = sorted({r["imo"] for r in med if r["imo"]})
mh = {}
for imo in med_imos:
    h = tc_history(imo)
    mh[imo] = [(d["detained"], d["port"]) for d in h["detentions"]]
    time.sleep(1)
out["join_med_to_tc_history"] = {"med_imos": len(med_imos), "imos_with_tc_detention": sum(1 for v in mh.values() if v),
                                 "matched": {k: v for k, v in mh.items() if v}}
# (c) list-level overlaps
out["overlap_tc_2024_2026_vs_mca"] = len(tc_imos & set(mca_imos))
out["overlap_tc_2024_2026_vs_med_current"] = len(tc_imos & set(med_imos))
out["overlap_tc_2024_2026_vs_paris_current_RED"] = len(tc_imos & {r["imo"] for r in paris})
# (d) event-level, context only (Tokyo RED): Canadian Pacific detentions in the Tokyo list vs TC 2026 list (IMO + date)
tc26 = {(r["imo"], r["detained"]) for r in tc.get(2026, {}).get("records", [])}
tk_ca = [x for x in tok if x["place"].endswith("Canada")]
out["context_tokyo_canada_events_in_tc_RED"] = {
    "tokyo_rows_in_canada": len(tk_ca),
    "same_imo_and_date_in_tc": sum(1 for x in tk_ca if (x["imo"], re.sub(r"(\d{2})\.(\d{2})\.(\d{4})", r"\3-\2-\1", x["detained"])) in tc26)}

# ---------------------------------------------------------------- 6. reachability of other authorities
other = {}
for k, url in [("uscg_psc_page", "https://www.dco.uscg.mil/Our-Organization/Assistant-Commandant-for-Prevention-Policy-CG-5P/Inspections-Compliance-CG-5PC-/Commercial-Vessel-Compliance/Foreign-Offshore-Compliance-Division/PortStateControl/"),
               ("uscg_psix", "https://cgmix.uscg.mil/PSIX/PSIXSearch.aspx"),
               ("amsa_detained_ships", "https://www.amsa.gov.au/vessels-operators/port-state-control/detained-ships"),
               ("iomou", "https://www.iomou.org/"),
               ("bsmou", "https://www.bsmou.org/"),
               ("caribbean_mou", "https://www.caribbeanmou.org/content/inspection-detention-data"),
               ("abuja_mou", "https://abujamou.org/detention-list"),
               ("equasis", "https://www.equasis.org/EquasisWeb/public/HomePage")]:
    s, fu, b = get(url, tries=1, timeout=45)
    t = b.decode("utf8", "replace")
    other[k] = {"status": s, "final_url": fu, "imo_numbers_on_page": len(set(re.findall(r"\b9\d{6}\b|\b8\d{6}\b", text(t)))),
                "mentions_login": bool(re.search(r"(?i)log ?in|sign ?in|password", t)),
                "body_head": text(t)[:120] if s != 200 else None}
    time.sleep(1)
out["other_authorities"] = other

json.dump(out, open("psc_measure.json", "w"), indent=1, ensure_ascii=False)
print(json.dumps({k: v for k, v in out.items() if not k.endswith("records") and k != "paris_mou_imos"}, indent=1, ensure_ascii=False)[:7000])
