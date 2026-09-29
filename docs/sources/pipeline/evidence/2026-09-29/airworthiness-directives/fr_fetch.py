import requests,json,re,time,random
H={'User-Agent':'data-foundry-scout/1.0 (data@mail.proviciency.com)'}
P={'conditions[agencies][]':'federal-aviation-administration','conditions[type][]':'RULE','conditions[cfr][title]':'14','conditions[cfr][part]':'39','conditions[publication_date][gte]':'2026-01-01','per_page':200,'order':'newest'}
P=list(P.items())+[('fields[]',f) for f in ('document_number','title','publication_date','docket_ids','cfr_references','raw_text_url','html_url','abstract','effective_on','citation')]
r=requests.get('https://www.federalregister.gov/api/v1/documents.json',params=P,headers=H,timeout=60).json()
print(r['count'],len(r['results']),r['results'][0])
docs=r['results']
json.dump([{k:d.get(k) for k in ('document_number','title','publication_date','docket_ids','cfr_references','raw_text_url','html_url','abstract','effective_on','citation')} for d in docs],open('fr_2026_list.json','w'),indent=1)
newest=docs[0]['publication_date'];print('newest',newest,'oldest in 2026 list',docs[-1]['publication_date'])
random.seed(2);smp=docs[:30]+random.sample(docs[30:],30)
out=[]
for d in smp:
    t=requests.get(f"https://www.govinfo.gov/content/pkg/FR-{d['publication_date']}/html/{d['document_number']}.htm",headers=H,timeout=60).text;import html as _h;t=_h.unescape(re.sub(r'<[^>]+>','',t))
    out.append({'document_number':d['document_number'],'title':d['title'],'date':d['publication_date'],'docket_ids':d['docket_ids'],'text':t})
    time.sleep(0.4)
json.dump(out,open('fr_2026_texts_60.json','w'))
print(len(out),sum(len(x['text']) for x in out)//len(out))
