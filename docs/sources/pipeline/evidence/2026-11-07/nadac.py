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
def hy(n): return f'{n[:5]}-{n[5:9]}-{n[9:]}'
hit_ndc=0; hit_lab=0; lab_text=0
for nd in ndcs:
    # 11-digit may be 5-4-2 only if padded; try openFDA package_ndc with all three hyphenations
    cands=[f'{nd[:5]}-{nd[5:9]}-{nd[9:]}', f'{nd[:5]}-{nd[5:8]}-{nd[9:]}'.replace(f'{nd[5:8]}',nd[6:9]) ,f'{nd[1:5]}-{nd[5:9]}-{nd[9:]}']
    found=False
    for c in cands:
        q=urllib.parse.quote(f'packaging.package_ndc:"{c}"')
        try: j=get(f'https://api.fda.gov/drug/ndc.json?search={q}&limit=1')
        except Exception: continue
        if j.get('results'): found=True; break
    hit_ndc+=found
print('NADAC NDC found in openFDA NDC directory',hit_ndc,'/',len(ndcs))
json.dump({'rows':n,'newest_effective_date':r['results'][0]['effective_date'],'sample_ndcs':ndcs,'openfda_ndc_hits':hit_ndc},open('nadac.json','w'),indent=1)
