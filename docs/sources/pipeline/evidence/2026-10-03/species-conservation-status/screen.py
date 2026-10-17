#!/usr/bin/env python3
"""Species conservation status screen (2026-10-03). Fetches ECOS (FWS), Canada SARA critical habitat (ECCC), GBIF match.
Polite: <=2 req/s, UA header. Writes raw/ cache + results.json. Usage: python3 screen.py [--gbif-all]"""
import json, re, sys, time, urllib.request, urllib.parse, os
UA = {'User-Agent': 'data-foundry-scout (data@mail.proviciency.com)'}
os.makedirs('raw', exist_ok=True)
def get(u, cache=None):
    if cache and os.path.exists('raw/' + cache): return open('raw/' + cache, 'rb').read()
    time.sleep(0.5)
    b = urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=90).read()
    if cache: open('raw/' + cache, 'wb').write(b)
    return b
ECOS = 'https://ecos.fws.gov/ecp/pullreports/catalog/species/report/'
listed = json.loads(get(ECOS + "species/export?format=json&filter=%2Fspecies%40status_category%20%3D%20%27Listed%27", 'ecos_listed.json'))
recov = json.loads(get(ECOS + 'recoveryDocs/export?format=json', 'ecos_recovery.json'))
CH = 'https://maps-cartes.ec.gc.ca/arcgis/rest/services/CWS_SCF/CriticalHabitat/MapServer/3/query?'
q = {'where': '1=1', 'outFields': 'COSEWIC_ID,SciName,CommName_E,Population_E,SARA_Status,Taxon,RDoc_Name_E,RD_Status,ProvTerr_E', 'returnGeometry': 'false', 'returnDistinctValues': 'true', 'f': 'json'}
ca = json.loads(get(CH + urllib.parse.urlencode(q), 'ca_ch.json'))['features']
def norm(s): return re.sub(r'\s+', ' ', re.sub(r'\(=[^)]*\)', '', s)).strip().lower()
ev = lambda r: r[1]['value'] if isinstance(r[1], dict) else r[1]
E_ = {}
for r in listed['data']: E_.setdefault(norm(ev(r)), r)
C_ = {}
for f in ca: C_.setdefault(norm(f['attributes']['SciName']), []).append(f['attributes'])
exact = sorted(set(E_) & set(C_))
def gbif(name):
    u = 'https://api.gbif.org/v1/species/match?' + urllib.parse.urlencode({'name': name, 'strict': 'false'})
    try: d = json.loads(get(u))
    except Exception as e: return {'error': str(e)}
    return {k: d.get(k) for k in ('usageKey', 'acceptedUsageKey', 'scientificName', 'rank', 'status', 'matchType', 'confidence')}
res = {'ecos_listed_total': listed['meta']['totalCount'], 'ecos_listed_unique_names': len(E_), 'ecos_recovery_doc_rows': recov['meta']['totalCount'],
       'canada_ch_distinct_rows': len(ca), 'canada_ch_unique_names': len(C_), 'exact_name_overlap_listed': len(exact)}
if '--gbif-all' in sys.argv:
    # key-level join: resolve every Canada name and every ECOS-listed name through GBIF, compare accepted keys
    kc = {n: gbif(n) for n in C_}
    ke = {}
    genera = {n.split()[0] for n in C_}  # politeness: resolve only ECOS names in a genus Canada also lists (misses cross-genus synonyms)
    for n in E_:
        if n.split()[0] in genera: ke[n] = gbif(n)
    key = lambda m: m.get('acceptedUsageKey') or m.get('usageKey')
    byk = {}
    for n, m in ke.items():
        if key(m): byk.setdefault(key(m), []).append(n)
    pairs = [(c, e) for c, m in kc.items() if key(m) for e in byk.get(key(m), [])]
    res['gbif_key_pairs'] = len(pairs)
    res['gbif_key_pairs_not_exact_name'] = [(c, e) for c, e in pairs if c != e]
    json.dump({'canada': kc, 'ecos': ke}, open('raw/gbif_matches.json', 'w'))
res['exact_pairs_sample'] = [{'sci': n, 'ecos_common': E_[n][0], 'ecos_status': E_[n][2], 'ecos_url': E_[n][1]['url'], 'ca_common': C_[n][0]['CommName_E'], 'ca_sara': C_[n][0]['SARA_Status'], 'ca_cosewic_id': C_[n][0]['COSEWIC_ID']} for n in exact]
json.dump(res, open('results.json', 'w'), indent=1)
print({k: v for k, v in res.items() if k != 'exact_pairs_sample'})
