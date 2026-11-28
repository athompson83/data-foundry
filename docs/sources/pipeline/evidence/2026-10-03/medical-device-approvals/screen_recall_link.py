#!/usr/bin/env python3
"""FDA device enforcement report (live fda-recalls) -> openFDA device/recall (k_numbers) -> 510(k). 2026-10-03."""
import json, time, urllib.request, os, random
UA = "data-foundry-scout (data@mail.proviciency.com)"
random.seed(11)
def get(u):
    time.sleep(0.6)
    try:
        return json.loads(urllib.request.urlopen(urllib.request.Request(u, headers={"User-Agent": UA}), timeout=60).read())
    except Exception:
        return None
F = "https://api.fda.gov/device/"
recs = []
for skip in random.sample(range(0, 20000, 100), 2):
    d = get(F + f"enforcement.json?search=product_type:Devices&limit=50&skip={skip}")
    if d: recs += d["results"]
recs = recs[:100]
has_res = has_k = k_in_510k = 0
for r in recs:
    d = get(F + f"recall.json?search=product_res_number:\"{r['recall_number']}\"&limit=1")
    if d and d["results"]:
        has_res += 1
        ks = d["results"][0].get("k_numbers") or []
        if ks:
            has_k += 1
            e = get(F + f"510k.json?search=k_number:{ks[0]}&limit=1")
            if e and e["results"]: k_in_510k += 1
out = {"enforcement_sampled": len(recs), "found_in_device_recall_by_recall_number": has_res, "with_k_numbers": has_k, "k_resolves_to_510k": k_in_510k}
p = os.path.join(os.path.dirname(os.path.abspath(__file__)), "results.json")
res = json.load(open(p)); res["join_enforcement_to_510k_via_device_recall"] = out
json.dump(res, open(p, "w"), indent=1); print(out)
