import json,re,collections,urllib.request,random
UA={"User-Agent":"data-foundry-scout/1.0 (data@mail.proviciency.com)"}
def get(u):
    return json.load(urllib.request.urlopen(urllib.request.Request(u,headers=UA),timeout=90))
recs=json.load(open("fda_all.json"))
# enforcement full
enf=json.load(open("/tmp/enf_all.json"))  # from download.open.fda.gov bulk zip (17988 records)
print("enforcement",len(enf))
print("enf keys",collections.Counter(k for r in enf for k in r).most_common(40))
print("enf newest report_date",max(r['report_date'] for r in enf))
print("enf w/ openfda.package_ndc",sum(1 for r in enf if r.get('openfda',{}).get('package_ndc')))
NDCRE=re.compile(r"\b(\d{4,5})-(\d{3,4})-(\d{1,2})\b")
NDC2=re.compile(r"\b(\d{4,5})-(\d{3,4})\b")
def norm11(a,b,c=None):
    return a.zfill(5)+b.zfill(4)+(c.zfill(2) if c else "")
# shortages package_ndc format
print("pkg ndc regex hit",sum(1 for r in recs if NDCRE.fullmatch(r['package_ndc'])),"/",len(recs))
print("presentation NDC regex hit",sum(1 for r in recs if NDCRE.search(r['presentation'])),"/",len(recs))
print("openfda.rxcui",sum(1 for r in recs if r.get('openfda',{}).get('rxcui')),"/",len(recs))
print("openfda keys",collections.Counter(k for r in recs for k in r.get('openfda',{})))
print("openfda.product_ndc",sum(1 for r in recs if r.get('openfda',{}).get('product_ndc')))
# Join set: recall side
pk=set();prod=set();text=set()
for r in enf:
    o=r.get('openfda',{})
    for n in o.get('package_ndc',[]): pk.add(n)
    for n in o.get('product_ndc',[]): prod.add(n)
    for a,b,c in NDCRE.findall(r.get('product_description','')+" "+r.get('code_info','')):
        text.add((a,b))
    for a,b in NDC2.findall(r.get('product_description','')):
        text.add((a,b))
def prodkey(ndc):
    a,b,c=ndc.split("-"); return (a,b)
matchpkg=[r for r in recs if r['package_ndc'] in pk]
matchprod=[r for r in recs if r['package_ndc'].rsplit("-",1)[0] in prod]
matchtext=[r for r in recs if prodkey(r['package_ndc']) in text]
print("JOIN declared: shortage.package_ndc in enforcement openfda.package_ndc",len(matchpkg),"/",len(recs))
print("JOIN declared: shortage product part in enforcement openfda.product_ndc",len(matchprod),"/",len(recs))
print("JOIN declared: product ndc appears in recall product_description text",len(matchtext),"/",len(recs))
random.seed(1)
# ~20 sample detail
sample=random.sample(recs,20)
rows=[]
for r in sample:
    hits=[e['recall_number'] for e in enf if r['package_ndc'] in e.get('openfda',{}).get('package_ndc',[]) or r['package_ndc'].rsplit("-",1)[0] in e.get('openfda',{}).get('product_ndc',[])]
    rows.append({"package_ndc":r['package_ndc'],"generic_name":r['generic_name'],"rxcui":r.get('openfda',{}).get('rxcui'),"recalls":hits[:5],"n":len(hits)})
json.dump(rows,open("fda_sample20.json","w"),indent=1)
print("sample20 with recall match",sum(1 for x in rows if x['n']),"/20")
json.dump({"matched_pkg":len(matchpkg),"matched_prod":len(matchprod),"matched_text":len(matchtext),"total":len(recs)},open("fda_join_result.json","w"))
