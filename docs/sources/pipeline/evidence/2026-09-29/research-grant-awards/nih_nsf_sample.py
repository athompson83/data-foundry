import json,random,re,time,requests
H={'User-Agent':'data-foundry-scout/1.0 (data@mail.proviciency.com)'}
random.seed(29)
def nih(body):
    for i in range(3):
        r=requests.post('https://api.reporter.nih.gov/v2/projects/search',json=body,headers=H,timeout=150)
        if r.status_code==200: return r.json()
        time.sleep(2)
    raise Exception(r.status_code)
# newest FY / counts by FY
counts={1985: 49745, 2000: 72013, 2010: 94010, 2020: 82431, 2024: 83537, 2025: 76355, 2026: 68601, 2027: 0}
for fy in ():pass
counts0={}
for fy in ():
    counts[fy]=nih({'criteria':{'fiscal_years':[fy]},'offset':0,'limit':1})['meta']['total']; time.sleep(1)
print('NIH by FY',counts)
# 20 random samples across FY 2015-2026
S=[]
for i in range(20):
    fy=random.choice(range(2015,2027))
    tot=100000
    off=random.randrange(0,1500)
    r=nih({'criteria':{'fiscal_years':[fy]},'offset':off,'limit':1})['results'][0]
    S.append(r); time.sleep(1)
json.dump(S,open('nih_samples.json','w'))
def hit(f):
    return sum(1 for r in S if f(r))
print('NIH n',len(S))
print('project_num regex',hit(lambda r:re.fullmatch(r'\d[A-Z]\d{2}[A-Z]{2}\d{6}-\d{2}([A-Z]\d)?',r['project_num'] or '')))
print('core_project_num regex',hit(lambda r:re.fullmatch(r'[A-Z]\d{2}[A-Z]{2}\d{6}',r['core_project_num'] or '')))
print('org UEI 12',hit(lambda r:any(re.fullmatch(r'[A-Z0-9]{12}',u) for u in (r['organization'].get('org_ueis') or []))))
print('org DUNS 9',hit(lambda r:any(re.fullmatch(r'\d{9}',u) for u in (r['organization'].get('org_duns') or []))))
print('abstract non-empty',hit(lambda r:len((r.get('abstract_text') or '').strip())>50))
print('PI profile_id',hit(lambda r:any(p.get('profile_id') for p in r['principal_investigators'] or [])))
print('cfda_code',hit(lambda r:bool(r.get('cfda_code'))))
print('opportunity_number',hit(lambda r:bool(r.get('opportunity_number'))))
print('agency_code',__import__('collections').Counter(r['agency_code'] for r in S))
