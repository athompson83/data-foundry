# Candidate join: Met highlight artists -> AIC agents by exact normalised name (no shared identifier exists: AIC publishes ulan_id for 1 of 17,017 agents and wikidata_id for 0).
import sys, json, urllib.parse, unicodedata, time
sys.path.insert(0, '..'); from common import *
n = lambda s: " ".join(unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower().replace(",", " ").split())
rows = json.load(open("highlights.json"))["rows"]
out = []
for r in rows:
    j = get("https://api.artic.edu/api/v1/agents/search?limit=5&fields=id,title,is_artist&q=" + urllib.parse.quote(r["met_name"]))
    hit = [d for d in (j or {}).get("data", []) if n(d["title"]) == n(r["met_name"])]
    out.append({"ulan": r["ulan"], "met": r["met_name"], "aic": [(d["id"], d["title"]) for d in hit]}); time.sleep(0.3)
s = {"artists": len(out), "exact_name_in_aic": sum(1 for o in out if o["aic"])}
json.dump({"stats": s, "rows": out}, open("names.json", "w"), indent=1); print(s)
for o in out:
    if o["aic"]: print(o["met"], "|", o["aic"])
