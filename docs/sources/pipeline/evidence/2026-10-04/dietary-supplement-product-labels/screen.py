#!/usr/bin/env python3
"""Screen dietary-supplement label members (2026-10-04). Polite (<=2 req/s), no keys.
Writes results.json next to this script. Work dir for large downloads: /tmp/dsp (not committed)."""
import json, re, time, html, gzip, os, sys, urllib.request, urllib.parse, collections, random

UA = {'User-Agent': 'data-foundry-scout (data@mail.proviciency.com)', 'Accept-Encoding': 'gzip'}
OUT = os.path.dirname(os.path.abspath(__file__))
W = '/tmp/dsp'; os.makedirs(W, exist_ok=True)
R = {}


def get(url, timeout=60, raw=False):
    time.sleep(0.6)
    req = urllib.request.Request(url, headers=UA)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            b = r.read()
            if r.headers.get('Content-Encoding') == 'gzip':
                b = gzip.decompress(b)
            return r.status, b if raw else b.decode('utf8', 'replace')
    except urllib.error.HTTPError as e:
        return e.code, ''
    except Exception as e:  # noqa
        return 0, str(e)


def gtin_ok(code):
    d = re.sub(r'\D', '', code or '')
    if len(d) not in (8, 12, 13, 14):
        return False
    s = sum(int(x) * (3 if i % 2 == 0 else 1) for i, x in enumerate(reversed(d[:-1])))
    return (10 - s % 10) % 10 == int(d[-1])


def gtin13(code):
    d = re.sub(r'\D', '', code or '')
    return d.zfill(13) if len(d) in (8, 12, 13) else d


# ---------------- DSLD ----------------
A = 'https://api.ods.od.nih.gov/dsld/v9'
dsld = {}
st, b = get(A + '/search-filter?q=*&size=1&sort_by=entryDate&sort_order=desc')
j = json.loads(b)
dsld['reach_status'] = st
dsld['total_labels'] = j['stats']['count']
dsld['newest_entryDate'] = j['hits'][0]['_source']['entryDate']
st, b = get('https://api.ods.od.nih.gov/dsld/version')
dsld['version'] = json.loads(b) if st == 200 and b.startswith('{') else {'status': st}
# labels with off-market vs on-market
for off in (0, 1):
    pass
# sample 60 labels spread over id space (ids are dense integers up to ~ 330k)
random.seed(7)
ids = sorted(random.sample(range(1000, 328000), 70))
labels = []
for i in ids:
    st, b = get(f'{A}/label/{i}')
    if st == 200:
        try:
            labels.append(json.loads(b))
        except Exception:
            pass
    if len(labels) >= 60:
        break
dsld['sample_n'] = len(labels)
dsld['sample_ids'] = [l['id'] for l in labels]
valid_upc = [l for l in labels if gtin_ok(l.get('upcSku'))]
dsld['upc_present'] = sum(1 for l in labels if (l.get('upcSku') or '').strip())
dsld['upc_checkdigit_valid'] = len(valid_upc)
dsld['claims_nonempty'] = sum(1 for l in labels if l.get('claims'))
dsld['statements_nonempty'] = sum(1 for l in labels if l.get('statements'))
dsld['ingredient_rows_nonempty'] = sum(1 for l in labels if l.get('ingredientRows'))
rows = [r for l in labels for r in l.get('ingredientRows', [])]
dsld['ingredient_rows_total'] = len(rows)
dsld['ingredient_rows_with_unii'] = sum(1 for r in rows if r.get('uniiCode') and r['uniiCode'] not in ('', 'NA'))
dsld['entry_year_counts'] = dict(collections.Counter((l.get('entryDate') or '')[:4] for l in labels))
dsld['offMarket_counts'] = dict(collections.Counter(l.get('offMarket') for l in labels))
dsld['statement_types_top'] = collections.Counter(s['type'] for l in labels for s in l.get('statements', [])).most_common(8)
dsld['sample_trim'] = [{'id': l['id'], 'fullName': l['fullName'], 'brandName': l['brandName'], 'upcSku': l.get('upcSku'),
                        'entryDate': l.get('entryDate'), 'n_ingredients': len(l.get('ingredientRows', []))} for l in labels[:25]]
R['dsld'] = dsld

