import json,re,random
fda=json.load(open("fda_all.json"));tga=json.load(open("tga_all.json"))
def n(s):
    s=s.lower(); s=re.sub(r"\b(hydrochloride|sodium|sulfate|sulphate|acetate|potassium|hcl|hydrobromide|phosphate|citrate|tartrate|mesylate|besylate|maleate|succinate|calcium)\b","",s)
    return re.sub(r"[^a-z]+"," ",s).strip()
fset={}
for r in fda:
    names=set()
    for s in r.get('openfda',{}).get('substance_name',[]): names.add(n(s))
    if not names: names.add(n(r['generic_name'].split(" ")[0]))
    for x in names: fset.setdefault(x,[]).append(r['package_ndc'])
tset=[(n(r['active_ingredients']),r) for r in tga if r['status'] in('C','A')]
hits=[(k,r) for k,r in tset if k in fset]
print("TGA current/anticipated records:",len(tset),"exact normalized single-ingredient name match to FDA substance:",len(hits))
random.seed(2);s=random.sample(hits,20)
out=[{"tga":r['active_ingredients'],"artg":r['artg_numb'],"fda_ndcs":fset[k][:3],"norm":k} for k,r in s]
json.dump(out,open("tga_fda_sample20.json","w"),indent=1)
for o in out:print(o["tga"],"|",o["norm"],"|",o["fda_ndcs"][:2])
