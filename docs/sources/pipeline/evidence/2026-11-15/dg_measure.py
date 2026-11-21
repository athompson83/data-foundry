#!/usr/bin/env python3
"""Screening 2026-11-15: dangerous-goods-classifications. Fetches every source live (stdlib only).
Run from this directory with: python3 -I dg_measure.py   -> writes dg_measure.json
Output holds UN numbers, proper shipping names (public regulatory text), classes and counts only.

Members screened:
  US 49 CFR 172.101 Hazardous Materials Table (GovInfo annual CFR XML, 2025-10-01 edition)
  Canada TDG Regulations Schedule 1 (Justice Laws XML, SOR/2001-286)
  US CDC NIOSH Pocket Guide pages ("DOT ID & Guide" prose field: UN/NA number + ERG guide)
  NOAA CAMEO Chemicals (UN/NA datasheets and chemical datasheets; robots.txt disallows /help and /search, which are not fetched)
  Reachability only: PHMSA (phmsa.dot.gov), UNECE (unece.org), NTC Australia (ntc.gov.au)
"""
import html as H
import json
import re
import time
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET

UA = "data-foundry-scout/1.0 (data@mail.proviciency.com)"
out = {"run_date": time.strftime("%Y-%m-%d")}
IDRE = re.compile(r"(UN|NA|ID)\d{4}")


def get(u, tries=3):
    for i in range(tries):
        try:
            r = urllib.request.Request(u, headers={"User-Agent": UA, "Accept-Encoding": "identity"})
            with urllib.request.urlopen(r, timeout=90) as f:
                return f.status, f.geturl(), f.read()
        except urllib.error.HTTPError as e:
            if e.code >= 500 and i < tries - 1:
                time.sleep(10)
                continue
            return e.code, u, e.read()
        except Exception as e:
            if i == tries - 1:
                return 0, u, str(e).encode()
            time.sleep(3)


def txt(e):
    return " ".join("".join(e.itertext()).split())


def lines(b):
    s = b.decode("utf8", "replace")
    s = re.sub(r"(?s)<script.*?</script>|<style.*?</style>", "", s)
    t = H.unescape(re.sub(r"<[^>]+>", "\n", s))
    return [" ".join(x.split()) for x in t.split("\n") if x.strip()]


def pclass(c):
    return re.split(r"[\s(]", (c or "").strip())[0]


def pnorm(s):
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())


# --- 1. US 49 CFR 172.101 HMT ----------------------------------------------------------------------------
s, u, b = get("https://www.govinfo.gov/content/pkg/CFR-2025-title49-vol2/xml/CFR-2025-title49-vol2-sec172-101.xml")
root = ET.fromstring(b)
hmt_tab = next(t for t in root.iter("GPOTABLE") if t.get("COLS") == "14")
us = []
for row in hmt_tab.iter("ROW"):
    e = [txt(x) for x in row.findall("ENT")]
    if len(e) >= 4 and IDRE.fullmatch(e[3]):
        us.append({"symbols": e[0], "name": e[1], "class": e[2], "id": e[3], "pg": e[4] if len(e) > 4 else "",
                   "sp": e[6] if len(e) > 6 else ""})
by_un = {}
for r in us:
    by_un.setdefault(r["id"], []).append(r)
out["us_hmt"] = {"status": s, "edition_date": root.findtext(".//DATE"), "bytes": len(b), "entries_with_id": len(us),
                 "distinct_ids": len(by_un), "un_ids": sum(1 for k in by_un if k.startswith("UN")),
                 "na_ids": sum(1 for k in by_un if k.startswith("NA")), "id_ids": sum(1 for k in by_un if k.startswith("ID")),
                 "entries_with_special_provisions": sum(1 for r in us if r["sp"]),
                 "forbidden_rows": sum(1 for row in hmt_tab.iter("ROW") if any(txt(x) == "Forbidden" for x in row.findall("ENT")[2:3]))}
time.sleep(1)

# --- 2. Canada TDG Schedule 1 ----------------------------------------------------------------------------
s, u, b = get("https://laws-lois.justice.gc.ca/eng/XML/SOR-2001-286.xml")
root = ET.fromstring(b)
ca = []
for sch in root.iter("Schedule"):
    lab = sch.find(".//ScheduleFormHeading/Label")
    if lab is None or lab.text != "SCHEDULE 1":
        continue
    for row in sch.iter("row"):
        e = [txt(x) for x in row.findall("entry")]
        if e and re.fullmatch(r"(UN|NA)\d{4}", e[0]):
            ca.append({"id": e[0], "name": e[1] if len(e) > 1 else "", "class": e[2] if len(e) > 2 else "",
                       "pg": e[3] if len(e) > 3 else "", "sp": e[4] if len(e) > 4 else ""})
