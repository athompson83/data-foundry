import json,urllib.request,re,time
UA={"User-Agent":"data-foundry-scout/1.0 (data@mail.proviciency.com)"}
def get(u,t=60): return urllib.request.urlopen(urllib.request.Request(u,headers=UA),timeout=t).read()
def gtin_ok(s):
    if not s.isdigit() or len(s) not in (8,12,13,14): return False
    d=[int(c) for c in s]; chk=d.pop(); tot=sum(x*(3 if i%2==0 else 1) for i,x in enumerate(reversed(d)))
    return (10-tot%10)%10==chk
res=get("https://www.gov.uk/api/search.json?filter_format=product_safety_alert_report_recall&count=200&order=-public_timestamp&fields=link,title,public_timestamp")
items=json.loads(res)["results"]
tot=0;withbar=0;valid=0;gt=set();fields={"hazard":0,"model":0,"brand":0,"corrective":0,"notif":0};types={}
for it in items:
    try: c=json.loads(get("https://www.gov.uk/api/content"+it["link"]))
    except Exception as e: continue
    tot+=1; t=re.sub(r"<[^>]+>"," ",c["details"].get("body","")); t=re.sub(r"\s+"," ",t)
    types[c["details"]["metadata"].get("product_alert_type")]=types.get(c["details"]["metadata"].get("product_alert_type"),0)+1
    m=re.search(r"Barcode\s+([0-9 ]{6,20})",t)
    if m:
        withbar+=1; b=m.group(1).replace(" ","")
        if gtin_ok(b): valid+=1; gt.add(b)
    for k,p in [("hazard","Hazard"),("model","Model"),("brand","Brand"),("corrective","Corrective action"),("notif","notification number")]:
        if p in t: fields[k]+=1
    time.sleep(0.2)
# CPSC UPC overlap (last 3 years), regex over raw recall JSON
cp=json.loads(get("https://www.saferproducts.gov/RestWebServices/Recall?format=json&RecallDateStart=2023-01-01",120))
blob=json.dumps(cp); 
cp_g={g for g in set(re.findall(r"\b\d{12,14}\b",blob)) if gtin_ok(g)}
out={"sampled":tot,"with_barcode_field":withbar,"valid_gtin":valid,"distinct_gtins":len(gt),"cpsc_since_2023_recalls":len(cp),"cpsc_distinct_valid_gtins_in_json":len(cp_g),"overlap":sorted(gt&cp_g),"field_presence":fields,"alert_types":types,"opss_total_search":3822}
json.dump(out,open("opss.json","w"),indent=1); print(json.dumps(out,indent=1))
