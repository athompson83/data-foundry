#!/usr/bin/env python3
"""Screen chemical-hazard-classifications members: NIOSH NPG (free text), PubChem GHS (structured), EPA TSCA inventory.
Run from this directory: python3 screen.py  -> results.json. Polite (<=2 req/s), UA header, no keys."""
import csv, html, io, json, random, re, time, urllib.parse, urllib.request, zipfile
UA = {"User-Agent": "data-foundry-scout (data@mail.proviciency.com)"}
def get(url, tries=2):
    for i in range(tries):
        time.sleep(0.6)
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
                return r.status, r.read().decode("utf-8", "replace"), dict(r.headers)
        except urllib.error.HTTPError as e:
            if e.code == 404: return 404, "", {}
            err = e.code
        except Exception as e:
            err = str(e)
    return err, "", {}
def text(h):
    h = re.sub(r"(?s)<(script|style).*?</\1>", " ", h)
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", h)))
out = {"run_date": "2026-10-03"}
# ---- reachability of other candidates
reach = {}
for u in ["https://echa.europa.eu/legal-notice", "https://echa.europa.eu/information-on-chemicals/cl-inventory-database",
          "https://www.chemicals.nite.go.jp/en/", "https://www.osha.gov/hazcom", "https://comptox.epa.gov/dashboard/"]:
    s, b, _ = get(u, 1)
    reach[u] = {"status": s, "waf_challenge": "azwaf" in b.lower()}
out["reachability"] = reach
# ---- NIOSH NPG
s, cas_html, hd = get("https://www.cdc.gov/niosh/npg/npgdcas.html")
rows = re.findall(r'<a href="(?:/niosh/npg/)?(npgd\d+\.html)"[^>]*>\s*([^<]+?)\s*</a>', cas_html)
t = text(cas_html)
pairs = re.findall(r"(\d{2,7}-\d{2}-\d)\s+([^0-9][^|]*?)(?=\s\d{2,7}-\d{2}-\d\s|$)", t)
cas_index = {}
for m in re.finditer(r"<td>(\d{2,7}-\d{2}-\d)</td><td><a href='(npgd\d+\.html)'", cas_html): cas_index.setdefault(m.group(1), m.group(2))
out["niosh_index"] = {"status": s, "index_cas_rows": len(pairs), "cas_to_page": len(cas_index), "last_modified": hd.get("Last-Modified")}
rnd = random.Random(7)
sample = rnd.sample(sorted(cas_index.items()), min(30, len(cas_index)))
niosh = []
for cas, page in sample:
    s, h, _ = get("https://www.cdc.gov/niosh/npg/" + page)
    tx = text(h)
    def fld(a, b):
        m = re.search(re.escape(a) + r"\s+(.*?)\s+" + re.escape(b), tx); return m.group(1).strip() if m else None
    page_cas = re.search(r"CAS No\.\s+([0-9\-]+)", tx)
    rec = {"cas": cas, "page": page, "status": s, "page_cas": page_cas.group(1) if page_cas else None,
           "symptoms": fld("Symptoms", "Target Organs"), "target_organs": fld("Target Organs", "Cancer Site") or fld("Target Organs", "Personal Protection/Sanitation"),
           "first_aid": fld("First Aid ( See procedures )", "Respirator Recommendations")}
    rec["name"] = re.search(r"\(NIOSH\)\s+(?:Facebook Twitter LinkedIn Syndicate\s+)?(.*?)\s+Minus Related", tx).group(1) if re.search(r"\(NIOSH\)\s+(?:Facebook Twitter LinkedIn Syndicate\s+)?(.*?)\s+Minus Related", tx) else None
    niosh.append(rec)
