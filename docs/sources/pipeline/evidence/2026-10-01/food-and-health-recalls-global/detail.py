"""Fetch HC/CFIA notice detail pages (polite, <=2 req/s) for (a) the hand-correct candidate notices and (b) 20 recent CFIA food notices;
extract UPCs, check digit, and test a declared GTIN join to FDA code_info."""
import json,re,time,urllib.request,html,collections
UA={'User-Agent':'data-foundry-scout (data@mail.proviciency.com)'}
def gtin_ok(s):
    d=[int(c) for c in s]
    if len(d) not in (8,12,13,14): return False
    tot=sum(x*(3 if i%2==0 else 1) for i,x in enumerate(reversed(d[:-1])))
    return (10-tot%10)%10==d[-1]
hc={x['NID']:x for x in json.load(open('raw/hc.json'))}
lk=json.load(open('link_stage1.json'))
fda=[]
for e in ['food','drug']:
    for s in [0,1000]: fda+=json.load(open(f'raw/fda_{e}_{s}.json'))['results']
fda_gt=collections.defaultdict(set)
for x in fda:
    c=(x.get('code_info') or '')+' '+(x.get('product_description') or '')+' '+(x.get('more_code_info') or '')
    for t in re.findall(r'(?<!\d)(\d{1,2}[ -]?\d{5}[ -]?\d{5}[ -]?\d)(?!\d)|(?<!\d)(\d{12,14})(?!\d)',c):
        t=''.join(t).replace(' ','').replace('-','')
        if gtin_ok(t): fda_gt[t.lstrip('0')].add(x['recall_number'])
def get(nid):
    r=urllib.request.Request(hc[nid]['URL'],headers=UA)
    t=urllib.request.urlopen(r,timeout=40).read().decode('utf8','replace'); time.sleep(0.6)
    tt=re.sub(r'\s+',' ',html.unescape(re.sub(r'<script.*?</script>|<style.*?</style>|<[^>]+>',' ',t,flags=re.S)))
    i=tt.find('Affected products'); j=tt.find('Issue',i+20)
    seg=tt[i:j] if i>0 else ''
    upcs=[]
    for m in re.findall(r'(?<!\d)(\d[\d ]{10,16}\d)(?!\d)',seg):
        d=m.replace(' ','')
        if gtin_ok(d) and len(d) in (8,12,13,14): upcs.append(d)
    return {'nid':nid,'title':hc[nid]['Title'][:80],'has_affected_products_table':i>0,'upcs':upcs,'lot_or_bb_codes_present':bool(re.search(r'\b(BB|BEST BEFORE|Lot|LOT)\b',seg)),'recall_number_field':bool(re.search(r'Identification number RA-\d+',tt)),'declared_fda_matches':sorted({r for u in upcs for r in fda_gt.get(u.lstrip('0'),[])})}
res=[]
for n in lk['hc_correct_nids']:
    try: res.append(dict(get(n),group='hand-correct'))
    except Exception as e: res.append({'nid':n,'error':str(e)[:80],'group':'hand-correct'})
cf=[x for x in hc.values() if x['Organization']=='CFIA' and x['Last updated']>='2026-01' and x['NID'] not in lk['hc_correct_nids']][:20]
for x in cf:
    try: res.append(dict(get(x['NID']),group='recent-cfia'))
    except Exception as e: res.append({'nid':x['NID'],'error':str(e)[:80],'group':'recent-cfia'})
json.dump(res,open('detail_results.json','w'),indent=1)
for g in ['hand-correct','recent-cfia']:
    r=[x for x in res if x['group']==g and 'error' not in x]
    print(g,len(r),'with UPC',sum(bool(x['upcs']) for x in r),'declared FDA matches',sum(bool(x['declared_fda_matches']) for x in r),'errors',sum('error' in x for x in res if x['group']==g))
for x in res:
    if x['group']=='hand-correct': print(x)
