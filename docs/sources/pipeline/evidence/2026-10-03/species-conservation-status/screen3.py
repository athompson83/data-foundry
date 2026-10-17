#!/usr/bin/env python3
"""Retry GBIF /species/match lookups that failed (connection resets via the egress proxy), then recompute key-level pairs."""
import json, time, urllib.request, urllib.parse
UA = {'User-Agent': 'data-foundry-scout (data@mail.proviciency.com)'}
g = json.load(open('raw/gbif_matches.json'))
def gbif(name):
    for attempt in range(4):
        time.sleep(0.6 + attempt)
        try:
            d = json.loads(urllib.request.urlopen(urllib.request.Request('https://api.gbif.org/v1/species/match?' + urllib.parse.urlencode({'name': name}), headers=UA), timeout=60).read())
            return {k: d.get(k) for k in ('usageKey', 'acceptedUsageKey', 'scientificName', 'rank', 'status', 'matchType', 'confidence')}
        except Exception as e: last = str(e)
    return {'error': last}
for side in g:
    for n, m in g[side].items():
        if 'error' in m: g[side][n] = gbif(n)
json.dump(g, open('raw/gbif_matches.json', 'w'))
key = lambda m: m.get('acceptedUsageKey') or m.get('usageKey')
byk = {}
for n, m in g['ecos'].items():
    if key(m): byk.setdefault(key(m), []).append(n)
pairs = [(c, e) for c, m in g['canada'].items() if key(m) for e in byk.get(key(m), [])]
res = json.load(open('results.json'))
res['gbif_errors_after_retry'] = {s: sum(1 for m in g[s].values() if 'error' in m) for s in g}
res['gbif_lookups'] = {s: len(g[s]) for s in g}
res['gbif_key_pairs'] = len(pairs); res['gbif_key_pairs_list'] = pairs
res['gbif_key_pairs_not_exact_name'] = [(c, e) for c, e in pairs if c != e]
json.dump(res, open('results.json', 'w'), indent=1)
print({k: res[k] for k in ('gbif_errors_after_retry', 'gbif_lookups', 'gbif_key_pairs', 'gbif_key_pairs_not_exact_name')})
