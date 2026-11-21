#!/usr/bin/env python3 -I
"""NGA MSI freshness, avalanche seasonality, Avalanche Canada report dates. Writes fresh.json."""
import json, urllib.request, collections
UA="data-foundry-scout/1.0 (data@mail.proviciency.com)"
def j(u): return json.loads(urllib.request.urlopen(urllib.request.Request(u,headers={"User-Agent":UA}),timeout=60).read())
o={}
w=j("https://msi.nga.mil/api/publications/broadcast-warn?output=json&status=all")["broadcast-warn"]
iss=sorted(x["issueDate"] for x in w if x.get("issueDate"))
o["nga_all"]={"n":len(w),"newest_issueDate":iss[-1],"oldest_issueDate":iss[0],"per_year_last5":sorted(collections.Counter(x["msgYear"] for x in w).items())[-5:]}
a=j("https://msi.nga.mil/api/publications/broadcast-warn?output=json&status=active")["broadcast-warn"]
ai=sorted(x["issueDate"] for x in a if x.get("issueDate"))
o["nga_active"]={"n":len(a),"newest_issueDate":ai[-1],"oldest":ai[0]}
f=j("https://api.avalanche.org/v2/public/products/map-layer")["features"]
o["avalanche_org"]={"zones":len(f),"off_season":sum(bool(x["properties"]["off_season"]) for x in f),"in_season":sum(not x["properties"]["off_season"] for x in f),"with_travel_advice":sum(bool(x["properties"].get("travel_advice")) for x in f),"danger_levels":dict(collections.Counter(str(x["properties"]["danger_level"]) for x in f))}
p=j("https://api.avalanche.ca/forecasts/en/products")
o["avalanche_ca"]=[{"area":x["area"].get("name") if isinstance(x["area"],dict) else x["area"],"dateIssued":x["report"].get("dateIssued"),"validUntil":x["report"].get("validUntil"),"highlights_chars":len(x["report"].get("highlights") or ""),"summaries":[k for k in x["report"] if "ummar" in k or "iscussion" in k]} for x in p]
json.dump(o,open("fresh.json","w"),indent=1)
print(json.dumps(o,indent=1)[:3500])
