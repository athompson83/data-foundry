import json,subprocess,re
UA='data-foundry-scout/1.0 (data@mail.proviciency.com)'
raw=subprocess.check_output(['curl','-g','-sS','-m','180','-A',UA,'https://www.saferproducts.gov/RestWebServices/Recall?format=json&RecallDateStart=2019-01-01'])
d=json.loads(raw); print('CPSC recalls since 2019',len(d))
pat=re.compile(r'\b\d{2}[VETC]-\d{3}\b')
nh=[r for r in d if 'NHTSA' in json.dumps(r)]
camp=[r for r in d if pat.search(json.dumps(r))]
print('mention NHTSA',len(nh),'; carry an NHTSA-style campaign number',len(camp))
ex=[(r['RecallNumber'],pat.findall(json.dumps(r))[:2]) for r in camp[:10]]
print(ex)
json.dump({'cpsc_since_2019':len(d),'mention_nhtsa':len(nh),'campaign_number_pattern':len(camp),'examples':ex},open('widen.json','w'),indent=1)
