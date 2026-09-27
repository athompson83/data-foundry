import json,re,random,collections
d=json.load(open('cpsc_all.json'))
KW=re.compile(r'circuit breaker|\bbreakers?\b|GFCI|AFCI|ground[- ]fault|arc[- ]fault|receptacle|outlet|extension cord|power strip|surge protect|load cent|electrical panel|panelboard|wiring device|light switch|dimmer|\bEV charg|electric vehicle charg|EVSE|ceiling fan|light fixture|luminaire|LED (?:light|lamp|bulb|fixture)|smoke alarm|generator|inverter|power station|transfer switch|junction box|\bwire\b|\bcable\b|electrical cord|power cord|power adapter|charger',re.I)
HAZ=re.compile(r'shock|electrocut|fire|burn|overheat|arc',re.I)
el=[]
for r in d:
    t=(r.get('Title') or '')+' '+' '.join(p.get('Name','') or '' for p in r.get('Products') or [])
    haz=' '.join(h.get('Name','') or '' for h in r.get('Hazards') or [])
    if KW.search(t) and HAZ.search(haz+' '+(r.get('Description') or '')): el.append(r)
print('electrical-ish recalls',len(el),'of',len(d))
yrs=collections.Counter(r['RecallDate'][:4] for r in el); print(sorted(yrs.items())[-8:])
since=[r for r in el if r['RecallDate']>='2020']
print('since 2020',len(since))
MODEL=re.compile(r'model (?:numbers?|nos?\.?|#)|\bmodels?\b[^.]{0,40}\b[A-Z0-9]{2,}[-/][A-Z0-9]+|\b(?:SKU|item|part|catalog|cat\.) ?(?:numbers?|no\.?|#)',re.I)
DATE=re.compile(r'date code|manufactur\w* (?:between|from|in)|serial number|lot',re.I)
UPC=re.compile(r'\bUPC\b|\b\d{12}\b')
UL=re.compile(r'\bUL\b|ETL|Underwriters|certif|listed',re.I)
AMP=re.compile(r'\b\d{1,3}[- ]?(?:amp|A)\b|\b\d{2,3}\s?(?:volt|V)\b',re.I)
def txt(r):
    s=(r.get('Description') or '')+' '+' '.join((p.get('Description') or '')+' '+(p.get('Model') or '')+' '+(p.get('Name') or '') for p in r.get('Products') or [])
    return s
def ms(rs):
    c=collections.Counter()
    for r in rs:
        s=txt(r); c['model']+=bool(MODEL.search(s)); c['datecode']+=bool(DATE.search(s)); c['upc']+=bool(UPC.search(s)) or bool(r.get('ProductUPCs')); c['ul']+=bool(UL.search(s+' '+' '.join(h.get('Name','') or '' for h in r.get('Hazards') or []))); c['rating']+=bool(AMP.search(s))
        c['structured_model_nonempty']+=any((p.get('Model') or '').strip() for p in r.get('Products') or [])
    return dict(c)
print('since2020 stats',len(since),ms(since))
random.seed(20260927); s=random.sample(since,25)
print('sample25',ms(s))
for r in s: print(r['RecallNumber'],r['RecallDate'][:10],r['Title'][:90])
json.dump([r['RecallNumber'] for r in s],open('cpsc_elec_sample_ids.json','w'))
