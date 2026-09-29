import sys,re,glob,json,html,collections;sys.path.insert(0,'scripts')
from common import *
def cd(s): return re.sub(r'\s+',' ',html.unescape(re.sub(r'<!\[CDATA\[(.*?)\]\]>',r'\1',s,flags=re.S))).strip()
recs=[]
for f in sorted(glob.glob('raw/eu/*.xml')):
    s=open(f,errors='ignore').read()
    m=re.search(r'<report_date>(\d\d)/(\d\d)/(\d{4})',s); rd=f'{m.group(3)}-{m.group(2)}-{m.group(1)}'
    for n in re.findall(r'<notifications\b.*?</notifications>',s,re.S):
        g=lambda t:(lambda m:cd(m.group(1)) if m else '')(re.search(rf'<{t}\b[^>]*>(.*?)</{t}>',n,re.S))
        recs.append(dict(case=g('caseNumber'),report_date=rd,category=g('category'),product=g('product'),brand=g('brand'),name=g('name'),
          model=g('type_numberOfModel'),batch=g('batchNumber'),barcode=g('barcode'),risk_type=g('riskType'),level=g('level'),danger=g('danger'),
          measures=g('measures'),description=g('description'),country=g('notifyingCountry'),origin=g('countryOfOrigin'),type=g('type'),
          url_recall=g('URLrecall'),company_recall_code=g('companyRecallCode'),production_dates=g('productionDates'),ref=g('reference'),
          n_pictures=len(re.findall(r'<picture>',n))))
json.dump(recs,open('results/eu_records.json','w'))
print(len(recs),'alerts in',len(glob.glob('raw/eu/*.xml')),'reports',min(r['report_date'] for r in recs),max(r['report_date'] for r in recs))
