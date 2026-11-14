#!/usr/bin/env python3
"""Screen pesticide-product-labels members. Downloads (polite, <50MB total) then measures and links.
Run: python3 screen.py WORKDIR   (WORKDIR holds downloaded files; downloads happen if missing)."""
import csv, io, json, os, re, subprocess, sys, time, zipfile, random
W = sys.argv[1] if len(sys.argv) > 1 else '.'
UA = 'data-foundry-scout (data@mail.proviciency.com)'
def get(url, dest, rng=None):
    p = os.path.join(W, dest)
    if os.path.exists(p): return p
    cmd = ['curl','-s','-L','-A',UA,'-m','180','-o',p,'-w','%{http_code}',url]
    if rng: cmd[1:1] = ['-r', rng]
    code = subprocess.run(cmd, capture_output=True, text=True).stdout
    print(url, code); time.sleep(1); return p
E='https://www3.epa.gov/pesticides/PPISdata/'
for f in ['product','formula','chemcas','chemname']:
    get(E+f+'.zip', f+'.zip')
    if not os.path.exists(os.path.join(W,f+'.txt')): zipfile.ZipFile(os.path.join(W,f+'.zip')).extract(f+'.txt', W)
P='https://pest-control.canada.ca/pesticide-registry-api/api/extract/'
for e in ['product','ingredient']: get(P+e, f'pmra_{e}.csv')
A='https://data.gov.au/data/dataset/0de37904-43e0-4814-b21b-5b64fafefe6f/resource/'
get(A+'b4bb5394-b60b-4602-8bde-2e206ffc498f/download/product.csv','apvma_product.csv')
get(A+'de913672-c51a-483a-b467-f2f9df51f671/download/constit.csv','apvma_constit.csv')
get('https://www.cdc.gov/niosh/npg/npgdcas.html','niosh.html')
rd = lambda n: open(os.path.join(W,n),encoding='cp1252',errors='replace').read()
R = {}
# ---- EPA PPIS
prod = [l.rstrip('\n') for l in rd('product.txt').splitlines() if l.strip()]
ep = [dict(reg=l[0:11], appr=l[14:22], can=l[22:30], name=l[32:102].strip(), rup=l[102:103]) for l in prod]
active = [p for p in ep if p['can']=='00000000']
formula = [l for l in rd('formula.txt').splitlines() if l.strip()]
form = {}
for l in formula: form.setdefault(l[0:11], set()).add(l[11:17])
cas = {}
for l in rd('chemcas.txt').splitlines():
    if len(l.strip())>=16: cas.setdefault(l[0:6], set()).add(l[6:16].lstrip('0') if False else l[6:16])
def fmt(c):  # ZZZZZZ9-99-9 from 10-digit numeric
    c=c.lstrip('0'); return f'{c[:-3]}-{c[-3:-1]}-{c[-1]}' if len(c)>3 else c
epa_active_pc = set().union(*[form.get(p['reg'],set()) for p in active]) if active else set()
epa_cas = {pc: {fmt(c) for c in cas[pc]} for pc in epa_active_pc if pc in cas}
epa_cas_set = set().union(*epa_cas.values())
R['epa_ppis'] = dict(products_total=len(ep), products_active=len(active), newest_approval=max(p['appr'] for p in ep),
  formula_rows=len(formula), products_with_formula=len(form), active_ingredient_pc_codes=len(epa_active_pc),
  pc_codes_with_cas=len(epa_cas), distinct_cas=len(epa_cas_set), chemcas_rows=sum(len(v) for v in cas.values()),
  rup_active=sum(1 for p in active if p['rup']=='T'),
  sample=[dict(reg=f"{p['reg'][:6].lstrip('0')}-{p['reg'][6:].lstrip('0')}", name=p['name'], appr=p['appr'], pcs=sorted(form.get(p['reg'],[])), cas=sorted(set().union(*[epa_cas.get(x,set()) for x in form.get(p['reg'],[])]))) for p in random.Random(4).sample(active,20)])
