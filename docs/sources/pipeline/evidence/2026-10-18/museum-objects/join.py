# Met Museum open-access objects -> Art Institute of Chicago agents by declared Getty ULAN artist id.
import sys, json, random, re, urllib.parse, time
sys.path.insert(0, '..'); from common import *
random.seed(20261018)
ids = get("https://collectionapi.metmuseum.org/public/collection/v1/objects")["objectIDs"]
total = len(ids); objs = []
for oid in random.sample(ids, 400):
    o = get(f"https://collectionapi.metmuseum.org/public/collection/v1/objects/{oid}")
    if o: objs.append(o)
    if len(objs) >= 300: break
ulans = {}
for o in objs:
    for c in o.get("constituents") or []:
        m = re.search(r"/ulan/(\d+)", c.get("constituentULAN_URL") or "")
        if m: ulans[m.group(1)] = c["name"]
stats = {"met_total_ids": total, "sampled": len(objs),
         "public_domain": sum(1 for o in objs if o.get("isPublicDomain")),
         "with_accession": sum(1 for o in objs if o.get("accessionNumber")),
         "with_wikidata_object": sum(1 for o in objs if o.get("objectWikidata_URL")),
         "with_credit_line": sum(1 for o in objs if o.get("creditLine")),
         "with_dimensions_text": sum(1 for o in objs if o.get("dimensions")),
         "with_ulan_artist": sum(1 for o in objs if any("ulan" in (c.get("constituentULAN_URL") or "") for c in o.get("constituents") or [])),
         "distinct_ulan_artists": len(ulans)}
rows = []
for u, name in list(ulans.items())[:60]:
    q = json.dumps({"query": {"term": {"ulan_id": int(u)}}})
    j = get("https://api.artic.edu/api/v1/agents/search?limit=3&fields=id,title,ulan_id&params=" + urllib.parse.quote(q))
    hit = [d for d in (j or {}).get("data", []) if str(d.get("ulan_id")) == u]
    rows.append({"ulan": u, "met_name": name, "aic": hit[0] if hit else None}); time.sleep(0.3)
stats["ulan_checked"] = len(rows); stats["ulan_in_aic"] = sum(1 for r in rows if r["aic"])
stats["name_equal_among_matches"] = sum(1 for r in rows if r["aic"] and r["aic"]["title"].split()[-1] == r["met_name"].split()[-1])
a = get("https://api.artic.edu/api/v1/artworks?limit=100&fields=id,description,main_reference_number,is_public_domain,provenance_text,exhibition_history")
stats["aic_total_artworks"] = a["pagination"]["total"]; d = a["data"]
stats["aic_sample100"] = {"description": sum(1 for x in d if x.get("description")), "provenance_text": sum(1 for x in d if x.get("provenance_text")), "exhibition_history": sum(1 for x in d if x.get("exhibition_history")), "public_domain": sum(1 for x in d if x.get("is_public_domain"))}
json.dump({"stats": stats, "rows": rows}, open("join.json", "w"), indent=1); print(json.dumps(stats, indent=1))
