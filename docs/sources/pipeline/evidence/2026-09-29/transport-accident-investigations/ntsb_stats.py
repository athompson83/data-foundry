import csv,re,json,sys,datetime,random
csv.field_size_limit(10**9)
S=sys.argv[1]
ev=list(csv.DictReader(open(S+'/events.csv',newline='',errors='ignore')))
ac=list(csv.DictReader(open(S+'/aircraft.csv',newline='',errors='ignore')))
na=list(csv.DictReader(open(S+'/narratives.csv',newline='',errors='ignore')))
def d(s):
    try:return datetime.datetime.strptime(s[:8],'%m/%d/%y')
    except:return None
def fix(dt): return dt if dt.year<=2026 else dt.replace(year=dt.year-100)
ds=[fix(d(e['ev_date'])) for e in ev if d(e['ev_date'])]
lc=[fix(d(e['lchg_date'])) for e in ev if d(e['lchg_date'])]
out={'events':len(ev),'aircraft_rows':len(ac),'narrative_rows':len(na),'ev_date_min':str(min(ds).date()),'ev_date_max':str(max(ds).date()),'lchg_max':str(max(lc).date()),
'ntsb_no_nonempty':sum(1 for e in ev if e['ntsb_no']),
'events_by_year':{}}
for x in ds: out['events_by_year'][x.year]=out['events_by_year'].get(x.year,0)+1
n=len(ac)
out['regis_no_pct']=round(100*sum(1 for a in ac if a['regis_no'].strip())/n,1)
out['serial_pct']=round(100*sum(1 for a in ac if a['acft_serial_no'].strip())/n,1)
out['make_model_pct']=round(100*sum(1 for a in ac if a['acft_make'].strip() and a['acft_model'].strip())/n,1)
txt=[x for x in na if (x['narr_accp'] or '').strip() and x['narr_accp']!='import']
out['narr_accp_nonempty']=len(txt)
AD=re.compile(r'\b(?:19|20)\d{2}-\d{2}-\d{2}\b')
ADW=re.compile(r'airworthiness directive|\bAD\b',re.I)
REG=re.compile(r'\bN\d{1,5}[A-Z]{0,2}\b')
out['narr_mentions_ADword']=sum(1 for x in txt if ADW.search(x['narr_accp']+x['narr_cause']))
adnums=[]
for x in txt:
    t=x['narr_accp']+' '+x['narr_cause']
    if ADW.search(t):
        adnums+= [(x['ev_id'],m) for m in AD.findall(t)]
out['narr_with_AD_number_pattern']=len({e for e,_ in adnums})
out['narr_reg_regex_hit']=sum(1 for x in txt if REG.search(x['narr_accp']))
out['narr_faa_reg_field_in_text']=0
regs={ (a['ev_id'],a['Aircraft_Key']):a['regis_no'].strip().upper() for a in ac}
hit=tot=0
for x in txt:
    r=regs.get((x['ev_id'],x['Aircraft_Key']))
    if r:
        tot+=1
        if r in x['narr_accp'].upper(): hit+=1
out['narr_names_own_registration']=f'{hit}/{tot}'
out['ad_numbers_cited_sample']=adnums[:30]
json.dump(out,open('ntsb_stats.json','w'),indent=1,default=str)
allad=sorted({m for _,m in adnums})
json.dump(allad,open('ntsb_cited_ad_numbers.json','w'))
random.seed(1)
smp=random.sample(txt,20)
evi={e['ev_id']:e for e in ev}
json.dump([{'ev_id':x['ev_id'],'ntsb_no':evi[x['ev_id']]['ntsb_no'],'ev_date':evi[x['ev_id']]['ev_date'],'regis':regs.get((x['ev_id'],x['Aircraft_Key'])),'narr_accp':x['narr_accp'][:600]} for x in smp],open('ntsb_samples_20.json','w'),indent=1)
print(json.dumps({k:v for k,v in out.items() if k!='events_by_year'},indent=1,default=str)); print(sorted(out['events_by_year'].items())[-3:])
