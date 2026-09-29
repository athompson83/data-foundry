import csv,re,random,collections,json,sys
csv.field_size_limit(10**9)
S="/tmp/claude-0/-home-user-data-foundry/18750a82-58eb-5501-8b7a-380a3c543347/scratchpad"
rows=list(csv.DictReader(open(S+"/Accidents.txt",encoding="latin-1"),delimiter="|",quotechar='"'))
print("accident rows",len(rows))
def d(s):
    m=re.match(r"(\d\d)/(\d\d)/(\d{4})",s or "");return m.group(3)+m.group(1)+m.group(2) if m else ""
dates=sorted(d(r["ACCIDENT_DT"]) for r in rows if d(r["ACCIDENT_DT"]))
print("oldest accident",dates[0],"newest",dates[-1])
print("distinct document_no",len({r["DOCUMENT_NO"] for r in rows}),"distinct mine_id",len({r["MINE_ID"] for r in rows}))
nar=[r for r in rows if (r["NARRATIVE"] or "").strip()]
print("narrative non-empty",len(nar),"/",len(rows),"avg len",sum(len(r["NARRATIVE"]) for r in nar)/len(nar),"max",max(len(r["NARRATIVE"]) for r in nar))
byyr=collections.Counter(r["CAL_YR"] for r in rows);print("by year tail",sorted(byyr.items())[-4:])
print("degree fatal",sum(1 for r in rows if r["DEGREE_INJURY_CD"]=="01"))
print("newest doc rows",[ (r["DOCUMENT_NO"],r["ACCIDENT_DT"]) for r in sorted(rows,key=lambda r:d(r["ACCIDENT_DT"]))[-3:]])
# Mines join
mines=list(csv.DictReader(open(S+"/Mines.txt",encoding="latin-1"),delimiter="|",quotechar='"'))
ms={m["MINE_ID"] for m in mines}
print("mines rows",len(mines),"cols",list(mines[0].keys())[:12])
print("JOIN declared accidents.MINE_ID in Mines:",sum(1 for r in rows if r["MINE_ID"] in ms),"/",len(rows))
random.seed(5)
sample=random.sample(nar,20)
AGE=re.compile(r"(\d{1,2})[- ]year[- ]old",re.I)
MODEL=re.compile(r"\b(?:model\s+)?[A-Z]{1,4}-?\d{2,4}[A-Z]?\b")
BODY=re.compile(r"\b(finger|hand|wrist|arm|elbow|shoulder|back|neck|head|eye|knee|ankle|foot|toe|leg|hip|chest|rib|face|thumb)s?\b",re.I)
CFR=re.compile(r"\b30\s*CFR\b|\bCFR\b")
out=[]
def stats(rs):
    return {"age":sum(1 for r in rs if AGE.search(r["NARRATIVE"])),"body_kw":sum(1 for r in rs if BODY.search(r["NARRATIVE"])),"equip_model_in_text":sum(1 for r in rs if r["EQUIP_MODEL_NO"].strip() and r["EQUIP_MODEL_NO"].strip().lower() in r["NARRATIVE"].lower()),"has_equip_model_field":sum(1 for r in rs if r["EQUIP_MODEL_NO"].strip()),"model_regex":sum(1 for r in rs if MODEL.search(r["NARRATIVE"])),"n":len(rs)}
print("sample20",stats(sample))
print("all narratives",stats(nar))
# body-part narrative vs structured agreement on sample
chk=[]
for r in sample:
    kw={m.group(1).lower() for m in BODY.finditer(r["NARRATIVE"])}
    sb=r["INJ_BODY_PART"].lower()
    agree=any(k in sb for k in kw)
    chk.append({"doc":r["DOCUMENT_NO"],"struct_body":r["INJ_BODY_PART"],"nar_kw":sorted(kw),"agree":agree,"narr":r["NARRATIVE"][:200]})
json.dump(chk,open("msha_sample20.json","w"),indent=1)
print("narrative body kw agrees with structured body part (sample20):",sum(c['agree'] for c in chk),"/20")
