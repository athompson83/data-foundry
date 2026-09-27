import random, collections, re
from load import *; from norm import *
mi=es_mi(); akti=json.load(open(E3+'/es/akti.json'))
def build(cats):
    ix=Index()
    for r in mi:
        if r['product_category'] in cats: ix.add(r['brand_name'], r['model_number'], r['pd_id'])
    return ix
res={}
random.seed(20260927)
def run(name, rows, ix, modelf, brandf, split=None):
    c=collections.Counter(); ex=[]
    for r in rows:
        models=[modelf(r)]
        if split: models=[m.strip() for m in re.split(split, modelf(r)) if m.strip()]
        fam=r.get('Family Name','').strip()
        # Every component model (and the family name) is looked up, and every match is kept for review. The row is
        # counted once, by the method of its first match, so the published per-row rates are unchanged.
        rid=r.get('Submit_ID') or r.get('Registration Number')
        hits=[(m,mm,list(ids)) for m in models+([fam] if fam else []) for mm,ids in [ix.lookup(brandf(r),m)] if mm]
        if hits:
            c['brand:'+hits[0][1]]+=1; ex.append((rid,brandf(r),modelf(r),hits[0][1],[{'component':m,'method':mm,'ids':ids} for m,mm,ids in hits]))
        else:
            hits=[(m,mm,list(ids)) for m in models for mm,ids in [ix.lookup(brandf(r),m,brand_scoped=False)] if mm]
            if hits: c['ANY:'+hits[0][1]]+=1; ex.append((rid,brandf(r),modelf(r),'ANY:'+hits[0][1],[{'component':m,'method':'ANY:'+mm,'ids':ids} for m,mm,ids in hits]))
    n=len(rows); b=sum(v for k,v in c.items() if k.startswith('brand:'))
    print(f'== {name}: AU rows {n}; brand-scoped matched {b}; any-brand-only {n and sum(v for k,v in c.items() if k.startswith("ANY"))}', dict(c))
    for e in random.sample(ex,min(12,len(ex))): print('   ',e)
    res[name]=ex
run('fridges', au('rf'), build({'Consumer Refrigeration Products'}), lambda r:r['Model No'], lambda r:r['Brand'])
run('dishwashers', au('dw'), build({'Dishwashers'}), lambda r:r['Model No'], lambda r:r['Brand'])
run('washers', au('cw'), build({'Clothes Washers'}), lambda r:r['Model No'], lambda r:r['Brand'])
run('water heaters', au('hw'), build({'Water Heaters - Non Solar Electric and Non Solar Gas','Water Heaters - Solar Electric and Solar Gas'}), lambda r:r['Model No'], lambda r:r['Brand'])
# AC: index ES mini-split outdoor + indoor models, plus Model Index HP/CAC mini
ix=build({'Room Air Conditioners'})
for r in akti:
    ix.add(r['outdoor_unit_brand_name'], r['model_number'], 'akti:'+r['pd_id'])
    ix.add(r['indoor_unit_brand_name'], r.get('indoor_unit_model_number',''), 'akti-in:'+r['pd_id'])
for r in mi:
    if r['product_type'] in ('HP - Mini or Multi Split','CAC - Mini or Multi Split'): ix.add(r['brand_name'], r['model_number'], r['pd_id'])
run('air conditioners (component)', au('ac'), ix, lambda r:r['Model_No'], lambda r:r['Brand'], split=r'\s*/\s*|\s*\+\s*|,')
# full system: both indoor and outdoor of AU pair match same akti row
pairs=collections.defaultdict(set)
for r in akti: pairs[(brand_key(r['outdoor_unit_brand_name']),model_key(r['model_number']))].add(model_key(r.get('indoor_unit_model_number','')))
sys_hit=0; aurows=au('ac'); sysx=[]
for r in aurows:
    parts=[model_key(p) for p in re.split(r'\s*/\s*',r['Model_No']) if p.strip()]
    if len(parts)!=2: continue
    b=brand_key(r['Brand']); i,o=parts
    if i in pairs.get((b,o),()) or o in pairs.get((b,i),()): sys_hit+=1; sysx.append((r['Submit_ID'],r['Brand'],r['Model_No'],r['Refrigerant']))
print('AU AC exact indoor+outdoor system pairs found in ES mini-split:',sys_hit,'/',len(aurows), sysx[:8])
json.dump(res,open(E3+'/link_au_matches.json','w'))