ca_un = {}
for r in ca:
    ca_un.setdefault(r["id"], []).append(r)
out["ca_tdg"] = {"status": s, "last_amended": root.get("{http://justice.gc.ca/lims}lastAmendedDate"),
                 "current_date": root.get("{http://justice.gc.ca/lims}current-date"), "bytes": len(b),
                 "schedule1_rows": len(ca), "distinct_un": len(ca_un), "rows_with_special_provisions": sum(1 for r in ca if r["sp"])}

# --- 3. Declared join: UN number (US HMT <-> TDG Schedule 1) ----------------------------------------------
us_un = {k for k in by_un if k.startswith("UN")}
common = sorted(us_un & set(ca_un))
cls_agree = sum(1 for k in common if {pclass(r["class"]) for r in by_un[k]} & {pclass(r["class"]) for r in ca_un[k]})
psn_agree = sum(1 for k in common if {pnorm(r["name"])[:25] for r in by_un[k]} & {pnorm(r["name"])[:25] for r in ca_un[k]})
out["join_us_ca_un"] = {"us_un_in_ca": f"{len(common)}/{len(us_un)}", "ca_un_in_us": f"{len(common)}/{len(ca_un)}",
                        "primary_class_agrees": f"{cls_agree}/{len(common)}",
                        "name_prefix25_agrees": f"{psn_agree}/{len(common)}",
                        "name_disagreement_examples": [(k, by_un[k][0]["name"][:50], ca_un[k][0]["name"][:50]) for k in common
                                                       if not ({pnorm(r["name"])[:25] for r in by_un[k]} & {pnorm(r["name"])[:25] for r in ca_un[k]})][:10],
                        "only_us_examples": sorted(us_un - set(ca_un))[:10], "only_ca_examples": sorted(set(ca_un) - us_un)[:10]}
time.sleep(1)

