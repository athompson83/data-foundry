import json,subprocess,urllib.parse,sys
sys.path.insert(0,'.')
UA='data-foundry-scout/1.0 (data@mail.proviciency.com)'
def get(u): return json.loads(subprocess.check_output(['curl','-g','-sS','-m','60','-A',UA,u]))
def norm(h):
    l,p,k=h.split('-'); return l.zfill(5)+p.zfill(4)+k.zfill(2)
def layouts(nd):
    out=[f'{nd[:5]}-{nd[5:9]}-{nd[9:]}']
    if nd[0]=='0': out.append(f'{nd[1:5]}-{nd[5:9]}-{nd[9:]}')
    if nd[5]=='0': out.append(f'{nd[:5]}-{nd[6:9]}-{nd[9:]}')
    if nd[9]=='0': out.append(f'{nd[:5]}-{nd[5:9]}-{nd[10]}')
    return out
nd=json.load(open('nadac.json'))['sample_ndcs'][:60]; hit=0
for n in nd:
    for c in layouts(n):
        try: j=get('https://api.fda.gov/drug/label.json?limit=1&search='+urllib.parse.quote(f'openfda.package_ndc:"{c}"'))
        except Exception: continue
        if any(norm(x)==n for r in j.get('results',[]) for x in r.get('openfda',{}).get('package_ndc',[])): hit+=1;break
print('NADAC NDCs with an openFDA label (first 60):',hit,'/60')
json.dump({'label_hits_of_60':hit},open('nadac_label.json','w'))
