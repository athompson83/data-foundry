import pickle,json,re,collections,sys,datetime,random
sys.path.insert(0,'.');from common import *
inc=pickle.load(open('spdb_inc.pkl','rb'))
DATEY=re.compile(r'^\d{1,2}(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\d{2,4}$')
def mdate(s):
    try: return datetime.datetime.strptime(s,'%m/%d/%Y').date()
    except ValueError: return None  # blank or malformed date
idx=collections.defaultdict(list)
for i,r in enumerate(inc):
    ms=model_tokens(r['Model Name or Number'])|({nmodel(r['Model Name or Number'])} if 5<=len(nmodel(r['Model Name or Number']))<=20 and re.search(r'\d',r['Model Name or Number']) and re.search(r'[A-Za-z]',r['Model Name or Number']) else set())
    for m in ms: idx[m].append(i)
home=json.load(open('cpsc_home.json'))
cands=[r for r in home if r['date']>='2011-03-11' and r['models']]
hit=0;hit_brand=0;pre=0;links=[];modelonly_nobrand=[]
GEN={'ELECTRIC','GAS','RANGES','HEATERS','WATER','AIR','DUE','FIRE','HAZARD','BURN','POWER','PORTABLE','SMOKE','ALARMS','CORDS','EXTENSION','SOLD','HOME','DEPOT','LOWE','WALMART','AMAZON','CHINA'}
for r in cands:
    ms=[m for m in r['models'] if not DATEY.match(m)]
    bt=set(r['brand_tokens'])-GEN
    ii=set(i for m in ms for i in idx.get(m,[]))
    if not ii: continue
    hit+=1
    good=[i for i in ii if (brand_tokens(inc[i]['Brand']+' '+inc[i]['Manufacturer / Importer / Private Labeler Name'])-GEN) & bt]
    if not good: modelonly_nobrand.append((r['id'],len(ii)));continue
    hit_brand+=1
    rd=datetime.date.fromisoformat(r['date'])
    prec=[i for i in good if (mdate(inc[i]['Report Date']) or rd)<rd]
    if prec: pre+=1
    links.append({'cpsc':r['id'],'date':r['date'],'facets':r['facets'],'n_incidents':len(good),'n_before_recall':len(prec),'reports':[inc[i]['Report No.'] for i in sorted(good)],'reports_before_recall':[inc[i]['Report No.'] for i in sorted(prec)]})
print('CPSC home recalls since 2011-03 with model tokens',len(cands))
print('  >=1 incident sharing a normalised model token',hit)
print('  ... and brand/manufacturer token overlap',hit_brand)
print('  ... with >=1 incident reported BEFORE the recall date',pre)
print('  total linked incident reports',sum(l['n_incidents'] for l in links))
print('by facet',collections.Counter(f for l in links for f in l['facets']))
json.dump(links,open('spdb_cpsc_links.json','w'),indent=0)
random.seed(20260927)
for l in random.sample(links,12): 
    i=[x for x in inc if x['Report No.']==l['reports'][0]][0]
    print(l['cpsc'],l['date'],l['n_incidents'],l['n_before_recall'],'|',i['Report No.'],i['Brand'][:20],'|',i['Model Name or Number'][:30],'|',i['Product Description'][:60].replace('\n',' '))
print('model-only (no brand) matches',len(modelonly_nobrand),modelonly_nobrand[:8])
# incident-side view: of home-category incidents with a model, how many match any CPSC recall model+brand
homecat={'Appliances','Heating, Ventilation & Air Conditioning','Laundry, Fabric Care & Sewing','Plumbing & Bath','Electrical Systems','Indoor Lighting','Home Security','Cables, Surge & Power Protection','Ladders'}
hi=[i for i,r in enumerate(inc) if r['Product Sub Category'] in homecat]
linked=set(); 
rid={}
for r in home:
    for m in r['models']:
        rid.setdefault(m,[]).append(r)
for i in hi:
    ms=model_tokens(inc[i]['Model Name or Number'])|{nmodel(inc[i]['Model Name or Number'])}
    bt=brand_tokens(inc[i]['Brand']+' '+inc[i]['Manufacturer / Importer / Private Labeler Name'])-GEN
    for m in ms:
        for r in rid.get(m,[]):
            if set(r['brand_tokens'])&bt: linked.add(i)
print('home-category incident reports',len(hi),'with model field',sum(1 for i in hi if inc[i]['Model Name or Number'].strip()),'linked to a CPSC home recall by model+brand',len(linked))
print('home-category incidents with UPC',sum(1 for i in hi if inc[i]['UPC'].strip()))
