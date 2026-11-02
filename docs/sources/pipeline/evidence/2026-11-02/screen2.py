#!/usr/bin/env python3
"""2026-11-02 screening measurements: Legistar municipal matters, CMS nursing-home citations, FEMA PA projects, FCSI zip, FMCSA."""
import json, urllib.request, statistics, collections, re
UA = {"User-Agent": "data-foundry-scout/1.0 (data@mail.proviciency.com)"}
def get(u, raw=False, n=None):
    r = urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=120)
    b = r.read() if n is None else r.read(n)
    return b if raw else json.loads(b)
out = {}
# Legistar: count via paging skip; sample 200 latest matters, text lengths, cited state/federal identifiers
leg = {}
for c in ["seattle", "boston", "phoenix", "pittsburgh"]:
    try:
        s = get(f"https://webapi.legistar.com/v1/{c}/matters?$top=200&$orderby=MatterLastModifiedUtc%20desc")
        lens = [len(m.get("MatterTitle") or "") for m in s]
        types = collections.Counter(m.get("MatterTypeName") for m in s).most_common(4)
        # approximate total: highest MatterId
        top = get(f"https://webapi.legistar.com/v1/{c}/matters?$top=1&$orderby=MatterId%20desc")[0]["MatterId"]
        att = get(f"https://webapi.legistar.com/v1/{c}/matters/{s[0]['MatterId']}/attachments")
        leg[c] = {"sample": len(s), "newest_modified": s[0]["MatterLastModifiedUtc"], "max_matter_id": top,
                  "title_len_median": statistics.median(lens), "title_over_100": sum(l > 100 for l in lens),
                  "types": types, "fields": sorted(s[0].keys())[:40], "attachments_first": len(att)}
    except Exception as e:
        leg[c] = {"error": str(e)[:120]}
out["legistar"] = leg
# CMS nursing home citations
base = "https://data.cms.gov/provider-data/api/1/datastore/query/r5ix-sfxw/0"
cms = get(base + "?limit=1&count=true&results=false")
rows = get(base + "?limit=500&offset=100000")["results"]
dl = [len(r["deficiency_description"]) for r in rows]
out["cms_nursing_citations"] = {"count": cms["count"], "sample": len(rows), "desc_len_median": statistics.median(dl),
    "desc_len_max": max(dl), "scope_codes": collections.Counter(r["scope_severity_code"] for r in rows).most_common(),
    "distinct_ccn_in_sample": len({r["cms_certification_number_ccn"] for r in rows}),
    "meta_released": get("https://data.cms.gov/provider-data/api/1/metastore/schemas/dataset/items/r5ix-sfxw").get("released")}
# FEMA PA project titles
fe = get("https://www.fema.gov/api/open/v2/PublicAssistanceFundedProjectsDetails?$top=500&$skip=300000&$select=applicationTitle,pwNumber,disasterNumber,totalObligated")
pa = list(fe.values())[1]
tl = [len(r.get("applicationTitle") or "") for r in pa]
out["fema_pa"] = {"count": list(fe.values())[0]["count"] if "count" in list(fe.values())[0] else None, "sample": len(pa),
                  "title_len_median": statistics.median(tl), "title_over_40": sum(l > 40 for l in tl)}
# FCSI zip (host fails TLS verification from this egress: recorded, never bypassed)
try:
    z = urllib.request.urlopen(urllib.request.Request("https://map-carte.tbs-sct.gc.ca/fcsi-rscf/oddo/fcsi-rscf.zip", headers=UA), timeout=120)
    zb = z.read(); out["fcsi_zip_bytes"] = len(zb)
    import zipfile, io
    out["fcsi_zip_members"] = [(i.filename, i.file_size) for i in zipfile.ZipFile(io.BytesIO(zb)).infolist()]
except Exception as e:
    out["fcsi_zip_error"] = str(e)[:160]
json.dump(out, open("screen2.json", "w"), indent=1, default=str)
print(json.dumps(out, indent=1, default=str)[:5000])
