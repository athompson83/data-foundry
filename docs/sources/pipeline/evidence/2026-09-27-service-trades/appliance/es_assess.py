import json,re,random,glob,collections
WILD=re.compile(r"[\*#\?]|\(.*?\)|\[.*?\]|\bx\b|(?<=[A-Z0-9])x+(?=[A-Z0-9]|$)|\{")
tot=collections.Counter();allrows=[]
for f in sorted(glob.glob('es_rows_*.json')):
    rows=json.load(open(f));n=len(rows);c=collections.Counter()
    for r in rows:
        mn=r.get('model_number','');ami=r.get('additional_model_information','') or ''
        if WILD.search(mn): c['model_wildcard']+=1
        if ami.strip(): c['ami_nonempty']+=1
        if re.search(r"[A-Z]{2,}[A-Z0-9\-]*\d",ami): c['ami_has_model_tokens']+=1
        if r.get('upc'): c['upc']+=1
        if ',' in mn or ';' in mn or '/' in mn: c['multi_model_in_field']+=1
        allrows.append((f[8:-5],r))
    print(f,n,dict(c)); tot['n']+=n
    for k,v in c.items(): tot[k]+=v
print('TOTAL',dict(tot))
random.seed(3);s=random.sample(allrows,24)
for ds,r in s: print(ds,r['pd_id'],r.get('brand_name'),'|',r.get('model_number'),'|',(r.get('additional_model_information') or '')[:150],'| upc',r.get('upc'))
json.dump([[ds,r['pd_id']] for ds,r in s],open('es_samples.json','w'))
