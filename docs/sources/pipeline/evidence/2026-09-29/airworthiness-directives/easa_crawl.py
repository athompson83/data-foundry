import requests,re,json,time,html,collections
H={'User-Agent':'data-foundry-scout/1.0 (data@mail.proviciency.com)'}
ids=[]
for p in list(range(1,11))+[100,300,600,871]:
    r=requests.get(f'https://ad.easa.europa.eu/search/page-{p}',headers=H,timeout=60)
    found=re.findall(r'href="https://ad.easa.europa.eu/ad/([^"]+)"',r.text)
    for f in found:
        if f not in ids: ids.append((f))
    if p in (1,871):print(p,r.status_code,re.findall(r'Displaying records[^<]*',r.text))
    time.sleep(0.5)
def kind(i):
    if re.match(r'^\d{4}-\d{4}',i):return 'EASA_AD'
    if re.match(r'^\d{2}-\d+',i):return 'EASA_PAD'
    return 'foreign:'+re.sub(r'[\d]+','#',i)
print(len(ids),collections.Counter(kind(i) for i in ids))
json.dump(ids,open('easa_listing_ids.json','w'))