# NPN mentions inside DSLD label text (declared cross-link to Health Canada)
npn_hits = []
st, b = get(A + '/search-filter?' + urllib.parse.urlencode({'q': 'NPN', 'size': 1}))
dsld['q_NPN_total'] = json.loads(b)['stats']['count']
st, b = get(A + '/search-filter?' + urllib.parse.urlencode({'q': 'NPN', 'size': 200}))
npn_ids = [h['_id'] for h in json.loads(b)['hits']]
npn_labels = []
for i in npn_ids[:120]:
    st, bb = get(f'{A}/label/{i}')
    if st == 200:
        npn_labels.append(json.loads(bb))
NPN_RE = re.compile(r'(?i)(?:NPN|Natural Product Number)[^0-9]{0,12}(\d{8})')
npn_found = []
for l in npn_labels:
    txt = json.dumps(l)
    for m in NPN_RE.finditer(txt):
        npn_found.append((l['id'], m.group(1)))
R['dsld_npn'] = {'labels_fetched': len(npn_labels), 'labels_with_8digit_npn': len({i for i, _ in npn_found}), 'pairs': npn_found[:60]}

# ---------------- LNHPD ----------------
H = 'https://health-products.canada.ca/api/natural-licences'
pl_path = f'{W}/pl.json'
if not os.path.exists(pl_path):
    st, b = get(H + '/productlicence/?lang=en&type=json', timeout=200, raw=True)  # ~15 MB gzip transfer, ~148 MB json
    open(pl_path, 'wb').write(b)
pl = json.load(open(pl_path))
lic = {r['licence_number'] for r in pl}
lh = {'rows': len(pl), 'distinct_licences': len(lic), 'distinct_lnhpd_ids': len({r['lnhpd_id'] for r in pl}),
      'newest_licence_date': max(r['licence_date'] for r in pl if r['licence_date']),
      'newest_revised_date': max(r['revised_date'] for r in pl if r['revised_date']),
      'revised_since_2026_09_01': sum(1 for r in pl if r['revised_date'] and r['revised_date'] >= '2026-09-01'),
      'licensed_2026': len({r['licence_number'] for r in pl if r['licence_date'] and r['licence_date'] >= '2026-01-01'}),
      'fields': sorted(pl[0].keys()),
      'status_flag_counts': dict(collections.Counter(r['flag_product_status'] for r in pl)),
      'submission_types': collections.Counter(r['sub_submission_type_desc'] for r in pl).most_common(6)}
st, b = get(H + '/medicinalingredient/?lang=en&type=json')
mi = json.loads(b)
lh['medicinalingredient_total'] = mi['metadata']['pagination']['total']
lh['medicinalingredient_fields'] = sorted(mi['data'][0].keys())
st, b = get(H + '/productpurpose/?lang=en&type=json')
pp = json.loads(b); lh['productpurpose_total'] = pp['metadata']['pagination']['total']
lh['purpose_sample'] = [x['purpose'][:160] for x in pp['data'][:3]]
st, b = get(H + '/productrisk/?lang=en&type=json')
pr = json.loads(b); lh['productrisk_total'] = pr['metadata']['pagination']['total']
lh['risk_fields'] = sorted(pr['data'][0].keys())
lh['has_upc_field'] = any('upc' in k.lower() or 'gtin' in k.lower() for k in pl[0])
lh['sample_trim'] = [{k: r[k] for k in ('lnhpd_id', 'licence_number', 'licence_date', 'product_name', 'dosage_form', 'company_name')} for r in pl[-25:]]
R['lnhpd'] = lh

# DSLD NPN -> LNHPD licence_number (declared join)
matched = [(i, n) for i, n in npn_found if n in lic]
R['join_dsld_lnhpd_npn'] = {'dsld_labels_with_npn': len({i for i, _ in npn_found}), 'distinct_npn_pairs': len(set(npn_found)),
                            'npn_present_in_lnhpd': len({n for _, n in npn_found if n in lic}),
                            'labels_matched': len({i for i, n in matched}), 'matched_pairs': sorted(set(matched))[:30]}

# ---------------- Open Food Facts ----------------
off = {}
st, b = get('https://world.openfoodfacts.org/api/v2/search?categories_tags_en=dietary-supplements&page_size=1&fields=code')
off['reach_status'] = st; off['dietary_supplements_category_count'] = json.loads(b)['count'] if st == 200 else None
st, b = get('https://world.openfoodfacts.org/api/v2/search?categories_tags_en=dietary-supplements&page_size=1&sort_by=last_modified_t&fields=code,last_modified_t')
if st == 200:
    off['newest_last_modified_t'] = json.loads(b)['products'][0]['last_modified_t']
