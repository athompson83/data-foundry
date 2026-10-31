#!/usr/bin/env python3
"""EPBC (Australia) name overlap with ECOS-listed and Canada SARA critical habitat (uses raw/ cached by screen.py)."""
import csv, json, re
def norm(s): return re.sub(r'\s+', ' ', re.sub(r'\(=[^)]*\)', '', s)).strip().lower()
ep = list(csv.DictReader(open('raw/epbc.csv', encoding='utf-8-sig')))
E = {}
for r in json.load(open('raw/ecos_listed.json'))['data']: E.setdefault(norm(r[1]['value']), r)
C = {}
for f in json.load(open('raw/ca_ch.json'))['features']: C.setdefault(norm(f['attributes']['SciName']), f['attributes'])
P = {}
for r in ep:
    for k in ('Scientific Name', 'Current Scientific Name'):
        if r[k] not in ('-', ''): P.setdefault(norm(r[k]), r)
eo = sorted(set(E) & set(P)); co = sorted(set(C) & set(P))
out = {'epbc_rows': len(ep), 'epbc_newest_extract': max(r['Date extracted'] for r in ep), 'epbc_status_counts': {}, 'ecos_epbc_exact': len(eo), 'canada_epbc_exact': len(co),
       'ecos_epbc_pairs': [{'sci': n, 'ecos': [E[n][0], E[n][2]], 'epbc': [P[n]['Common Name'], P[n]['Threatened status'], P[n]['Listed SPRAT TaxonID']]} for n in eo],
       'canada_epbc_pairs': [{'sci': n, 'canada': C[n]['CommName_E'], 'epbc': [P[n]['Common Name'], P[n]['Threatened status']]} for n in co]}
for r in ep: out['epbc_status_counts'][r['Threatened status']] = out['epbc_status_counts'].get(r['Threatened status'], 0) + 1
json.dump(out, open('results_epbc.json', 'w'), indent=1)
print({k: v for k, v in out.items() if 'pairs' not in k})
for p in out['ecos_epbc_pairs'][:25]: print(p)
