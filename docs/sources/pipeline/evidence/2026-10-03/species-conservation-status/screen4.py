#!/usr/bin/env python3
"""ITIS TSN lookup for the exact-name overlaps (ECOS-Canada 19, ECOS-EPBC 51): does the name resolve to exactly one TSN?"""
import json, time, urllib.request, urllib.parse
UA = {'User-Agent': 'data-foundry-scout (data@mail.proviciency.com)'}
r1 = json.load(open('results.json')); r2 = json.load(open('results_epbc.json'))
names = sorted({p['sci'] for p in r1['exact_pairs_sample']} | {p['sci'] for p in r2['ecos_epbc_pairs']})
out = {}
for n in names:
    time.sleep(0.6)
    try:
        d = json.loads(urllib.request.urlopen(urllib.request.Request('https://www.itis.gov/ITISWebService/jsonservice/searchByScientificName?' + urllib.parse.urlencode({'srchKey': n}), headers=UA), timeout=60).read())
        out[n] = [x['tsn'] for x in (d.get('scientificNames') or []) if x and x.get('combinedName', '').lower() == n]
    except Exception as e: out[n] = 'error: ' + str(e)
res = {'names': len(names), 'one_tsn': sum(1 for v in out.values() if isinstance(v, list) and len(v) == 1), 'none': sum(1 for v in out.values() if v == []), 'multi': sum(1 for v in out.values() if isinstance(v, list) and len(v) > 1), 'errors': sum(1 for v in out.values() if isinstance(v, str)), 'tsn': out}
json.dump(res, open('results_itis.json', 'w'), indent=1); print({k: v for k, v in res.items() if k != 'tsn'})
