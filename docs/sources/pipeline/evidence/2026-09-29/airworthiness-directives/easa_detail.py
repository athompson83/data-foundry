import requests,re,json,time,html,collections
H={'User-Agent':'data-foundry-scout/1.0 (data@mail.proviciency.com)'}
ids=json.load(open('easa_listing_ids.json'))
easa=[i for i in ids if re.match(r'^\d{4}-\d{4}',i)][:40]
us=[i for i in ids if i.startswith('US-')][:40]
cf=[i for i in ids if i.startswith('CF-')][:20]
def txt(t):
    t=re.sub(r'<script.*?</script>|<style.*?</style>','',t,flags=re.S);t=re.sub(r'<[^>]+>',' ',t);return re.sub(r'\s+',' ',html.unescape(t))
recs=[]
for i in easa+us+cf:
    r=requests.get('https://ad.easa.europa.eu/ad/'+i,headers=H,timeout=60)
    t=txt(r.text)
    a=t.find('Print Download');b=t.find('Download attachments')
    body=t[a:b if b>0 else a+4000]
    def f(lab,nxt):
        m=re.search(lab+r'\s+(.*?)\s+(?:'+nxt+')',body);return m.group(1).strip() if m else None
    recs.append({'id':i,'status':r.status_code,'issued_by':f('Issued by','Issue date'),'issue_date':f('Issue date','Effective date'),'ata':f('ATA Chapter','Approval Holder'),'holder_type':f('Approval Holder / Type Designation','Revision|Supersedure'),'supersedure':f('Supersedure','Publication|Remarks'),'body':body[:3500]})
    time.sleep(0.5)
json.dump(recs,open('easa_samples.json','w'),indent=1)
print(len(recs),collections.Counter(r['status'] for r in recs))
for r in recs[:2]+recs[40:43]+recs[80:82]: print({k:v for k,v in r.items() if k!='body'})
