"""Widening screen for consumer-product-recalls-north-america (2026-11-14).

Measures, live and keyless:
  1. Health Canada open-data index: notices per Organization; Transport Canada (Organization == 'TC') notices, their
     categories (child car seats, tires, equipment) and the VRDB recall number in their titles.
  2. CPSC Recall API full list (RecallDate windows, split on the HTTP-200 error body): every Inconjunctions[].URL,
     classified by host. recalls-rappels.canada.ca URLs are canonicalised (as packages/product-recall-structuring
     links.ts does) and resolved against the index; the Organization of the resolved notice is recorded.
     Transport Canada VRDB URLs (wwwapps.tc.gc.ca ... rn=NNNNNNN) are resolved against the TC notices in the index by
     recall number and, for each distinct number, against the TC VRDB API (data.tc.gc.ca).
  3. Consumer-type notices outside the 'Consumer product safety' Organization (capture check), and how many CPSC
     citations land on them.
  4. NHTSA: CPSC records whose text or citations mention NHTSA or carry a campaign-number-shaped token, each token
     checked against api.nhtsa.gov/recalls/campaignNumber.
  5. Reachability of EU Safety Gate, USDA FSIS and NZ productsafety.govt.nz endpoints.

Raw downloads are cached in a scratch directory passed as argv[1] (never in the repo). Output JSON (identifiers only)
goes to argv[2]. Usage: python3 -I widen_measure.py <cache_dir> <out.json>
"""
import collections, datetime as dt, json, os, re, sys, time, urllib.error, urllib.parse, urllib.request

UA = 'data-foundry-scout/1.0 (data@mail.proviciency.com)'
CACHE, OUT = sys.argv[1], sys.argv[2]
HC_URL = 'https://recalls-rappels.canada.ca/sites/default/files/opendata-donneesouvertes/HCRSAMOpenData.json'
CPSC = 'https://www.saferproducts.gov/RestWebServices/Recall?format=json'
os.makedirs(CACHE, exist_ok=True)


