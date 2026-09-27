import json,re,glob,collections,random
rows=[]
for f in sorted(glob.glob('es_hp_*.json')): rows+=json.load(open(f))
N=len(rows); print('HP rows',N,'distinct pd_id',len({r['pd_id'] for r in rows}))
def rate(name,pred,field_rows=rows):
    hits=[r for r in field_rows if pred(r)]; print(f"{name}: {len(hits)}/{len(field_rows)} = {100*len(hits)/len(field_rows):.1f}%  e.g. {[h['pd_id'] for h in hits[:3]]}")
    return hits
mn=lambda r:r.get('model_number','')
im=lambda r:r.get('indoor_unit_model_number','')
rate('outdoor model has * wildcard',lambda r:'*' in mn(r))
rate('outdoor model has (a,b) alternation',lambda r:re.search(r'\([^)]*,[^)]*\)',mn(r)))
rate('outdoor model has [..] class',lambda r:'[' in mn(r))
rate('outdoor model has ?/#/x placeholder',lambda r:re.search(r'[?#]|x(?=[A-Z0-9])',mn(r)))
rate('indoor model has + composite (coil+control/etc)',lambda r:'+' in im(r))
rate('indoor model lists multiple via / or ,',lambda r:re.search(r'[/,]',re.sub(r'\([^)]*\)','',im(r))))
rate('indoor any wildcard/alternation',lambda r:re.search(r'[*()\[\]?]',im(r)))
rate('furnace_model_number present',lambda r:bool(r.get('furnace_model_number')))
rate('additional_model_information present',lambda r:bool(r.get('additional_model_information')))
rate('upc present',lambda r:bool(r.get('upc')))
nom={18:18000,24:24000,30:30000,36:36000,42:42000,48:48000,60:60000,9:9000,12:12000,15:15000}
def capcode(r):
    m=re.findall(r'(?<!\d)(09|12|15|18|24|30|36|42|48|60)(?!\d)',re.sub(r'\([^)]*\)','',mn(r)))
    return m
h=rate('outdoor model contains a nominal-capacity token',lambda r:capcode(r))
def consistent(r):
    c=capcode(r); cap=float(r.get('cooling_capacity_btu_h') or 0)
    return any(abs(int(x)*1000-cap)<=0.2*int(x)*1000 for x in c)
rate('  ...and token within 20% of rated cooling capacity',consistent,h)
print(collections.Counter(r.get('product_type') for r in rows).most_common())
print('series_name distinct',len({r.get('series_name') for r in rows}))
# deterministic 40-sample
random.seed(20260927); s=random.sample(rows,40)
json.dump([{k:r.get(k) for k in ['pd_id','ahri_reference_number','outdoor_unit_brand_name','energy_star_partner','model_number','indoor_unit_model_number','furnace_model_number','refrigerant_type','cooling_capacity_btu_h','series_name','additional_model_information']} for r in s],open('es_sample40.json','w'),indent=1)
print('sample40 pd_ids',[r['pd_id'] for r in s])
for name,pred in [('*',lambda r:'*' in mn(r)),('alt',lambda r:re.search(r'\([^)]*,[^)]*\)',mn(r))),('+indoor',lambda r:'+' in im(r)),('cap',lambda r:capcode(r)),('capcons',consistent)]:
    print('sample40',name,sum(1 for r in s if pred(r)),'/40')
fr=json.load(open('es_furn.json')); print('furnaces',len(fr))
rate('furnace model * wildcard',lambda r:'*' in r.get('model_number',''),fr)
rate('furnace model alternation',lambda r:re.search(r'\([^)]*,[^)]*\)',r.get('model_number','')),fr)
rate('furnace additional_model_information',lambda r:bool(r.get('additional_model_information')),fr)
for r in fr[:5]: print(r.get('brand_name'),r.get('model_number'),'|',(r.get('additional_model_information') or '')[:120])
