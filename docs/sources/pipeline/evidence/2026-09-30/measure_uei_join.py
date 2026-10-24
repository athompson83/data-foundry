"""NSF awardee UEI vs the set of organization UEIs on NIH RePORTER FY2025 projects (sliced by state under NIH's 15k offset cap).
Writes uei_join.json. Live requests, declared User-Agent, at most one request per second."""
import json, random, subprocess, time

UA = "DataFoundryScout/1.0 (data@mail.proviciency.com)"


def get(url, body=None):
    cmd = ["curl", "-sS", "-m", "90", "-A", UA, url] + (["-H", "Content-Type: application/json", "-d", json.dumps(body)] if body else [])
    for attempt in range(5):
        done = subprocess.run(cmd, capture_output=True)
        if done.returncode == 0:
            try:
                parsed = json.loads(done.stdout)
                if not isinstance(parsed, dict) or "meta" in parsed or "response" in parsed:
                    return parsed
            except ValueError:
                pass
        time.sleep(2 ** attempt)
    raise RuntimeError(url)


STATES = "AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY PR".split()
nih_ueis, projects, capped = set(), 0, []
for st in STATES:
    offset, total = 0, None
    while total is None or offset < min(total, 15000):
        r = get("https://api.reporter.nih.gov/v2/projects/search", {"criteria": {"fiscal_years": [2025], "org_states": [st]}, "include_fields": ["Organization"], "offset": offset, "limit": 500})
        total = r["meta"]["total"]
        for p in r["results"]:
            org = p.get("organization") or {}
            nih_ueis.update(u for u in (org.get("org_ueis") or []) + [org.get("primary_uei")] if u)
        offset += 500
        time.sleep(1.05)
    projects += min(total, 15000)
    if total > 15000:
        capped.append(st)
nsf = []
for a, b in [("03/01/2025", "03/31/2025"), ("07/01/2025", "07/31/2025"), ("10/01/2024", "10/31/2024")]:
    nsf += get(f"https://api.nsf.gov/services/v1/awards.json?printFields=id,awardeeName,ueiNumber&rpp=25&dateStart={a}&dateEnd={b}")["response"]["award"]
nsf = [x for x in nsf if x.get("ueiNumber")]
random.seed(7)
sample = random.sample(nsf, min(40, len(nsf)))
found = [x for x in sample if x["ueiNumber"] in nih_ueis]
json.dump({"nih_fy2025_projects_read": projects, "nih_distinct_uei": len(nih_ueis), "states_capped_at_15000": capped, "nsf_sample": len(sample),
           "nsf_uei_on_nih_fy2025": len(found), "matched": [{"nsf_award": x["id"], "awardee": x["awardeeName"], "uei": x["ueiNumber"]} for x in found]}, open("uei_join.json", "w"), indent=1)
print(len(sample), len(found), len(nih_ueis), projects, capped)
