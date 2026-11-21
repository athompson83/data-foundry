#!/usr/bin/env python3
"""Screening 2026-11-15: occupational-exposure-limits. Fetches every source live (stdlib only).
Run from this directory with: python3 -I oel_measure.py   -> writes oel_measure.json
Output holds CAS numbers, substance names (public regulatory text), limit values and counts only.

Members screened:
  US OSHA 29 CFR 1910.1000 Tables Z-1/Z-2/Z-3 (GovInfo annual CFR XML; eCFR blocks this client)
  US CDC NIOSH Pocket Guide (CAS index + per-chemical HTML pages: REL, PEL, IDLH)
  UK HSE EH40/2005 (PDF; text pulled from Flate streams with zlib, no PDF library)
  EU indicative OELV directives (Publications Office Cellar XHTML; EUR-Lex answers an AWS WAF challenge)
  Safe Work Australia HCIS (public CAS search + chemical page WEL table)
  Reachability/terms only: Ontario OEL page, WorkSafeBC, IFA GESTIS-ILV (all RED on their terms; no data pulled)
"""
import html as H
import json
import re
import time
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
import zlib

UA = "data-foundry-scout/1.0 (data@mail.proviciency.com)"
out = {"run_date": time.strftime("%Y-%m-%d")}
CASRE = re.compile(r"\b(\d{2,7}-\d{2}-\d)\b")


def get(u, accept=None, tries=3):
    for i in range(tries):
        try:
            h = {"User-Agent": UA, "Accept-Encoding": "identity"}
            if accept:
                h["Accept"] = accept
                h["Accept-Language"] = "eng"
            r = urllib.request.Request(u, headers=h)
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


def cas_ok(c):
    d = c.replace("-", "")
    return int(d[-1]) == sum(int(x) * (i + 1) for i, x in enumerate(reversed(d[:-1]))) % 10


def lines(b):
    s = b.decode("utf8", "replace")
    s = re.sub(r"(?s)<script.*?</script>|<style.*?</style>", "", s)
    t = H.unescape(re.sub(r"<[^>]+>", "\n", s))
    return [" ".join(x.split()) for x in t.split("\n") if x.strip()]


def txt(e):
    return " ".join("".join(e.itertext()).split())


# --- 1. OSHA Z tables (GovInfo annual CFR; title 29 2025 edition not yet on GovInfo -> 2024) --------------
s, u, b = get("https://www.govinfo.gov/content/pkg/CFR-2025-title29-vol6/xml/CFR-2025-title29-vol6-sec1910-1000.xml")
out["osha_cfr2025_status"] = {"status": s, "final_url": u}
s, u, b = get("https://www.govinfo.gov/content/pkg/CFR-2024-title29-vol6/xml/CFR-2024-title29-vol6-sec1910-1000.xml")
root = ET.fromstring(b)
osha = {}
tables = {}
for t in root.iter("GPOTABLE"):
    title = t.findtext("TTITLE") or ""
    rows = [[txt(x) for x in row.findall("ENT")] for row in t.iter("ROW")]
    tables[title[:40] or "untitled"] = len(rows)
    if title.startswith("Table Z-1"):
        for e in rows:
            if len(e) >= 2 and CASRE.fullmatch(e[1] or ""):
                osha.setdefault(e[1], {"name": e[0][:80], "ppm": e[2] if len(e) > 2 else "", "mg_m3": e[3] if len(e) > 3 else "",
                                       "skin": (e[4] if len(e) > 4 else "") == "X"})
out["osha"] = {"status": s, "edition_date": root.findtext(".//DATE"), "bytes": len(b), "table_rows": tables,
               "z1_rows_with_cas": len(osha), "z1_cas_checksum_valid": sum(cas_ok(c) for c in osha),
               "z1_rows_with_skin": sum(v["skin"] for v in osha.values())}
time.sleep(1)

# --- 2. NIOSH Pocket Guide (CAS index + pages) -----------------------------------------------------------
s, u, b = get("https://www.cdc.gov/niosh/npg/npgdcas.html")
idx = re.findall(r"<td>(\d{2,7}-\d{2}-\d)</td><td><a href='(npgd\d{4})\.html'>([^<]+)</a>", b.decode("utf8", "replace"))
niosh_cas = {}
for c, page, name in idx:
    niosh_cas.setdefault(c, (page, name))
out["niosh"] = {"status": s, "index_rows": len(idx), "distinct_cas": len(niosh_cas), "distinct_pages": len({p for _, p, _ in idx})}


def niosh_page(page):
    s, u, b = get(f"https://www.cdc.gov/niosh/npg/{page}.html")
    L = lines(b)
    rec = {"status": s, "page": page}
    for k, l in enumerate(L):
        if l == "CAS No." and k + 1 < len(L):
            rec["cas"] = L[k + 1]
        elif l == "DOT ID & Guide" and k + 1 < len(L):
            rec["dot_id"] = L[k + 1]
        elif l == "IDLH" and k + 1 < len(L):
            rec["idlh"] = L[k + 1][:60]
        elif l == "NIOSH REL" and k + 1 < len(L):
            rec["rel"] = " ".join(L[k + 1:k + 4])[:120]
        elif l == "OSHA PEL" and k + 1 < len(L):
            rec["pel"] = " ".join(L[k + 1:k + 4])[:120]
        elif l == "Page last reviewed:" and k + 1 < len(L):
            rec["last_reviewed"] = L[k + 1]
    return rec


