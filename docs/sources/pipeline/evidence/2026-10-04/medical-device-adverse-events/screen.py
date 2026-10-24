#!/usr/bin/env python3
"""Screen medical-device adverse-event sources (2026-10-04). Polite (<=2 req/s), UA header, no keys.

Usage: python3 screen.py [path-to-mdall-deviceidentifier.json]
The MDALL deviceidentifier endpoint cannot be paged: the bare call returns the whole list (422 MB, 3,152,063 rows).
That single download happened once (an over-the-50MB-limit mistake while probing); the join below reuses the cached file.
"""
import json, re, sys, time, urllib.parse, urllib.request, html

UA = {"User-Agent": "data-foundry-scout (data@mail.proviciency.com)"}
OUT = {}


def get(url, timeout=60):
    time.sleep(0.5)
    req = urllib.request.Request(url, headers=UA)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()
    except Exception as e:  # noqa
        return 0, str(e).encode()


def jget(url):
    s, b = get(url)
    try:
        return s, json.loads(b)
    except Exception:
        return s, None


def text(h):
    h = re.sub(r"<script.*?</script>|<style.*?</style>", "", h, flags=re.S)
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", h)))


def ofda(path, **q):
    return jget("https://api.fda.gov/device/" + path + ".json?" + urllib.parse.urlencode(q, safe=":[]\"+*"))


# ---------------------------------------------------------------- MAUDE (openFDA device/event)
s, d = ofda("event", limit=1)
OUT["maude_probe"] = {"http": s, "total": d["meta"]["results"]["total"], "last_updated": d["meta"]["last_updated"]}
s, d = ofda("event", search="date_received:[20260101+TO+20261004]", limit=1)
OUT["maude_probe"]["received_2026"] = d["meta"]["results"]["total"]
s, d = ofda("event", sort="date_received:desc", limit=1)
OUT["maude_probe"]["newest_date_received"] = d["results"][0]["date_received"]
s, d = ofda("event", search="date_received:[20150101+TO+20150131]", limit=1)
OUT["maude_probe"]["received_jan2015"] = d["meta"]["results"]["total"]

sample = []
for skip in (0, 100, 200):
    s, d = ofda("event", search="date_received:[20260801+TO+20261004]", limit=100, skip=skip)
    sample += d["results"]
OUT["maude_sample_n"] = len(sample)


def has_text(r):
    return any((t.get("text") or "").strip() for t in r.get("mdr_text", []))


def narr_len(r):
    return sum(len(t.get("text") or "") for t in r.get("mdr_text", []))


