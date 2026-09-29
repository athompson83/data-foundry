import requests,json,re,time
H={'User-Agent':'data-foundry-scout/1.0 (data@mail.proviciency.com)'}
HJ=dict(H,Accept='application/json')
nsf=json.load(open('nsf_samples.json')); nih=json.load(open('nih_samples.json')); gtr=json.load(open('gtr_samples.json'))
def nihq(body):
    for i in range(3):
        try:
            r=requests.post('https://api.reporter.nih.gov/v2/projects/search',json=body,headers=H,timeout=150)
            if r.status_code==200:return r.json()
        except Exception as e: pass
        time.sleep(2)
    return None
def nsfq(**p):
    for i in range(3):
        try:
            return requests.get('https://api.nsf.gov/services/v1/awards.json',params=p,headers=HJ,timeout=90).json()['response']
        except Exception as e: time.sleep(2)
    return {}
res={}
# J1: NSF awardee UEI -> found among NIH orgs (retrieval by name, confirmation by UEI)
rows=[];seen=set()
for a in nsf:
    u=a['ueiNumber']; nm=a['awardeeName']
    if u in seen: continue
    seen.add(u)
    r=nihq({'criteria':{'org_names':[nm.upper()]},'offset':0,'limit':5})
    ueis=set(); tot=0
    if r:
        tot=r['meta']['total']
        for p in r['results']: ueis.update(p['organization'].get('org_ueis') or [])
    rows.append({'nsf_awardee':nm,'nsf_uei':u,'nih_projects_by_name':tot,'nih_ueis_seen':sorted(ueis),'uei_match':u in ueis}); time.sleep(1)
res['J1_nsf_to_nih_uei']=rows
# J1b reverse: NIH org UEI -> NSF by awardeeName
rows=[];seen=set()
for a in nih:
    o=a['organization']; ue=(o.get('org_ueis') or [None])[0]
    if not ue or ue in seen: continue
    seen.add(ue)
    r=nsfq(awardeeName=o['org_name'],rpp=25)
    ueis=set(x.get('ueiNumber') for x in r.get('award',[]) )
    rows.append({'nih_org':o['org_name'],'nih_uei':ue,'nsf_awards_returned':len(r.get('award',[])),'uei_match':ue in ueis}); time.sleep(1)
res['J1b_nih_to_nsf_uei']=rows
# J2: DOI: NSF pubs vs GtR pubs
nsf_dois=set()
for a in nsf:
    for t in (a.get('publicationResearch') or [])+(a.get('publicationConference') or []):
        for d in re.findall(r'10\.\d{4,9}/[^\s~"<>;,]+',t): nsf_dois.add(d.rstrip('.').lower())
gtr_dois={p['doi'].lower().replace('https://doi.org/','') for r in gtr for p in r['pubs'] if p['doi']}
res['J2_doi']={'nsf_dois':len(nsf_dois),'gtr_dois':len(gtr_dois),'overlap':len(nsf_dois&gtr_dois),'gtr_doi_examples':sorted(gtr_dois)[:3]}
# J2b: look up each NSF DOI in GtR publication search
hits=0;rows=[]
for d in sorted(nsf_dois)[:36]:
    try:
        r=requests.get('https://gtr.ukri.org/gtr/api/search/publication',params={'term':d,'s':25},headers=HJ,timeout=60)
        j=r.json(); n=j.get('totalSize',0); ex=[p.get('doi') for p in j.get('publication',[])]
        m=any((e or '').lower().endswith(d) for e in ex)
    except Exception as e: n=-1;m=False
    rows.append({'doi':d,'gtr_total':n,'exact':m}); hits+=m; time.sleep(0.5)
res['J2b_nsfdoi_in_gtr']={'matched':hits,'total':len(rows),'rows':rows}
# J3: cited grant numbers in abstracts across publishers
pat={'NIH':r'\b[A-Z]\d{2}[A-Z]{2}\d{6}\b','NSF':r'\b(?:NSF|National Science Foundation)[^.]{0,80}?\b(\d{7})\b','UKRI':r'\b(?:EP|BB|MR|ES|NE|ST|AH)/[A-Z]?\d{6}/\d\b','EU':r'\b(?:grant agreement|GA)[^.]{0,30}?\b(\d{9})\b'}
abs_={'NIH':[r.get('abstract_text') or '' for r in nih],'NSF':[r.get('abstractText') or '' for r in nsf],'GtR':[r['abstract_head'] for r in gtr]}
j3={}
for src,ts in abs_.items():
    j3[src]={k:sum(1 for t in ts if re.search(v,t)) for k,v in pat.items()}
    j3[src]['n']=len(ts)
res['J3_cited_grant_numbers_in_abstracts_(GtR only first 300 chars)']=j3
json.dump(res,open('joins_out.json','w'),indent=1)
print(json.dumps({k:(v if k!='J2b_nsfdoi_in_gtr' else {x:y for x,y in v.items() if x!='rows'}) for k,v in res.items()},indent=1)[:5000])
