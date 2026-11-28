"""Recalls widening: NHTSA equipment/child-seat/tire recalls as a member of
consumer-product-recalls-north-america. Measures size, fields, and whether CPSC notices cite NHTSA
campaigns. Re-fetches live. Seed-free (full populations)."""
import io, json, re, zipfile, urllib.request, collections, time
UA = "data-foundry-scout/1.0 (data@mail.proviciency.com)"
def raw(u):
    return urllib.request.urlopen(urllib.request.Request(u, headers={"User-Agent": UA}), timeout=300).read()
z = zipfile.ZipFile(io.BytesIO(raw("https://static.nhtsa.gov/odi/ffdd/rcl/FLAT_RCL_POST_2010.zip")))
name = z.namelist()[0]; data = z.read(name).decode("latin-1")
rows = [l.split("\t") for l in data.splitlines() if l.strip()]
# RCL layout: 1 RECORD_ID,2 CAMPNO,3 MAKETXT,4 MODELTXT,5 YEARTXT,...,type at index 6? check documented layout below
camp = collections.Counter(r[1] for r in rows)
cmp_types = collections.Counter(re.match(r"\d\d([VETC])", r[1]).group(1) if re.match(r"\d\d[VETC]", r[1]) else "?" for r in rows)
campaigns = {r[1] for r in rows}
types = collections.Counter(re.match(r"\d\d([VETC])", c).group(1) if re.match(r"\d\d[VETC]", c) else "?" for c in campaigns)
print("file", name, "rows", len(rows), "distinct campaigns", len(campaigns), dict(types))
# CPSC: scan notices for NHTSA mentions or campaign numbers
cpsc = {}
for y in range(2015, 2027):
    for half in (("01-01", "06-30"), ("07-01", "12-31")):
        u = f"https://www.saferproducts.gov/RestWebServices/Recall?format=json&RecallDateStart={y}-{half[0]}&RecallDateEnd={y}-{half[1]}"
        try:
            for r in json.loads(raw(u)):
                cpsc[r["RecallID"]] = r
        except Exception as e:
            print("cpsc window failed", y, half, e)
        time.sleep(0.3)
pat = re.compile(r"\b(\d{2}[EVTC]-?\d{3})\b")
nh = [r for r in cpsc.values() if re.search(r"NHTSA|National Highway Traffic", json.dumps(r))]
cites = {}
for r in nh:
    txt = json.dumps(r)
    for m in pat.findall(txt):
        c = m.replace("-", "")
        cites.setdefault(r["RecallID"], set()).add(c)
cites_resolving = {k: [c for c in v if any(cc.startswith(c) for cc in campaigns)] for k, v in cites.items()}
out = {"nhtsa_post2010_rows": len(rows), "nhtsa_distinct_campaigns": len(campaigns), "campaign_type_letters": dict(types),
       "cpsc_notices_2015_2026": len(cpsc), "cpsc_mentioning_nhtsa": len(nh), "cpsc_with_campaign_like_token": len(cites),
       "cpsc_with_resolving_campaign": sum(1 for v in cites_resolving.values() if v), "examples": {k: v for k, v in list(cites_resolving.items())[:10]}}
json.dump(out, open("nhtsa_widening.json", "w"), indent=1, default=list)
print(out)
