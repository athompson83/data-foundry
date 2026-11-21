#!/usr/bin/env python3
"""Screen hazard-disaster-events members (2026-10-01). Polite, small samples, no keys."""
import csv, gzip, io, json, re, time, urllib.request, urllib.parse, collections, datetime as dt
UA = {'User-Agent': 'data-foundry-scout (data@mail.proviciency.com)'}
def get(u, raw=False):
    time.sleep(0.6)
    for attempt in (1, 2):
        try:
            r = urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=90)
            b = r.read(); return r.status, (b if raw else b.decode('utf-8', 'replace'))
        except urllib.error.HTTPError as e: return e.code, ''
        except Exception as e:
            err = str(e); time.sleep(3)
    return 0, err
out = {}
# ---- FEMA OpenFEMA (data API reachable; terms page 403 Akamai from our egress)
s, t = get('https://www.fema.gov/about/openfema/terms-conditions'); out['fema_terms_page'] = s
q = 'https://www.fema.gov/api/open/v2/DisasterDeclarationsSummaries?$top=1000&$inlinecount=allpages&$orderby=declarationDate%20desc&$filter=declarationDate%20ge%20%272025-06-01T00:00:00.000Z%27'
s, t = get(q); d = json.loads(t); fema = d['DisasterDeclarationsSummaries']
out['fema'] = {'http': s, 'total_all_time': 70423, 'newest': fema[0]['declarationDate'], 'rows_since_2025_06': d['metadata']['count'],
  'fields': list(fema[0].keys()), 'free_text': ['declarationTitle (short title only)'], 'ids': ['femaDeclarationString','disasterNumber','fipsStateCode+fipsCountyCode','placeCode','incidentId'],
  'refresh_cadence': 'accrualPeriodicity R/PT20M; lastDataSetRefresh 2026-10-01T13:48Z'}
s, t = get('https://www.fema.gov/api/open/v1/OpenFemaDataSets?$filter=name%20eq%20%27DisasterDeclarationsSummaries%27')
m = json.loads(t)['OpenFemaDataSets'][0]; out['fema']['metadata'] = {k: m[k] for k in ['accessLevel','license','accrualPeriodicity','temporal','recordCount','lastDataSetRefresh','publisher']}
# ---- NWS active alerts
s, t = get('https://api.weather.gov/alerts/active'); nws = json.loads(t)['features']
out['nws'] = {'http': s, 'active_alerts': len(nws), 'ids': ['id (urn:oid)','geocode.SAME','geocode.UGC','eventCode','parameters.AWIPSidentifier'],
  'free_text': ['headline','description','instruction'], 'desc_nonempty': sum(1 for f in nws if f['properties'].get('description')),
  'newest_sent': max(f['properties']['sent'] for f in nws)}
s, t = get('https://api.weather.gov/alerts?start=2026-06-01T00:00:00Z&end=2026-06-02T00:00:00Z'); out['nws']['history_probe_2026-06-01_features'] = len(json.loads(t)['features'])
# ---- USGS
s, t = get('https://earthquake.usgs.gov/fdsnws/event/1/count?starttime=2026-09-01&format=geojson'); out['usgs_count_since_2026-09-01'] = t.strip()
s, t = get('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_month.geojson'); u = json.loads(t)
out['usgs'] = {'http': s, 'm2.5_month_events': len(u['features']), 'newest_time': dt.datetime.utcfromtimestamp(max(f['properties']['time'] for f in u['features'])/1000).isoformat(),
  'fields': list(u['features'][0]['properties'].keys()), 'ids': ['id','ids','code','net','url'], 'free_text': ['place (e.g. "10 km N of Town, ST")','title'], 'sample': [f['properties']['place'] for f in u['features'][:5]]}
# ---- NCEI Storm Events 2026
s, b = get('https://www.ncei.noaa.gov/pub/data/swdi/stormevents/csvfiles/StormEvents_details-ftp_v1.0_d2026_c20260918.csv.gz', raw=True)
ncei = list(csv.DictReader(io.StringIO(gzip.decompress(b).decode('latin-1'))))
out['ncei'] = {'http': s, 'bytes': len(b), 'rows_2026': len(ncei), 'months': [min(r['BEGIN_YEARMONTH'] for r in ncei), max(r['BEGIN_YEARMONTH'] for r in ncei)],
  'event_narrative_nonempty': sum(1 for r in ncei if r['EVENT_NARRATIVE'].strip()), 'episode_narrative_nonempty': sum(1 for r in ncei if r['EPISODE_NARRATIVE'].strip()),
  'ids': ['EVENT_ID','EPISODE_ID','STATE_FIPS','CZ_TYPE','CZ_FIPS','WFO'], 'free_text': ['EVENT_NARRATIVE','EPISODE_NARRATIVE'], 'files_listed': ['d2025_c20260819','d2026_c20260918']}
