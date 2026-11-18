#!/usr/bin/env python3
"""Rights re-read 2026-11-18 for `drug-label-facts` (EVIDENCED -> RIGHTS_DETERMINED). Stdlib only, fetches live.
Run from this directory: python3 -I druglabel_rights.py  -> writes druglabel_rights.json
Checks that each quoted sentence is present verbatim (whitespace-normalised) in the publisher's terms page as served
today, records each page's SHA-256, and measures the openFDA drug label endpoint (totals, last_updated) and the DailyMed
bulk-download listing. A sample of 100 prescription labels is counted for sponsor copyright notices by section
(set ids and counts only; no label text is written).
"""
import hashlib, html, json, re, time, urllib.parse, urllib.request, urllib.error

UA = "data-foundry-scout/1.0 (data@mail.proviciency.com)"
N = [0]


def get(u, timeout=90):
    N[0] += 1
    try:
        with urllib.request.urlopen(urllib.request.Request(u, headers={"User-Agent": UA}), timeout=timeout) as f:
            return f.status, f.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()
    except Exception as e:  # noqa: BLE001
        return 0, str(e).encode()


def text(b):
    t = re.sub(r"<script.*?</script>|<style.*?</style>", " ", b.decode("utf8", "replace"), flags=re.S)
    t = html.unescape(re.sub(r"<[^>]+>", " ", t)).replace("’", "'").replace("“", '"').replace("”", '"')
    return re.sub(r"\s+", " ", t)


QUOTES = {
    "https://open.fda.gov/terms/": [
        "Unless otherwise noted, the content, data, documentation, code, and related materials on openFDA is public domain and made available with a Creative Commons CC0 1.0 Universal dedication.",
        "Some data on openFDA may not be public domain, such as copies of copyrightable works made available to the FDA by private entities.",
        "FDA may make these works available under the fair use provision of the Copyright Act or as a result of regulatory directives. Therefore, your rights to use those works may be similarly limited.",
    ],
    "https://www.nlm.nih.gov/web_policies.html": [
        "Works produced by the U.S. government are not subject to copyright protection in the United States",
        "Transmission or reproduction of copyrighted items (beyond that allowed by fair use as defined in the U.S. copyright laws) requires the written permission of the copyright holders.",
    ],
}
out = {"run_date": time.strftime("%Y-%m-%d"), "terms": {}}
for url, quotes in QUOTES.items():
    st, b = get(url)
    t = text(b)
    out["terms"][url] = {"status": st, "bytes": len(b), "sha256": hashlib.sha256(b).hexdigest(),
                         "quotes": [{"quote": q, "present_verbatim": q in t} for q in quotes]}
    # context around key phrases, to quote the page as served when wording has changed
    ctx = {}
    for kw in ("public domain", "fair use", "medical care", "copyright protection", "written permission"):
        i = t.find(kw)
        if i >= 0:
            ctx[kw] = t[max(0, i - 250): i + 300]
    out["terms"][url]["context"] = ctx

for url in ("https://dailymed.nlm.nih.gov/dailymed/spl-resources-all-drug-labels.cfm",
            "https://dailymed.nlm.nih.gov/dailymed/app-support-web-services.cfm"):
    st, b = get(url)
    t = text(b)
    out["terms"][url] = {"status": st, "bytes": len(b), "sha256": hashlib.sha256(b).hexdigest(),
                         "zip_links": sorted(set(re.findall(r'href="([^"]+\.zip)"', b.decode("utf8", "replace"))))[:40],
                         "mentions_terms": [m for m in ("copyright", "terms", "license", "public domain") if m in t.lower()]}

api = "https://api.fda.gov/drug/label.json"
st, b = get(api + "?limit=1")
meta = json.loads(b)["meta"]
out["openfda_label"] = {"status": st, "last_updated": meta["last_updated"], "total": meta["results"]["total"],
                        "license": meta.get("license"), "disclaimer": meta.get("disclaimer")}
st, b = get(api + "?search=" + urllib.parse.quote('openfda.product_type.exact:"HUMAN PRESCRIPTION DRUG"') + "&limit=1")
out["openfda_label"]["prescription_total"] = json.loads(b)["meta"]["results"]["total"]

st, b = get("https://api.fda.gov/download.json")
bulk = json.loads(b)["results"]["drug"]["label"]
out["openfda_label_bulk"] = {"status": st, "export_date": bulk["export_date"], "total_records": bulk["total_records"],
                             "partitions": len(bulk["partitions"]), "zipped_mb": round(sum(float(p["size_mb"]) for p in bulk["partitions"]), 1)}
st, b = get("https://open.fda.gov/apis/authentication/")
m = re.search(r"With no API key: ([^.]+\.[^.]+\.)", text(b))
out["openfda_rate_limit_no_key"] = {"status": st, "text": m.group(1) if m else None}

# Copyright notices by section in 100 prescription labels (newest effective_time first).
st, b = get(api + "?search=" + urllib.parse.quote('openfda.product_type.exact:"HUMAN PRESCRIPTION DRUG"') + "&sort=effective_time:desc&limit=100")
labels = json.loads(b)["results"]
NOTICE = re.compile(r"all rights reserved|©|\(c\)\s*(?:19|20)\d\d|copyright\s*(?:©|\(c\))?\s*(?:19|20)\d\d", re.I)
PATIENT = ("spl_medguide", "spl_patient_package_insert", "information_for_patients", "instructions_for_use", "patient_medication_information", "spl_unclassified_section", "package_label_principal_display_panel")
FACT = ("boxed_warning", "contraindications", "pregnancy", "lactation", "use_in_specific_populations", "drug_interactions", "dosage_forms_and_strengths", "indications_and_usage")
with_notice, by_section, fact_section_notice, have = [], {}, 0, {k: 0 for k in FACT}
for lab in labels:
    hit = False
    for k, v in lab.items():
        if k == "openfda" or not isinstance(v, list):
            continue
        if any(isinstance(x, str) and NOTICE.search(x) for x in v):
            hit = True
            base = k.replace("_table", "")
            by_section[base] = by_section.get(base, 0) + 1
            if base in FACT:
                fact_section_notice += 1
    for k in FACT:
        if k in lab:
            have[k] += 1
    if hit:
        with_notice.append(lab.get("set_id"))
out["copyright_notice_sample"] = {
    "sample": "100 newest prescription labels by effective_time", "labels": len(labels),
    "effective_time_range": [min(l["effective_time"] for l in labels), max(l["effective_time"] for l in labels)],
    "labels_with_notice": len(with_notice), "notice_by_section": dict(sorted(by_section.items(), key=lambda kv: -kv[1])),
    "notices_inside_fact_sections": fact_section_notice, "labels_having_section": have,
    "set_ids_with_notice": with_notice, "set_ids_sampled": [l.get("set_id") for l in labels],
}
out["requests"] = N[0]
json.dump(out, open("druglabel_rights.json", "w"), indent=1, ensure_ascii=False)
print(json.dumps({k: v for k, v in out.items() if k != "copyright_notice_sample"}, indent=1)[:6000])
c = out["copyright_notice_sample"]
print({k: c[k] for k in c if not k.startswith("set_ids")})