cas_sorted = sorted(niosh_cas)
step = max(1, len(cas_sorted) // 30)
sample = cas_sorted[::step][:30]
pages = []
for c in sample:
    r = niosh_page(niosh_cas[c][0])
    r["index_cas"] = c
    pages.append(r)
    time.sleep(1)
out["niosh"]["sampled_pages"] = len(pages)
out["niosh"]["pages_200"] = sum(p["status"] == 200 for p in pages)
out["niosh"]["pages_with_rel"] = sum(bool(p.get("rel")) for p in pages)
out["niosh"]["pages_with_pel"] = sum(bool(p.get("pel")) for p in pages)
out["niosh"]["pages_with_idlh"] = sum(bool(p.get("idlh")) for p in pages)
out["niosh"]["last_reviewed_values"] = sorted({p.get("last_reviewed", "") for p in pages})
out["niosh"]["sample"] = pages

# NIOSH page "OSHA PEL" prose vs the OSHA Z-1 table (declared CAS join, then value comparison)
cmp_ = []
for p in pages:
    c = p.get("index_cas")
    if c in osha and p.get("pel"):
        z = osha[c]
        nums = re.findall(r"TWA ([\d.]+) ppm", p["pel"])
        cmp_.append({"cas": c, "z1_ppm": z["ppm"], "niosh_pel_twa_ppm": nums[0] if nums else None,
                     "equal": bool(nums) and z["ppm"] == nums[0]})
out["join_niosh_page_pel_vs_z1"] = {"pairs_with_ppm_on_both": sum(1 for x in cmp_ if x["z1_ppm"] and x["niosh_pel_twa_ppm"]),
                                    "equal": sum(x["equal"] for x in cmp_), "rows": cmp_}
time.sleep(1)

# --- 3. UK HSE EH40/2005 (PDF) ---------------------------------------------------------------------------
s0, _, b0 = get("https://www.hse.gov.uk/pubns/books/eh40.htm")
pub = re.search(r"Published:\s*([A-Z][a-z]+ \d{4})", " ".join(re.sub(r"<[^>]+>", " ", b0.decode("utf8", "replace")).split()))
s, u, b = get("https://www.hse.gov.uk/pubns/priced/eh40.pdf")
chunks = []
for m in re.finditer(rb"stream\r?\n(.*?)\r?\nendstream", b, re.S):
    try:
        d = zlib.decompress(m.group(1))
    except Exception:
        continue
    for bt in re.findall(rb"BT(.*?)ET", d, re.S):
        line = b""
        for t in re.findall(rb"\[(.*?)\]\s*TJ|\((.*?)(?<!\\)\)\s*Tj|(T\*|Td|TD|Tm)", bt, re.S):
            if t[2]:
                line += b"\n"
                continue
            line += b"".join(re.findall(rb"\((.*?)(?<!\\)\)", t[0], re.S)) if t[0] else t[1]
        chunks.append(line)
pdftext = b"\n".join(chunks).decode("latin1").replace("\\(", "(").replace("\\)", ")")
plines = [x.strip() for x in pdftext.split("\n") if x.strip()]
eh40 = {}
for k, l in enumerate(plines):
    if CASRE.fullmatch(l) and k > 0:
        vals = plines[k + 1:k + 5]
        eh40.setdefault(l, {"name": plines[k - 1][:80], "twa_ppm": vals[0] if vals else "", "twa_mg": vals[1] if len(vals) > 1 else "",
                            "stel_ppm": vals[2] if len(vals) > 2 else "", "stel_mg": vals[3] if len(vals) > 3 else ""})
out["eh40"] = {"page_status": s0, "page_published": pub.group(1) if pub else None, "pdf_status": s, "pdf_bytes": len(b),
               "text_lines": len(plines), "distinct_cas": len(eh40), "cas_checksum_valid": sum(cas_ok(c) for c in eh40),
               "carc_notations": len(re.findall(r"\bCarc\b", pdftext)), "sk_notations": len(re.findall(r"\bSk\b", pdftext)),
               "sen_notations": len(re.findall(r"\bSen\b", pdftext))}
time.sleep(1)

# --- 4. EU indicative OELV directives (Cellar XHTML) -----------------------------------------------------
eu = {}
out["eu"] = {}
s, u, b = get("https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32017L0164")
out["eu"]["eurlex_status"] = {"status": s, "bytes": len(b)}
for celex in ["31991L0322", "32000L0039", "32006L0015", "32009L0161", "32017L0164", "32019L1831"]:
    s, u, b = get("https://publications.europa.eu/resource/celex/" + celex, accept="application/xhtml+xml")
    t = H.unescape(re.sub(r"<[^>]+>", " ", b.decode("utf8", "replace"))) if s == 200 else ""
    found = [c for c in dict.fromkeys(CASRE.findall(t)) if cas_ok(c)]
    for c in found:
        eu.setdefault(c, []).append(celex)
    out["eu"][celex] = {"status": s, "bytes": len(b), "distinct_valid_cas": len(found)}
    time.sleep(1)
out["eu"]["distinct_cas_all_directives"] = len(eu)

# --- 5. Safe Work Australia HCIS (CAS search -> chemical page WEL) ---------------------------------------
eh_cas = sorted(c for c in eh40 if cas_ok(c))
hstep = max(1, len(eh_cas) // 15)
hcis = []
for c in eh_cas[::hstep][:15]:
    s, u, b = get("https://hcis.safeworkaustralia.gov.au/search/?q=" + c + "&filter=all")
    ids = list(dict.fromkeys(re.findall(r"/chemical/\?id=[0-9a-f-]{36}", b.decode("utf8", "replace"))))
    rec = {"cas": c, "search_status": s, "hits": len(ids)}
    time.sleep(1)
    if ids:
        s2, u2, b2 = get("https://hcis.safeworkaustralia.gov.au" + ids[0])
        L = lines(b2)
        rec["page_status"] = s2
        rec["not_on_public_register"] = "Chemical not found" in L
        rec["search_lists_wel_tag"] = "WEL" in lines(b)
        rec["page_cas"] = next((L[k + 1] for k, l in enumerate(L) if l == "CAS Number" and k + 1 < len(L)), None)
        rec["last_updated"] = next((l.split(":", 1)[1] for l in L if l.startswith("Last updated:")), None)
        k = next((k for k, l in enumerate(L) if l == "TWA"), None)
        rec["wel_twa"] = L[k + 1:k + 3] if k is not None else None
        k = next((k for k, l in enumerate(L) if l == "STEL"), None)
        rec["wel_stel"] = L[k + 1:k + 3] if k is not None else None
        time.sleep(1)
    hcis.append(rec)
out["hcis"] = {"sampled": len(hcis), "search_200": sum(h["search_status"] == 200 for h in hcis),
               "found_page": sum(1 for h in hcis if h.get("page_status") == 200),
               "page_cas_equal": sum(1 for h in hcis if h.get("page_cas") == h["cas"]),
               "with_wel_twa": sum(1 for h in hcis if h.get("wel_twa")),
               "page_not_on_public_register": sum(1 for h in hcis if h.get("not_on_public_register")),
               "footer": (re.findall(r"©[^<]{0,80}All rights reserved\.", b2.decode("utf8", "replace")) or [None])[0],
               "rows": hcis}

# --- 6. Reachability of the RED/parked publishers (no data pulled) ---------------------------------------
reach = {}
for k, url in [("ontario_oel_page", "https://www.ontario.ca/page/current-occupational-exposure-limits-ontario-workplaces-under-regulation-833"),
               ("ontario_elaws_reg833", "https://www.ontario.ca/laws/regulation/900833"),
               ("worksafebc_guideline_part5", "https://www.worksafebc.com/en/law-policy/occupational-health-safety/searchable-ohs-regulation/ohs-guidelines/guidelines-part-05"),
               ("gestis_ilv_terms", "https://www.dguv.de/ifa/gestis/gestis-internationale-grenzwerte-fuer-chemische-substanzen-limit-values-for-chemical-agents/general-terms-and-conditions-of-use/index-2.jsp")]:
    s, u, b = get(url)
    t = b.decode("utf8", "replace")
    reach[k] = {"status": s, "bytes": len(b), "valid_cas_in_html": len({c for c in CASRE.findall(t) if cas_ok(c)})}
    time.sleep(1)
out["reachability_only"] = reach

# --- 7. Cross-publisher CAS joins (declared: the CAS number names the substance) ------------------------
def j(a, b_):
    return f"{len(set(a) & set(b_))}/{len(set(a))}"


out["joins"] = {
    "osha_z1_to_niosh_index": j(osha, niosh_cas),
    "eh40_to_osha_z1": j(eh_cas, osha),
    "eh40_to_niosh_index": j(eh_cas, niosh_cas),
    "eu_ioelv_to_eh40": j(eu, eh_cas),
    "eu_ioelv_to_osha_z1": j(eu, osha),
    "hcis_page_cas_equal_to_eh40_sample": f"{out['hcis']['page_cas_equal']}/{out['hcis']['sampled']}",
}
# value disagreement example set: same CAS, different jurisdictions (TWA ppm)
common = sorted(set(osha) & set(eh_cas) & set(niosh_cas))
out["value_examples"] = [{"cas": c, "osha_z1_ppm": osha[c]["ppm"], "eh40_twa_ppm": eh40[c]["twa_ppm"]} for c in common[:: max(1, len(common) // 12)][:12]]
out["osha_eh40_common_cas"] = len(common)

json.dump(out, open("oel_measure.json", "w"), indent=1)
print(json.dumps({k: v for k, v in out.items() if k not in ("value_examples",)}, indent=1)[:6000])
