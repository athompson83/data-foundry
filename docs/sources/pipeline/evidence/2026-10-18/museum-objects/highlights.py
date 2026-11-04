# Same ULAN join, restricted to Met "highlight" objects (well-known works), seeded sample of 120.
import sys, json, random, re, urllib.parse, time
sys.path.insert(0, '..'); from common import *
random.seed(20261018)
ids = get("https://collectionapi.metmuseum.org/public/collection/v1.1/search?isHighlight=true&q=portrait")["objectIDs"]
objs = [o for o in (get(f"https://collectionapi.metmuseum.org/public/collection/v1/objects/{i}") for i in random.sample(ids, min(120, len(ids)))) if o]
ulans = {}
for o in objs:
    for c in o.get("constituents") or []:
        m = re.search(r"/ulan/(\d+)", c.get("constituentULAN_URL") or "")
        if m: ulans[m.group(1)] = c["name"]
rows = []
for u, name in ulans.items():
    q = json.dumps({"query": {"term": {"ulan_id": int(u)}}})
    j = get("https://api.artic.edu/api/v1/agents/search?limit=3&fields=id,title,ulan_id&params=" + urllib.parse.quote(q))
    hit = [d for d in (j or {}).get("data", []) if str(d.get("ulan_id")) == u]
    rows.append({"ulan": u, "met_name": name, "aic": hit[0] if hit else None}); time.sleep(0.3)
s = {"highlight_ids": len(ids), "sampled_objects": len(objs), "distinct_ulan_artists": len(ulans), "in_aic": sum(1 for r in rows if r["aic"]),
     "surname_equal": sum(1 for r in rows if r["aic"] and r["aic"]["title"].split()[-1] == r["met_name"].split()[-1])}
json.dump({"stats": s, "rows": rows}, open("highlights.json", "w"), indent=1); print(s)
