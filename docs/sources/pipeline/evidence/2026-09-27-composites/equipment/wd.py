import json, time, urllib.request, urllib.parse, collections, re
from load import *; from norm import *
mi=es_mi(); cac=es_cac()
partners=collections.Counter(r['energy_star_partner'] for r in mi); 
for r in cac: partners[r['energy_star_partner']]+=int(r['n'])
brands=collections.Counter(r['brand_name'] for r in mi)
for r in cac: brands[r['brand_name']]+=int(r['n'])
print('distinct partners',len(partners),'distinct brand strings',len(brands),'brand keys',len({brand_key(b) for b in brands}))
def clean(s):  # label forms to try
    s=s.strip(); out={s}
    t=re.sub(r',?\s+(Inc\.?|LLC|L\.L\.C\.|Ltd\.?|Co\.,? Ltd\.?|Corporation|Corp\.?|Company|L\.P\.|GmbH|S\.A\.|Limited|AG)$','',s,flags=re.I).strip(' ,.')
    out.add(t); return out
def sparql(labels):
    vals=' '.join('"%s"@en'%l.replace('\\','').replace('"','') for l in labels)
    q=f'''SELECT ?lab ?item ?itemLabel ?inst ?parent ?parentLabel ?owner ?ownerLabel ?ownerInst WHERE {{
 VALUES ?lab {{ {vals} }} ?item rdfs:label|skos:altLabel ?lab .
 OPTIONAL {{ ?item wdt:P31 ?inst }} OPTIONAL {{ ?item wdt:P749 ?parent }} OPTIONAL {{ ?item wdt:P127 ?owner . OPTIONAL {{ ?owner wdt:P31 ?ownerInst }} }}
 SERVICE wikibase:label {{ bd:serviceParam wikibase:language "en". }} }}'''
    req=urllib.request.Request('https://query.wikidata.org/sparql',data=urllib.parse.urlencode({'query':q}).encode(),headers={'User-Agent':'DataFoundry/1.0 (data@mail.proviciency.com)','Accept':'application/sparql-results+json'})
    return json.load(urllib.request.urlopen(req,timeout=120))['results']['bindings']
def run(names, tag):
    lab2name={}
    for n in names:
        for l in clean(n): lab2name.setdefault(l,set()).add(n)
    labs=list(lab2name); res=[]
    for i in range(0,len(labs),120):
        for attempt in range(3):
            try: res+=sparql(labs[i:i+120]); break
            except Exception as e: print('err',e); time.sleep(10)
        time.sleep(2)
    json.dump(res,open(E3+f'/wd_{tag}.json','w'))
    return res,lab2name
top=[p for p,_ in partners.most_common()]
res,l2n=run(top,'partners')
ORGS={'Q4830453','Q6881511','Q891723','Q783794','Q43229','Q167037','Q1589009','Q210167','Q18388277','Q1631111','Q219577','Q2085381','Q936518','Q15911314','Q1058914','Q17990971'}
by=collections.defaultdict(lambda:{'items':set(),'org':set(),'parent':set(),'owner':set(),'humanowner':0})
for b in res:
    for n in l2n[b['lab']['value']]:
        d=by[n]; it=b['item']['value'].split('/')[-1]; d['items'].add(it)
        if b.get('inst',{}).get('value','').split('/')[-1] in ORGS: d['org'].add(it)
        if 'parent' in b: d['parent'].add((it,b['parent']['value'].split('/')[-1],b.get('parentLabel',{}).get('value')))
        if 'owner' in b:
            if b.get('ownerInst',{}).get('value','').endswith('/Q5'): d['humanowner']+=1
            else: d['owner'].add((it,b['owner']['value'].split('/')[-1],b.get('ownerLabel',{}).get('value')))
n=len(top); anyhit=sum(1 for p in top if by[p]['items']); orghit=sum(1 for p in top if by[p]['org']); par=sum(1 for p in top if by[p]['org'] and (by[p]['parent'] or by[p]['owner']))
amb=sum(1 for p in top if len(by[p]['org'])>1)
print(f'partners {n}: any label hit {anyhit}; org-typed hit {orghit}; org-typed with parent/owner {par}; ambiguous(>1 org item) {amb}; human-owner rows dropped {sum(by[p]["humanowner"] for p in top)}')
top50=top[:50]
print('top-50 partners by rows: org hit',sum(1 for p in top50 if by[p]['org']),'with parent/owner',sum(1 for p in top50 if by[p]['org'] and (by[p]['parent'] or by[p]['owner'])))
for p in top50:
    d=by[p]; print(repr(p), partners[p], sorted(d['org'])[:3], sorted(d['parent']|d['owner'])[:3])