# ---- ECCC CAP
s, t = get('https://dd.weather.gc.ca/today/alerts/cap/'); days = re.findall(r'href="(\d{8})/"', t)
out['eccc'] = {'http': s, 'day_dirs': days}
s, t = get(f'https://dd.weather.gc.ca/today/alerts/cap/{days[-1]}/'); out['eccc']['day_listing_http'] = s
subs = sorted(set(re.findall(r'href="([A-Z0-9]+/)"', t)))[:3]; out['eccc']['wfo_dirs_sample'] = subs
caps = []
for sd in re.findall(r'href="([A-Z0-9]+/)"', t):
    if len(caps) >= 20: break
    s2, t2 = get(f'https://dd.weather.gc.ca/today/alerts/cap/{days[-1]}/{sd}')
    for hr in re.findall(r'href="(\d\d/)"', t2):
        s3, t3 = get(f'https://dd.weather.gc.ca/today/alerts/cap/{days[-1]}/{sd}{hr}')
        caps += [f'{days[-1]}/{sd}{hr}{x}' for x in re.findall(r'href="([^"]+\.cap)"', t3)]
        if len(caps) >= 20: break
out['eccc']['cap_files_found'] = len(caps)
samp = []
for c in caps[:20]:
    s4, x = get('https://dd.weather.gc.ca/today/alerts/cap/' + c)
    samp.append({'file': c, 'http': s4, 'identifier': (re.search(r'<identifier>(.*?)</identifier>', x) or [0, None])[1], 'has_description': '<description>' in x,
                 'geocodes': re.findall(r'<geocode>\s*<valueName>(.*?)</valueName>\s*<value>(.*?)</value>', x)[:2]})
out['eccc']['samples'] = samp[:20]
# ---- Linkage A: NWS active alerts <-> NCEI 2026 (declared FIPS / zone codes; place level)
same = set(); ugc_z = set()
for f in nws:
    g = f['properties']['geocode']
    same |= {x for x in g.get('SAME', [])}; ugc_z |= {x for x in g.get('UGC', []) if x[2] == 'Z'}
cnty_ncei = {r['STATE_FIPS'].zfill(2) + r['CZ_FIPS'].zfill(3) for r in ncei if r['CZ_TYPE'] == 'C'}
abbr = {x['fipsStateCode']: x['state'] for x in fema}  # state FIPS -> USPS, from FEMA rows
zone_ncei = {abbr[r['STATE_FIPS'].zfill(2)] + 'Z' + r['CZ_FIPS'].zfill(3) for r in ncei if r['CZ_TYPE'] == 'Z' and r['STATE_FIPS'].zfill(2) in abbr}
nws_cty = {x[1:] for x in same if x[1:] != '000' and not x.startswith('09')}  # 0SSCCC land counties; 09xxxx are marine SAME
out['linkA_nws_ncei'] = {'nws_distinct_county_SAME': len(nws_cty), 'matched_county_in_ncei2026': len(nws_cty & cnty_ncei),
  'nws_distinct_zone_UGC': len(ugc_z), 'matched_zone_in_ncei2026': len(ugc_z & zone_ncei),
  'event_level_overlap_note': 'NWS API keeps only active alerts (history probe returned 0); NCEI 2026 ends 2026-06-30; time-overlapping event pairs = 0'}
# ---- Linkage B: FEMA DDS <-> NCEI by county FIPS and incident window (informational; FEMA member parked)
def fd(x): return dt.datetime.strptime(x[:10], '%Y-%m-%d').date() if x else None
idx = collections.defaultdict(list)
for r in ncei:
    if r['CZ_TYPE'] == 'C':
        try: idx[r['STATE_FIPS'].zfill(2) + r['CZ_FIPS'].zfill(3)].append(dt.date(int(r['BEGIN_YEARMONTH'][:4]), int(r['BEGIN_YEARMONTH'][4:]), int(r['BEGIN_DAY'])))
        except Exception: pass
rows = [x for x in fema if x['fipsCountyCode'] != '000' and x['declarationType'] == 'DR' and fd(x['incidentBeginDate']) and fd(x['incidentBeginDate']) >= dt.date(2026, 1, 1)]
hit = 0
for x in rows:
    k = x['fipsStateCode'] + x['fipsCountyCode']; b = fd(x['incidentBeginDate']); e = fd(x['incidentEndDate']) or dt.date(2026, 6, 30)
    if any(b - dt.timedelta(days=1) <= d <= e for d in idx.get(k, [])): hit += 1
out['linkB_fema_ncei'] = {'fema_dr_county_rows_incident_2026': len(rows), 'with_ncei_county_event_in_window': hit}
fz = [x for x in fema if x['fipsCountyCode'] != '000']
out['linkB_fema_ncei']['fema_rows_county_fips_present'] = len(fz)
out['samples'] = {'fema': [{k: x[k] for k in ['femaDeclarationString','incidentType','declarationTitle','fipsStateCode','fipsCountyCode','incidentBeginDate']} for x in fema[:20]],
  'nws': [{'id': f['properties']['id'][-20:], 'event': f['properties']['event'], 'SAME': f['properties']['geocode'].get('SAME', [])[:3], 'desc_len': len(f['properties'].get('description') or '')} for f in nws[:20]],
  'ncei': [{k: r[k] for k in ['EVENT_ID','STATE_FIPS','CZ_TYPE','CZ_FIPS','EVENT_TYPE','BEGIN_YEARMONTH']} | {'narr_len': len(r['EVENT_NARRATIVE'])} for r in ncei[:20]]}
json.dump(out, open('results.json', 'w'), indent=1, default=str)
print(json.dumps({k: v for k, v in out.items() if k not in ('samples',)}, indent=1, default=str)[:6000])
