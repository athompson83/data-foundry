import json,re,random,collections
d=json.load(open('cpsc_appliance.json'))
MODEL_CTX=re.compile(r"\bmodel(?:\s+(?:and serial\s+)?numbers?|s)?\b",re.I)
TOKEN=re.compile(r"\b(?=[A-Z0-9/\-]*\d)(?=[A-Z0-9/\-]*[A-Z])[A-Z0-9][A-Z0-9/\-\.]{4,}[A-Z0-9]\b")
SERIAL=re.compile(r"serial\s+(?:numbers?|nos?\.?)[^.]{0,120}?(?:through|to|thru|between|beginning|starting|ending|range)",re.I)
SERIALANY=re.compile(r"serial\s+(?:numbers?|nos?\.?)",re.I)
MFG=re.compile(r"(?:manufactured|made|produced|built)\s+(?:between|from|in|during|before|after)\s+[A-Z][a-z]+\.?\s+(?:\d{1,2},\s+)?\d{4}",re.I)
SOLD=re.compile(r"sold\s+[^.]{0,80}?(?:from|between)\s+[A-Z][a-z]+\.?\s+(?:\d{1,2},\s+)?\d{4}\s+(?:through|to|and)\s+[A-Z][a-z]+\.?\s+(?:\d{1,2},\s+)?\d{4}",re.I)
PRICE=re.compile(r"\$\d[\d,]*(?:\.\d\d)?")
UNITS=re.compile(r"(?:about|approximately)\s+[\d,\.]+(?:\s+million)?",re.I)
def text(r):
    parts=[r.get('Description') or '']
    for k in ('Retailers','Hazards','Remedies','Injuries','Products'):
        for x in r.get(k) or []:
            parts.append(' '.join(str(v) for v in x.values() if v))
    return ' '.join(parts)
def assess(rs,label):
    n=len(rs);c=collections.Counter();ids=collections.defaultdict(list);tot_models=0
    for r in rs:
        t=text(r);desc=r.get('Description') or ''
        if any((p.get('Model') or '').strip() for p in r.get('Products') or []): c['structured_Model']+=1
        if any((h.get('HazardType') or '').strip() for h in r.get('Hazards') or []): c['structured_HazardType']+=1
        toks=set(TOKEN.findall(desc)) if MODEL_CTX.search(desc) else set()
        toks={x for x in toks if not re.fullmatch(r'\d{3}-\d{3}-\d{4}',x) and not re.fullmatch(r'\d{4}',x)}
        if toks: c['model_tokens_in_desc']+=1;ids['model'].append(r['RecallNumber']);tot_models+=len(toks)
        if SERIALANY.search(t): c['serial_mentioned']+=1
        if SERIAL.search(t): c['serial_range']+=1;ids['serial'].append(r['RecallNumber'])
        if MFG.search(t): c['mfg_date']+=1;ids['mfg'].append(r['RecallNumber'])
        if SOLD.search(t): c['sold_date_range']+=1
        if PRICE.search(t): c['price']+=1
        if any((p.get('NumberOfUnits') or '').strip() for p in r.get('Products') or []) or UNITS.search(t): c['units']+=1
        if r.get('ProductUPCs'): c['UPC_field']+=1
        if r.get('RemedyOptions'): c['RemedyOptions_field']+=1
    print(f'== {label}: n={n}; total model tokens={tot_models}')
    for k,v in sorted(c.items()): print(f'  {k}: {v}/{n}')
    return ids
assess(d,'all appliance recalls')
recent=[r for r in d if r['RecallDate']>='2010']
ids=assess(recent,'2010+')
fixed=json.load(open('cpsc_sample_fixed.json'))['sample'];s=[r for r in recent if r['RecallNumber'] in fixed]
print('SAMPLE',[r['RecallNumber'] for r in s])
assess(s,'sample25 (2010+)')
json.dump({'sample':[r['RecallNumber'] for r in s],'model_ids_2010':ids['model'],'serial_ids_2010':ids['serial']},open('cpsc_samples.json','w'),indent=1)
