import json,urllib.request,zipfile,io,re,sys
UA={"User-Agent":"data-foundry-scout/1.0 (data@mail.proviciency.com)"}
def get(u,t=90):
    return urllib.request.urlopen(urllib.request.Request(u,headers=UA),timeout=t).read()
out={}
# MSHA accidents
try:
    z=zipfile.ZipFile(io.BytesIO(get("https://arlweb.msha.gov/OpenGovernmentData/DataSets/Accidents.zip",180)))
    txt=z.read("Accidents.txt").decode("latin1").splitlines()
    hdr=txt[0].split("|"); rows=[l.split("|") for l in txt[1:]]
    ni=hdr.index("NARRATIVE") if "NARRATIVE" in hdr else None
    out["msha"]={"rows":len(rows),"cols":len(hdr),"has_narrative":ni is not None,"narr_nonempty":sum(1 for r in rows if ni is not None and len(r)>ni and r[ni].strip()) ,"header":hdr[:60],"newest":max(r[hdr.index("ACCIDENT_DT")] for r in rows if len(r)>hdr.index("ACCIDENT_DT")) if "ACCIDENT_DT" in hdr else None,"files":z.namelist()}
except Exception as e: out["msha"]=str(e)
# FRA
try:
    d=json.loads(get("https://data.transportation.gov/resource/rash-pd2d.json?$limit=1"))
    out["fra_cols"]=list(d[0].keys())
    c=json.loads(get("https://data.transportation.gov/resource/rash-pd2d.json?$select=count(*)"))
    out["fra_count"]=c
    c=json.loads(get("https://data.transportation.gov/resource/rash-pd2d.json?$select=max(date)&$limit=1")) if "date" in d[0] else None
    out["fra_max"]=c
except Exception as e: out["fra"]=str(e)
# CFPB
try:
    d=json.loads(get("https://www.consumerfinance.gov/data-research/consumer-complaints/search/api/v1/?size=100&has_narrative=true&sort=created_date_desc&no_aggs=true"))
    hs=d["hits"]["hits"]; out["cfpb"]={"total":d["hits"]["total"]["value"],"fields":list(hs[0]["_source"].keys()),"narr_100":sum(1 for h in hs if h["_source"].get("complaint_what_happened")),"newest":hs[0]["_source"]["date_received"]}
except Exception as e: out["cfpb"]=str(e)
# FEMA
try:
    d=json.loads(get("https://www.fema.gov/api/open/v2/DisasterDeclarationsSummaries?$top=1&$inlinecount=allpages"))
    out["fema"]={"count":d["metadata"].get("count"),"fields":list(d["DisasterDeclarationsSummaries"][0].keys())}
except Exception as e: out["fema"]=str(e)
# OSHA severe injury / DOL
for u in ["https://www.osha.gov/severe-injury-reports","https://data.dol.gov/get_api_key"]:
    try:
        b=get(u,40); out[u]=len(b)
    except Exception as e: out[u]=str(e)
# NTSB
for u in ["https://data.ntsb.gov/carol-main-public/basic-search","https://www.ntsb.gov/Pages/AviationQueryV2.aspx","https://data.ntsb.gov/avdata/FileDirectory/DownloadFile?fileID=C%3A%5Cavdata%5Cavall.zip"]:
    try:
        b=get(u,60); out[u]=len(b)
    except Exception as e: out[u]=str(e)
# OPSS
try:
    d=json.loads(get("https://www.gov.uk/api/search.json?filter_format=product_safety_alert_report_recall&count=0"))
    out["opss_total"]=d["total"]
    d=json.loads(get("https://www.gov.uk/api/search.json?filter_format=product_safety_alert_report_recall&count=5&order=-public_timestamp&fields=title,public_timestamp,link"))
    out["opss_new"]=[(r["public_timestamp"],r["title"]) for r in d["results"]]
    c=json.loads(get("https://www.gov.uk/api/content/product-safety-alerts-reports-recalls/product-safety-report-20000pcs-runfeng-water-beads-2607-0041"))
    out["opss_detail_keys"]=list(c.keys()); out["opss_meta"]=c["details"].get("metadata"); out["opss_body_len"]=len(c["details"].get("body",""))
    out["opss_body_head"]=re.sub("<[^>]+>"," ",c["details"].get("body",""))[:600]
except Exception as e: out["opss"]=str(e)
# NHTSA
try:
    d=json.loads(get("https://api.nhtsa.gov/products/vehicle/makes?issueType=r"))
    out["nhtsa_makes"]=d.get("count")
except Exception as e: out["nhtsa"]=str(e)
json.dump(out,open("probe2.json","w"),indent=1,default=str)
print(json.dumps(out,indent=1,default=str)[:6000])