dev = [(r, x) for r in sample for x in r.get("device", [])]
OUT["maude_sample_stats"] = {
    "reports": len(sample),
    "devices": len(dev),
    "with_narrative": sum(has_text(r) for r in sample),
    "median_narrative_chars": sorted(narr_len(r) for r in sample)[len(sample) // 2],
    "text_types": sorted({t.get("text_type_code") for r in sample for t in r.get("mdr_text", [])}),
    "with_udi_di": sum(1 for _, x in dev if x.get("udi_di")),
    "with_product_code": sum(1 for _, x in dev if x.get("device_report_product_code")),
    "with_510k_baseline": sum(1 for _, x in dev if x.get("baseline_510_k__number")),
    "with_pma_pmn_number": sum(1 for r in sample if r.get("pma_pmn_number")),
    "event_types": {k: sum(1 for r in sample if r.get("event_type") == k) for k in {r.get("event_type") for r in sample}},
    "has_patient_demographics_fields": sorted({k for r in sample for p in r.get("patient", []) for k in p})[:12],
}

# ---- same-publisher links (FDA to FDA): reported for completeness, not counted as independent
ks = set()
for r, x in dev:
    for v in (x.get("baseline_510_k__number"), r.get("pma_pmn_number")):
        if v and re.fullmatch(r"K\d{6}", v.strip()):
            ks.add(v.strip())
OUT["maude_510k_numbers_cited_in_sample"] = len(ks)
found = 0
for k in sorted(ks)[:40]:
    s, d = ofda("510k", search="k_number:" + k, limit=1)
    found += bool(d and d.get("results"))
OUT["maude_k_to_openfda_510k"] = f"{found}/{min(len(ks), 40)}"
pcs = sorted({x.get("device_report_product_code") for _, x in dev if x.get("device_report_product_code")})
hit = 0
for pc in pcs[:30]:
    s, d = ofda("classification", search="product_code:" + pc, limit=1)
    hit += bool(d and d.get("results"))
OUT["maude_productcode_to_classification"] = f"{hit}/{min(len(pcs), 30)}"

# ---- recall endpoint (existing fda-recalls feed; same publisher)
s, d = ofda("recall", limit=1)
OUT["fda_device_recall_probe"] = {"http": s, "total": d["meta"]["results"]["total"], "last_updated": d["meta"]["last_updated"]}

# ---- openFDA terms
s, b = get("https://open.fda.gov/terms/")
t = text(b.decode("utf8", "ignore"))
i = t.find("Unless otherwise noted")
OUT["openfda_terms"] = {"http": s, "quote": t[i:i + 190]}

# ---------------------------------------------------------------- MDALL join: MAUDE udi_di vs Health Canada device_identifier
def norm(v):
    v = re.sub(r"[^0-9A-Za-z]", "", v or "").upper()
    return v.lstrip("0")


try:
    mdall = json.load(open(sys.argv[1] if len(sys.argv) > 1 else "/tmp/di.json"))
    idset = {}
    for row in mdall:
        n = norm(row.get("device_identifier"))
        if len(n) >= 8:
            idset.setdefault(n, row["original_licence_no"])
    OUT["mdall_deviceidentifier_rows"] = len(mdall)
    OUT["mdall_newest_first_licence_dt"] = max((r["first_licence_dt"] or "") for r in mdall)
    udis = [(r["report_number"], norm(x["udi_di"])) for r, x in dev if x.get("udi_di")]
    m = [(rn, u, idset[u]) for rn, u in udis if u in idset]
    OUT["join_udi_di_vs_mdall"] = {"matched": len(m), "total": len(udis), "examples": m[:5]}
    cats = [(r["report_number"], norm(x.get("catalog_number")), x.get("brand_name")) for r, x in dev if len(norm(x.get("catalog_number"))) >= 6]
    mc = [(rn, c, b, idset[c]) for rn, c, b in cats if c in idset]
    OUT["join_catalog_number_vs_mdall_candidate"] = {"matched": len(mc), "total": len(cats), "examples": mc[:8]}
    # DI-presence rate: how much of MDALL looks like GTIN (8/12/13/14 digits)
    gt = sum(1 for k in idset if k.isdigit() and len(k) in (8, 11, 12, 13, 14))
    OUT["mdall_identifier_gtin_like_share"] = f"{gt}/{len(idset)}"
except FileNotFoundError:
    OUT["mdall_join"] = "cache file missing"

# larger udi sample to give the DI join a fair size (events that carry a UDI-DI)
udi_big = []
for skip in range(0, 500, 100):
    s, d = ofda("event", search="device.udi_di:[0+TO+99999999999999]+AND+date_received:[20260801+TO+20261004]", limit=100, skip=skip)
    if not d or "results" not in d:
        break
    udi_big += [(r["report_number"], norm(x["udi_di"]), x.get("brand_name")) for r in d["results"] for x in r["device"] if x.get("udi_di")]
OUT["udi_big_sample"] = len(udi_big)
if "mdall_deviceidentifier_rows" in OUT:
    mb = [(rn, u) for rn, u, _ in udi_big if u in idset]
    OUT["join_udi_di_vs_mdall_big"] = {"matched": len(mb), "total": len(udi_big), "examples": mb[:5]}

# ---------------------------------------------------------------- MHRA field safety notices (gov.uk)
s, d = jget("https://www.gov.uk/api/search.json?filter_document_type=medical_safety_alert&filter_alert_type=field-safety-notices&count=100&order=-public_timestamp&fields=title,link,public_timestamp")
lists = d["results"]
OUT["mhra_fsn"] = {"search_http": s, "fsn_list_pages_total": d["total"], "newest": lists[0]["public_timestamp"], "oldest_in_100": lists[-1]["public_timestamp"]}
entries = []
for page in lists[:12]:
    s, c = jget("https://www.gov.uk" + page["link"].replace("/drug-device-alerts/", "/api/content/drug-device-alerts/"))
    if not c:
        continue
    body = c["details"]["body"]
    for blk in re.split(r"(?=<h3)", body)[1:]:
        title = text(re.search(r"<h3[^>]*>(.*?)</h3>", blk, re.S).group(1))
        rest = blk.split("</h3>", 1)[1]
        paras = [text(p) for p in re.findall(r"<p>(.*?)</p>", rest, re.S)]
        ref = re.search(r"MHRA reference:\s*(?:<a[^>]*>(\d+)</a>)?\s*([0-9/]+)", rest)
        model = next((p[6:].strip() for p in paras if p.startswith("Model:")), None)
        entries.append({"page": page["link"][-40:], "title": title, "mfr": title.split(":")[0].strip(), "model": model,
                        "paras": [p for p in paras if not p.startswith(("MHRA reference", "Model:"))][:3], "mhra_ref": ref.group(2) if ref else None})
OUT["mhra_fsn"]["entries_parsed_from_12_pages"] = len(entries)
OUT["mhra_fsn"]["with_model"] = sum(1 for e in entries if e["model"])
OUT["mhra_fsn"]["with_mhra_ref"] = sum(1 for e in entries if e["mhra_ref"])
OUT["mhra_fsn"]["sample"] = entries[:6]
# attached FSN PDFs live on filecamp (third-party host)
s, b = get("https://mhra-gov.filecamp.com/s/d/ufgoyb52EAk7vCWo")
OUT["mhra_fsn"]["filecamp_http"] = s
s, b = get("https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/")
t = text(b.decode("utf8", "ignore"))
i = t.find("You are free to")
OUT["ogl3_terms"] = {"http": s, "quote": t[i:i + 250]}
i = t.find("Acknowledge the source")
OUT["ogl3_attribution"] = t[i:i + 160]
s, b = get("https://www.gov.uk/help/terms-conditions")
t = text(b.decode("utf8", "ignore"))
i = t.find("is published under the")
OUT["govuk_terms"] = {"http": s, "quote": t[max(0, i - 120):i + 140]}

# ---- MHRA <-> MAUDE candidate link: manufacturer + model token search in MAUDE
cand = []
for e in entries:
    if not e["model"]:
        continue
    tok = re.split(r"[;,]", e["model"])[0].strip()
    if not re.fullmatch(r"[A-Za-z0-9\-./]{3,24}", tok):
        continue
    s, d = ofda("event", search=f'device.model_number:"{tok}"', limit=3)
    hits = []
    if d and d.get("results"):
        for r in d["results"]:
            for x in r["device"]:
                hits.append({"report": r["report_number"], "mfr": x.get("manufacturer_d_name"), "brand": x.get("brand_name"), "model": x.get("model_number")})
    cand.append({"mhra_mfr": e["mfr"], "mhra_title": e["title"], "model": tok, "maude_hits": hits[:3], "total": (d or {}).get("meta", {}).get("results", {}).get("total", 0)})
    if len(cand) >= 40:
        break
OUT["mhra_vs_maude_candidate"] = {"tried": len(cand), "with_any_model_hit": sum(1 for c in cand if c["maude_hits"]), "rows": cand}

# ---------------------------------------------------------------- Health Canada incident data
s, d = jget("https://open.canada.ca/data/api/3/action/package_search?q=%22medical+device%22+incident+reports&rows=30")
OUT["hc_open_canada_search"] = {"http": s, "count": d["result"]["count"], "hc_titles": [p["title"][:80] for p in d["result"]["results"] if p.get("organization") and p["organization"]["name"] == "hc-sc"][:12]}
s, b = get("https://www.canada.ca/en/health-canada/services/drugs-health-products/medeffect-canada/adverse-reaction-reporting/medical-device-problems.html")
t = text(b.decode("utf8", "ignore"))
OUT["hc_problem_page"] = {"http": s, "mentions_incidents_database_link": "Medical device incidents database" in t}

# ---------------------------------------------------------------- parked probes
for name, url in [("tga_daen", "https://apps.tga.gov.au/PROD/DAEN/daen-entry.aspx"), ("tga_copyright", "https://www.tga.gov.au/resources/copyright"),
                  ("bfarm_kundeninfo", "https://www.bfarm.de/SiteGlobals/Forms/Suche/Kundeninformationen_Formular.html")]:
    s, b = get(url)
    OUT[name] = {"http": s, "bytes": len(b)}
s, d = jget("https://fsca.swissmedic.ch/mep/api/publications?pageNumber=0&sortingProperty=PUBLICATION_DATE&direction=DESC")
OUT["swissmedic_fsca"] = {"http": s, "total": d["totalElements"], "newest": d["content"][0]["publikationsDatum"]}
s, b = get("https://www.swissmedic.ch/swissmedic/en/home/legal-framework.html")
t = text(b.decode("utf8", "ignore"))
i = t.find("Restrictions on use")
OUT["swissmedic_terms"] = {"http": s, "quote": t[i + 20:i + 330]}

json.dump(OUT, open("results.json", "w"), indent=1, default=str)
print(json.dumps({k: v for k, v in OUT.items() if k not in ("mhra_vs_maude_candidate",)}, indent=1, default=str)[:9000])
