"""Sample CFIA food-recall notices from the Health Canada open-data index and measure deterministic identifier hits.
Reads /tmp/hc.json (HCRSAMOpenData.json fetched the same day). Writes results/cfia-sample.json."""
import json,re,random,urllib.request,time,sys
UA="data-foundry-scout/1.0 (data@mail.proviciency.com)"
d=json.load(open('/tmp/hc.json'))
cfia=[r for r in d if r['Organization']=='CFIA' and r['Archived']=='0']
random.seed(20260929)
sample=random.sample(cfia,25)
def gtin_ok(s):
    s=re.sub(r'\D','',s)
    if len(s) not in (8,12,13,14): return False
    body,chk=s[:-1],int(s[-1]); t=0
    for i,ch in enumerate(reversed(body)): t+=int(ch)*(3 if i%2==0 else 1)
    return (10-t%10)%10==chk
out=[]
for r in sample:
    try:
        req=urllib.request.Request(r['URL'],headers={'User-Agent':UA}); html=urllib.request.urlopen(req,timeout=40).read().decode('utf8','replace')
    except Exception as e:
        out.append({'nid':r['NID'],'url':r['URL'],'error':str(e)}); continue
    text=re.sub(r'<[^>]+>',' ',html)
    upcs=[m for m in re.findall(r'\b\d[\d ]{6,16}\d\b',text) if gtin_ok(m)]
    out.append({'nid':r['NID'],'url':r['URL'],'bytes':len(html),'valid_gtins':upcs[:5],'us_fda_mention':bool(re.search(r'U\.?S\.? (?:Food and Drug Administration|FDA)|\bFDA\b',text)),'lot_or_best_before':bool(re.search(r'(?i)best before|lot|batch|code',text)),'us_distribution':bool(re.search(r'(?i)United States|\bU\.S\.\b',text))})
    time.sleep(1)
ok=[o for o in out if 'error' not in o]
res={'sampled':len(out),'fetched':len(ok),'with_valid_gtin':sum(1 for o in ok if o['valid_gtins']),'fda_mention':sum(o['us_fda_mention'] for o in ok),'us_distribution':sum(o['us_distribution'] for o in ok),'lot_or_best_before':sum(o['lot_or_best_before'] for o in ok),'records':out}
json.dump(res,open('results/cfia-sample.json','w'),indent=1)
print({k:v for k,v in res.items() if k!='records'})
