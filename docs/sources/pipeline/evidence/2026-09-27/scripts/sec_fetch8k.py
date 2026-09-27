import json,urllib.request,time,re,html,os
UA={'User-Agent':'DataFoundry research data@mail.proviciency.com'}
def get(u):
    for a in range(3):
        time.sleep(0.3+a*2)
        try: return urllib.request.urlopen(urllib.request.Request(u,headers=UA),timeout=30).read()
        except Exception as e: print('retry',u[:80],e)
    raise SystemExit('fail')
items={'5.02':'"Item 5.02"','1.01':'"Item 1.01"','1.05':'"Item 1.05"','1.03':'"Item 1.03"','4.01':'"Item 4.01" accountant'}
out=[]
for it,q in items.items():
    d=json.loads(get(f'https://efts.sec.gov/LATEST/search-index?q={urllib.parse.quote(q)}&forms=8-K&dateRange=custom&startdt=2026-06-01&enddt=2026-09-26'))
    print(it,'hits',d['hits']['total'])
    n=0
    for h in d['hits']['hits']:
        s=h['_source']
        if it not in s['items']: continue
        adsh,fn=h['_id'].split(':'); cik=s['ciks'][0].lstrip('0')
        u=f"https://www.sec.gov/Archives/edgar/data/{cik}/{adsh.replace('-','')}/{fn}"
        t=get(u).decode('utf-8','ignore')
        t=re.sub(r'(?s)<(script|style).*?</\1>','',t);t=re.sub(r'<br\s*/?>|</p>|</div>|</tr>',"\n",t,flags=re.I);t=re.sub(r'<[^>]+>',' ',t);t=html.unescape(t);t=re.sub(r'[ \t\xa0]+',' ',t);t=re.sub(r'\n\s*\n+','\n',t)
        out.append({'item':it,'items':s['items'],'name':s['display_names'][0],'date':s['file_date'],'url':u,'text':t})
        n+=1
        if n>=4: break
json.dump(out,open('8k_samples.json','w'))
print(len(out))
