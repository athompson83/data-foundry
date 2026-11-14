import json,subprocess,urllib.parse,random,re
UA='data-foundry-scout/1.0 (data@mail.proviciency.com)'
def raw(u): return subprocess.check_output(['curl','-g','-sS','-m','60','-A',UA,u])
nas=[]
for g in ['Fishes','Mollusks-Bivalves','Mollusks-Gastropods','Crustaceans-Crayfish','Plants','Amphibians','Reptiles','Birds','Mammals','Insects']:
    nas+=json.loads(raw('https://nas.er.usgs.gov/api/v2/species/search?group='+g)).get('results',[])
exo=[n for n in nas if n['native_exotic']=='Exotic' and n['species'] not in ('sp.','') and n['genus']]
random.seed(11); s=random.sample(exo,60)
hit=0; agree=0; detail=[]
for n in s:
    b=f"{n['genus']} {n['species']}"
    try: j=json.loads(raw('https://easin.jrc.ec.europa.eu/apixg/catxg/term/'+urllib.parse.quote(b)))
    except Exception: j=[]
    m=[e for e in (j if isinstance(j,list) else []) if isinstance(e,dict) and e['Name'].strip().lower()==b.lower()]
    ok=bool(m); hit+=ok
    norm=lambda x:re.sub(r'[^a-z0-9]','',(x or '').lower())
    auth=bool(m) and bool(norm(m[0].get('Authorship'))) and bool(norm(n.get('authority'))) and norm(m[0].get('Authorship'))==norm(n.get('authority'))
    agree+=auth; detail.append([b,n['itis_tsn'],ok,auth])
print('authority string equal among matches',agree)
print('exotic sampled',len(s),'exact binomial found in EASIN',hit)
json.dump({'nas_exotic_in_groups':len(exo),'sampled':len(s),'easin_exact_binomial':hit,'authority_equal':agree,'rows':detail},open('invasive.json','w'),indent=1)
