import json,glob,re,collections,sys
sys.path.insert(0,'.');from common import *
def gs1_valid(g):
    # A UPC/GTIN only counts as an identifier when its GS1 check digit is valid.
    if not g.isdigit() or len(g) not in (8,12,13,14): return False
    t=sum(int(c)*(3 if i%2==0 else 1) for i,c in enumerate(reversed(g[:-1])))
    return (10-t%10)%10==int(g[-1])
es=[]
for f in glob.glob('es/*.json'):
    for r in json.load(open(f)): r['_ds']=f[3:-5]; es.append(r)
exact=collections.defaultdict(list); pats=[]; upc=collections.defaultdict(list)
for r in es:
    for mm in re.split(r'[,;]\s*',r.get('model_number') or ''):
        p=re.sub(r'[^A-Z0-9*#?]','',fold(mm).upper())
        if len(p)<5: continue
        # ENERGY STAR wildcards mean zero or one character (the opt1 grammar in equipment/norm.py).
        if re.search(r'[*#?]',p): pats.append((re.compile('^'+re.sub(r'[*#?]','[A-Z0-9]?',p)+'$'),r))
        else: exact[p].append(r)
    for u in [c for c in digit_codes(r.get('upc')) if 11<=len(c)<=14]:  # split multi-code fields before normalising
        if gs1_valid(u): upc[u.lstrip('0').zfill(13)].append(r)
print('ES rows',len(es),'exact model keys',len(exact),'wildcard patterns',len(pats),'UPC keys',len(upc))

def es_match(m):
    return exact.get(m,[])+[r for p,r in pats if p.match(m)]
home=json.load(open('cpsc_home.json'))
for since in ('2015','2000'):
    rs=[r for r in home if r['date']>=since and r['models']]
    hits=[]
    for r in rs:
        mt=[(m,x) for m in r['models'] for x in es_match(m)]
        # brand check
        bt=set(r['brand_tokens'])
        mb=[(m,x) for m,x in mt if brand_tokens(x.get('brand_name',''))&bt]
        if mb: hits.append((r['id'],r['date'],r['facets'],sorted({m for m,_ in mb}),sorted({x['_ds']+':'+x.get('energy_star_model_identifier','') for _,x in mb}),len(mt),len(mb)))
    print(f'CPSC home recalls since {since} with model tokens',len(rs),'-> naming an ENERGY STAR-listed model (model match + brand token overlap)',len(hits))
    if since=='2015':
        for h in hits: print('  ',h)
# model match without brand check (false-match control)
rs=[r for r in home if r['date']>='2015' and r['models']]
nb=[r['id'] for r in rs if any(es_match(m) for m in r['models'])]
print('model-only matches since 2015 (no brand check)',len(nb))
# UPC joins
cu=[(r['id'],u.lstrip('0').zfill(13)) for r in home for u in r['upcs'] if u and gs1_valid(re.sub(r'\D','',u))]
print('CPSC home recall UPCs',len(cu),'matching ES UPC',sum(1 for _,u in cu if u in upc))
intl=json.load(open('intl_recs.json'))
for src in ('eu','uk','au','nz'):
    g=[(r['id'],g) for r in intl if r['src']==src for g in [g for g in r['gtins'] if gs1_valid(g)]]
    m=[(i,g) for i,g in g if g in upc]
    print(src,'GTINs',len(g),'matching ES UPC',len(m),m[:3])
