# CBP CROSS rulings (free text) -> USITC HTS by declared tariff number; ruling text fetched for a seeded sample.
import sys, json, random, re, urllib.parse, time
sys.path.insert(0, '..'); from common import *
random.seed(20261018)
hts = get("https://hts.usitc.gov/reststop/exportList?from=0101&to=9999&format=JSON&styles=false")
codes = {re.sub(r"\D", "", h["htsno"]) for h in hts if h.get("htsno")}
terms = ["heat pump", "compressor", "refrigerator", "valve", "solar panel", "battery", "furniture", "footwear", "textile", "plastic", "steel pipe", "toy", "led lamp", "water heater", "garment", "frozen fish", "pharmaceutical", "bicycle"]
rulings = {}; totals = {}
for t in terms:
    for page in (1, 2):
        j = get("https://rulings.cbp.gov/api/search?collection=ALL&pageSize=100&page=%d&term=%s" % (page, urllib.parse.quote(t)))
        if not j: break
        totals[t] = j["totalHits"]
        for r in j["rulings"]: rulings[r["rulingNumber"]] = r
rs = list(rulings.values()); c = [r for r in rs if r["tariffs"]]
tok = lambda r: [re.sub(r"\D", "", x) for x in r["tariffs"].split(",") if x.strip()]
def known(d): return any(k.startswith(d) for k in codes) if len(d) < 10 else d in codes
scored = [(r, [t for t in tok(r) if not t.startswith("99")]) for r in c]  # skip Chapter 99 temporary duty lines
scored = [(r, ts) for r, ts in scored if ts]
res = sum(1 for r, ts in scored if all(known(t) for t in ts)); any_res = sum(1 for r, ts in scored if any(known(t) for t in ts))
samp = random.sample(rs, 40); texts = []
for r in samp:
    d = get("https://rulings.cbp.gov/api/ruling/" + r["rulingNumber"])
    t = (d or {}).get("text", ""); texts.append({"ruling": r["rulingNumber"], "len": len(t), "has_classification_para": bool(re.search(r"(?i)classification|HTSUS", t)), "has_duty_rate": bool(re.search(r"(?i)rate of duty|duty rate|\d+(\.\d+)? percent", t))}); time.sleep(0.2)
out = {"hts_codes": len(codes), "hts_rows": len(hts), "search_terms": totals, "distinct_rulings": len(rs), "date_min": min(r["rulingDate"][:10] for r in rs), "date_max": max(r["rulingDate"][:10] for r in rs),
       "with_tariffs_field": len(c), "non_chapter99_scored": len(scored), "all_codes_in_hts": res, "any_code_in_hts": any_res,
       "text_sample": {"n": len(texts), "text_nonempty": sum(1 for t in texts if t["len"] > 500), "has_classification_para": sum(t["has_classification_para"] for t in texts), "has_duty_rate": sum(t["has_duty_rate"] for t in texts)},
       "unresolved": [(r["rulingNumber"], ts) for r, ts in scored if not all(known(t) for t in ts)][:20], "texts": texts}
json.dump(out, open("join.json", "w"), indent=1); print({k: v for k, v in out.items() if k not in ("texts", "search_terms")})
