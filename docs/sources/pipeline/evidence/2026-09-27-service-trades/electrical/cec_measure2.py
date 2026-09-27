exec(open('cec_measure.py').read().split("# seeded sample")[0])
import json
random.seed(20260927)
sm=random.sample(mod,25)
print('module sample:',[f"{r[0]}|{r[1]}" for r in sm][:25])
print(' w',sum(bool(w.search(str(r[2]))) for r in sm),'tech',sum(bool(tech.search(str(r[2]))) for r in sm),'bifacial',sum(bool(bif.search(str(r[2]))) for r in sm),'halfcut',sum(bool(half.search(str(r[2]))) for r in sm),'cells',sum(bool(cell.search(str(r[2]))) for r in sm))
for r in sm[:8]: print('   ',r[1],'|',r[2])
se=random.sample(ess,25)
print('ESS sample kwh',sum(bool(kwh.search(str(r[De]))) for r in se),'curly',sum(bool(curly.search(str(r[2]))) for r in se),[f"{r[0]}|{r[2]}" for r in se][:25])
# formula cells in modules (PTC is an Excel formula, not a value)
print('module PTC formula cells',sum(isinstance(r[5],str) and r[5].startswith('=') for r in mod),'/',len(mod))
# CPSC overlap
cp=json.load(open('cpsc_all.json'))
mf=set()
for r in cp:
    for m in (r.get('Manufacturers') or [])+(r.get('Importers') or [])+(r.get('Distributors') or []):
        n=(m.get('Name') or '').lower()
        if n: mf.add(re.sub(r'[^a-z0-9]','',n.split(',')[0])[:12])
cm=set(re.sub(r'[^a-z0-9]','',r[0].lower().split(',')[0])[:12] for r in inv+ess+mod)
ov=[x for x in cm if x in mf and len(x)>=5]
print('CEC manufacturers',len(cm),'also named as mfr/importer/distributor in CPSC recalls',len(ov),sorted(ov)[:20])
json.dump({'modules':[f"{r[0]}|{r[1]}" for r in sm],'ess':[f"{r[0]}|{r[2]}" for r in se]},open('cec_other_samples.json','w'),indent=1)
