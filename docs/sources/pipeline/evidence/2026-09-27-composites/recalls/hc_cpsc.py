import json,re,collections,sys,datetime,random
sys.path.insert(0,'.');from common import *
GEN=STOP|{'RECALLED','RECALL','RECALLS','DUE','HAZARD','HAZARDS','FIRE','BURN','INJURY','RISK','SERIOUS','DEATH','CHOKING','FALL','SHOCK','LACERATION','STRANGULATION','ENTRAPMENT','SUFFOCATION','POISONING','TIP','OVER','WITH','FROM','SOLD','EXCLUSIVELY','AMAZON','WALMART','COM','AT','FOR','NEW','ELECTRIC','GAS','CHILDREN','CHILD','KIDS','BABY','MODELS','MODEL','SERIES','SET','SETS','PORTABLE','ALERT','AND','VIOLATION','FEDERAL','BAN','STANDARD','MANDATORY','LEAD','PAINT','BATTERIES','BATTERY','CERTAIN','ONLINE','EXPLOSION','HAZ','DEFECT','DEFECTIVE','POSE','POSES','ALSO','THAT','THIS','NOT','ITS','INTO','PRODUCT','PRODUCTS','CONSUMER','SAFETY','WARNING','WARNINGS','UNITS','OUT','BRAND'}
def toks(s): return {t for t in re.findall(r'[A-Z0-9]+',fold(s).upper()) if len(t)>=3 and t not in GEN}
cp=json.load(open('cpsc_all.json'))
for r in cp: r['_t']=toks((r.get('Title') or '')+' '+' '.join(p.get('Name') or '' for p in r.get('Products') or [])); r['_d']=datetime.date.fromisoformat(r['RecallDate'][:10])
hc=[r for r in json.load(open('hc_open.json')) if r['Organization']=='Consumer product safety']
joint=[r for r in hc if re.search(r'joint recall',r.get('What you should do') or '',re.I) and re.search(r'CPSC|Consumer Product Safety Commission',r['What you should do'])]
def best(h,win=45):
    hd=datetime.date.fromisoformat(h['Last updated']); ht=toks(h['Title']+' '+(h.get('Product') or ''))
    cands=[]
    for r in cp:
        if abs((r['_d']-hd).days)>win: continue
        sh=ht & r['_t']
        if len(sh)>=2: cands.append((len(sh),-abs((r['_d']-hd).days),r['RecallNumber'],sorted(sh)))
    cands.sort(reverse=True)
    return cands
res=[]
for h in joint:
    c=best(h); res.append((h['NID'],h['Last updated'],h['Title'][:80],c[:2]))
m=[x for x in res if x[3]]; uniq=[x for x in m if len(x[3])==1 or x[3][0][0]>x[3][1][0]]
print('HC joint-with-CPSC',len(joint),'matched (>=2 shared distinctive title tokens, +/-45d)',len(m),'unambiguous top',len(uniq))
random.seed(20260927); s=random.sample(m,25)
for x in s: print(x[0],x[1],x[2],'->',x[3][0][2],[cc for cc in x[3][0][3]][:5], 'runner-up', (x[3][1][:3] if len(x[3])>1 else '-'))
json.dump([{'hc_nid':x[0],'cpsc':x[3][0][2] if x[3] else None,'shared':x[3][0][3] if x[3] else []} for x in res],open('hc_cpsc_links.json','w'),indent=0)
# control: HC consumer rows WITHOUT the joint marker since 2022 - how many still match a CPSC recall?
ctrl=[h for h in hc if h['Last updated']>='2022' and h not in joint]
cm=sum(1 for h in ctrl if best(h))
print('control: non-joint HC consumer since 2022',len(ctrl),'with a CPSC title match',cm)
cmatch=[(h,best(h)) for h in ctrl]; cmatch=[(h,c) for h,c in cmatch if c]
random.seed(7); cpm={r['RecallNumber']:r for r in cp}
for h,c in random.sample(cmatch,15): print('CTRL',h['NID'],h['Last updated'],h['Title'][:55],'||',c[0][2],cpm[c[0][2]]['RecallDate'][:10],cpm[c[0][2]]['Title'][:70],c[0][3])
json.dump([{'hc_nid':h['NID'],'cpsc':c[0][2],'shared':c[0][3]} for h,c in cmatch],open('hc_cpsc_control.json','w'),indent=0)
