import json,re,collections,sys,datetime,random
sys.path.insert(0,'.');from common import *
DATEY=re.compile(r'^\d{1,2}(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\d{2,4}$')
GEN={'LIGHTS','BATTERIES','BUTTON','COIN','LITHIUM','RECALLED','SUBMERSIBLE','CHARGERS','CHARGING','WIRELESS','BANKS','BANK','SCOOTERS','SCOOTER','ELECTRICAL','ADAPTER','ADAPTERS','PLUG','USB','','ELECTRIC','GAS','RANGES','HEATERS','HEATER','WATER','AIR','DUE','FIRE','HAZARD','BURN','POWER','PORTABLE','SMOKE','ALARMS','CORDS','EXTENSION','SOLD','DEPOT','LOWE','WALMART','AMAZON','CHINA','UNKNOWN','BRAND','NONE','GENERIC','NAME','OTHER','LIGHT','LED','CHARGER','BATTERY','TOY','KIDS','BABY'}
# CPSC: all recalls (for foreign->CPSC direction) with model tokens + brand tokens
cpall=json.load(open('cpsc_all.json')); home={r['id']:r for r in json.load(open('cpsc_home.json'))}
C=[]
for r in cpall:
    firm=re.split(r'\s+(?:Recalls?|Announces?|Expands?|Reannounces?|to Recall)\b',r.get('Title') or '',1)[0]
    txt=(r.get('Description') or '')+' '+' '.join((p.get('Model') or '')+' '+(p.get('Description') or '') for p in r.get('Products') or [])
    firm2=re.split(r'\s+(?:Recalled|Recalls?)\b',r.get('Title') or '',1)[0] if 'Recalled' in (r.get('Title') or '') else firm
    bt=brand_tokens(firm2+' '+' '.join(re.split(r',\s*(?:of|in)\b',x.get('Name',''))[0] for k in ('Manufacturers','Importers','Distributors') for x in r.get(k) or [])+' '+' '.join(' '.join((p.get('Name') or '').split()[:1]) for p in r.get('Products') or []))-GEN
    C.append({'src':'us','id':r['RecallNumber'],'date':r['RecallDate'][:10],'title':r.get('Title'),'brand_tokens':sorted(bt),
      'models':sorted(m for m in model_tokens(txt) if not DATEY.match(m)),'gtins':sorted(u.get('UPC','').lstrip('0').zfill(13) for u in r.get('ProductUPCs') or [] if u.get('UPC')),'home':r['RecallNumber'] in home})
I=json.load(open('intl_recs.json'))
for r in I: r['brand_tokens']=sorted(set(r['brand_tokens'])-GEN)
ALL=C+I
GENERIC_MODELS={'CR2032','CR2025','CR2016','CR2450','CR1220','CR1632','CR1616','LR1130','LR41','SR626','18650','21700','PAR30','PAR38','PAR20','A19LED','BR30','GU10','MR16','E26','E27','USB2','USBC','QI2','HDMI2','WIFI6','IP65','IP44','IP67','CE2023','UL1310','UL2272','UL498','UL817','EN60335','R410A','R32','R454B','R290','R600A'}
def d(s): return datetime.date.fromisoformat(s) if s else None
def build(recs,key):
    ix=collections.defaultdict(list)
    for i,r in enumerate(recs):
        for k in r[key]: ix[k].append(i)
    return ix
def match(a,B,ixm,ixg,win=365,need_brand=True,base=False):
    out=[];da=d(a['date'])
    keys=[('model',m) for m in a['models']]+[('gtin',g) for g in a['gtins']]
    for kind,k in keys:
        ix=ixm if kind=='model' else ixg
        for j in ix.get(k,[]):
            b=B[j]
            if da and b['date'] and abs((d(b['date'])-da).days)>win: continue
            if kind=='model' and k in GENERIC_MODELS: continue
            if kind=='model' and need_brand and not (set(a['brand_tokens'])&set(b['brand_tokens'])|(set(a['brand_tokens'])&(brand_tokens(b['title'])-GEN)) |(set(b['brand_tokens'])&(brand_tokens(a['title'])-GEN))): continue
            out.append((kind,k,b['id'],b['date']))
    return out
