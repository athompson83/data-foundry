#!/usr/bin/env python3
"""Cross-publisher join attempts FDA -> Health Canada MDALL (2026-10-03). Second pass of screen.py."""
import json, re, time, random, urllib.parse, urllib.request, os
UA = "data-foundry-scout (data@mail.proviciency.com)"
random.seed(7)
def get(url, timeout=120):
    time.sleep(0.6)
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=timeout) as r:
            return json.loads(r.read())
    except Exception as e:
        return None
FDA = "https://api.fda.gov/device/"
OUT = {}
# --- A. declared: FDA UDI primary DI (trailing/leading-zero tolerant) vs Health Canada device_identifier
udis = []
for skip in random.sample(range(0, 20000, 100), 4):
    d = get(FDA + f"udi.json?search=_exists_:premarket_submissions+AND+commercial_distribution_status:\"In+Commercial+Distribution\"&limit=100&skip={skip}")
    if d: udis += d["results"]
checked = matched = 0
hits = []
for r in udis:
    prim = [i["id"] for i in r.get("identifiers", []) if i.get("type") == "Primary" and i["id"].isdigit() and len(i["id"]) >= 12]
    if not prim: continue
    di = prim[0]; core = di.lstrip("0")
    checked += 1
    rr = get(f"https://health-products.canada.ca/api/medical-devices/deviceidentifier/?device_identifier={core}&type=json")
    found = [x for x in (rr or []) if (x["device_identifier"] or "").lstrip("0") == core]
    if found:
        matched += 1
        hits.append({"fda_di": di, "fda_brand": r.get("brand_name"), "fda_company": r.get("company_name"), "hc_licence_no": found[0]["original_licence_no"], "hc_device_id": found[0]["device_id"]})
    if checked >= 120: break
OUT["udi_to_mdall_device_identifier"] = {"checked": checked, "matched": matched, "hits": hits[:10]}

# --- B. candidate: normalised company name, FDA 510k applicant vs HC company, then device-name tokens
def norm(s):
    s = re.sub(r"[^a-z0-9 ]", " ", (s or "").lower())
    s = re.sub(r"\b(inc|llc|ltd|limited|corp|corporation|co|gmbh|ag|sa|plc|lp|company|usa|us|the|of|and)\b", " ", s)
    return re.sub(r"\s+", " ", s).strip()
comp = get("https://health-products.canada.ca/api/medical-devices/company/?type=json&lang=en", 180)
lic = get("https://health-products.canada.ca/api/medical-devices/licence/?state=active&type=json&lang=en", 180)
cn = {}
for c in comp: cn.setdefault(norm(c["company_name"]), []).append(c["company_id"])
bycomp = {}
for l in lic: bycomp.setdefault(l["company_id"], []).append(l)
OUT["hc_company_rows"] = len(comp)
recs = []
for skip in random.sample(range(0, 2500, 100), 3):
    d = get(FDA + f"510k.json?search=decision_date:[2025-01-01+TO+2026-09-30]&limit=100&skip={skip}")
    if d: recs += d["results"]
random.shuffle(recs)
STOP = set("system device the with and for kit set model series version".split())
def toks(s): return {t for t in re.findall(r"[a-z0-9]{4,}", (s or "").lower()) if t not in STOP}
pairs = []; company_matches = 0
for r in recs[:150]:
    ids = cn.get(norm(r["applicant"]))
    if not ids: continue
    company_matches += 1
    for cid in ids:
        for l in bycomp.get(cid, []):
            ov = toks(r["device_name"]) & toks(l["licence_name"])
            if ov:
                pairs.append({"k_number": r["k_number"], "fda_applicant": r["applicant"], "fda_device": r["device_name"], "fda_code": r["product_code"], "hc_licence_no": l["original_licence_no"], "hc_licence_name": l["licence_name"], "overlap": sorted(ov)})
OUT["name_join"] = {"fda_510k_sampled": min(150, len(recs)), "company_exact_normalised_match": company_matches, "candidate_pairs": len(pairs), "distinct_k_with_pair": len({p["k_number"] for p in pairs}), "pairs": pairs}
res = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "results.json")))
res["join_pass2"] = OUT
json.dump(res, open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "results.json"), "w"), indent=1)
print(json.dumps({k: (v if k != "name_join" else {kk: vv for kk, vv in v.items() if kk != "pairs"}) for k, v in OUT.items()}, indent=1)[:3000])
for p in pairs[:40]: print(p["k_number"], "|", p["fda_applicant"], "|", p["fda_device"], "||", p["hc_licence_name"], p["overlap"])
