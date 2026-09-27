import json,re,collections,random
d=json.load(open('cpsc_all.json'))
KW=re.compile(r'\b(water heaters?|tankless|faucets?|toilets?|shower ?heads?|showers?|bidet|garbage disposals?|disposers?|sump pumps?|well pumps?|water softeners?|water filters?|water filtration|reverse osmosis|plumbing|backflow|expansion tanks?|boilers?|pex|supply lines?|braided|sink|bathtubs?|tub spout|water dispensers?|ice makers? supply|shut-?off valves?|pressure relief|T&P|gas valves?|hot water dispensers?)\b',re.I)
def text(r):
    p=' '.join((x.get('Name') or '')+' '+(x.get('Description') or '')+' '+(x.get('Model') or '') for x in r.get('Products') or [])
    return (r.get('Title') or '')+' '+p
sel=[r for r in d if KW.search(text(r))]
# exclude obvious non-plumbing matches (shower curtains? boilers ok)
print('keyword-matched',len(sel),'of',len(d))
yr=collections.Counter(r['RecallDate'][:4] for r in sel); print(sorted(yr.items())[-8:])
cat=collections.Counter()
for r in sel:
    m=KW.search(text(r)).group(1).lower(); cat[re.sub(r's$','',m)]+=1
print(cat.most_common(25))
json.dump(sel,open('cpsc_plumb.json','w'))