srcs={'us':[r for r in C],'eu':[r for r in I if r['src']=='eu'],'uk':[r for r in I if r['src']=='uk'],'au':[r for r in I if r['src']=='au'],'nz':[r for r in I if r['src']=='nz'],'fr':[r for r in I if r['src']=='fr']}
res={}
def pair(A,B,label,filt=lambda r:True):
    ixm=build(srcs[B],'models'); ixg=build(srcs[B],'gtins')
    bd=[x['date'] for x in srcs[B] if x['date']]; lo,hi=min(bd),max(bd)
    den=[a for a in srcs[A] if filt(a) and (a['models'] or a['gtins']) and a['date'] and lo<=a['date']<=hi] if B!='nz' else [a for a in srcs[A] if filt(a) and (a['models'] or a['gtins'])]
    strict=[(a,match(a,srcs[B],ixm,ixg)) for a in den]; strict=[(a,m) for a,m in strict if m]
    loose=[a for a in den if match(a,srcs[B],ixm,ixg,need_brand=False)]
    gt=[a for a,m in strict if any(k=='gtin' for k,*_ in m)]
    print(f'{label}: denominator {len(den)} (window {lo}..{hi}); model+brand or GTIN match {len(strict)}; of which via GTIN {len(gt)}; model-only(no brand) {len(loose)}')
    res[label]={'den':len(den),'strict':len(strict),'gtin':len(gt),'loose':len(loose),'window':[lo,hi],'examples':[(a['id'],a['date'],m[0]) for a,m in strict[:40]]}
    return strict
homecat_eu={'Electrical appliances and equipment','Lighting equipment','Gas appliances and components','Construction products','Kitchen/cooking accessories','Machinery','Lighting chains'}
homecat_uk={'electrical-appliances-equipment','gas-appliances-and-components','lighting-products','adaptors-plugs-sockets','construction-products','pressure-equipment-vessels','kitchen-cooking-accessories'}
s1=pair('us','eu','CPSC home -> EU Safety Gate',lambda r:r['home'])
s2=pair('us','uk','CPSC home -> UK OPSS',lambda r:r['home'])
s3=pair('us','au','CPSC home -> ACCC',lambda r:r['home'])
s4=pair('us','nz','CPSC home -> NZ (sample)',lambda r:r['home'])
pair('us','eu','CPSC all -> EU Safety Gate')
pair('us','uk','CPSC all -> UK OPSS (home cats only fetched)')
pair('us','au','CPSC all -> ACCC')
t1=pair('eu','us','EU home cats -> CPSC',lambda r:r['category'] in homecat_eu)
t2=pair('uk','us','UK home cats -> CPSC')
t3=pair('au','us','ACCC -> CPSC')
t4=pair('nz','us','NZ sample -> CPSC')
u1=pair('uk','eu','UK home cats -> EU Safety Gate')
u2=pair('au','eu','ACCC -> EU Safety Gate')
u3=pair('au','uk','ACCC -> UK OPSS')
u4=pair('nz','au','NZ sample -> ACCC')
f1=pair('fr','eu','FR RappelConso home -> EU Safety Gate')
f2=pair('fr','us','FR RappelConso home -> CPSC')
f3=pair('uk','fr','UK home cats -> FR RappelConso')
json.dump(res,open('xmatch_result.json','w'),indent=1)
# print examples for hand check
byid={(r['src'],r['id']):r for r in ALL}
random.seed(20260927)
for lab,S,B in [('US->EU',s1,'eu'),('US->UK',s2,'uk'),('US->AU',s3,'au'),('US->NZ',s4,'nz'),('EU->US',t1,'us'),('UK->US',t2,'us'),('AU->US',t3,'us'),('NZ->US',t4,'us'),('UK->EU',u1,'eu'),('AU->EU',u2,'eu'),('AU->UK',u3,'uk')]:
    for a,m in (random.sample(S,min(8,len(S)))):
        b=byid.get((B,m[0][2]))
        print('HC',lab,a['id'],a['date'],(a['title'] or '')[:55],'||',m[0][0],m[0][1],'->',m[0][2],m[0][3],(b['title'] if b else '')[:55])
