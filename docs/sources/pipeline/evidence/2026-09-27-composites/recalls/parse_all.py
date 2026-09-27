import json,glob,re,html,collections,sys,os
sys.path.insert(0,'.');from common import *
def strip(s): return re.sub(r'\s+',' ',html.unescape(re.sub(r'<[^>]+>',' ',s or ''))).strip()
GTIN=re.compile(r'(?<!\d)(\d{12,14}|\d{8})(?!\d)')
def gs1_valid(g):
    if not g.isdigit() or len(g) not in (8,12,13,14): return False
    t=sum(int(c)*(3 if i%2==0 else 1) for i,c in enumerate(reversed(g[:-1])))
    return (10-t%10)%10==int(g[-1])
def gtins(s):
    # Only codes with a valid GS1 check digit are GTINs; anything else is a model or lot token.
    out=set()
    for g in GTIN.findall(re.sub(r'(?<=\d)[ -](?=\d)','',s or '')):
        if len(g) in (8,12,13,14) and gs1_valid(g): out.add(g.lstrip('0').zfill(13) if len(g)>=12 else g)
    return out
recs=[]
# ---- UK OPSS (GOV.UK content API)
idx={r['link'].rsplit('/',1)[1]:r for r in json.load(open('uk_index.json'))}
# Read exactly the notices uk_fetch.py reconciled to the current index, never whatever is in the cache.
for slug in json.load(open('uk_manifest.json')):
    f=f'uk/{slug}.json'
    j=json.load(open(f))  # a missing or unreadable notice is an incomplete run, not a skipped row
    slug=os.path.basename(f)[:-5]; b=j['details'].get('body','')
    rows={}
    for k,v in re.findall(r'<tr>\s*<td>(.*?)</td>\s*<td>(.*?)</td>',b,re.S): rows.setdefault(strip(k).lower(),[]).append(strip(v))
    typ=re.search(r'<th scope="col">Type</th>\s*<th scope="col">(.*?)</th>',b,re.S)
    brand=' '.join(rows.get('brand',[]))
    modeltxt=' '.join(v for k,vs in rows.items() for v in vs if re.search(r'model|identif|sku|item|article|part|type number',k) and 'asin' not in k)
    bar=' '.join(v for k,vs in rows.items() for v in vs if 'barcode' in k or 'ean' in k or 'gtin' in k or 'upc' in k)
    psd=re.search(r'PSD notification number:\s*([0-9-]+)',strip(b))
    title=j['title']; prod=re.sub(r'^Product (?:Recall|Safety Report|Safety Alert):\s*','',title)
    recs.append({'src':'uk','id':psd.group(1) if psd else slug,'date':(idx.get(slug) or {}).get('product_recall_alert_date') or j['first_published_at'][:10],
      'title':title,'brand':brand,'brand_tokens':sorted(brand_tokens(brand) or brand_tokens(prod.split()[0] if prod else '')),
      'models':sorted(model_tokens(modeltxt)),'gtins':sorted(gtins(bar)),'category':(idx.get(slug) or {}).get('product_category'),
      'has_model_field':bool(modeltxt.strip()),'has_brand_field':bool(brand.strip()),'has_barcode_field':bool(bar.strip()),'url':'https://www.gov.uk'+j['base_path']})
# ---- EU Safety Gate weekly XML
for f in glob.glob('sg/*.xml'):
    s=open(f,errors='ignore').read()
    for n in re.findall(r'<notifications\b.*?</notifications>',s,re.S):
        g=lambda t:(lambda m:strip(re.sub(r'<!\[CDATA\[(.*?)\]\]>',r'\1',m.group(1),flags=re.S)) if m else '')(re.search(rf'<{t}>(.*?)</{t}>',n,re.S))
        date=re.search(r'<report_date>(\d\d)/(\d\d)/(\d{4})',s)
        recs.append({'src':'eu','id':g('caseNumber'),'date':f'{date.group(3)}-{date.group(2)}-{date.group(1)}' if date else '',
          'title':g('product')+' '+g('name'),'brand':g('brand'),'brand_tokens':sorted(brand_tokens(g('brand'))),
          'models':sorted(model_tokens(g('type_numberOfModel'))),'gtins':sorted(gtins(g('barcode'))),'category':g('category'),
          'has_model_field':bool(g('type_numberOfModel')),'has_brand_field':bool(g('brand')) and g('brand').lower() not in ('unknown','no brand'),'has_barcode_field':bool(g('barcode')),
          'risk':g('riskType'),'country':g('notifyingCountry'),'origin':g('countryOfOrigin'),'url':g('reference')})
