#!/usr/bin/env python3
"""Join measurement: bill numbers cited in lda.gov lobbying-activity text vs govinfo BILLSTATUS (declared: congress + type + number)."""
import json, re, urllib.request, urllib.error
UA="data-foundry-scout/1.0 (data@mail.proviciency.com)"
def get(u):
    return urllib.request.urlopen(urllib.request.Request(u,headers={"User-Agent":UA}),timeout=60).read()
acts=[]
for page in range(1,9):
    d=json.loads(get(f"https://lda.gov/api/v1/filings/?page_size=25&page={page}&filing_year=2025&filing_period=third_quarter"))
    for f in d["results"]:
        for a in f.get("lobbying_activities",[]):
            acts.append((f["filing_uuid"],a.get("general_issue_code"),a.get("description") or ""))
PAT=re.compile(r"\b(H\.?\s?R\.?|S\.?|H\.?\s?J\.?\s?Res\.?|S\.?\s?J\.?\s?Res\.?)\s?(\d{1,5})\b")
TYPE={"HR":"hr","H.R":"hr","S":"s"}
cited=set(); with_cite=0
for _,_,t in acts:
    ms=[(re.sub(r"[.\s]","",m.group(1)).upper(),int(m.group(2))) for m in PAT.finditer(t)]
    ms=[(("hr" if k=="HR" else "s" if k=="S" else None),n) for k,n in ms]
    ms=[m for m in ms if m[0]]
    if ms: with_cite+=1
    cited.update(ms)
sample=sorted(cited)[:60]
ok=0; checked=0; res=[]
for typ,n in sample:
    u=f"https://www.govinfo.gov/bulkdata/BILLSTATUS/119/{typ}/BILLSTATUS-119{typ}{n}.xml"
    try:
        x=get(u).decode("utf8","replace"); title=re.search(r"<title>(.*?)</title>",x,re.S)
        ok+=1; res.append((typ,n,"found",title.group(1)[:80] if title else None))
    except urllib.error.HTTPError as e:
        res.append((typ,n,e.code,None))
    checked+=1
out={"activities":len(acts),"activities_with_bill_citation":with_cite,"distinct_bills_cited":len(cited),"checked":checked,"resolved_in_govinfo_119":ok,"examples":res[:12]}
json.dump(out,open("lda_bills.json","w"),indent=1)
print(json.dumps(out,indent=1))
