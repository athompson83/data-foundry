import json,re,csv,random,time,requests,sys
csv.field_size_limit(10**9)
H={'User-Agent':'data-foundry-scout/1.0 (data@mail.proviciency.com)'}
S=sys.argv[1]
aaib=json.load(open('aaib_all_meta.json'))
norm=lambda s:re.sub(r'[^A-Z0-9]','',(s or '').upper())
ar={norm(x.get('registration')) for x in aaib if norm(x.get('registration'))}
ac=list(csv.DictReader(open(S+'/aircraft.csv',newline='',errors='ignore')))
nr={norm(a['regis_no']) for a in ac if norm(a['regis_no'])}
ov=ar&nr
res={'aaib_distinct_regs':len(ar),'ntsb_distinct_regs':len(nr),'reg_overlap_aaib_in_ntsb':f'{len(ov)}/{len(ar)}'}
# N-number registrations in AAIB
n_aaib={r for r in ar if re.match(r'^N\d',r)}
res['aaib_N_regs_in_ntsb']=f'{len(n_aaib&nr)}/{len(n_aaib)}'
# accident-report -> AD join (NTSB narratives citing AD numbers -> FAA FR)
cited=json.load(open('ntsb_cited_ad_numbers.json'))
plaus=[c for c in cited if 1<=int(c[5:7])<=27 and 1<=int(c[8:10])<=99 and int(c[:4])>=1998]
random.seed(3);smp=random.sample(plaus,40)
m=0;det=[]
for ad in smp:
    r=requests.get('https://www.federalregister.gov/api/v1/documents.json',params=[('conditions[term]',ad),('conditions[type][]','RULE'),('conditions[agencies][]','federal-aviation-administration'),('fields[]','document_number'),('fields[]','docket_ids'),('per_page',20)],headers=H,timeout=60).json()
    hit=[d['document_number'] for d in r.get('results',[]) if any(x==f'AD {ad}' for x in (d.get('docket_ids') or []))]
    det.append((ad,hit[:1]));m+=bool(hit);time.sleep(0.3)
res['ntsb_cited_AD_distinct_total']=len(cited);res['ntsb_cited_plausible']=len(plaus)
res['ntsb_cited_AD_found_in_FR_docket_ids']=f'{m}/{len(smp)}';res['ntsb_cited_detail']=det
json.dump(res,open('joins.json','w'),indent=1);print(json.dumps({k:v for k,v in res.items() if k!='ntsb_cited_detail'},indent=1))
print([d for d in det if not d[1]][:20])