# ---- PMRA
pr = list(csv.DictReader(io.StringIO(rd('pmra_product.csv'))))
ing = list(csv.DictReader(io.StringIO(rd('pmra_ingredient.csv'))))
cur = [r for r in pr if r['Current / Historical']=='Current']
pm_cas = {r['CAS number'].strip() for r in ing if r['CAS number'].strip()}
R['pmra_ppid'] = dict(products=len(pr), current=len(cur), newest_first_registered=max(r['Date first registered'] for r in pr),
  with_sites_of_use=sum(1 for r in cur if r['Sites of Use'].strip()), with_pests=sum(1 for r in cur if r['Pests'].strip()),
  ingredients=len(ing), ingredients_with_cas=len(pm_cas), 
  sample=[{k:r[k] for k in ['Registration number','Product name - English','Active ingredients - English','Registration Status','Sites of Use']} for r in random.Random(4).sample(cur,20)])
# ---- APVMA
ap = list(csv.DictReader(io.StringIO(rd('apvma_product.csv'))))
co = list(csv.DictReader(io.StringIO(rd('apvma_constit.csv'))))
R['apvma_pubcris'] = dict(products=len(ap), newest_regdate=sorted({r['regdate'].split()[0] for r in ap}, key=lambda d: tuple(reversed(d.split('/'))))[-1],
  constituents=len(co), constituent_groups=sorted({r['clevel1'] for r in co})[:40], constit_columns=list(co[0].keys()), product_columns=list(ap[0].keys()),
  sample=[{k:r[k] for k in ['pcode','fpname','sname','typedesc','regcode']} for r in random.Random(4).sample(ap,20)])
# ---- Link 1: declared CAS number, EPA active-ingredient CAS vs PMRA ingredient CAS
both = epa_cas_set & pm_cas
R['link_cas_epa_pmra'] = dict(epa_distinct_cas=len(epa_cas_set), pmra_distinct_cas=len(pm_cas), matched=len(both),
  matched_over_epa=f'{len(both)}/{len(epa_cas_set)}', matched_over_pmra=f'{len(both)}/{len(pm_cas)}', sample_matches=sorted(both)[:20])
# sample of 30 EPA CAS, by name pairing
pmname = {r['CAS number'].strip(): r['Active ingredient name - English'] for r in ing if r['CAS number'].strip()}
cname = {}
for l in rd('chemname.txt').splitlines():
    if len(l)>=297 and l[296]=='Y': cname[l[0:6]] = l[26:296].strip()
pairs=[]
for pc,cs in epa_cas.items():
    for c in cs:
        if c in pm_cas: pairs.append((c,cname.get(pc,''),pmname[c]))
R['link_cas_epa_pmra']['name_pairs_sample']=random.Random(4).sample(pairs,25)
# ---- Link 2: EPA CAS vs NIOSH CAS index (cross-dataset chemical link)
nio = set(re.findall(r'\b(\d{2,7}-\d{2}-\d)\b', rd('niosh.html')))
R['link_cas_epa_niosh'] = dict(niosh_cas=len(nio), matched=len(epa_cas_set & nio), matched_over_epa=f'{len(epa_cas_set & nio)}/{len(epa_cas_set)}')
R['link_cas_pmra_niosh'] = dict(matched=len(pm_cas & nio), matched_over_pmra=f'{len(pm_cas & nio)}/{len(pm_cas)}')
# ---- Link 3 (candidate, names): PMRA ingredient names vs APVMA constituent names, exact normalised
norm = lambda s: re.sub(r'[^A-Z0-9]','',s.upper())
apn = {norm(r['cname']): r for r in co}
nm = [(r['Active ingredient name - English'], apn[norm(r['Active ingredient name - English'])]['cname']) for r in ing if norm(r['Active ingredient name - English']) in apn]
R['link_name_pmra_apvma'] = dict(pmra_ingredients=len(ing), matched_exact_normalised=len(nm), sample=random.Random(4).sample(nm, min(20,len(nm))))
# registration-number overlap across regimes (EPA vs PMRA vs APVMA numbers are separate registers)
epa_regs = {p['reg'][6:].lstrip('0') for p in ep}; pm_regs={r['Registration number'] for r in pr}
R['registration_number_overlap_note']=dict(epa_reg_suffixes_in_pmra_numbers=len(epa_regs & pm_regs), note='numeric collision only; different registers, not a link')
json.dump(R, open('results.json','w'), indent=1, default=list)
print(json.dumps({k:{a:b for a,b in v.items() if a not in('sample','name_pairs_sample','sample_matches')} for k,v in R.items()}, indent=1, default=list))
