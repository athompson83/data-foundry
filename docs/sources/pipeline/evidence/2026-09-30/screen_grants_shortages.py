"""Round 2026-09-30 screening: research-grant UEI join (NSF vs NIH) and drug-shortage name join (FDA vs EMA).
Live requests with the declared scout User-Agent; writes grants_shortages.json."""
import json, random, re, subprocess, time

UA = "DataFoundryScout/1.0 (data@mail.proviciency.com)"


def get(url, body=None):
    # curl, not urllib: it honours the egress proxy's CA bundle for every host.
    cmd = ["curl", "-sS", "-m", "90", "-A", UA, url] + (["-H", "Content-Type: application/json", "-d", json.dumps(body)] if body else [])
    for attempt in range(4):
        done = subprocess.run(cmd, capture_output=True)
        if done.returncode == 0:
            return json.loads(done.stdout)
        time.sleep(2 ** attempt)
    raise RuntimeError(f"{url}: curl exit {done.returncode}")


out = {"round": "2026-09-30"}
nsf = get("https://api.nsf.gov/services/v1/awards.json?printFields=id,awardeeName,ueiNumber,title&rpp=25&dateStart=03/01/2025&dateEnd=03/31/2025")["response"]["award"]
nsf += get("https://api.nsf.gov/services/v1/awards.json?printFields=id,awardeeName,ueiNumber,title&rpp=25&dateStart=07/01/2025&dateEnd=07/31/2025")["response"]["award"]
random.seed(7)
sample = random.sample([a for a in nsf if a.get("ueiNumber")], min(40, len([a for a in nsf if a.get("ueiNumber")])))
hits = []
for a in sample:
    r = get("https://api.reporter.nih.gov/v2/projects/search", {"criteria": {"fiscal_years": [2025], "org_names": [a["awardeeName"].upper()[:40]]},
                                                               "include_fields": ["ApplId", "Organization"], "offset": 0, "limit": 25})
    ueis = {(p["organization"] or {}).get("org_uei") for p in r["results"]}
    hits.append({"nsf_award": a["id"], "awardee": a["awardeeName"], "uei": a["ueiNumber"], "nih_rows_seen": len(r["results"]), "uei_on_nih_award": a["ueiNumber"] in ueis})
    time.sleep(1.1)
out["grants"] = {"nsf_sample": len(sample), "uei_found_on_nih_award": sum(h["uei_on_nih_award"] for h in hits), "rows": hits,
                 "note": "org_names is a wildcard search capped at 25 rows, so a miss can be a truncation; the count is a lower bound"}
out["grants"]["nih_fy2025_projects"] = get("https://api.reporter.nih.gov/v2/projects/search", {"criteria": {"fiscal_years": [2025]}, "limit": 1})["meta"]["total"]

fda, skip = [], 0
while True:
    p = get(f"https://api.fda.gov/drug/shortages.json?limit=100&skip={skip}")
    fda += p["results"]
    skip += 100
    if skip >= p["meta"]["results"]["total"]:
        break
ema = get("https://www.ema.europa.eu/en/documents/report/shortages-output-json-report_en.json")["data"]
norm = lambda s: re.sub(r"[^a-z ]", " ", (s or "").lower())
STOP = {"injection", "tablet", "tablets", "hydrochloride", "sodium", "sulfate", "acetate", "and", "for", "oral", "solution", "capsule", "capsules", "extended", "release", "human", "normal"}
tok = lambda s: {t for t in norm(s).split() if len(t) > 3 and t not in STOP}
fda_tok = [(f, tok(f.get("generic_name", ""))) for f in fda]
matches = []
for e in ema:
    et = tok(e.get("international_non_proprietary_name_inn_or_common_name", ""))
    cand = [f["generic_name"] for f, ft in fda_tok if et and ft and (et & ft)]
    if cand:
        matches.append({"ema_inn": e["international_non_proprietary_name_inn_or_common_name"], "ema_status": e["supply_shortage_status"], "fda_generic_names": sorted(set(cand))[:4]})
out["shortages"] = {"fda_records": len(fda), "fda_with_related_info": sum(1 for f in fda if f.get("related_info")), "ema_records": len(ema),
                    "ema_with_fda_candidate": len(matches), "candidates": matches}
json.dump(out, open("grants_shortages.json", "w"), indent=1)
print(json.dumps({k: {kk: vv for kk, vv in v.items() if kk not in ("rows", "candidates")} for k, v in out.items() if isinstance(v, dict)}, indent=1))
