import json,subprocess,urllib.parse,random
UA='data-foundry-scout/1.0 (data@mail.proviciency.com)'
def get(u):
    return json.loads(subprocess.check_output(['curl','-g','-sS','-m','90','-A',UA,u]))
base='https://data.medicaid.gov/api/1/datastore/query/fbb83258-11c7-47f5-8b18-5f8e79f7e704/0'
first=get(base+'?limit=1&count=true')
print('NADAC 2026 rows',first['count']); print(first['results'][0])
# newest effective date
r=get(base+'?limit=1&sorts[0][property]=effective_date&sorts[0][order]=desc')
print('newest effective_date',r['results'][0]['effective_date'])
# sample 200 random-offset NDCs
random.seed(7)
n=first['count']; ndcs=[]
for off in sorted(random.sample(range(0,n-1),40)):
    ndcs+= [x['ndc'] for x in get(base+f'?limit=5&offset={off}')['results']]
ndcs=sorted(set(ndcs)); print('sample NDCs',len(ndcs))
# openFDA NDC directory: package_ndc is 5-4-2 hyphenated; NADAC ndc is 11 digits
def layouts(nd):
    """Hyphenated forms that normalise back to the 11-digit NADAC NDC: 5-4-2 as is, and the three zero-padded
    layouts 4-4-2, 5-3-2, 5-4-1 (each only when the digit that padding would add is a zero)."""
    out=[f'{nd[:5]}-{nd[5:9]}-{nd[9:]}']
    if nd[0]=='0': out.append(f'{nd[1:5]}-{nd[5:9]}-{nd[9:]}')
    if nd[5]=='0': out.append(f'{nd[:5]}-{nd[6:9]}-{nd[9:]}')
    if nd[9]=='0': out.append(f'{nd[:5]}-{nd[5:9]}-{nd[10]}')
    return out
def norm(h):
    l,p,k=h.split('-'); return l.zfill(5)+p.zfill(4)+k.zfill(2)
hit_ndc=0
for nd in ndcs:
    found=False
    for c in layouts(nd):
        assert norm(c)==nd
        q=urllib.parse.quote(f'packaging.package_ndc:"{c}"')
        try: j=get(f'https://api.fda.gov/drug/ndc.json?search={q}&limit=1')
        except Exception: continue
        if any(norm(p['package_ndc'])==nd for r in j.get('results',[]) for p in r.get('packaging',[]) if '-' in p.get('package_ndc','')): found=True; break
    hit_ndc+=found
print('NADAC NDC found in openFDA NDC directory',hit_ndc,'/',len(ndcs))
json.dump({'rows':n,'newest_effective_date':r['results'][0]['effective_date'],'sample_ndcs':ndcs,'openfda_ndc_hits':hit_ndc},open('nadac.json','w'),indent=1)
