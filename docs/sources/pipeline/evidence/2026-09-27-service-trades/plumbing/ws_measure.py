import csv,re,glob,collections,random,json
rows=[]
for f in sorted(glob.glob('ws/*.csv')):
    cat=f.split('Products-')[1][:-4]
    for r in csv.DictReader(open(f,encoding='utf-8-sig',errors='ignore')): r['_cat']=cat; rows.append(r)
N=len(rows)
cls={'asterisk':r'\*','hash':r'#','paren_option':r'\([A-Z0-9/,\- ]{1,8}\)','bracket':r'\[','x_placeholder':r'(?<![A-Z0-9])X{1,4}(?![A-Z])|-x+\b|x{2,}','slash_alternates':r'[A-Z0-9]/[A-Z0-9]','comma_or_list':r',|;|\band\b','space_inside':r'\S\s+\S'}
cnt=collections.Counter(); anyp=0
for r in rows:
    m=r['Model Number']; hit=False
    for k,p in cls.items():
        if re.search(p,m): cnt[k]+=1; hit=True
    anyp+=hit
print('rows',N,'any variant notation',anyp, round(100*anyp/N,1)); print(cnt.most_common())
# UPC validity
def ok(u):
    u=re.sub(r'\D','',u)
    if len(u) not in (12,13,14,8): return None
    ds=[int(c) for c in u]; chk=ds[-1]; body=ds[:-1][::-1]
    s=sum(d*(3 if i%2==0 else 1) for i,d in enumerate(body)); return (10-s%10)%10==chk
upcs=[];multi=0
for r in rows:
    v=(r.get('Universal Product Code(s)') or '').strip()
    if v:
        parts=[p for p in re.split(r'[,;\s]+',v) if p]
        if len(parts)>1: multi+=1
        upcs+=parts
res=collections.Counter(ok(u) for u in upcs)
print('upc cells',sum(1 for r in rows if (r.get('Universal Product Code(s)') or '').strip()),'multi',multi,'upc tokens',len(upcs),'valid',res[True],'bad check',res[False],'bad length',res[None])
random.seed(20260927)
wild=[r for r in rows if re.search(r'[\*#]',r['Model Number'])]
s=random.sample(wild,20)
json.dump([{'cat':r['_cat'],'brand':r['Brand Name'],'model':r['Model Number']} for r in s],open('ws_wild_sample.json','w'),indent=0)
for r in s: print(r['_cat'],'|',r['Brand Name'],'|',r['Model Number'])
