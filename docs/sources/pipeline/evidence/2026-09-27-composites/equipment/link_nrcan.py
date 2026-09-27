import random, collections
from load import *; from norm import *
mi=es_mi()
catmap={'001_clothes-dryers_secheuses':'Clothes Dryers','003_clothes-washers_laveuses':'Clothes Washers','005_dishwashers_lave-vaisselle':'Dishwashers','006_freezers_congelateurs':'Consumer Refrigeration Products','009_refrigerators-wine-chillers_refrigerateurs-celliers-domestiques':'Consumer Refrigeration Products','010_room_air_conditioners_climatiseurs_individuels':'Room Air Conditioners'}
idx={c:Index() for c in set(catmap.values())}
for r in mi:
    if r['product_category'] in idx: idx[r['product_category']].add(r['brand_name'], r['model_number'], r['pd_id'])
nr=nrcan()
stats=collections.Counter(); ex=[]
nr_brands=set(brand_key(r['brand']) for r in nr); es_brands=set(brand_key(r['brand_name']) for r in mi if r['product_category'] in idx)
print('NRCan rows',len(nr),'brands',len(nr_brands),'ES brands in cats',len(es_brands),'brand overlap',len(nr_brands&es_brands))
per=collections.Counter(); perh=collections.Counter()
for r in nr:
    ix=idx[catmap[r['file']]]; per[r['file']]+=1
    m,ids=ix.lookup(r['brand'],r['model'])
    if m: stats[m]+=1; perh[r['file']]+=1; ex.append((r['id'],r['brand'],r['model'],m,list(ids)))
    else:
        m2,ids2=ix.lookup(r['brand'],r['model'],brand_scoped=False)
        if m2: stats['anybrand:'+m2]+=1; ex.append((r['id'],r['brand'],r['model'],'ANY:'+m2,list(ids2)))
print(stats); 
for f in per: print(f, perh[f],'/',per[f])
print('brand-scoped matched',sum(perh.values()),'/',len(nr))
random.seed(20260927); s=random.sample(ex,min(25,len(ex)))
for e in s: print(e)
json.dump(ex,open(E3+'/link_nrcan_matches.json','w'))
