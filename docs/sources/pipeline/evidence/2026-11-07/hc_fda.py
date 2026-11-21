import json,subprocess,re,urllib.parse
UA='data-foundry-scout/1.0 (data@mail.proviciency.com)'
raw=subprocess.check_output(['curl','-g','-sS','-m','240','-L','-A',UA,'https://recalls-rappels.canada.ca/sites/default/files/opendata-donneesouvertes/HCRSAMOpenData.json'])
print('HC bytes',len(raw))
d=json.loads(raw); print(type(d).__name__,len(d))
txt=[json.dumps(r) for r in d]
pat=re.compile(r'\b[FDZ]-\d{3,4}-\d{4}\b')
fda=[(i,pat.findall(t)) for i,t in enumerate(txt) if pat.search(t)]
mention=sum('Food and Drug Administration' in t or ' FDA' in t for t in txt)
print('HC notices',len(d),'mention FDA',mention,'cite an FDA recall-number pattern',len(fda))
ids=sorted({x for _,l in fda for x in l})
hit=0; checked=0
for rn in ids[:40]:
    q=urllib.parse.quote(f'recall_number:"{rn}"'); checked+=1
    ok=False
    for ep in ('food','drug','device'):
        try:
            j=json.loads(subprocess.check_output(['curl','-g','-sS','-m','40','-A',UA,f'https://api.fda.gov/{ep}/enforcement.json?search={q}&limit=1']))
            if j.get('results'): ok=True;break
        except Exception: pass
    hit+=ok
print('distinct FDA-style ids',len(ids),'checked',checked,'found in openFDA',hit)
json.dump({'hc_notices':len(d),'mention_fda':mention,'cite_fda_number':len(fda),'distinct_ids':len(ids),'checked':checked,'found_in_openfda':hit,'sample_ids':ids[:40]},open('hc_fda.json','w'),indent=1)
