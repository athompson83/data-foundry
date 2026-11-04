#!/usr/bin/env python3
"""Measure the Transport Canada VRDB as a widening member of consumer-product-recalls-north-america.
Re-fetches live: the VRDB full CSV and the CPSC Recall API (all recalls), then counts CPSC notices that cite a
Transport Canada VRDB URL and how many resolve to a RECALL_NUMBER_NUM in the CSV. Writes tc_widening.json."""
import csv, io, json, re, sys, urllib.request, collections, hashlib
UA = {"User-Agent": "data-foundry-scout/1.0 (data@mail.proviciency.com)"}
def get(u):
    return urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=300).read()
raw = get("https://opendatatc.tc.canada.ca/vrdb_full_monthly.csv")
csv.field_size_limit(10**9)
rows = list(csv.DictReader(io.StringIO(raw.decode("utf-8", "replace"))))
recalls = {}
for r in rows:
    recalls.setdefault(r["RECALL_NUMBER_NUM"], r)
cats = collections.Counter(r["CATEGORY_ETXT"] for r in recalls.values())
dates = sorted(r["RECALL_DATE_DTE"] for r in recalls.values() if r["RECALL_DATE_DTE"])
comment = sum(1 for r in recalls.values() if len(r["COMMENT_ETXT"]) > 50)
cpsc = json.loads(get("https://www.saferproducts.gov/RestWebServices/Recall?format=json"))
cited, resolved, unresolved, samples = 0, 0, [], []
for n in cpsc:
    urls = [c.get("URL", "") for c in (n.get("Inconjunctions") or []) if isinstance(c, dict)]
    urls += [n.get("URL", "")]
    tc = [u for u in urls if "tc.gc.ca" in u or "tc.canada.ca" in u]
    if not tc: continue
    cited += 1
    ids = set()
    for u in tc:
        ids |= set(re.findall(r"(?:[?&]rn=|/)(\d{7})\b", u))
    hit = [i for i in ids if i in recalls]
    if hit: resolved += 1
    else: unresolved.append({"RecallNumber": n.get("RecallNumber"), "urls": tc})
    if len(samples) < 20: samples.append({"RecallNumber": n.get("RecallNumber"), "tc": tc, "ids": sorted(ids), "resolved": hit})
out = {"csv_bytes": len(raw), "csv_sha256": hashlib.sha256(raw).hexdigest(), "csv_rows": len(rows),
       "distinct_recalls": len(recalls), "first_date": dates[0], "last_date": dates[-1],
       "recalls_with_comment_over_50_chars": comment, "categories": cats.most_common(12),
       "cpsc_recalls_total": len(cpsc), "cpsc_citing_tc": cited, "cpsc_tc_resolved": resolved,
       "unresolved_sample": unresolved[:10], "samples": samples}
json.dump(out, open("tc_widening.json", "w"), indent=1)
print(json.dumps({k: v for k, v in out.items() if k not in ("samples", "unresolved_sample")}, indent=1))
print(json.dumps(unresolved[:5], indent=1))
