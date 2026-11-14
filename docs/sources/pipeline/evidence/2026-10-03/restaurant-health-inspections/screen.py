#!/usr/bin/env python3
"""Screen restaurant-health-inspection sources (2026-10-03). Writes results.json. <=2 req/s, small samples."""
import json, time, urllib.request, urllib.parse, urllib.error, re, collections
UA = {'User-Agent': 'data-foundry-scout (data@mail.proviciency.com)'}
def get(u, h=None):
    time.sleep(0.6)
    r = urllib.request.Request(u, headers={**UA, **(h or {})})
    try:
        x = urllib.request.urlopen(r, timeout=60); return x.status, x.read().decode('utf8', 'replace')
    except urllib.error.HTTPError as e: return e.code, e.read().decode('utf8', 'replace')
    except Exception as e: return 0, str(e)
def j(u, h=None):
    s, b = get(u, h)
    try: return s, json.loads(b)
    except Exception: return s, b[:200]
def soc(dom, id_, **q):
    return j(f'https://{dom}/resource/{id_}.json?' + urllib.parse.urlencode(q))
R = {}
# ---- Socrata feeds
feeds = {
 'nyc-dohmh-restaurant-inspections': ('data.cityofnewyork.us', '43nn-pn8j', 'camis', 'inspection_date', 'violation_description'),
 'chicago-food-inspections': ('data.cityofchicago.org', '4ijn-s7e5', 'license_', 'inspection_date', 'violations'),
 'sf-health-inspection-scores': ('data.sfgov.org', 'pyih-qa8i', 'business_id', 'inspection_date', 'violation_description'),
 'austin-food-inspection-scores': ('data.austintexas.gov', 'ecmv-9xxi', 'facility_id', 'inspection_date', None),
 'dallas-food-inspections': ('www.dallasopendata.com', 'dri5-wcct', None, 'insp_date', 'violation1_text'),
 'king-county-food-inspections': ('data.kingcounty.gov', 'f29f-zza5', None, None, None),
}
for k, (dom, i, idf, df, tf) in feeds.items():
    o = {}
    s, v = j(f'https://{dom}/api/views/{i}.json')
    if isinstance(v, dict) and 'name' in v:
        o['view'] = {x: v.get(x) for x in ('name', 'licenseId', 'attribution', 'rowsUpdatedAt')}
        o['view']['license'] = (v.get('license') or {}).get('name')
    else: o['view'] = {'http': s}
    sel = {'$select': 'count(*) as n' + (f', max({df}) as newest, min({df}) as oldest' if df else '') + (f', count(distinct {idf}) as ids' if idf else '')}
    s, v = soc(dom, i, **sel); o['aggregate_http'] = s; o['aggregate'] = v[0] if isinstance(v, list) and v else v
    q = {'$limit': 200}
    if df: q['$where'] = f"{df} > '2000-01-01'"; q['$order'] = f'{df} DESC'
    s, rows = soc(dom, i, **q); o['sample_http'] = s
    if isinstance(rows, list):
        o['sample_n'] = len(rows)
        if tf: o['free_text_field'] = tf; o['free_text_filled_in_sample'] = sum(1 for r in rows if r.get(tf))
        if idf: o['id_field'] = idf; o['ids_filled_in_sample'] = sum(1 for r in rows if r.get(idf))
        o['sample_keys'] = sorted(rows[0].keys())[:30] if rows else []
        o['sample_example'] = {a: (str(b)[:160]) for a, b in list(rows[0].items())[:12]} if rows else None
    R[k] = o
# ---- FSA FHRS API
H2 = {'x-api-version': '2', 'accept': 'application/json'}
s, v = j('https://api.ratings.food.gov.uk/Authorities', H2)
fsa = {'authorities_http': s}
if isinstance(v, dict):
    a = v['authorities']; fsa['authorities'] = len(a); fsa['establishments_total'] = sum(x['EstablishmentCount'] for x in a)
    fsa['newest_authority_publish'] = max(x['LastPublishedDate'] for x in a); fsa['oldest_authority_publish'] = min(x['LastPublishedDate'] for x in a)
    fsa['regions'] = dict(collections.Counter(x['RegionName'] for x in a))
