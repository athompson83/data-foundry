"""UK OPSS (GOV.UK) notices vs CPSC recalls: check-digit-valid GTIN overlap. Writes opss_gtin.json.
CPSC: all recalls 2022-01..2026-09 (half-year RecallDate windows). OPSS: the 600 most recent notices since 2024-01-01."""
import json, re, subprocess, time

UA = "DataFoundryScout/1.0 (data@mail.proviciency.com)"


def get(url):
    for attempt in range(4):
        done = subprocess.run(["curl", "-sS", "-m", "90", "-A", UA, url], capture_output=True)
        if done.returncode == 0:
            try:
                return json.loads(done.stdout)
            except ValueError:
                pass
        time.sleep(2 ** attempt)
    raise RuntimeError(url)


def gtin_ok(s):
    if len(s) not in (8, 12, 13, 14):
        return False
    digits = [int(c) for c in s]
    total = sum(x * (3 if i % 2 == 0 else 1) for i, x in enumerate(digits[:-1][::-1]))
    return (10 - total % 10) % 10 == digits[-1]


cpsc = []
for year in range(2022, 2027):
    for a, b in [(f"{year}-01-01", f"{year}-06-30"), (f"{year}-07-01", f"{year}-12-31")]:
        cpsc += get(f"https://www.saferproducts.gov/RestWebServices/Recall?format=json&RecallDateStart={a}&RecallDateEnd={b}")
cpsc_gtins, cpsc_with = set(), 0
for r in cpsc:
    upcs = [u.get("UPC", "") if isinstance(u, dict) else str(u) for u in r.get("ProductUPCs", [])]
    found = {m.lstrip("0") for t in upcs + [r.get("Description", "")] for m in re.findall(r"(?<!\d)\d{8,14}(?!\d)", t) if gtin_ok(m)}
    cpsc_with += bool(found)
    cpsc_gtins |= found
index, start = [], 0
while True:
    page = get(f"https://www.gov.uk/api/search.json?filter_format=product_safety_alert_report_recall&count=1000&start={start}&fields=title,public_timestamp,link&order=-public_timestamp")
    index += page["results"]
    start += 1000
    if start >= page["total"]:
        break
recent = [r for r in index if r["public_timestamp"] >= "2024-01-01"][:600]
with_gtin, shared = 0, []
for r in recent:
    text = json.dumps(get("https://www.gov.uk/api/content" + r["link"]).get("details", {}))
    found = {m.lstrip("0") for m in re.findall(r"(?<!\d)\d{8,14}(?!\d)", text) if gtin_ok(m)}
    with_gtin += bool(found)
    if found & cpsc_gtins:
        shared.append({"link": r["link"], "gtins": sorted(found & cpsc_gtins)})
    time.sleep(0.15)
out = {"opss_notices_total": len(index), "opss_newest": index[0]["public_timestamp"], "opss_fetched": len(recent), "opss_with_valid_gtin": with_gtin,
       "cpsc_recalls_2022_2026": len(cpsc), "cpsc_recalls_with_valid_gtin": cpsc_with, "cpsc_distinct_gtins": len(cpsc_gtins), "shared_gtin_notices": shared}
json.dump(out, open("opss_gtin.json", "w"), indent=1)
print({k: v for k, v in out.items() if k != "shared_gtin_notices"}, len(shared))
