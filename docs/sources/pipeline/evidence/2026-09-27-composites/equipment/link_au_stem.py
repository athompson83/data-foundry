import re, collections, random
from load import *; from norm import *
akti=json.load(open(E3+'/es/akti.json')); mi=es_mi()
es=collections.defaultdict(set)
for r in akti:
    es[brand_key(r['outdoor_unit_brand_name'])].add(model_key(r['model_number'])); es[brand_key(r['indoor_unit_brand_name'])].add(model_key(r.get('indoor_unit_model_number','')))
for r in mi:
    if r['product_type'] in ('HP - Mini or Multi Split','CAC - Mini or Multi Split'): es[brand_key(r['brand_name'])].add(model_key(r['model_number']))
au_=au('ac'); c=collections.Counter(); ex=[]
shared=set(brand_key(r['Brand']) for r in au_)&set(es)
print('AU AC brands',len(set(brand_key(r['Brand']) for r in au_)),'ES mini-split brands',len(es),'shared',len(shared),sorted(shared)[:40])
for r in au_:
    b=brand_key(r['Brand'])
    if b not in es: continue
    c['rows_shared_brand']+=1
    parts=[model_key(p) for p in re.split(r'\s*/\s*',r['Model_No']) if len(model_key(p))>=6]
    hit=None
    for p in parts:
        stem=p[:6]
        cand=[k for k in es[b] if k[:6]==stem]
        if cand: hit=(p,cand[:3]); break
    if hit: c['stem6']+=1; ex.append((r['Submit_ID'],r['Brand'],r['Model_No'],hit))
print(c); random.seed(20260927)
for e in random.sample(ex,min(15,len(ex))): print(e)