# ---- ACCC product recall pages (Drupal fields)
for f in glob.glob('accc/*.html'):
    s=open(f,errors='ignore').read()
    if 'field-psa-recall-pra-number' not in s: continue
    def fld(name):
        ms=re.findall(r'field--name-field-psa-'+name+r'\b[^>]*>(.*?)</div>\s*</div>',s,re.S);return ' '.join(strip(m) for m in ms)
    title=strip(re.search(r'<title>(.*?)</title>',s,re.S).group(1)).split('|')[0].strip()
    pra=re.search(r'(\d{4}/\d{3,6})',fld('recall-pra-number'))
    date=re.search(r'datetime="(\d{4}-\d\d-\d\d)',s)
    brand=fld('recall-brand'); model=fld('recall-model'); sku=fld('recall-sku'); other=fld('recall-other-identify'); gt=fld('recall-gtin')+' '+fld('recall-ean')
    desc=fld('recall-product-desc'); sup=fld('recall-supplier-name')
    recs.append({'src':'au','id':pra.group(1) if pra else os.path.basename(f)[:-5],'date':date.group(1) if date else '','title':title,
      'brand':brand or sup,'brand_tokens':sorted(brand_tokens(brand or sup or title)),'models':sorted(model_tokens(model+' '+sku+' '+other)),'gtins':sorted(gtins(gt+' '+other)),
      'category':fld('product-category'),'has_model_field':bool(model.strip()),'has_brand_field':bool(brand.strip()),'has_barcode_field':bool(gt.strip()),'url':'https://www.productsafety.gov.au/search-consumer-product-recalls/'+os.path.basename(f)[:-5]})
# ---- NZ MBIE product recalls pages
for f in glob.glob('nz/*.html'):
    s=open(f,errors='ignore').read(); s2=re.sub(r'(?s)<script.*?</script>|<style.*?</style>','',s)
    t=html.unescape(re.sub(r'<[^>]+>','\n',s2)); t=re.sub(r'\n\s*\n+','\n',t)
    tm=re.search(r'<h1[^>]*>(.*?)</h1>',s,re.S) or re.search(r'<title>(.*?)</title>',s,re.S)
    if not tm: continue
    title=strip(tm.group(1))
    m=re.search(r'Product Identifiers\n(.*?)\nSupplier Contact\n(.*?)\n',t,re.S); ident=m.group(1) if m else ''; sup=m.group(2) if m else ''
    date=re.search(r'(?:Date|Recall date)[^\n]*\n\s*(\d{1,2} \w+ \d{4})',t) or re.search(r'(\d{1,2} (?:January|February|March|April|May|June|July|August|September|October|November|December) \d{4})',t)
    import datetime
    dd=''
    if date:
        try: dd=datetime.datetime.strptime(date.group(1),'%d %B %Y').strftime('%Y-%m-%d')
        except ValueError: pass  # an unparseable date leaves the notice undated (excluded from date-windowed joins)
    recs.append({'src':'nz','id':os.path.basename(f)[:-5],'date':dd,'title':title,'brand':sup,'brand_tokens':sorted(brand_tokens(title+' '+sup)),
      'models':sorted(model_tokens(ident)),'gtins':sorted(gtins(ident)),'category':'','has_model_field':bool(ident.strip()),'has_brand_field':bool(sup),'has_barcode_field':bool(gtins(ident)),'url':'https://www.productsafety.govt.nz/recalls/'+os.path.basename(f)[:-5]})
# ---- France RappelConso V2 (non-food home categories) -- measurement only, rights RED today
for x in json.load(open('fr_rc.json')):
    ip=x.get('identification_produits') or ''; ident=(json.dumps(ip) if not isinstance(ip,str) else ip)+' '+(x.get('modeles_ou_references') or '')
    b=x.get('marque_produit') if x.get('marque_produit') not in (None,'None') else ''
    recs.append({'src':'fr','id':x['numero_fiche'] or x['id'],'date':(x['date_publication'] or '')[:10],'title':x.get('libelle') or '','brand':b,'brand_tokens':sorted(brand_tokens(b)),
      'models':sorted(model_tokens(x.get('modeles_ou_references') or '')),'gtins':sorted(gtins(ident)),'category':x.get('sous_categorie_produit'),
      'has_model_field':bool((x.get('modeles_ou_references') or '').strip()),'has_brand_field':bool(b),'has_barcode_field':bool(gtins(ident)),'url':x.get('lien_vers_la_fiche_rappel')})
json.dump(recs,open('intl_recs.json','w'))
c=collections.Counter(r['src'] for r in recs); print(c)
for src in c:
    rs=[r for r in recs if r['src']==src]; n=len(rs)
    print(src,n,'dates',min(r['date'] for r in rs if r['date']) if any(r['date'] for r in rs) else '',max(r['date'] for r in rs),
      'brand_field',sum(r['has_brand_field'] for r in rs),'model_field',sum(r['has_model_field'] for r in rs),'model_tokens',sum(bool(r['models']) for r in rs),
      'barcode_field',sum(r['has_barcode_field'] for r in rs),'gtin_parsed',sum(bool(r['gtins']) for r in rs),'no_date',sum(not r['date'] for r in rs))
