import sys,re,json,collections,html,unicodedata;sys.path.insert(0,'scripts')
from common import *
def fold(s): return ''.join(c for c in unicodedata.normalize('NFKD',s or '') if not unicodedata.combining(c))
def nm(t): return re.sub(r'[^A-Z0-9]','',fold(t).upper())
STOP=set('THE AND INC LLC LTD CO CORP CORPORATION COMPANY GROUP USA US INTERNATIONAL PTY LIMITED GMBH SA SL AB BV NV OF BRAND PRODUCTS HOME PLC UK EUROPE'.split())
def btok(s): return {x for x in re.findall(r'[A-Z0-9]+',fold(s).upper()) if x not in STOP and len(x)>=3}
TOKEN=re.compile(r"(?<![A-Za-z0-9])(?=[A-Za-z0-9/\-\.]*\d)(?=[A-Za-z0-9/\-\.]*[A-Za-z])[A-Za-z0-9][A-Za-z0-9/\-\.]{3,}[A-Za-z0-9](?![A-Za-z0-9])")
def mtoks(t): return {nm(x) for x in TOKEN.findall(t or '') if len(nm(x))>=5 and re.search(r'\d',nm(x)) and re.search(r'[A-Z]',nm(x)) and not re.fullmatch(r'\d+(MM|CM|V|W|KW|MAH|HZ|LBS?|OZ|ML|KG|FT|BTU|GB)',nm(x)) and not re.fullmatch(r'(19|20)\d\d[A-Z]{1,3}',nm(x))}
out={}
# --- CPSC since 2025
C=json.load(open('raw/cpsc_since_2025.json')); cp=[]
for x in C:
    txt=x['Description']+' '+' '.join(p.get('Description','')+' '+p.get('Model','') for p in x['Products'])
    upc=' , '.join(u['UPC'] for u in x['ProductUPCs'])
    g=gtins_fused(upc)|gtins(re.sub(r'(?i)upc|gtin|ean|barcode','',txt))
    mods=mtoks(' '.join(p.get('Model','') for p in x['Products']))|mtoks(' '.join(re.findall(r'(?i)model(?: number| no\.?| #)?s?:?\s*["“]?([A-Za-z0-9][A-Za-z0-9 ,/\-\.]{3,60})',txt)))
    firms=' '.join(m['Name'] for k in('Manufacturers','Importers','Retailers','Distributors') for m in x[k])
    cp.append(dict(id=x['RecallNumber'],date=x['RecallDate'][:10],title=x['Title'],url=x['URL'],gtins=g,models=mods,btok=btok(x['Title'].split(' Recall')[0]+' '+firms+' '+' '.join(p['Name'] for p in x['Products'])),
                   hc_cites=[i['URL'] for i in x['Inconjunctions'] if 'recalls-rappels' in i.get('URL','')]))
out['cpsc_n']=len(cp);out['cpsc_with_gtin']=sum(1 for r in cp if r['gtins']);out['cpsc_with_model']=sum(1 for r in cp if r['models'])
cpsc_num={r['id'] for r in cp}
# --- EU
E=json.load(open('results/eu_records.json'))
for r in E:
    r['g']=gtins_fused(r['barcode']);r['m']=mtoks(r['model']);r['b']=btok(r['brand'])
# --- UK (since 2025 only where fetched)
U=json.load(open('results/uk_records.json'))
for r in U:
    r['g']=gtins_fused(r['barcode']);r['m']=mtoks(r['model']);r['b']=btok(r['brand'])
out['eu_n']=len(E);out['uk_n']=len(U)
# --- declared: GTIN
def gjoin(A,B,la,lb,extra=None):
    idx=collections.defaultdict(list)
    for b in B:
        for g in b['g'] if 'g' in b else b['gtins']: idx[g].append(b)
    hits=[];
    for a in A:
        for g in (a['g'] if 'g' in a else a['gtins']):
            for b in idx.get(g,[]): hits.append((a,b,g))
    an={id(a) for a,_,_ in hits}
    return hits,len(an)
gt={}
for name,A,B in [('EU->CPSC',E,cp),('UK->CPSC',U,cp),('EU->UK',E,U)]:
    h,n=gjoin(A,B,0,0)
    withg=sum(1 for a in A if (a['g'] if 'g' in a else a['gtins']))
    gt[name]={'source_notices':len(A),'source_with_valid_gtin':withg,'source_notices_matched':n,'pairs':len(h)}
    json.dump([{'a':(a.get('case') or a.get('slug') or a.get('id')),'b':(b.get('case') or b.get('slug') or b.get('id')),'gtin':g} for a,b,g in h],open(f'results/join_gtin_{name.replace("->","_")}.json','w'),indent=0)
out['declared_gtin']=gt
# --- declared: cited case/recall numbers
def cited(texts):
    return bool(re.search(r'CPSC|Consumer Product Safety|saferproducts|cpsc\.gov',texts,re.I))
out['uk_text_cites_cpsc']=sum(1 for r in U if re.search(r'CPSC|Consumer Product Safety Commission|saferproducts|cpsc\.gov',r['body'],re.I))
out['uk_text_cites_safety_gate_or_case']=sum(1 for r in U if re.search(r'Safety Gate|RAPEX|\b[A-Z]{2}/\d{4,5}/\d\d\b',r['body'],re.I))
out['uk_text_cites_healthcanada']=sum(1 for r in U if re.search(r'Health Canada|recalls-rappels',r['body'],re.I))
out['eu_text_cites_cpsc_hc']=sum(1 for r in E if re.search(r'CPSC|Consumer Product Safety|saferproducts|Health Canada|recalls-rappels',' '.join([r['danger'],r['description'],r['measures'],r['url_recall']]),re.I))
out['cpsc_cites_hc']={'cpsc_with_hc_citation':sum(1 for r in cp if r['hc_cites'])}
json.dump(out,open('results/09_joins_declared.json','w'),indent=1,default=list)
print(json.dumps(out,indent=1,default=list))
import pickle;pickle.dump((cp,E,U),open('/tmp/joins.pkl','wb'))
