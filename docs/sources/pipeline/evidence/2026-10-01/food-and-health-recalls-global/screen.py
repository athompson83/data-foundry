"""Linkage screen for food-and-health-recalls-global. Reads files fetched into raw/ (see fetch.sh).
Prints census of declared identifiers and candidate (firm+product) pairs for hand check."""
import json,re,collections,datetime as dt,sys
R='raw/'
def gtin_ok(s):
    d=[int(c) for c in s]
    if len(d) not in (8,12,13,14): return False
    tot=sum(x*(3 if i%2==0 else 1) for i,x in enumerate(reversed(d[:-1])))
    return (10-tot%10)%10==d[-1]
fda=[]
for e in ['food','drug']:
    for s in [0,1000]: fda+=json.load(open(f'{R}fda_{e}_{s}.json'))['results']
fsa=json.load(open(R+'fsa.json'))['items']
ORGS=('CFIA','Medical devices','Drugs and health products','Marketed health products','Communications and Public Affairs Branch','Controlled substances and cannabis')
hc=[x for x in json.load(open(R+'hc.json')) if x['Organization'] in ORGS]
txt=lambda x:' '.join(str(v) for v in x.values() if v)
out={'fda_rows':len(fda),'fda_report_date_range':[min(x['report_date'] for x in fda),max(x['report_date'] for x in fda)]}
fda_nums={x['recall_number'] for x in fda}
fda_gt=collections.defaultdict(list)
for x in fda:
    c=(x.get('code_info') or '')+' '+(x.get('product_description') or '')
    for t in set(re.findall(r'(?<!\d)(\d{12,14})(?!\d)',c)):
        if gtin_ok(t): fda_gt[t.lstrip('0')].append(x['recall_number'])
out['fda_rows_with_valid_gtin12_14']=len({r for v in fda_gt.values() for r in v})
rn=re.compile(r'\b[FDHZ]-\d{3,4}-\d{4}\b')
def census(items,get):
    c=collections.Counter()
    for x in items:
        t=get(x)
        if re.search(r'\bFDA\b|Food and Drug Administration|U\.S\. |USDA',t): c['mentions_FDA_or_US']+=1
        for r in rn.findall(t): c['fda_recall_numbers_cited']+=1; c['cited_in_sample']+=r in fda_nums
        for tok in re.findall(r'(?<!\d)(\d{12,14})(?!\d)',t):
            if gtin_ok(tok):
                c['valid_gtin_tokens']+=1; c['gtin_matches_fda']+=tok.lstrip('0') in fda_gt
    c['records']=len(items); return dict(c)
out['census_fsa']=census(fsa,json.dumps); out['census_hc_food_health']=census(hc,txt)
generic=set('pharma international brands world trading products product foods food farm farms natural partners incorporated group health brand fresh organic sweet cream chicken flavor flavour bottle count tablets capsules injection solution usp only packaged distributed manufactured net weight oral the and for with recalls recall recalled due because may contain contains ltd inc llc company corp limited undeclared allergen risk canada certain some from sold'.split())
tk=lambda s:{w for w in re.findall(r'[a-z0-9]{4,}',(s or '').lower()) if w not in generic}
fd=lambda x: dt.datetime.strptime(x.get('recall_initiation_date') or x['report_date'],'%Y%m%d')
fi=[(x,tk(x['recalling_firm']),tk(x['product_description']),fd(x)) for x in fda]
firmdf=collections.Counter(t for _,f,_,_ in fi for t in f)
inv=collections.defaultdict(list)
for i,(x,f,p,d) in enumerate(fi):
    for t in f:
        if firmdf[t]<=6: inv[t].append(i)
def pairs(members,firm,prod,date,win):
    res={}
    for m in members:
        d=date(m)
        if d is None: continue
        f=tk(firm(m)); p=tk(prod(m))
        for t in f:
            for i in inv.get(t,[]):
                x,ff,pp,fdd=fi[i]
                if win and abs((fdd-d).days)>win: continue
                ph=(p&pp)-{t}
                if ph: res[(id(m),x['recall_number'])]=(m,x,t,ph)
    return list(res.values())
pd=lambda s:(dt.datetime.strptime(s[:10],'%Y-%m-%d') if s and s[:4].isdigit() else None)
fsa_r=pairs(fsa,lambda x:x.get('reportingBusiness',{}).get('commonName','')+' '+x['title'],lambda x:x['title']+' '+' '.join(p['productName'] for p in x.get('productDetails',[])),lambda x:pd(x['created']),120)
hcs=[x for x in hc if x['Organization'] in('CFIA','Drugs and health products','Communications and Public Affairs Branch','Medical devices') and (x['Last updated'] or '')>='2023-12']
hc_r=pairs(hcs,lambda x:x['Title'],lambda x:x['Product'],lambda x:pd(x['Last updated']),None)
out['fsa_records_since_2024']=sum(x['created']>='2024-01' for x in fsa); out['fsa_candidate_pairs']=len(fsa_r)
out['hc_records_since_2023_12']=len(hcs); out['hc_candidate_pairs']=len(hc_r)
HAND_CORRECT=['Heinz brand Real Mayonnaise','Gerber brand arrowroot','Tom Bumble Nutty','McCain Tasti Taters brand Crispy Potato Bites','Blackstone brand Parmesan','Celebration Herbals','ByHeart Whole Nutrition','Peeters Mushroom Farm','Honeywell Eyesaline']  # hand-verified: same firm + same hazard + dates within ~6 weeks
hc_nids={m['NID']:m for m,_,_,_ in hc_r}
out['hc_candidate_distinct_notices_checked']=len(hc_nids)
out['hc_candidate_hand_correct']=sum(any(h in m['Title'] for h in HAND_CORRECT) for m in hc_nids.values())
out['hc_correct_nids']=[n for n,m in hc_nids.items() if any(h in m['Title'] for h in HAND_CORRECT)]
fsa_n={m['notation'] for m,_,_,_ in fsa_r}
out['fsa_candidate_distinct_notices_checked']=len(fsa_n); out['fsa_candidate_hand_correct']=0
json.dump(out,open('link_stage1.json','w'),indent=1); print(json.dumps(out,indent=1))
json.dump({'hc_pairs_nids':sorted(hc_nids)},open('raw/hc_pair_nids.json','w'))
if len(sys.argv)>1:
    for tag,res,g in [('FSA',fsa_r,lambda m:m['created']+' '+m['title']),('HC',hc_r,lambda m:m['Organization']+' '+m['Last updated']+' '+m['Title'])]:
        print('###',tag)
        for m,x,t,ph in res[:70]: print(g(m)[:120],'||FDA',x['recall_number'],x['recalling_firm'][:30],'|',x['product_description'][:80].replace('\n',' '),'||',t,sorted(ph)[:4])