def get(url, timeout=120, method='GET'):
    req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept': '*/*'}, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read(), r.geturl()
    except urllib.error.HTTPError as e:
        return e.code, e.read()[:2000], url
    except Exception as e:  # network / proxy failure
        return None, str(e).encode()[:300], url


def cached(name, fetch):
    path = os.path.join(CACHE, name)
    if os.path.exists(path):
        return json.load(open(path))
    data = fetch()
    json.dump(data, open(path, 'w'))
    return data


# ---------- 1. Health Canada index ----------
def fetch_hc():
    status, body, _ = get(HC_URL, 300)
    assert status == 200, status
    return json.loads(body)

hc = cached('hc.json', fetch_hc)
orgs = collections.Counter(r.get('Organization') for r in hc)


def canon_hc(url):
    m = re.match(r'^(?:https?://)?(?:www\.)?recalls-rappels\.canada\.ca/(en/alert-recall|fr/avis-rappel)/([^?#\s]+?)/?(?:[?#].*)?$', url.strip(), re.I)
    return f'https://recalls-rappels.canada.ca/{m.group(1).lower()}/{m.group(2).lower()}' if m else None

by_url = {}
for r in hc:
    k = canon_hc(r.get('URL') or '')
    if k:
        by_url[k] = r
tc = [r for r in hc if r.get('Organization') == 'TC']
tc_by_rn = {}
for r in tc:
    m = re.search(r'Recall\s*-\s*(\d{7})\b', r.get('Title') or '')
    if m:
        tc_by_rn.setdefault(m.group(1), r)
tc_cats = collections.Counter()
for r in tc:
    for part in (r.get('Category') or '').split(' - '):
        tc_cats[part.strip()] += 1
tc_dates = sorted(r.get('Last updated') or '' for r in tc if r.get('Last updated'))

CONSUMER_PARTS = {'Household items', 'Toys and games', 'Sports and fitness', 'Clothing and accessories', 'Chemicals', 'Electronics',
                  'Tools and accessories', 'Beauty and personal care', 'Outdoor living', 'Jewellery', 'Clothing', 'Appliances',
                  'Furniture and furnishings', 'Consumer products', 'Hobby and craft items', 'Vaping and tobacco products', 'Specialized products'}
outside = collections.defaultdict(list)  # org -> NIDs whose Category has any consumer-type part
outside_only = collections.defaultdict(list)  # every part consumer-type
for r in hc:
    if r.get('Organization') == 'Consumer product safety':
        continue
    parts = [p.strip() for p in (r.get('Category') or '').split(' - ') if p.strip()]
    if any(p in CONSUMER_PARTS for p in parts):
        outside[r['Organization']].append(r['NID'])
        if all(p in CONSUMER_PARTS for p in parts):
            outside_only[r['Organization']].append(r['NID'])

# ---------- 2. CPSC full list ----------
def fetch_cpsc():
    out, fails = {}, []

    def window(s, e):
        for _ in range(3):
            status, body, _ = get(f'{CPSC}&RecallDateStart={s}&RecallDateEnd={e}', 180)
            time.sleep(0.6)
            try:
                j = json.loads(body)
            except Exception:
                j = None
            if status == 200 and isinstance(j, list) and not (j and j[0].get('RecallID') == 0 and not j[0].get('RecallNumber')):
                return j
            fails.append([s, e, status])
            time.sleep(2)
        return None

    def win(s, e):
        j = window(s, e)
        if j is not None:
            for r in j:
                if r.get('RecallNumber'):
                    out[r['RecallNumber']] = r
            return
        a, b = dt.date.fromisoformat(s), dt.date.fromisoformat(e)
        if (b - a).days < 20:
            fails.append([s, e, 'gave up'])
            return
        m = a + (b - a) / 2
        win(s, str(m)); win(str(m + dt.timedelta(days=1)), e)

    for s, e in [('1900-01-01', '1989-12-31'), ('1990-01-01', '1999-12-31')] + [(f'{y}-01-01', f'{y}-12-31') for y in range(2000, 2027)]:
        win(s, e)
    return {'records': list(out.values()), 'fails': fails}

cp = cached('cpsc.json', fetch_cpsc)
cpsc = cp['records']
cpsc_title = {r['RecallNumber']: r.get('Title') for r in cpsc}
cpsc_dates = sorted((r.get('RecallDate') or '')[:10] for r in cpsc if r.get('RecallDate'))

host_counts = collections.Counter()
rr_cites = []          # (recall, canonical url, resolved org or None)
vrdb_cites = []        # (recall, rn)
tc_other = []          # TC-host URLs without rn
nhtsa_hits = []
CAMPAIGN = re.compile(r'\b(\d{2})\s?-?([VEICT])\s?-?(\d{3})(?:\s?-?(\d{3}))?\b')
for r in cpsc:
    rn = r['RecallNumber']
    for c in r.get('Inconjunctions') or []:
        url = (c.get('URL') or '').strip()
        if not url:
            continue
        host = urllib.parse.urlsplit(url if '://' in url else 'https://' + url).hostname or ''
        host_counts[host.lower()] += 1
        k = canon_hc(url)
        if k:
            hit = by_url.get(k)
            rr_cites.append((rn, k, hit.get('Organization') if hit else None, hit.get('NID') if hit else None))
        elif re.search(r'tc\.gc\.ca|tc\.canada\.ca', url, re.I):
            m = re.search(r'[?&]rn=(\d{7})', url, re.I)
            (vrdb_cites.append((rn, m.group(1))) if m else tc_other.append((rn, url)))
        if re.search(r'nhtsa', url, re.I):
            nhtsa_hits.append((rn, 'url', url))
    text = ' '.join(str(r.get(f) or '') for f in ('Description', 'Title', 'ConsumerContact'))
    text += ' ' + ' '.join(str(x.get('Name') or '') for x in (r.get('Remedies') or []) + (r.get('Hazards') or []))
    if re.search(r'NHTSA|National Highway Traffic Safety', text):
        nhtsa_hits.append((rn, 'text', sorted({''.join(g for g in m.groups()[:3]) for m in CAMPAIGN.finditer(text)})))

rr_by_org = collections.Counter(o or 'NOT_IN_INDEX' for _, _, o, _ in rr_cites)
rr_recalls_by_org = collections.defaultdict(set)
for rn, _, o, _ in rr_cites:
    rr_recalls_by_org[o or 'NOT_IN_INDEX'].add(rn)
tc_notice_cites = sorted({(rn, nid) for rn, _, o, nid in rr_cites if o == 'TC'})
outside_nids = {n for v in outside.values() for n in v}
cites_on_outside = sorted({(rn, nid, o) for rn, _, o, nid in rr_cites if nid in outside_nids})

vrdb_recalls = sorted({rn for rn, _ in vrdb_cites})
vrdb_rns = sorted({n for _, n in vrdb_cites})
vrdb_in_index = sorted(n for n in vrdb_rns if n in tc_by_rn)
vrdb_recalls_in_index = sorted({rn for rn, n in vrdb_cites if n in tc_by_rn})

# VRDB API check, one request per distinct recall number (small).
def fetch_vrdb():
    res = {}
    for n in vrdb_rns:
        status, body, _ = get(f'https://data.tc.gc.ca/v1.3/api/eng/vehicle-recall-database/recall-summary/recall-number/{n}', 60)
        cat = maker = None
        try:
            rows = json.loads(body).get('ResultSet') or []
            if rows:
                cat = next((f['Value']['Literal'] for f in rows[0] if f['Name'] == 'CATEGORY_ETXT'), None)
                maker = next((f['Value']['Literal'] for f in rows[0] if f['Name'] == 'MAKE_NAME_NM'), None)
        except Exception:
            rows = []
        res[n] = {'status': status, 'rows': len(rows), 'category': cat, 'make': maker}
        time.sleep(0.4)
    return res

vrdb_api = cached('vrdb_api.json', fetch_vrdb)
vrdb_api_found = sorted(n for n, v in vrdb_api.items() if v['rows'] > 0)
vrdb_recalls_api = sorted({rn for rn, n in vrdb_cites if n in vrdb_api_found})
vrdb_api_cats = collections.Counter(v['category'] for v in vrdb_api.values() if v['rows'])

# NHTSA campaign tokens
tokens = sorted({t for _, kind, v in nhtsa_hits if kind == 'text' for t in v})
def fetch_nhtsa():
    res = {}
    for t in tokens[:40]:
        q = t + '000'
        status, body, _ = get(f'https://api.nhtsa.gov/recalls/campaignNumber?campaignNumber={q}', 60)
        try:
            cnt = json.loads(body).get('Count')
        except Exception:
            cnt = None
        res[t] = {'status': status, 'count': cnt}
        time.sleep(0.5)
    return res
nhtsa_api = cached('nhtsa_api.json', fetch_nhtsa)
nhtsa_text_recalls = sorted({rn for rn, kind, _ in nhtsa_hits if kind == 'text'})
nhtsa_url_recalls = sorted({rn for rn, kind, _ in nhtsa_hits if kind == 'url'})
nhtsa_token_recalls = sorted({rn for rn, kind, v in nhtsa_hits if kind == 'text' and v})
nhtsa_resolved = sorted({rn for rn, kind, v in nhtsa_hits if kind == 'text' and any((nhtsa_api.get(t) or {}).get('count') for t in v)})

# ---------- 5. reachability ----------
probes = [
    'https://ec.europa.eu/safety-gate-alerts/screen/webReport',
    'https://ec.europa.eu/safety-gate-alerts/public/api/notification/carousel/?language=en',
    'https://ec.europa.eu/safety-gate-alerts/public/api/weeklyReport/list?language=en',
    'https://ec.europa.eu/safety-gate-alerts/public/api/notification/search?language=en&page=0&size=1',
    'https://www.fsis.usda.gov/fsis/api/recall/v/1',
    'https://www.fsis.usda.gov/recalls',
    'https://www.productsafety.govt.nz/recalls',
    'https://www.productsafety.govt.nz/',
    'https://api.nhtsa.gov/recalls/campaignNumber?campaignNumber=24V001000',
]
reach = {}
for u in probes:
    status, body, final = get(u, 40)
    reach[u] = {'status': status, 'bytes': len(body or b''), 'final_url': final if final != u else None,
                'head': (body or b'')[:120].decode('utf-8', 'replace') if status != 200 else None}
    time.sleep(0.5)

result = {
    'measured_at': dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds'),
    'hc_index': {'url': HC_URL, 'records': len(hc), 'by_organization': dict(orgs.most_common()),
                 'tc_notices': len(tc), 'tc_with_vrdb_number_in_title': len(tc_by_rn),
                 'tc_last_updated_range': [tc_dates[0], tc_dates[-1]] if tc_dates else None,
                 'tc_category_parts': dict(tc_cats.most_common()),
                 'consumer_type_outside_cps_any_part': {k: len(v) for k, v in outside.items()},
                 'consumer_type_outside_cps_all_parts': {k: len(v) for k, v in outside_only.items()},
                 'consumer_type_outside_cps_sample_nids': {k: v[:15] for k, v in outside_only.items()}},
    'cpsc': {'records': len(cpsc), 'recall_date_range': [cpsc_dates[0], cpsc_dates[-1]] if cpsc_dates else None,
             'failed_window_attempts': cp['fails'], 'inconjunction_hosts': dict(host_counts.most_common(25)),
             'recalls_rappels_citations': len(rr_cites), 'recalls_rappels_citations_by_resolved_org': dict(rr_by_org),
             'recalls_rappels_recalls_by_resolved_org': {k: len(v) for k, v in rr_recalls_by_org.items()},
             'cpsc_citing_tc_notice_in_index': [{'cpsc': a, 'hc_nid': b} for a, b in tc_notice_cites],
             'cpsc_citing_consumer_type_notice_outside_cps': [{'cpsc': a, 'hc_nid': b, 'org': c} for a, b, c in cites_on_outside],
             'vrdb_citations': len(vrdb_cites), 'vrdb_citing_recalls': len(vrdb_recalls), 'vrdb_distinct_numbers': len(vrdb_rns),
             'vrdb_numbers_with_tc_notice_in_hc_index': len(vrdb_in_index), 'vrdb_recalls_resolving_in_hc_index': len(vrdb_recalls_in_index),
             'vrdb_numbers_found_by_tc_api': len(vrdb_api_found), 'vrdb_recalls_resolving_by_tc_api': len(vrdb_recalls_api),
             'vrdb_api_categories': dict(vrdb_api_cats),
             'vrdb_pairs': [{'cpsc': a, 'tc_recall_number': b, 'in_hc_index': b in tc_by_rn, 'hc_nid': (tc_by_rn.get(b) or {}).get('NID'),
                             'tc_api_rows': (vrdb_api.get(b) or {}).get('rows'), 'tc_api_category': (vrdb_api.get(b) or {}).get('category'),
                             'tc_api_make': (vrdb_api.get(b) or {}).get('make'), 'cpsc_title': cpsc_title.get(a)} for a, b in sorted(set(vrdb_cites))],
             'tc_notice_citations_detail': [{'cpsc': a, 'hc_nid': b, 'hc_title': next((r.get('Title') for r in tc if r.get('NID') == b), None), 'cpsc_title': cpsc_title.get(a)} for a, b in tc_notice_cites],
             'tc_host_urls_without_rn': len(tc_other)},
    'nhtsa': {'cpsc_recalls_citing_nhtsa_url': nhtsa_url_recalls, 'cpsc_recalls_naming_nhtsa_in_text': len(nhtsa_text_recalls),
              'cpsc_recalls_with_campaign_token': nhtsa_token_recalls, 'campaign_token_api': nhtsa_api,
              'cpsc_recalls_with_token_resolving': nhtsa_resolved},
    'reachability': reach,
}
json.dump(result, open(OUT, 'w'), indent=1)
print(json.dumps({k: v for k, v in result['cpsc'].items() if k not in ('vrdb_pairs', 'cpsc_citing_tc_notice_in_index', 'cpsc_citing_consumer_type_notice_outside_cps')}, indent=1))
print(json.dumps(result['hc_index'], indent=1)[:3000])
print(json.dumps(result['nhtsa'], indent=1)[:2000])
print(json.dumps(reach, indent=1))
