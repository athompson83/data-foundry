"""Round 2026-11-14: plumbing-wikidata-brand-owners DISCOVERED -> SCREENED.

Brand list: every brand_name in ENERGY STAR Certified Water Heaters (Socrata pbpq-swnu, open, no key),
ranked by certified model count. The WaterSense API was the planned brand list but now requires an
api.data.gov key (DEMO_KEY: 10 requests/hour, 10 rows/page), so it was not used.
For the top 50 brands, the Wikidata Action API finds items whose English label or alias equals
the brand (case-insensitive exact) and reports owner (P127), parent organisation (P749) and
manufacturer (P176) where present. An exact label is a candidate only (AGENTS.md rules 3, 7).
Run: python3 -I wikidata_brands.py > wikidata_brands.json
"""
import json, urllib.parse, urllib.request

UA = 'data-foundry-scout/1.0 (data@mail.proviciency.com)'

import time, urllib.error

def get(url, accept='application/json', tries=5):
    req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept': accept})
    for attempt in range(tries):
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                return r.status, json.load(r)
        except urllib.error.HTTPError as e:  # 429: honour Retry-After, then retry; anything else is raised
            if e.code != 429 or attempt == tries - 1:
                raise
            time.sleep(min(int(e.headers.get('Retry-After') or 10), 90))

soql = urllib.parse.urlencode({'$select': 'brand_name, count(*) as n', '$group': 'brand_name', '$order': 'n DESC', '$limit': '5000'})
status_es, brands = get('https://data.energystar.gov/resource/pbpq-swnu.json?' + soql)
status_tot, tot = get('https://data.energystar.gov/resource/pbpq-swnu.json?$select=count(*)%20as%20n')
top = [b['brand_name'].strip() for b in brands[:50]]

# WDQS answered HTTP 429 ("1 req / min ... during active wdqs outage") on 2026-11-14, so the lookup uses the
# Wikidata Action API: wbsearchentities per brand (exact, case-insensitive label or alias match kept), then
# wbgetentities for the claims, one request per second.
import time
API = 'https://www.wikidata.org/w/api.php?'
results, hits = {}, {}
for b in top:
    time.sleep(3)
    try:
        _, d = get(API + urllib.parse.urlencode({'action': 'wbsearchentities', 'search': b, 'language': 'en', 'type': 'item', 'limit': '10', 'format': 'json'}))
    except Exception as e:
        results[b] = {'error': str(e)[:120]}
        continue
    exact = [h['id'] for h in d.get('search', []) if h.get('match', {}).get('text', '').lower() == b.lower()]
    results[b] = {'items': exact}
    for i in exact: hits.setdefault(i, []).append(b)
ids = list(hits)
claims = {}
for k in range(0, len(ids), 50):
    time.sleep(3)
    _, d = get(API + urllib.parse.urlencode({'action': 'wbgetentities', 'ids': '|'.join(ids[k:k + 50]), 'props': 'claims', 'format': 'json'}))
    for i, ent in d.get('entities', {}).items():
        def vals(p):
            return sorted({c['mainsnak']['datavalue']['value']['id'] for c in ent.get('claims', {}).get(p, []) if c['mainsnak'].get('datavalue')})
        claims[i] = {'P127': vals('P127'), 'P749': vals('P749'), 'P176': vals('P176'), 'P31': vals('P31')}
for b, r in results.items():
    for key, prop in (('owner_P127', 'P127'), ('parent_P749', 'P749'), ('manufacturer_P176', 'P176')):
        r[key] = sorted({v for i in r.get('items', []) for v in claims.get(i, {}).get(prop, [])})
    r['instance_of_P31'] = sorted({v for i in r.get('items', []) for v in claims.get(i, {}).get('P31', [])})

resolved = [b for b, r in results.items() if r.get('items')]
with_rel = [b for b, r in results.items() if r.get('owner_P127') or r.get('parent_P749') or r.get('manufacturer_P176')]
print(json.dumps({
    'measured': '2026-11-14',
    'energystar_http': status_es, 'energystar_models_total': int(tot[0]['n']), 'energystar_brands_total': len(brands),
    'top50_models_covered': sum(int(b['n']) for b in brands[:50]),
    'top50_resolved_exact_label': f'{len(resolved)}/50',
    'top50_with_owner_parent_or_manufacturer': f'{len(with_rel)}/50',
    'errors': sum(1 for r in results.values() if 'error' in r),
    'by_brand': results,
}, indent=1))
