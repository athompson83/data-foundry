# Measures how many UK OPSS alert/report/recall pages cite a CPSC or Health Canada notice.
# usage: python3 -I opss-citations.py [N]  (samples the N newest + N oldest-of-first-page pages)
import json, re, sys, urllib.request, urllib.parse
UA = "data-foundry-scout/1.0 (data@mail.proviciency.com)"
def get(u):
    return json.load(urllib.request.urlopen(urllib.request.Request(u, headers={"User-Agent": UA}), timeout=40))
n = int(sys.argv[1]) if len(sys.argv) > 1 else 150
base = "https://www.gov.uk/api/search.json?filter_format=product_safety_alert_report_recall&order=-public_timestamp&fields=title,public_timestamp,link&count=%d&start=%d"
total = get(base % (0, 0))["total"]
links = []
for start in (0, 1000, 2000, 3000):
    links += get(base % (n // 4, start))["results"]
out = {"total": total, "sampled": len(links), "cpsc": [], "hc": [], "text_types": {}}
for r in links:
    c = get("https://www.gov.uk/api/content" + r["link"])
    body = json.dumps(c)
    m = re.findall(r"(?:cpsc\.gov|saferproducts\.gov)[^\"\\ )<]*", body)
    h = re.findall(r"(?:recalls-rappels\.canada\.ca|healthycanadians\.gc\.ca)[^\"\\ )<]*", body)
    if m: out["cpsc"].append({"link": r["link"], "cites": m[:3]})
    if h: out["hc"].append({"link": r["link"], "cites": h[:3]})
out["cpsc_n"], out["hc_n"] = len(out["cpsc"]), len(out["hc"])
json.dump(out, open("opss-citations.json", "w"), indent=1)
print(total, len(links), out["cpsc_n"], out["hc_n"])
