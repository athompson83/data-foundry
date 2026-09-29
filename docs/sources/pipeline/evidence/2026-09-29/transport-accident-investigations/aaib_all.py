import requests,json,time,collections,re
H={'User-Agent':'data-foundry-scout/1.0 (data@mail.proviciency.com)'}
F=['aircraft_category','report_type','date_of_occurrence','registration','location','aircraft_type','title','description','public_timestamp']
allr=[];start=0
while True:
    p=[('filter_format','aaib_report'),('count',500),('start',start)]+[('fields',f) for f in F]
    r=requests.get('https://www.gov.uk/api/search.json',params=p,headers=H,timeout=90)
    if r.status_code!=200: print('stop',start,r.status_code,r.text[:200]);break
    j=r.json();allr+=j['results'];print(start,len(j['results']),j['total'],flush=True)
    if not j['results'] or len(allr)>=j['total']:break
    start+=500;time.sleep(0.5)
json.dump(allr,open('aaib_all_meta.json','w'))
