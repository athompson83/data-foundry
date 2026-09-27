"""UK OPSS home categories -> EU Safety Gate, with the three join rules measured as independent result sets.

xmatch.py counted a notice under "brand + model" when it matched by model+brand OR by GTIN, and under
"model only" when it matched by model OR GTIN, so its 118/697 and 149/697 mixed the GTIN branch in. This
script reuses xmatch.py's filters and window on the archived intl_recs.json (R2
research/pipeline/2026-09-27-composites/intl_recs.json, sha256 e7aaee0d...42db) and keeps the rules apart.
"""
import json,datetime,sys
sys.path.insert(0,'.');from common import *
def gs1_valid(g):
    """GS1 check digit, as in gtin_validated.py (defined here because that script runs on import)."""
    if not g.isdigit() or len(g) not in (8,12,13,14): return False
    t=sum(int(c)*(3 if i%2==0 else 1) for i,c in enumerate(reversed(g[:-1])))
    return (10-t%10)%10==int(g[-1])
GEN={'LIGHTS','BATTERIES','BUTTON','COIN','LITHIUM','RECALLED','SUBMERSIBLE','CHARGERS','CHARGING','WIRELESS','BANKS','BANK','SCOOTERS','SCOOTER','ELECTRICAL','ADAPTER','ADAPTERS','PLUG','USB','','ELECTRIC','GAS','RANGES','HEATERS','HEATER','WATER','AIR','DUE','FIRE','HAZARD','BURN','POWER','PORTABLE','SMOKE','ALARMS','CORDS','EXTENSION','SOLD','DEPOT','LOWE','WALMART','AMAZON','CHINA','UNKNOWN','BRAND','NONE','GENERIC','NAME','OTHER','LIGHT','LED','CHARGER','BATTERY','TOY','KIDS','BABY'}
GENERIC_MODELS={'CR2032','CR2025','CR2016','CR2450','CR1220','CR1632','CR1616','LR1130','LR41','SR626','18650','21700','PAR30','PAR38','PAR20','A19LED','BR30','GU10','MR16','E26','E27','USB2','USBC','QI2','HDMI2','WIFI6','IP65','IP44','IP67','CE2023','UL1310','UL2272','UL498','UL817','EN60335','R410A','R32','R454B','R290','R600A'}
d=lambda s: datetime.date.fromisoformat(s) if s else None
I=json.load(open('intl_recs.json'))
uk=[r for r in I if r['src']=='uk']; eu=[r for r in I if r['src']=='eu']
ixm,ixg={},{}
for j,r in enumerate(eu):
    for m in r['models']: ixm.setdefault(m,[]).append(j)
    for g in r['gtins']: ixg.setdefault(g,[]).append(j)
bd=[x['date'] for x in eu if x['date']]; lo,hi=min(bd),max(bd)
den=[a for a in uk if (a['models'] or a['gtins']) and a['date'] and lo<=a['date']<=hi]
def in_window(a,b): return not (a['date'] and b['date']) or abs((d(b['date'])-d(a['date'])).days)<=365
# Brand evidence comes only from a real brand field. intl_recs.json was parsed when a UK notice without a brand
# borrowed the first title word ("Fan", "Washing") as its brand, so tokens are recomputed from the field here.
def real_brand(r): return (brand_tokens(r['brand'])-GEN) if r['has_brand_field'] else set()
def brand_ok(a,b):
    ba,bb=real_brand(a),real_brand(b)
    return bool(ba&bb or ba&(brand_tokens(b['title'])-GEN) or bb&(brand_tokens(a['title'])-GEN))
def model_hits(a,need_brand):
    return {eu[j]['id'] for m in a['models'] if m not in GENERIC_MODELS for j in ixm.get(m,[]) if in_window(a,eu[j]) and (not need_brand or brand_ok(a,eu[j]))}
def gtin_hits(a):
    return {eu[j]['id'] for g in a['gtins'] if gs1_valid(g) for j in ixg.get(g,[]) if in_window(a,eu[j])}
mb={a['id'] for a in den if model_hits(a,True)}
mo={a['id'] for a in den if model_hits(a,False)}
gt={a['id'] for a in den if gtin_hits(a)}
n=len(den)
print(f'UK home cats -> EU Safety Gate, window {lo}..{hi}: denominator {n}')
print(f'  brand + model (no GTIN branch): {len(mb)}/{n}')
print(f'  model only, no brand check (control): {len(mo)}/{n}')
print(f'  check-digit-valid GTIN: {len(gt)}/{n}')
print(f'  GTIN only (no brand+model match): {len(gt-mb)}; brand+model only: {len(mb-gt)}; both: {len(mb&gt)}; either: {len(mb|gt)}')

# Hand-check sample drawn from the brand + model set alone (seed 20260927), with the evidence for each pair.
import random
byid={r['id']:r for r in eu}
pairs=[]
for a in den:
    if a['id'] not in mb: continue
    hits=sorted({(m,eu[j]['id']) for m in a['models'] if m not in GENERIC_MODELS for j in ixm.get(m,[]) if in_window(a,eu[j]) and brand_ok(a,eu[j])})
    pairs.append((a,hits))
random.seed(20260927)
print('\nhand-check sample: 20 of',len(pairs),'brand + model matches')
for a,hits in random.sample(pairs,20):
    m,bid=hits[0]; b=byid[bid]
    print(f"- UK {a['id']} | {a['title'][:90]} | brand {a['brand'][:30]!r}\n    EU {bid} | {b['title'][:90]} | brand {b['brand'][:30]!r} | shared model {m} | other hits {len(hits)-1}")
