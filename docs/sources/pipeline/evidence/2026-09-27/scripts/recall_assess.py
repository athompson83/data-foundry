import json,re,pickle,collections,random
random.seed(7)
d=json.load(open('cpsc_all.json'))
S=random.sample(d,40)
pat={
 'model_no':r'\b(?:model|item|style|SKU|part)\s*(?:numbers?|nos?\.?|#)\s*[:#]?\s*[A-Z0-9][A-Z0-9\-./]{2,}',
 'upc':r'\b(?:UPC|GTIN)\b[^.]{0,40}?\d{11,13}|\b\d{12}\b',
 'date_code':r'\b(?:date code|manufactur\w* dates?|production dates?|lot|batch|serial)\b',
 'units':r'\d[\d,]*',
 'price':r'\$\d[\d,.]*',
 'date_range_sold':r'(?:from|between)\s+\w+\s+\d{4}\s+(?:through|and|to)\s+\w+\s+\d{4}',
 'hazard_class':r'\b(fire|burn|fall|chok|lacerat|entrap|suffocat|strangulat|tip-?over|lead|poison|shock|electrocut|drown|crash|head injur|ingest|magnet|button cell|battery)',
 'remedy_class':r'\b(refund|repair|replace|replacement|kit|destroy|dispose|stop using)',
 'violates_std':r'violat\w* (?:the )?(?:mandatory|federal)',
 'country':r'.',
}
c=collections.Counter();ex=collections.defaultdict(list)
for r in S:
    desc=r['Description'];haz=' '.join(h['Name'] for h in r['Hazards']);rem=' '.join(x['Name'] for x in r['Remedies'])
    ret=' '.join(x['Name'] for x in r['Retailers']);units=' '.join(p['NumberOfUnits'] for p in r['Products'])
    tgt={'model_no':desc,'upc':desc+' '+' '.join(u.get('UPC','') for u in r.get('ProductUPCs',[])),'date_code':desc,'units':units,'price':ret,
         'date_range_sold':ret,'hazard_class':haz+' '+r['Title'],'remedy_class':rem,'violates_std':haz+r['Title'],'country':' '.join(x['Country'] for x in r['ManufacturerCountries'])}
    for k,p in pat.items():
        m=re.search(p,tgt[k],re.I)
        if m: c[k]+=1; ex[k].append(m.group(0)[:70])
print('CPSC sample',len(S),'of',len(d),'(2020+)'); 
for k in pat: print(f'  {k:16s} {c[k]:2d}/40  e.g. {ex[k][:2]}')
print('  structured Products.Model non-empty:',sum(any(p['Model'] for p in r['Products']) for r in d),'/',len(d))
print('  structured Hazards.HazardType non-empty:',sum(any(h['HazardType'] for h in r['Hazards']) for r in d))
print('  ProductUPCs non-empty:',sum(bool(r['ProductUPCs']) for r in d))
print('  Inconjunctions (Canada/Mexico) non-empty:',sum(bool(r['Inconjunctions']) for r in d))
print('  units unparseable (no digit):',sum(not re.search(r'\d',' '.join(p['NumberOfUnits'] for p in r['Products'])) for r in d))
# NHTSA
rows=pickle.load(open('rcl_rows.pkl','rb'))
camp={}
for r in rows: camp.setdefault(r[1],r)
recent=[r for k,r in camp.items() if k[:2] in('25','26')]
S=random.sample(recent,40);c=collections.Counter();ex=collections.defaultdict(list)
P={'build_dates_text':r'(?:built|manufactured|produced)\s+(?:from|between|on)\s+\w+\s+\d{1,2},\s+\d{4}',
   'vin_in_text':r'\bVIN\b|\b[A-HJ-NPR-Z0-9]{17}\b','part_no':r'\bpart (?:number|no\.?)s?\b',
   'fmvss_field':None,'bgman_field':None,'potaff_field':None,'ota':r'over[- ]the[- ]air|OTA\b','software':r'\bsoftware\b',
   'remedy_free':r'free of charge','interim':r'interim|until (?:the )?remedy'}
for r in S:
    txt=r[19]+' '+(r[21] if len(r)>21 else '')
    for k,p in P.items():
        if p is None:
            v={'fmvss_field':r[18],'bgman_field':r[8],'potaff_field':r[11]}[k]
            if v.strip() and v.strip()!='0': c[k]+=1
        else:
            m=re.search(p,txt,re.I)
            if m: c[k]+=1; ex[k].append(m.group(0)[:60])
print('NHTSA sample 40 of',len(recent),'campaigns 2025-26; total campaigns post-2010',len(camp))
for k in P: print(f'  {k:16s} {c[k]:2d}/40 e.g. {ex[k][:2]}')
print('  example DESC_DEFECT:',S[0][19][:300])
