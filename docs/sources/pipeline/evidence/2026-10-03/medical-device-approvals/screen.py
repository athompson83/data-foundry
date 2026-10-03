#!/usr/bin/env python3
"""Screen medical-device approval sources (2026-10-03). Polite (<=2 req/s), small samples."""
import json, re, subprocess, time, random, urllib.parse, urllib.request, tempfile, os

UA = "data-foundry-scout (data@mail.proviciency.com)"
random.seed(20261003)
OUT = {}


def get(url, timeout=60, raw=False):
    time.sleep(0.6)
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            b = r.read()
            return r.status, (b if raw else json.loads(b))
    except urllib.error.HTTPError as e:
        return e.code, None
    except Exception as e:
        return 0, str(e)[:100]


FDA = "https://api.fda.gov/device/"
# ---- FDA endpoints: counts, newest
for ep, sortf in [("510k", "decision_date"), ("pma", "decision_date"), ("classification", None), ("udi", None), ("recall", "event_date_initiated")]:
    u = FDA + ep + ".json?limit=1" + (f"&sort={sortf}:desc" if sortf else "")
    st, d = get(u)
    OUT[f"openfda_{ep}"] = {"http": st, "total": d["meta"]["results"]["total"], "last_updated": d["meta"]["last_updated"],
                            "newest": (d["results"][0].get(sortf) if sortf else None)}
st, d = get(FDA + "510k.json?count=decision_date&limit=1")
# 510k decided in last 12 months
st, d = get(FDA + "510k.json?search=decision_date:[2025-10-01+TO+2026-10-03]&limit=1")
OUT["openfda_510k"]["decided_last_12mo"] = d["meta"]["results"]["total"]
st, d = get(FDA + "510k.json?search=statement_or_summary:Summary&limit=1")
OUT["openfda_510k"]["with_summary_flag"] = d["meta"]["results"]["total"]
st, d = get(FDA + "pma.json?search=decision_date:[2025-10-01+TO+2026-10-03]&limit=1")
OUT["openfda_pma"]["decided_last_12mo"] = d["meta"]["results"]["total"]

# ---- 510k sample + summary PDF indications text
st, d = get(FDA + "510k.json?search=decision_date:[2025-06-01+TO+2026-09-30]+AND+statement_or_summary:Summary&limit=100&skip=" + str(random.randint(0, 1500)))
recs = d["results"]
random.shuffle(recs)
sample510 = recs[:25]
pdf_hits = []
ind_re = re.compile(r"(indications?\s+for\s+use|intended\s+use)", re.I)
for r in sample510:
    k = r["k_number"]
    yy = k[1:3]
    url = f"https://www.accessdata.fda.gov/cdrh_docs/pdf{yy}/{k}.pdf"
    st, b = get(url, raw=True, timeout=90)
    row = {"k_number": k, "pdf_http": st, "decision_date": r["decision_date"], "product_code": r["product_code"],
           "applicant": r["applicant"], "device_name": r["device_name"]}
    if st == 200:
        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as f:
            f.write(b)
        t = subprocess.run(["pdftotext", "-layout", f.name, "-"], capture_output=True, text=True).stdout
        os.unlink(f.name)
        m = re.search(r"(indications?\s+for\s+use|intended\s+use)[^\n]*\n(.{40,400})", t, re.I | re.S)
        row["pdf_chars"] = len(t)
        row["has_indications_text"] = bool(m)
        row["indications_snippet"] = re.sub(r"\s+", " ", m.group(2))[:200] if m else None
        row["pdf_cites_other_k"] = sorted(set(re.findall(r"\bK\d{6}\b", t)) - {k})[:5]
    pdf_hits.append(row)
OUT["openfda_510k_pdf_sample"] = {
    "n": len(pdf_hits), "pdf_200": sum(1 for x in pdf_hits if x["pdf_http"] == 200),
    "indications_text_found": sum(1 for x in pdf_hits if x.get("has_indications_text")),
    "cites_predicate_k": sum(1 for x in pdf_hits if x.get("pdf_cites_other_k")),
    "rows": pdf_hits[:8]}

# ---- Join 1 (same publisher, FDA): 510k K-number -> device recall k_numbers
st, d = get(FDA + "510k.json?search=decision_date:[2015-01-01+TO+2026-09-30]&limit=100&skip=" + str(random.randint(0, 5000)))
ks = [r["k_number"] for r in d["results"]][:40]
hit = []
for k in ks:
    st, rr = get(FDA + f"recall.json?search=k_numbers:{k}&limit=1")
    if st == 200 and rr["meta"]["results"]["total"] > 0:
        hit.append((k, rr["meta"]["results"]["total"]))
OUT["join_510k_to_fda_device_recall_by_k_number"] = {"checked": len(ks), "matched": len(hit), "examples": hit[:5]}
# reverse: recalls citing a K-number -> does 510k exist?
st, d = get(FDA + "recall.json?search=_exists_:k_numbers&limit=100&skip=" + str(random.randint(0, 5000)))
rk = [(r["product_res_number"], r["k_numbers"][0]) for r in d["results"] if r.get("k_numbers")][:30]
found = 0
for res, k in rk:
    st, rr = get(FDA + f"510k.json?search=k_number:{k}&limit=1")
    if st == 200 and rr["meta"]["results"]["total"] > 0:
        found += 1
