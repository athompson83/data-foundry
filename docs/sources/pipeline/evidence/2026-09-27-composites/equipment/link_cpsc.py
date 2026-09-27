import re, collections, random, sys
from load import *; from norm import *
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'recalls'))
from common import digit_codes, slash_parts  # shared with recalls/ (barcode tokenizer, slash classification)
mi=es_mi(); cac=es_cac(); wsr=ws(); rec=cpsc()
# Case-insensitive: prose can print a model in mixed case (iComfort-S30); model_key() upper-cases before lookup.
TOKEN=re.compile(r"\b(?=[A-Z0-9/\-\.]*\d)(?=[A-Z0-9/\-\.]*[A-Z])[A-Z0-9][A-Z0-9/\-\.]{3,}[A-Z0-9]\b",re.I)
es=Index(); cat_of={}; brand_of={}
for r in mi:
    es.add(r['brand_name'], r['model_number'], r['pd_id']); cat_of[r['pd_id']]=r['product_category']; brand_of[r['pd_id']]=r['brand_name']
for i,r in enumerate(cac):
    rid='cac%d'%i; es.add(r['brand_name'], r['model_number'], rid); cat_of[rid]='Central AC (split)'; brand_of[rid]=r['brand_name']
for i,r in enumerate(wsr):
    rid='ws%d'%i; es.add(r['Brand Name'], r['Model Number'], rid); cat_of[rid]='WaterSense:'+r['_file'].replace('WaterSense-Products-','').replace('.csv',''); brand_of[rid]=r['Brand Name']
brands={b for (b,k) in es.exact}|set(es.pats)
# Two-character brands (GE, LG) are real; only single characters are too ambiguous to gate a candidate.
brands={b for b in brands if len(b)>=2}
print('index brands',len(brands))
def ngrams(t):
    w=re.sub(r'[^a-z0-9 ]',' ',t.lower().replace('&',' and ')).split()
    s=set()
    for n in (1,2,3):
        for i in range(len(w)-n+1): s.add(''.join(w[i:i+n]))
    return s
def gs1_valid(g):
    # A UPC/GTIN only counts as an identifier when its GS1 check digit is valid.
    if not g.isdigit() or len(g) not in (8,12,13,14): return False
    t=sum(int(c)*(3 if i%2==0 else 1) for i,c in enumerate(reversed(g[:-1])))
    return (10-t%10)%10==int(g[-1])
# UPC
es_upc={}
for r in mi:
    for u in digit_codes(r.get('upc')):
        if len(u)>=11 and gs1_valid(u): es_upc.setdefault(u.lstrip('0'),[]).append(r['pd_id'])
for i,r in enumerate(wsr):
    for u in digit_codes(r.get('Universal Product Code(s)')):
        if len(u)>=11 and gs1_valid(u): es_upc.setdefault(u.lstrip('0'),[]).append('ws%d'%i)
print('ES+WS UPCs',len(es_upc))
stats=collections.Counter(); hits=[]; upchits=[]; tok_total=0; tok_hit=0
for r in rec:
    head=' '.join([r.get('Title') or '']+[p.get('Name') or '' for p in r.get('Products') or []]+[m.get('Name') or '' for m in (r.get('Manufacturers') or [])+(r.get('Importers') or [])+(r.get('Distributors') or [])])
    txt=head+' '+(r.get('Description') or '')
    cand=ngrams(txt)&brands
    # Structured model fields can list several models: tokenize them exactly like the prose.
    toks=set(TOKEN.findall(txt))|{t for p in r.get('Products') or [] for t in TOKEN.findall(p.get('Model') or '')}
    toks={t for t in toks if t and len(model_key(t))>=5 and not re.fullmatch(r'[\d\-\.]+',t)}
    toks|={x for t in toks for x in slash_parts(t)}  # shared, form-aware slash classification (recalls/common.py)
    tok_total+=len(toks)
    rh=[]
    # Every brand and every matching listing is kept: these are review candidates, so the queue must see them all.
    for t in sorted(toks):  # deterministic order
        k=model_key(t); found=False
        for b in sorted(cand):  # deterministic order
            if (b,k) in es.exact:
                rh.append((t,'exact',b,list(es.exact[(b,k)]))); found=True
            ph=[(rid,raw) for rx,raw,rid in es.pats.get(b,[]) if rx.match(k)]
            if ph: rh.append((t,'pattern',b,[rid for rid,_ in ph],sorted({raw for _,raw in ph}))); found=True
        tok_hit+=found
    for u in r.get('ProductUPCs') or []:
        # A CPSC UPC field can list several codes: each token is validated on its own.
        for raw in digit_codes(u.get('UPC','') if isinstance(u,dict) else str(u)):
            uu=raw.lstrip('0')
            if gs1_valid(raw) and uu in es_upc: upchits.append((r['RecallNumber'],uu,list(es_upc[uu])))
    if rh:
        stats['recalls_with_match']+=1
        if r['RecallDate']>='2015': stats['recalls_with_match_2015+']+=1
        hits.append({'recall':r['RecallNumber'],'date':r['RecallDate'][:10],'title':r['Title'][:90],'hits':rh,'cats':sorted({cat_of[x] for h in rh for x in h[3]})})
stats['recalls']=len(rec); stats['recalls_2015+']=sum(1 for r in rec if r['RecallDate']>='2015')
print(stats,'tokens',tok_total,'token hits',tok_hit,'upc hits',len(upchits),upchits[:10])
cc=collections.Counter(c for h in hits for c in h['cats']); print(cc.most_common(40))
random.seed(20260927)
for h in random.sample(hits,min(30,len(hits))): print(h)
json.dump({'hits':hits,'upc':upchits},open(os.path.join(OUT,'link_cpsc_matches.json'),'w'),indent=0)