look = {'checked': 0, 'found': 0, 'found_with_supplement_category': 0, 'pairs': []}
for l in valid_upc[:40]:
    code = gtin13(l['upcSku'])
    st, b = get(f'https://world.openfoodfacts.org/api/v2/product/{code}.json?fields=code,product_name,brands,categories_tags,ingredients_text')
    look['checked'] += 1
    if st == 200:
        p = json.loads(b)
        if p.get('status') == 1:
            look['found'] += 1
            pr_ = p['product']
            sup = any('supplement' in c for c in pr_.get('categories_tags', []))
            look['found_with_supplement_category'] += sup
            look['pairs'].append({'dsld_id': l['id'], 'dsld_name': l['fullName'], 'dsld_brand': l['brandName'], 'gtin13': code,
                                  'off_name': pr_.get('product_name'), 'off_brands': pr_.get('brands'), 'off_has_ingredients_text': bool(pr_.get('ingredients_text')), 'off_supplement_category': sup})
off['lookup_by_gtin'] = look
R['off'] = off

# ---------------- FDA Health Fraud Product Database (tainted supplements) ----------------
st, b = get('https://www.fda.gov/consumers/health-fraud-scams/health-fraud-product-database', timeout=90)
rows = re.findall(r'<tr.*?</tr>', b, flags=re.S)
tab = []
for r in rows[1:]:
    c = [re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', '', x))).strip() for x in re.findall(r'<td[^>]*>(.*?)</td>', r, flags=re.S)]
    m = re.search(r'href="([^"]+)"', r)
    if len(c) >= 8:
        tab.append({'date': c[0], 'product': c[1], 'firm': c[2], 'source': c[4], 'subject': c[5], 'action': c[6], 'area': c[7], 'url': m.group(1) if m else None})
fd = {'reach_status': st, 'rows': len(tab),
      'newest': max((datetime for datetime in (x['date'][6:] + x['date'][:2] + x['date'][3:5] for x in tab)), default=None),
      'actions': collections.Counter(x['action'] for x in tab).most_common(), 'areas': collections.Counter(x['area'] for x in tab).most_common(),
      'undeclared_rows': sum(1 for x in tab if x['subject'].lower().startswith('undeclared')),
      'content_current': (re.search(r'Content current as of:\s*([\d/]+)', b) or [None, None])[1]}
fd['sample_trim'] = tab[:25]
R['fda_hfpd'] = fd
json.dump(tab, open(f'{W}/hfpd.json', 'w'))

# Public notification page text sample
pn = [x for x in tab if x['action'] == 'Public Notification' and x['url']][:5]
fd['public_notification_sample'] = []
for x in pn:
    st, b = get(x['url'])
    t = re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', ' ', re.sub(r'<(script|style)[^>]*>.*?</\1>', '', b, flags=re.S))))
    i = t.find('FDA')
    fd['public_notification_sample'].append({'url': x['url'], 'status': st, 'chars': len(t), 'excerpt': t[i:i + 300]})

# ---------------- candidate link: FDA HFPD product <-> DSLD (name only) ----------------
cand = {'checked': 0, 'dsld_exact_fullname_or_brand_hits': [], 'queries': []}
tainted = [x for x in tab if x['area'] in ('Drugs',) and x['action'] == 'Public Notification']
random.seed(11)
for x in random.sample(tainted, min(40, len(tainted))):
    name = x['product']
    st, b = get(A + '/search-filter?' + urllib.parse.urlencode({'q': f'"{name}"', 'size': 5}))
    cand['checked'] += 1
    if st != 200:
        continue
    for h in json.loads(b)['hits']:
        s = h['_source']
        if re.sub(r'\W', '', s['fullName'].lower()) == re.sub(r'\W', '', name.lower()):
            cand['dsld_exact_fullname_or_brand_hits'].append({'hfpd_product': name, 'hfpd_date': x['date'], 'hfpd_subject': x['subject'],
                                                              'dsld_id': h['_id'], 'dsld_fullName': s['fullName'], 'dsld_brand': s['brandName']})
R['join_hfpd_dsld_name'] = cand

json.dump(R, open(os.path.join(OUT, 'results.json'), 'w'), indent=1, default=str)
print('done')