OUT["join_device_recall_to_510k_by_k_number"] = {"checked": len(rk), "matched": found}

# ---- FDA UDI sample and join to 510k via premarket_submissions, and to Health Canada via device identifier
udis = []
for skip in random.sample(range(0, 25000, 100), 3):
    st, d = get(FDA + f"udi.json?search=_exists_:premarket_submissions+AND+commercial_distribution_status:\"In+Commercial+Distribution\"&limit=100&skip={skip}")
    if st == 200:
        udis += d["results"]
OUT["openfda_udi_sample"] = {"n": len(udis)}
pm = 0
pm_checked = 0
for r in udis[:30]:
    subs = [s["submission_number"] for s in r.get("premarket_submissions", []) if re.fullmatch(r"K\d{6}", s.get("submission_number", ""))]
    if not subs:
        continue
    pm_checked += 1
    st, rr = get(FDA + f"510k.json?search=k_number:{subs[0]}&limit=1")
    if st == 200 and rr["meta"]["results"]["total"] > 0:
        pm += 1
OUT["join_udi_to_510k_by_cited_k_number"] = {"checked": pm_checked, "matched": pm}

hc_hits = []
hc_checked = 0
for r in udis[:150]:
    prim = [i["id"] for i in r.get("identifiers", []) if i.get("type") == "Primary"]
    if not prim or not prim[0].isdigit():
        continue
    di = prim[0]
    cands = [di] + ([di.lstrip("0")] if di.lstrip("0") != di else [])
    hc_checked += 1
    found = []
    for c in cands[:1]:
        st, rr = get(f"https://health-products.canada.ca/api/medical-devices/deviceidentifier/?device_identifier={urllib.parse.quote(c)}&type=json", timeout=120)
        if st == 200 and isinstance(rr, list):
            found = [x for x in rr if x["device_identifier"] in (di, di.lstrip("0"))]
    if found:
        lic = found[0]["original_licence_no"]
        st, lr = get(f"https://health-products.canada.ca/api/medical-devices/licence/?id={lic}&type=json&lang=en")
        lrec = lr[0] if isinstance(lr, list) and lr else (lr if isinstance(lr, dict) else None)
        comp = None
        if lrec:
            st, cr = get(f"https://health-products.canada.ca/api/medical-devices/company/?id={lrec['company_id']}&type=json&lang=en")
            comp = cr[0]["company_name"] if isinstance(cr, list) and cr else (cr.get("company_name") if isinstance(cr, dict) else None)
        hc_hits.append({"di": di, "fda_brand": r.get("brand_name"), "fda_company": r.get("company_name"), "fda_product_code": [p["code"] for p in r.get("product_codes", [])],
                        "hc_licence_no": lic, "hc_licence_name": lrec and lrec["licence_name"], "hc_company": comp, "hc_risk_class": lrec and lrec["appl_risk_class"]})
    if hc_checked >= 60:
        break
OUT["join_fda_udi_to_health_canada_by_device_identifier"] = {"checked": hc_checked, "matched": len(hc_hits), "hits": hc_hits}

# ---- Health Canada counts
st, lic = get("https://health-products.canada.ca/api/medical-devices/licence/?state=active&type=json&lang=en", timeout=180)
if isinstance(lic, list):
    OUT["hc_mdall_licence_active"] = {"http": st, "n": len(lic), "newest_first_licence_status_dt": max(x["first_licence_status_dt"] for x in lic if x["first_licence_status_dt"]),
                                      "last_refresh_dt": max(x["last_refresh_dt"] for x in lic), "keys": sorted(lic[0].keys()),
                                      "classes": {str(c): sum(1 for x in lic if x["appl_risk_class"] == c) for c in (1, 2, 3, 4)}}
    OUT["hc_mdall_licence_active"]["licence_16_in_last_12mo"] = sum(1 for x in lic if (x["first_licence_status_dt"] or "") >= "2025-10-03")
for ep in ["summarybasisdecision", "licencetype"]:
    st, rr = get(f"https://health-products.canada.ca/api/medical-devices/{ep}/?type=json&lang=en", timeout=120)
    OUT[f"hc_{ep}"] = {"http": st, "n": len(rr) if isinstance(rr, list) else None, "sample": rr[:2] if isinstance(rr, list) else rr}

# ---- TGA reachability
for u in ["https://www.tga.gov.au/", "https://compliance.health.gov.au/artg/", "https://www.tga.gov.au/resources/artg"]:
    p = subprocess.run(["curl", "-sS", "-m", "40", "-o", "/dev/null", "-w", "%{http_code}", "-H", "User-Agent: " + UA, u], capture_output=True, text=True)
    OUT.setdefault("tga_reach", {})[u] = (p.stdout or "000") + " " + p.stderr.strip()[:80]
    time.sleep(1)

json.dump(OUT, open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "results.json"), "w"), indent=1)
print(json.dumps(OUT, indent=1)[:6000])
