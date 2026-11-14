#!/usr/bin/env python3 -I
"""NZ Product Safety (MBIE) recalls: sitemap size, detail-page field presence on 20 recalls, GTIN extraction. Writes nz_widening.json."""
import json, re, subprocess, time, random
UA = "data-foundry-scout/1.0 (data@mail.proviciency.com)"
def curl(u): return subprocess.run(["curl","-sS","-m","40","-L","-A",UA,u],capture_output=True,text=True).stdout
out = {}
rec = set()
page_sizes = []
for start in (0, 200, 400, 600, 800, 1000, 1200, 1400, 1600):
    h = curl(f"https://www.recalls.govt.nz/recalls?start={start}")
    found = set(re.findall(r'href="(/recalls/[^"#?/]+)"', h))
    page_sizes.append((start, len(found)))
    rec |= {"https://www.recalls.govt.nz" + f for f in found}
    time.sleep(1)
rec = sorted(rec)
out.update({"listing_pages_probed": page_sizes, "distinct_recall_urls_seen": len(rec)})
random.seed(7); sample = random.sample(rec, min(20, len(rec))) if rec else []
def gtin_ok(d):
    if len(d) not in (8,12,13,14): return False
    s = sum(int(c) * (3 if i % 2 == 0 else 1) for i, c in enumerate(reversed(d[:-1])))
    return (10 - s % 10) % 10 == int(d[-1])
res = []
for u in sample:
    h = curl(u); time.sleep(1)
    t = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", re.sub(r"<script.*?</script>|<style.*?</style>", "", h, flags=re.S)))
    g = [d for d in re.findall(r"\b\d{8,14}\b", t) if gtin_ok(d)]
    res.append({"url": u, "chars": len(t), "has_hazard": bool(re.search(r"(?i)hazard|risk|injur|fire|choking", t)), "has_model": bool(re.search(r"(?i)model|product code|SKU|barcode", t)),
                "has_date": bool(re.search(r"\b20\d\d\b", t)), "has_remedy": bool(re.search(r"(?i)refund|return|repair|replace|stop using", t)), "gtin_valid": g[:3]})
out["sample"] = len(res)
for k in ("has_hazard","has_model","has_date","has_remedy"): out[k] = sum(r[k] for r in res)
out["with_valid_gtin"] = sum(bool(r["gtin_valid"]) for r in res)
out["median_chars"] = sorted(r["chars"] for r in res)[len(res)//2] if res else None
out["rows"] = res
json.dump(out, open("nz_widening.json","w"), indent=1)
print(json.dumps({k:v for k,v in out.items() if k!="rows"}, indent=1))
