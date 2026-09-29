import json,re,urllib.request
UA={"User-Agent":"data-foundry-scout/1.0 (data@mail.proviciency.com)"}
def get(u): return json.loads(urllib.request.urlopen(urllib.request.Request(u,headers=UA),timeout=90).read())
cl=json.load(open("cl_fed1997.json"))['results']
idx={}
for v in range(123,130):
    for c in get(f"https://static.case.law/f3d/{v}/CasesMetadata.json"):
        for ci in c["citations"]: idx[ci["cite"]]=(c["docket_number"],c["decision_date"],c["court"]["name_abbreviation"])
rows=[];m=0;t=0;dk=0
for r in cl:
    cites=[c for c in r['citation'] if re.fullmatch(r"\d+ F\.3d \d+",c)]
    if not cites: rows.append({"cl":r['docketNumber'],"cite":None});continue
    t+=1;c=cites[0];h=idx.get(c)
    if h:
        m+=1;same=(h[1]==r['dateFiled'])
        rows.append({"cite":c,"cl_docket":r['docketNumber'],"cap_docket":h[0],"cap_date":h[1],"cl_date":r['dateFiled'],"cap_court":h[2],"cl_court":r['court_id'],"date_equal":same})
    else: rows.append({"cite":c,"cl_docket":r['docketNumber'],"matched":False})
json.dump(rows,open("cl_cap_join.json","w"),indent=1)
print("CL results:",len(cl),"with F.3d official cite:",t,"declared-cite join matched in CAP:",m,"/",t)
for x in rows:print(x)