s, v = j('https://api.ratings.food.gov.uk/Establishments?localAuthorityId=1&pageSize=200&pageNumber=1', H2)
fsa['sample_http'] = s
if isinstance(v, dict):
    e = v['establishments']; fsa['sample_n'] = len(e)
    fsa['right_to_reply_filled'] = sum(1 for x in e if x.get('RightToReply')); fsa['keys'] = sorted(e[0].keys())
    fsa['rating_values'] = dict(collections.Counter(x['RatingValue'] for x in e))
    fsa['newest_rating_date'] = max(x['RatingDate'] for x in e if x.get('RatingDate'))
    fsa['example_right_to_reply'] = next((x['RightToReply'][:300] for x in e if x.get('RightToReply')), None)
s, v = j('https://api.ratings.food.gov.uk/Establishments?pageSize=1', H2); fsa['unfiltered_query_http'] = s
R['uk-fsa-food-hygiene-ratings'] = fsa
# ---- OSM (fhrs:id) and linkage FSA <-> OSM
s, t = j('https://taginfo.openstreetmap.org/api/4/key/stats?key=fhrs:id')
R['osm-fhrs-tagged-venues'] = {'taginfo_http': s, 'objects_with_fhrs_id': next((x['count'] for x in t['data'] if x['type'] == 'all'), None) if isinstance(t, dict) else None}
osm = {'elements': json.load(open('osm_cambridge_fhrs_sample.json'))}  # trimmed from one call: curl 'https://api.openstreetmap.org/api/0.6/map.json?bbox=0.1200,52.1950,0.1330,52.2030' (12291 elements, 86 with fhrs:id; the full bbox count is recorded in results.json)
tagged = [x for x in osm['elements'] if 'fhrs:id' in x.get('tags', {})]
R['osm-fhrs-tagged-venues']['bbox_elements'] = 12291; R['osm-fhrs-tagged-venues']['bbox_with_fhrs_id'] = len(tagged)
norm = lambda s: re.sub(r'[^a-z0-9]', '', (s or '').lower())
pcn = lambda s: re.sub(r'\s', '', (s or '').upper())
rows = []
for x in tagged[:40]:
    t = x['tags']; fid = t['fhrs:id']
    s, e = j(f'https://api.ratings.food.gov.uk/Establishments/{fid}', H2)
    ok = isinstance(e, dict) and e.get('FHRSID') is not None
    r = {'osm': f"{x['type']}/{x['id']}", 'fhrs_id': fid, 'http': s, 'resolved': ok, 'osm_name': t.get('name')}
    if ok:
        r.update(fsa_name=e['BusinessName'], fsa_postcode=e['PostCode'], osm_postcode=t.get('addr:postcode'), rating=e['RatingValue'])
        r['name_eq'] = norm(e['BusinessName']) == norm(t.get('name')); r['postcode_eq'] = bool(t.get('addr:postcode')) and pcn(e['PostCode']) == pcn(t['addr:postcode'])
        r['postcode_present'] = bool(t.get('addr:postcode'))
    rows.append(r)
res = [r for r in rows if r['resolved']]
R['link_fsa_osm_fhrsid'] = {'sampled': len(rows), 'resolved_in_fsa_api': len(res), 'name_equal': sum(r.get('name_eq', False) for r in res),
  'postcode_checked': sum(r.get('postcode_present', False) for r in res), 'postcode_equal': sum(r.get('postcode_eq', False) for r in res), 'rows': rows}
json.dump(R, open('results.json', 'w'), indent=1)
print(json.dumps({k: {a: b for a, b in v.items() if a not in ('rows',)} for k, v in R.items()}, indent=1)[:9000])
