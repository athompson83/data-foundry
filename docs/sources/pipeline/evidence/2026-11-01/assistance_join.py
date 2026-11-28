"""Federal assistance programs: measure the Assistance Listing Number (ALN) join between
Grants.gov opportunities, SAM.gov Assistance Listings and USAspending assistance awards.
Re-fetches live. Writes assistance_join.json."""
import json, urllib.request, time, random, collections
UA = "data-foundry-scout/1.0 (data@mail.proviciency.com)"
def req(url, data=None):
    r = urllib.request.Request(url, data=json.dumps(data).encode() if data else None,
        headers={"User-Agent": UA, "Content-Type": "application/json"})
    for i in range(3):
        try:
            return json.load(urllib.request.urlopen(r, timeout=60))
        except Exception as e:
            err = e; time.sleep(2)
    raise err
# 1. all posted + forecasted opportunities
opps = []
for st in ("posted", "forecasted"):
    start = 0
    while True:
        d = req("https://api.grants.gov/v1/api/search2", {"rows": 250, "startRecordNum": start, "oppStatuses": st})["data"]
        opps += d["oppHits"]; start += 250
        if start >= d["hitCount"]: break
n = len(opps)
with_aln = [o for o in opps if o.get("cfdaList")]
alns = sorted({a for o in with_aln for a in o["cfdaList"]})
print("opps", n, "with ALN", len(with_aln), "distinct ALN", len(alns))
# 2. resolve each ALN in SAM.gov Assistance Listings (latest version)
sam = {}
for a in alns:
    d = req(f"https://sam.gov/api/prod/sgs/v1/search/?index=cfda&page=0&size=10&q={a}&is_active=true")
    hits = [r for r in d.get("_embedded", {}).get("results", []) if r.get("programNumber") == a and str(r.get("isLatest")).lower() == "true"]
    sam[a] = hits[0] if hits else None
resolved = [a for a in alns if sam[a]]
elig = [a for a in resolved if (sam[a].get("eligibility") or {}).get("applicant") or (sam[a].get("eligibility") or {}).get("beneficiary")]
obj = [a for a in resolved if sam[a].get("objective")]
# 3. awards in USAspending per ALN (sampled, seed fixed)
random.seed(20261101)
samp = random.sample(alns, min(40, len(alns)))
aw = {}
for a in samp:
    d = req("https://api.usaspending.gov/api/v2/search/spending_by_award/", {"filters": {"program_numbers": [a], "award_type_codes": ["02","03","04","05"], "time_period": [{"start_date": "2023-10-01", "end_date": "2026-09-30"}]}, "fields": ["Award ID"], "limit": 1})
    aw[a] = bool(d.get("results"))
out = {"opportunities": n, "with_aln": len(with_aln), "distinct_aln": len(alns),
       "aln_resolved_in_sam": len(resolved), "unresolved": [a for a in alns if not sam[a]],
       "resolved_with_eligibility_text": len(elig), "resolved_with_objective_text": len(obj),
       "usaspending_sample": len(samp), "usaspending_with_awards": sum(aw.values()),
       "sample_alns": samp, "awards_by_aln": aw}
json.dump(out, open("assistance_join.json", "w"), indent=1)
print({k: v for k, v in out.items() if k not in ("sample_alns", "awards_by_aln")})
