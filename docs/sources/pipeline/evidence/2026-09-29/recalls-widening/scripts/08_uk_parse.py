import sys,re,glob,json,html,os,collections;sys.path.insert(0,'scripts')
from common import *
def strip(s): return re.sub(r'\s+',' ',html.unescape(re.sub(r'<[^>]+>',' ',s or ''))).strip()
idx={r['link'].rsplit('/',1)[1]:r for r in json.load(open('raw/uk_index.json'))['results']}
CITE=re.compile(r'CPSC|Consumer Product Safety Commission|saferproducts|cpsc\.gov|Health Canada|recalls-rappels|Safety Gate|RAPEX|ec\.europa\.eu/safety-gate|\b[A-Z]{2}/\d{4,5}/\d\d\b|\bACCC\b|productsafety\.gov\.au',re.I)
recs=[]
for f in sorted(glob.glob('raw/uk/*.json')):
    slug=os.path.basename(f)[:-5]; j=json.load(open(f)); d=j['details']; b=d.get('body','')
    md=d.get('metadata',{}); ix=idx.get(slug,{})
    rows=collections.defaultdict(list)
    for k,v in re.findall(r'<tr>\s*<td>(.*?)</td>\s*<td>(.*?)</td>',b,re.S): rows[strip(k).lower()].append(strip(v))
    typ=re.search(r'<th scope="col">Type</th>\s*<th scope="col">(.*?)</th>',b,re.S)
    g=lambda *ks:' '.join(v for k,vs in rows.items() for v in vs if any(x in k for x in ks))
    psd=re.search(r'PSD notification number:?\s*([0-9A-Za-z-]+)',strip(b))
    text=strip(b)
    cites=sorted(set(m.group(0) for m in CITE.finditer(text)))
    recs.append(dict(slug=slug,title=j['title'],date=md.get('product_recall_alert_date') or ix.get('product_recall_alert_date') or j['first_published_at'][:10],
      alert_type=md.get('product_alert_type'),category=md.get('product_category'),risk_level=md.get('product_risk_level'),measure=md.get('product_measure_type'),
      brand=g('brand'),model=g('model','identif','type number','item','article','part'),barcode=g('barcode','ean','gtin','upc'),batch=g('batch','lot','serial','date code'),
      sku=g('sku'),country_of_origin=g('country of origin'),psd=psd.group(1) if psd else '',type_row=strip(typ.group(1)) if typ else '',
      hazard=' '.join(re.findall(r'<h2 id="hazard">.*?</h2>(.*?)<h2',b,re.S)[:1]) and strip(re.findall(r'<h2 id="hazard">.*?</h2>(.*?)<h2',b,re.S)[0]),
      cites=cites,n_attach=len(d.get('attachments',[])),url='https://www.gov.uk'+j['base_path'],text_len=len(text),body=text[:6000]))
json.dump(recs,open('results/uk_records.json','w'))
print(len(recs))
