"""Lobbying disclosures: how often do LDA activity descriptions cite a bill by number, and do
the cited bills exist in the GPO BILLSTATUS bulk data (119th Congress)? Seed 20261101."""
import json, re, random, urllib.request, urllib.error, time
UA = "data-foundry-scout/1.0 (data@mail.proviciency.com)"
def get(u, method="GET"):
    r = urllib.request.Request(u, headers={"User-Agent": UA}, method=method)
    return urllib.request.urlopen(r, timeout=60)
filings = []
for page in range(1, 6):
    d = json.load(get(f"https://lda.gov/api/v1/filings/?filing_year=2026&filing_period=third_quarter&page_size=25&page={page}"))
    filings += d["results"]; time.sleep(8)
random.seed(20261101)
samp = random.sample(filings, 100)
pat = re.compile(r"\b(H\.?\s?R\.?|S\.|H\.?\s?J\.?\s?Res\.?|S\.?\s?J\.?\s?Res\.?)\s*(\d{1,5})\b")
code = {"HR": "hr", "S": "s", "HJRES": "hjres", "SJRES": "sjres"}
cites, per_filing = set(), []
for f in samp:
    txt = " ".join(a["description"] or "" for a in f["lobbying_activities"])
    found = set()
    for m in pat.finditer(txt):
        k = re.sub(r"[.\s]", "", m.group(1)).upper()
        if k in code: found.add((code[k], int(m.group(2))))
    per_filing.append(len(found)); cites |= found
cites = sorted(cites)
ok = {}
for t, n in cites:
    try:
        r = get(f"https://www.govinfo.gov/bulkdata/BILLSTATUS/119/{t}/BILLSTATUS-119{t}{n}.xml", "HEAD"); ok[f"{t}{n}"] = r.status == 200
    except urllib.error.HTTPError as e:
        ok[f"{t}{n}"] = False
    time.sleep(0.2)
descs = [len(" ".join(a["description"] or "" for a in f["lobbying_activities"])) for f in samp]
out = {"filings_in_q3_2026": 25790, "sampled": len(samp), "filings_citing_a_bill": sum(1 for c in per_filing if c), "distinct_cites": len(cites),
       "cites_resolving_in_billstatus": sum(ok.values()), "median_description_chars": sorted(descs)[len(descs)//2], "cites": ok}
json.dump(out, open("lobbying_join.json", "w"), indent=1)
print({k: v for k, v in out.items() if k != "cites"})