# --- 4. NIOSH Pocket Guide "DOT ID & Guide" (free-text field citing UN/NA numbers) ------------------------
s, u, b = get("https://www.cdc.gov/niosh/npg/npgdcas.html")
pages = sorted(set(re.findall(r"href='(npgd\d{4})\.html'", b.decode("utf8", "replace"))))
out["niosh_index"] = {"status": s, "pages": len(pages)}
smp = pages[:: max(1, len(pages) // 30)][:30]
nio = []
for p in smp:
    s, u, b = get(f"https://www.cdc.gov/niosh/npg/{p}.html")
    L = lines(b)
    dot = next((" ".join(L[k + 1:k + 3]) for k, l in enumerate(L) if l == "DOT ID & Guide" and k + 1 < len(L)), None)
    pairs = re.findall(r"\b(\d{4})\s+(\d{3}P?)\b", dot or "")
    rec = {"page": p, "status": s, "dot_field": (dot or "")[:60], "pairs": pairs}
    rec["in_us_hmt"] = [n for n, g in pairs if ("UN" + n) in by_un or ("NA" + n) in by_un]
    rec["in_ca_tdg"] = [n for n, g in pairs if ("UN" + n) in ca_un]
    nio.append(rec)
    time.sleep(1)
with_ids = [r for r in nio if r["pairs"]]
out["niosh_dot"] = {"sampled": len(nio), "pages_200": sum(r["status"] == 200 for r in nio), "with_dot_id": len(with_ids),
                    "join_niosh_to_us_hmt": f"{sum(1 for r in with_ids if r['in_us_hmt'])}/{len(with_ids)}",
                    "join_niosh_to_ca_tdg": f"{sum(1 for r in with_ids if r['in_ca_tdg'])}/{len(with_ids)}", "rows": nio}

# --- 5. NOAA CAMEO Chemicals ------------------------------------------------------------------------------
s, u, b = get("https://cameochemicals.noaa.gov/robots.txt")
out["cameo_robots"] = {"status": s, "disallow": re.findall(r"Disallow: (\S+)", b.decode("utf8", "replace"))}
uns = sorted(us_un & set(ca_un))
cam = []
for k in uns[:: max(1, len(uns) // 20)][:20]:
    n = k[2:]
    s, u, b = get(f"https://cameochemicals.noaa.gov/unna/{n}")
    L = lines(b)
    rec = {"un": k, "status": s}
    m = re.search(r"CAMEO Chemicals has (\d+) chemical datasheets?", " ".join(L))
    rec["datasheets"] = int(m.group(1)) if m else 0
    g = re.search(r"Response Guide (\d{3}P?)", " ".join(L))
    rec["erg_guide"] = g.group(1) if g else None
    rec["names_in_page"] = sum(1 for r in by_un[k] if r["name"] and r["name"][:20] in " ".join(L))
    cam.append(rec)
    time.sleep(1)
# NIOSH ERG guide vs CAMEO ERG guide on the same UN number
erg_cmp = []
for r in with_ids[:10]:
    n, g = r["pairs"][0]
    s, u, b = get(f"https://cameochemicals.noaa.gov/unna/{n}")
    gg = re.search(r"Response Guide (\d{3}P?)", " ".join(lines(b)))
    erg_cmp.append({"un": n, "niosh_guide": g, "cameo_guide": gg.group(1) if gg else None, "status": s})
    time.sleep(1)
# chemical datasheets (prose): a fixed ID sample; each cites a UN/NA number in its identifier block
chem = []
for cid in [9000, 20000, 25000, 30000] + list(range(1, 41)):
    s, u, b = get(f"https://cameochemicals.noaa.gov/chemical/{cid}")
    rec = {"id": cid, "status": s}
    if s == 200:
        L = lines(b)
        k = L.index("UN/NA Number") if "UN/NA Number" in L else None
        un = next((x for x in (L[k + 1:k + 8] if k is not None else []) if re.fullmatch(r"\d{4}", x)), None)
        d = L[L.index("General Description") + 1] if "General Description" in L else ""
        rec.update({"un_na": un, "description_chars": len(d), "cas": next((x for x in L if re.fullmatch(r"\d{2,7}-\d{2}-\d", x)), None),
                    "un_in_us_hmt": bool(un) and (("UN" + un) in by_un or ("NA" + un) in by_un)})
    chem.append(rec)
    time.sleep(1)
ok = [c for c in chem if c["status"] == 200]
withun = [c for c in ok if c.get("un_na")]
out["cameo"] = {"unna_sampled": len(cam), "unna_200": sum(c["status"] == 200 for c in cam),
                "unna_with_datasheets": sum(1 for c in cam if c["datasheets"]), "unna_with_erg_guide": sum(1 for c in cam if c["erg_guide"]),
                "unna_rows": cam, "erg_guide_niosh_vs_cameo": erg_cmp,
                "erg_guide_equal": f"{sum(1 for e in erg_cmp if e['cameo_guide'] and e['cameo_guide'] == e['niosh_guide'])}/{len(erg_cmp)}",
                "chemical_ids_probed": len(chem), "chemical_200": len(ok), "chemical_with_un_na": len(withun),
                "chemical_with_description": sum(1 for c in ok if c.get("description_chars", 0) > 40),
                "join_cameo_chemical_un_to_us_hmt": f"{sum(1 for c in withun if c['un_in_us_hmt'])}/{len(withun)}", "chemical_rows": chem}

# --- 6. Reachability only ----------------------------------------------------------------------------------
reach = {}
for k, url in [("phmsa_interpretations", "https://www.phmsa.dot.gov/regulations/title49/interp"),
               ("phmsa_special_permits", "https://www.phmsa.dot.gov/approvals-and-permits/hazmat/special-permits-search"),
               ("unece_adr_2025", "https://unece.org/transport/dangerous-goods/adr-2025-files"),
               ("ntc_adg_code", "https://www.ntc.gov.au/codes-and-guidelines/australian-dangerous-goods-code")]:
    s, u, b = get(url, tries=1)
    t = b.decode("utf8", "replace")
    reach[k] = {"status": s, "bytes": len(b), "akamai_denied": "Access Denied" in t and "edgesuite" in t,
                "cloudflare_block": "Sorry, you have been blocked" in t, "error": t[:100] if s == 0 else None}
    time.sleep(1)
out["reachability_only"] = reach

json.dump(out, open("dg_measure.json", "w"), indent=1)
print(json.dumps({k: (v if not isinstance(v, dict) else {a: b for a, b in v.items() if a not in ("rows", "unna_rows", "chemical_rows")})
                  for k, v in out.items()}, indent=1)[:7000])
