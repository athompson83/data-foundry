import json,re,urllib.request,random,time
UA={"User-Agent":"data-foundry-scout/1.0 (data@mail.proviciency.com)"}
def get(u):
    return urllib.request.urlopen(urllib.request.Request(u,headers=UA),timeout=90).read()
meta=json.load(open("cap_f3d123_meta.json"))
random.seed(7)
# case file names: from first_page order; use path from cites: fetch list via case ids? use index numbering 0001-01..
vols=json.loads(get("https://static.case.law/f3d/VolumesMetadata.json"))
print("f3d volumes",len(vols))
# Index of cites in volumes 118..123
idx={}
for v in range(118,124):
    ms=meta if v==123 else json.loads(get(f"https://static.case.law/f3d/{v}/CasesMetadata.json"))
    for c in ms:
        for ci in c["citations"]: idx[ci["cite"]]=c["id"]
print("indexed official cites in F.3d 118-123:",len(idx))
sample=random.sample(meta,20)
REP=re.compile(r"\b(\d{1,3})\s+(F\.\s?3d|F\.\s?2d|U\.S\.|S\.\s?Ct\.|F\.\s?Supp\.(?:\s?[23]d)?|A\.\s?[23]d|N\.E\.\s?[23]d|P\.\s?[23]d|S\.E\.\s?2d|S\.W\.\s?[23]d|N\.W\.\s?2d|So\.\s?[23]d|Cal\.\s?Rptr\.(?:\s?[23]d)?)\s+(\d{1,4})\b")
USC=re.compile(r"\b(\d{1,2})\s+U\.S\.C\.?\s+(?:§+\s*)?(\d+[a-z]?(?:-\d+)?)")
CFR=re.compile(r"\b(\d{1,2})\s+C\.F\.R\.?\s+(?:§+\s*)?(\d+(?:\.\d+)?)")
DOCK=re.compile(r"\b(?:No\.|Nos\.)\s*\d{2}-\d{3,5}")
rows=[];tot_f3d=0;m_f3d=0;recall_num=0;recall_den=0
for c in sample:
    path=c["id"]
    # find case file: try file naming from first_page
    fp=int(c["first_page"]);name=None
    for k in range(1,4):
        u=f"https://static.case.law/f3d/123/cases/{fp:04d}-{k:02d}.json"
        try:
            d=json.loads(get(u));
            if d["id"]==c["id"]: name=u;break
        except Exception as e: pass
    if not name: rows.append({"id":c["id"],"err":"file not found"});continue
    text="\n".join(o.get("text","") for o in d["casebody"]["opinions"])
    reps=[(m.group(1),re.sub(r"\s","",m.group(2)),m.group(3)) for m in REP.finditer(text)]
    f3=[f"{a} F.3d {b}" for a,r,b in reps if r=="F.3d"]
    uniq=set(f3)
    inrange=[x for x in uniq if 118<=int(x.split()[0])<=123]
    mm=[x for x in inrange if x in idx]
    tot_f3d+=len(inrange);m_f3d+=len(mm)
    cites_to={x["cite"] for x in d.get("cites_to",[])}
    rep_all={f"{a} {r} {b}" for a,r,b in reps}
    rows.append({"file":name.split("/")[-1],"cite":d["citations"][0]["cite"],"docket":d["docket_number"],"docket_regex":bool(DOCK.search(d["docket_number"] or "")),"chars":len(text),"reporter_cites":len(reps),"uscc":len(USC.findall(text)),"cfr":len(CFR.findall(text)),"f3d_cites_118_123":len(inrange),"resolved":len(mm),"cites_to_len":len(cites_to)})
    time.sleep(0.3)
json.dump(rows,open("cap_sample20.json","w"),indent=1)
ok=[r for r in rows if "err" not in r]
print("fetched",len(ok))
print("own official cite present (123 F.3d N):",sum(1 for r in ok if re.fullmatch(r"123 F\.3d \d+",r["cite"])),"/",len(ok))
print("docket_number matches No./Nos. regex:",sum(r["docket_regex"] for r in ok),"/",len(ok))
print("opinions with >=1 reporter cite regex hit:",sum(1 for r in ok if r["reporter_cites"]),"/",len(ok))
print("opinions with >=1 U.S.C. cite:",sum(1 for r in ok if r["uscc"]),"/",len(ok))
print("opinions with >=1 C.F.R. cite:",sum(1 for r in ok if r["cfr"]),"/",len(ok))
print("cross-cite: F.3d cites into vols 118-123 resolved to a case in CAP:",m_f3d,"/",tot_f3d)
print("total F.3d 123 cases",len(meta))
