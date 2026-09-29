# ACCC Drupal JSON:API: full history of node--psa_recall, 50 per page, offset paging (sort param is rejected with 400).
import sys,json;sys.path.insert(0,'scripts')
from common import *
allr=[];off=0;pages=0;url='https://www.productsafety.gov.au/jsonapi/node/psa_recall?page%5Blimit%5D=50'
while url:
    b,st=get(url)
    if not b: print('fail',url,st);break
    j=json.loads(b);allr+=j['data'];pages+=1
    url=(j.get('links',{}).get('next') or {}).get('href');time.sleep(0.5)
json.dump(allr,open('raw/accc_jsonapi_all.json','w'))
print(len(allr),'records',pages,'pages')
