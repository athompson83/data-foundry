import json,random,re,time,requests
UA={'User-Agent':'data-foundry-scout/1.0 (data@mail.proviciency.com)','Accept':'application/json'}
B='https://gtr.ukri.org/gtr/api'
def g(u,**kw):
    for i in range(3):
        r=requests.get(u,headers=UA,timeout=60,**kw)
        if r.status_code==200: return r
        time.sleep(1)
    return r
random.seed(29)
j=g(B+'/projects?s=25').json();tot=j['totalSize'];pages=j['totalPages'];print('total',tot,pages)
out=[]
for p in random.sample(range(1,pages+1),20):
    pr=random.choice(g(B+f'/projects?s=25&p={p}').json()['project'])
    full=g(pr['href'].replace('http://','https://')).json()
    rels=collections=None
    links=[(l['rel'],l['href']) for l in full['links']['link']]
    rec={'id':full['id'],'identifiers':full['identifiers'],'title':full['title'],'status':full['status'],'leadFunder':full['leadFunder'],
         'grantCategory':full['grantCategory'],'abstract_len':len(full.get('abstractText') or ''),'techAbstract_len':len(full.get('techAbstractText') or ''),
         'impact_len':len(full.get('potentialImpact') or ''),'start':full.get('start'),'end':full.get('end'),'created':full.get('created'),
         'link_rels':sorted(set(r for r,_ in links)),'abstract_head':(full.get('abstractText') or '')[:300]}
    # publications, persons, orgs
    pubs=[];orcids=[];persons=0
    for rel,h in links:
        h=h.replace('http://','https://')
        if rel=='PUBLICATION':
            try:
                d=g(h).json(); pubs.append({'doi':d.get('doi'),'pubMedId':d.get('pubMedId'),'title':(d.get('title') or '')[:100]})
            except Exception as e: pass
        if rel in('PI_PER','COI_PER','FELLOW_PER','STUDENT_PER','CO_PI','PI') or rel.endswith('_PER'):
            persons+=1
            try:
                d=g(h).json(); orcids.append(d.get('orcidId'))
            except Exception as e: pass
    rec['pubs']=pubs;rec['persons']=persons;rec['orcids']=orcids
    out.append(rec)
json.dump(out,open('gtr_samples.json','w'),indent=1)
print(len(out))