out["niosh_sample"] = niosh
out["niosh_free_text_fields_populated"] = {k: sum(1 for r in niosh if r[k]) for k in ("symptoms", "target_organs", "first_aid")}
out["niosh_cas_page_matches_index"] = sum(1 for r in niosh if r["page_cas"] == r["cas"])
# ---- PubChem for each NIOSH CAS: name->CID, synonym contains CAS, PUG-View GHS
def ghs(cid):
    s, b, _ = get(f"https://pubchem.ncbi.nlm.nih.gov/rest/pug_view/data/compound/{cid}/JSON?heading=GHS+Classification")
    if s != 200: return {"status": s}
    d = json.loads(b)
    strs, codes, signal, pict = [], set(), None, []
    def walk(sec):
        nonlocal signal
        for x in sec if isinstance(sec, list) else [sec]:
            for info in x.get("Information", []):
                n = info.get("Name"); v = info.get("Value", {}).get("StringWithMarkup", [])
                for sv in v:
                    st = sv.get("String", "")
                    if n == "Signal" and not signal: signal = st
                    if n == "GHS Hazard Statements": strs.append(st); codes.update(re.findall(r"\bH\d{3}[A-Za-z]*\b", st))
            walk(x.get("Section", [])) if x.get("Section") else None
    walk(d.get("Record", {}).get("Section", []))
    return {"status": 200, "signal": signal, "h_codes": sorted(codes), "n_statement_lines": len(strs), "example_statement": strs[0][:160] if strs else None}
pc = []
for r in niosh:
    cas = r["cas"]
    s, b, _ = get("https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/" + urllib.parse.quote(cas) + "/cids/JSON")
    rec = {"cas": cas, "cid_status": s}
    if s == 200:
        cid = json.loads(b)["IdentifierList"]["CID"][0]; rec["cid"] = cid
        s2, b2, _ = get(f"https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/{cid}/synonyms/JSON")
        syn = json.loads(b2)["InformationList"]["Information"][0]["Synonym"] if s2 == 200 else []
        rec["cas_in_synonyms_exact"] = cas in syn
        rec["ghs"] = ghs(cid)
    pc.append(rec)
out["pubchem_sample"] = pc
out["link_niosh_to_pubchem"] = {
    "sampled": len(pc), "cid_found": sum(1 for p in pc if p.get("cid")),
    "declared_cas_exact_in_pubchem_synonyms": sum(1 for p in pc if p.get("cas_in_synonyms_exact")),
    "with_ghs_hazard_statements": sum(1 for p in pc if p.get("ghs", {}).get("h_codes"))}
# ---- TSCA
s, b, hd = 0, None, {}
req = urllib.request.Request("https://www.epa.gov/system/files/other-files/2026-05/csv-non-cbi-tsca-inventory.zip", headers=UA)
z = zipfile.ZipFile(io.BytesIO(urllib.request.urlopen(req, timeout=120).read()))
name = [n for n in z.namelist() if n.startswith("TSCAINV")][0]
rd = list(csv.DictReader(io.TextIOWrapper(z.open(name), encoding="utf-8", errors="replace")))
tsca = {r["CASRN"]: r for r in rd}
from collections import Counter
out["tsca"] = {"file": name, "rows": len(rd), "activity": dict(Counter(r["ACTIVITY"] for r in rd)), "columns": list(rd[0].keys())}
m = [r["cas"] for r in niosh if r["cas"] in tsca]
out["link_niosh_to_tsca"] = {"sampled": len(niosh), "matched_exact_cas": len(m), "active": sum(1 for c in m if tsca[c]["ACTIVITY"] == "ACTIVE")}
m2 = [p["cas"] for p in pc if p.get("cas_in_synonyms_exact") and p["cas"] in tsca]
out["link_pubchem_to_tsca"] = {"sampled": len(pc), "matched_exact_cas": len(m2)}
# full NIOSH index vs TSCA
out["niosh_index_all_vs_tsca"] = {"niosh_cas": len(cas_index), "in_tsca": sum(1 for c in cas_index if c in tsca)}
json.dump(out, open("results.json", "w"), indent=1)
print(json.dumps({k: v for k, v in out.items() if k not in ("niosh_sample", "pubchem_sample")}, indent=1))
