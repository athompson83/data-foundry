import json,subprocess
UA='data-foundry-scout/1.0 (data@mail.proviciency.com)'
def raw(u): return subprocess.check_output(['curl','-g','-sS','-m','120','-A',UA,u])
# EASIN full catalogue by pages
easin=[]; skip=0
while True:
    try: j=json.loads(raw(f'https://easin.jrc.ec.europa.eu/apixg/catxg/skip/{skip}/take/500'))
    except Exception as e: print('easin err',skip,e); break
    if not j: break
    easin+=j; skip+=500
    if skip>20000: break
print('EASIN records',len(easin)); 
names={e['Name'].strip().lower() for e in easin}
# NAS: groups listing
nas=[]
for g in ['Fishes','Mollusks-Bivalves','Mollusks-Gastropods','Crustaceans-Cladocerans','Crustaceans-Crayfish','Crustaceans-Amphipods','Plants','Amphibians','Reptiles','Birds','Mammals','Coelenterates','Crustaceans-Crabs','Crustaceans-Shrimp','Crustaceans-Isopods','Crustaceans-Copepods','Insects','Sponges','Bryozoans','Annelids','Mollusks-Cephalopods','Crustaceans-Barnacles','Crustaceans-Other']:
    try: j=json.loads(raw('https://nas.er.usgs.gov/api/v2/species/search?group='+g))
    except Exception as e: print('nas err',g); continue
    nas+=j.get('results',[])
print('NAS species',len(nas))
exo=[n for n in nas if n['native_exotic']=='Exotic' and n['species'] not in ('sp.','')]
m=[n for n in exo if f"{n['genus']} {n['species']}".lower() in names]
print('NAS exotic binomials',len(exo),'also in EASIN catalogue',len(m))
json.dump({'easin_records':len(easin),'nas_species':len(nas),'nas_exotic':len(exo),'binomial_matches':len(m),'sample_matches':[f"{n['genus']} {n['species']}|{n['itis_tsn']}" for n in m[:20]]},open('invasive.json','w'),indent=1)
