# Page the GOV.UK search API for the whole finder, then fetch /api/content for every notice since 2025-01-01.
import sys,json;sys.path.insert(0,'scripts')
from common import *
F="title,link,public_timestamp,description,product_category,product_alert_type,product_risk_level,product_measure_type,product_recall_alert_date,alert_type"
idx=[];start=0;total=None
while True:
    b,st=get(f"https://www.gov.uk/api/search.json?filter_format=product_safety_alert_report_recall&count=1000&start={start}&order=-public_timestamp&fields={F}")
    if not b: print('search fail',st); break
    j=json.loads(b); total=j['total']; idx+=j['results']; start+=1000
    if start>=total: break
    time.sleep(0.5)
print('total',total,'got',len(idx))
json.dump({'total':total,'results':idx},open('raw/uk_index.json','w'))
os.makedirs('raw/uk',exist_ok=True)
want=[r for r in idx if r['public_timestamp']>='2025-01-01']
print('since2025',len(want),flush=True)
fails=[]
for r in want:
    slug=r['link'].rsplit('/',1)[1];fn=f'raw/uk/{slug}.json'
    if os.path.exists(fn): continue
    b,st=get('https://www.gov.uk/api/content'+r['link'])
    if b: open(fn,'w').write(b)
    else: fails.append((slug,st))
    time.sleep(0.4)
json.dump({'total':total,'indexed':len(idx),'since_2025':len(want),'fails':fails},open('results/03_uk_fetch.json','w'))
print('fails',fails)
