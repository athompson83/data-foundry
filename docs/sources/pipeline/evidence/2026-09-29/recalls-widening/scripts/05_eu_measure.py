import json,re,sys,collections;sys.path.insert(0,'scripts')
from common import *
R=json.load(open('results/eu_records.json'))
def stats(rs,label):
    n=len(rs); f=lambda p:sum(1 for r in rs if p(r))
    notunk=lambda b:b and b.lower() not in('unknown','no brand','not available','n/a','-')
    o={'label':label,'n':n,
     'brand_present':f(lambda r:notunk(r['brand'])),
     'model_present':f(lambda r:r['model'] and r['model'].lower() not in('unknown','n/a')),
     'batch_present':f(lambda r:r['batch'] and r['batch'].lower() not in('unknown','n/a')),
     'barcode_field_present':f(lambda r:r['barcode'].strip()),
     'barcode_checkdigit_valid_gtin':f(lambda r:gtins(r['barcode'])),
     'hazard_riskType':f(lambda r:r['risk_type']),'level':f(lambda r:r['level']),
     'notifying_country':f(lambda r:r['country']),'origin_country':f(lambda r:r['origin']),
     'url_recall':f(lambda r:r['url_recall']),'company_recall_code':f(lambda r:r['company_recall_code']),
     'measures_parseable':f(lambda r:'Category of measure' in r['measures']),
     'cites_cpsc_or_hc_or_us_in_text':f(lambda r:re.search(r'CPSC|saferproducts|Consumer Product Safety Commission|recalls-rappels|Health Canada',r['danger']+' '+r['description']+' '+r['measures']+' '+r['url_recall'],re.I)),
     'cites_other_SR_case_in_text':f(lambda r:[c for c in re.findall(r'\b[A-Z]{2,4}/\d{4,5}/\d\d\b',r['danger']+' '+r['description']+' '+r['measures']) if c!=r['case']]),
     'has_pictures(excluded)':f(lambda r:r['n_pictures'])}
    return o
out={'all_2025_01_to_2026_09':stats(R,'all'),}
recent=sorted(R,key=lambda r:(r['report_date'],r['case']),reverse=True)
out['latest_8_weeks']=stats([r for r in recent if r['report_date']>='2026-08-01'],'latest 8 weeks')
out['countries']=collections.Counter(r['country'] for r in R).most_common(8)
out['levels']=collections.Counter(r['level'] for r in R)
out['risk_types']=collections.Counter(r['risk_type'] for r in R).most_common(12)
out['categories']=collections.Counter(r['category'] for r in R).most_common(12)
out['measures_types']=collections.Counter(m for r in R for m in re.findall(r'Category of measure\(s\): (.*?)(?:Date of entry|Type of economic|$)',r['measures'])).most_common(8)
out['duplicate_case_numbers']=len(R)-len({r['case'] for r in R})
out['sample_barcode_values_invalid']=[r['barcode'] for r in R if r['barcode'].strip() and not gtins(r['barcode'])][:10]
json.dump(out,open('results/05_eu_measure.json','w'),indent=1,default=list)
print(json.dumps(out,indent=1,default=list))
# sample file: 40 most recent alerts with extracted fields
json.dump([{k:r[k] for k in('case','report_date','category','brand','model','batch','barcode','risk_type','level','country','origin','url_recall','company_recall_code')}|{'gtin_valid':sorted(gtins(r['barcode']))} for r in recent[:40]],open('results/eu_sample_40.json','w'),indent=1,ensure_ascii=False)
