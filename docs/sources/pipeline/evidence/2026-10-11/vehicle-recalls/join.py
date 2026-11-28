"""Measure the NHTSA <-> Transport Canada vehicle-recall join on the manufacturer's own campaign number.
Run: python3 -I join.py <workdir>. Uses only open endpoints, UA declared."""
import sys, json, re, io, zipfile, urllib.request, concurrent.futures as cf, csv
UA = 'data-foundry-scout/1.0 (data@mail.proviciency.com)'
work = sys.argv[1]
import subprocess
def get(u):
    # curl: the Transport Canada API answers 500 to Python's urllib through the egress proxy but 200 to curl
    return subprocess.run(['curl', '-sS', '--fail', '-m', '120', '-A', UA, u], check=True, capture_output=True).stdout
z = zipfile.ZipFile(io.BytesIO(get('https://static.nhtsa.gov/odi/ffdd/rcl/FLAT_RCL_POST_2010.zip')))
raw = z.read(z.namelist()[0]).decode('latin-1')
nh = []
for line in raw.splitlines():
    f = line.split('\t')
    if len(f) < 24: continue
    nh.append(dict(camp=f[1], make=f[2], mfgcamp=f[5], date=f[16], desc=f[19], conseq=f[20], remedy=f[21]))
ncamp = {r['camp'] for r in nh}
norm = lambda s: re.sub(r'[^A-Z0-9]', '', s.upper())
idx = {}
for r in nh:
    if r['mfgcamp'].strip(): idx.setdefault(norm(r['mfgcamp']), []).append(r)
def tc(n):
    try:
        d = json.loads(get(f'https://data.tc.gc.ca/v1.3/api/eng/vehicle-recall-database/recall-summary/recall-number/{n}'))
    except Exception as e:
        return n, None
    rs = d['ResultSet']
    if not rs: return n, None
    row = {c['Name']: c['Value']['Literal'] for c in rs[0]}
    return n, row
nums = [f'{y}{i:03d}' for y in (2022, 2023, 2024, 2025) for i in range(1, 91)]
with cf.ThreadPoolExecutor(12) as ex: res = list(ex.map(tc, nums))
tcs = [(n, r) for n, r in res if r]
out = {'nhtsa_rows': len(nh), 'nhtsa_campaigns': len(ncamp), 'tc_requested': len(nums), 'tc_found': len(tcs), 'matches': []}
cited = 0
for n, r in tcs:
    m = norm(r['MANUFACTURER_RECALL_NO_TXT'])
    hits = [h for h in idx.get(m, []) if norm(h['make'])[:4] == norm(r['MAKE_NAME_NM'])[:4]] if m else []
    # TC comment citing an NHTSA campaign number (e.g. 23V-123)
    cites = re.findall(r'\b\d{2}V-?\d{3}\b', r.get('COMMENT_ETXT') or '')
    cited += bool(cites)
    out['matches'].append({'tc': n, 'mfr_no': r['MANUFACTURER_RECALL_NO_TXT'], 'make': r['MAKE_NAME_NM'], 'nhtsa_campaigns': sorted({h['camp'] for h in hits}), 'tc_cites_nhtsa': cites})
m = [x for x in out['matches'] if x['nhtsa_campaigns']]
out['declared_mfr_number_matches'] = len(m)
out['tc_comment_cites_nhtsa'] = cited
out['mfr_number_matches_after_year_filter'] = len(m)
json.dump(out, open('join.json', 'w'), indent=1)
print({k: v for k, v in out.items() if k != 'matches'})
