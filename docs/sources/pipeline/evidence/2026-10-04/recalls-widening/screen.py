"""Linkage screen for consumer-product-recalls-north-america widening (2026-10-04).
Inputs (all fetched keyless with the scout User-Agent, cached under /tmp/claude-0/rw by the collect scripts and curl):
  hc.json        Health Canada HCRSAMOpenData.json (15.7 MB)
  spdb/Recalls.csv   CPSC SaferProducts.gov public database export (CPSC Recall API list queries were failing, see notes)
  uk/*.json      GOV.UK content API, product_safety_alert_report_recall (uk_collect.py)
  sg/*.xml       EU Safety Gate weekly reports (sg_collect.py)
  accc.xml       ACCC RSS feed
Writes results.json next to this file."""
import csv, glob, html, json, os, random, re, collections, datetime as dt
R = '/tmp/claude-0/rw'; OUT = os.path.dirname(os.path.abspath(__file__))
random.seed(7)
csv.field_size_limit(10**9)

def strip(t): return re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', ' ', t or ''))).strip()
def gtin_ok(s):
    s = s.zfill(14)
    if len(s) != 14 or not s.isdigit(): return False
    d = [int(c) for c in s]; tot = sum(x * (3 if i % 2 == 0 else 1) for i, x in enumerate(d[:13]))
    return (10 - tot % 10) % 10 == d[13]
def gtins(text):
    out = set()
    for m in re.finditer(r'(?<![\d.])(\d{8}|\d{12,14})(?![\d])', re.sub(r'(?<=\d)[ -](?=\d)', '', text) if False else text):
        if gtin_ok(m.group(1)) and len(set(m.group(1))) > 2: out.add(m.group(1).zfill(14))
    # spaced UPC style "0 12345 67890 5" / hyphenated
    for m in re.finditer(r'(?<![\d.])(\d(?:[ -]?\d){11,13})(?![\d])', text):
        s = re.sub(r'\D', '', m.group(1))
        if len(s) in (12, 13, 14) and gtin_ok(s) and len(set(s)) > 2: out.add(s.zfill(14))
    return out
def d(s):
    for f in ('%Y-%m-%d', '%m/%d/%Y', '%d/%m/%Y'):
        try: return dt.datetime.strptime(s[:10] if f == '%Y-%m-%d' else s, f).date()
        except Exception: pass
    return None
STOP = set('recall recalled recalls product products sold due hazard hazards risk safety alert report health canada from with that this have will your their only more than the and for are was been used use can may not new set pack size model number brand black white blue green red pink grey gray small large medium kids child children baby infant adult women men'.split())
def toks(t): return {w for w in re.findall(r'[a-z0-9][a-z0-9\-]{3,}', t.lower()) if w not in STOP and not w.isdigit()}

res = {'generated': dt.date.today().isoformat()}
# ---- Health Canada ----
hc_all = json.load(open(f'{R}/../-home-user-data-foundry/0e9b1ea8-b4e0-58e7-b0e4-75b5cc8d0905/scratchpad/hc.json')) if not os.path.exists(f'{R}/hc.json') else json.load(open(f'{R}/hc.json'))
org = collections.Counter(r['Organization'] for r in hc_all)
hc = [r for r in hc_all if r['Organization'] == 'Consumer product safety']
hcr = []
for r in hc:
    txt = ' '.join(str(r.get(k) or '') for k in ('Title', 'Product', 'Issue'))
    hcr.append({'id': 'hc-' + r['NID'], 'title': strip(r['Title']), 'date': d(r['Last updated'] or ''), 'g': gtins(txt), 'toks': toks(strip(r['Title'])), 'text': strip(txt),
                'joint': re.search(r'(?i)joint recall with', r.get('What you should do') or '') is not None, 'profeco': bool(re.search(r'(?i)profeco', r.get('What you should do') or ''))})
res['hc'] = {'index_records': len(hc_all), 'by_organisation': dict(org), 'consumer_records': len(hc), 'archived_flag_1': sum(1 for r in hc if r['Archived'] == '1'),
             'last_updated_min': min(r['Last updated'] for r in hc if r['Last updated']), 'last_updated_max': max(r['Last updated'] for r in hc if r['Last updated']),
             'fields': list(hc_all[0].keys()), 'with_gtin_in_title_product_issue': sum(1 for x in hcr if x['g']), 'joint_marker': sum(1 for x in hcr if x['joint']), 'profeco_named_in_joint_text': sum(1 for x in hcr if x['profeco']),
             'consumer_categories': dict(collections.Counter(r['Category'] for r in hc).most_common(30))}
# ---- CPSC (SaferProducts export Recalls.csv: Title, Date, Summary, Repair Number = CPSC recall number) ----
rows = list(csv.reader(open(f'{R}/spdb/Recalls.csv', encoding='utf-8-sig', errors='replace')))
hdr = rows[1]; cp = [dict(zip(hdr, x)) for x in rows[2:]]
cpr = []
for r in cp:
    txt = r['Title'] + ' ' + r['Summary']
    cpr.append({'id': 'cpsc-' + r['Repair Number'], 'title': r['Title'], 'date': d(r['Date']), 'g': gtins(txt), 'toks': toks(r['Title']), 'text': txt})
res['cpsc_export'] = {'rows': len(cp), 'date_min': str(min(x['date'] for x in cpr if x['date'])), 'date_max': str(max(x['date'] for x in cpr if x['date'])), 'with_gtin_in_summary': sum(1 for x in cpr if x['g']),
                      'names_profeco': sum(1 for x in cpr if re.search(r'(?i)profeco', x['text'])), 'names_safety_gate_or_rapex': sum(1 for x in cpr if re.search(r'(?i)safety gate|rapex', x['text'])),
                      'names_opss_or_uk': sum(1 for x in cpr if re.search(r'(?i)\bOPSS\b|office for product safety', x['text'])), 'names_accc': sum(1 for x in cpr if re.search(r'\bACCC\b|Australian Competition', x['text'])),
                      'names_health_canada': sum(1 for x in cpr if re.search(r'(?i)health canada', x['text']))}
# ---- UK OPSS ----
ukr = []
for f in glob.glob(f'{R}/uk/*.json'):
    if f.endswith('uk_index.json'): continue
    j = json.load(open(f)); det = j['details']; body = det.get('body') or ''; md = det.get('metadata', {})
    txt = strip(body); title = j['title']
    psd = re.search(r'\((\d{4}-\d{4})\)', title)
    ukr.append({'id': 'uk-' + j['base_path'].rsplit('/', 1)[-1], 'title': title, 'date': d(md.get('product_recall_alert_date') or j.get('first_published_at', '')), 'type': md.get('product_alert_type'), 'g': gtins(txt), 'toks': toks(title), 'text': txt,
                'psd': psd.group(1) if psd else None, 'has_barcode_row': bool(re.search(r'<td>\s*(Barcode|GTIN|EAN|UPC)', body, re.I)), 'has_model_row': bool(re.search(r'<td>\s*(Model|Model number|Type number)', body, re.I)),
                'cites': {k: bool(re.search(p, body, re.I)) for k, p in {'cpsc': r'cpsc|consumer product safety commission|saferproducts', 'health_canada': r'health canada|recalls-rappels', 'safety_gate': r'safety gate|rapex|ec\.europa\.eu/safety-gate', 'accc': r'\baccc\b|productsafety\.gov\.au', 'profeco': r'profeco'}.items()},
                'case_nos': re.findall(r'\b[AB]\d{2}/\d{4,5}/\d{2}\b|\b(?:SR|MV|SC)/\d{5}/\d{2}\b', body)})
res['uk'] = {'collected': len(ukr), 'index_total': json.load(open(f'{R}/uk/uk_index.json'))['total'],
             'types': dict(collections.Counter(x['type'] for x in ukr)), 'date_min': str(min(x['date'] for x in ukr if x['date'])), 'date_max': str(max(x['date'] for x in ukr if x['date'])),
             'with_gtin': sum(1 for x in ukr if x['g']), 'with_barcode_row': sum(1 for x in ukr if x['has_barcode_row']), 'with_model_row': sum(1 for x in ukr if x['has_model_row']),
             'with_psd_in_title': sum(1 for x in ukr if x['psd']), 'cites': {k: sum(1 for x in ukr if x['cites'][k]) for k in ('cpsc', 'health_canada', 'safety_gate', 'accc', 'profeco')}, 'with_safety_gate_case_no': sum(1 for x in ukr if x['case_nos'])}
# ---- EU Safety Gate ----
eur = []
for f in glob.glob(f'{R}/sg/*.xml'):
    t = open(f, encoding='utf-8').read(); rd = re.search(r'<report_date>([^<]+)', t); rdt = dt.datetime.strptime(rd.group(1), '%d/%m/%Y').date() if rd else None
    for n in re.findall(r'<notifications[\s\S]*?</notifications>', t):
        g = lambda tag: (lambda m: strip(m.group(1)) if m else '')(re.search(rf'<{tag}>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?</{tag}>', n))
        txt = ' '.join(g(k) for k in ('product', 'brand', 'name', 'description', 'danger', 'measures'))
        bc = g('barcode')
        eur.append({'id': 'eu-' + g('caseNumber'), 'title': ' '.join(x for x in (g('brand'), g('name'), g('product')) if x), 'date': rdt, 'g': gtins(bc) | gtins(g('description')), 'barcode_field': bc, 'model': g('type_numberOfModel'), 'toks': toks(g('brand') + ' ' + g('name') + ' ' + g('product')), 'text': txt,
                    'url_recall': g('URLrecall'), 'company_code': g('companyRecallCode'), 'country': g('notifyingCountry'), 'category': g('category'),
                    'cites': {k: bool(re.search(p, txt + ' ' + g('URLrecall'), re.I)) for k, p in {'cpsc': r'cpsc|consumer product safety commission|saferproducts', 'health_canada': r'health canada|recalls-rappels', 'profeco': r'profeco'}.items()}})
res['eu'] = {'weekly_reports_read': len(glob.glob(f'{R}/sg/*.xml')), 'notifications': len(eur), 'date_min': str(min((x['date'] for x in eur if x['date']), default='')), 'date_max': str(max((x['date'] for x in eur if x['date']), default='')),
             'with_barcode_field': sum(1 for x in eur if x['barcode_field']), 'with_valid_gtin': sum(1 for x in eur if x['g']), 'with_model': sum(1 for x in eur if x['model']), 'with_url_recall': sum(1 for x in eur if x['url_recall']),
             'url_recall_hosts': dict(collections.Counter(re.sub(r'^https?://(www\.)?([^/]+).*', r'\2', x['url_recall']) for x in eur if x['url_recall']).most_common(15)),
             'cites': {k: sum(1 for x in eur if x['cites'][k]) for k in ('cpsc', 'health_canada', 'profeco')}}
# ---- ACCC RSS ----
ac = open(f'{R}/accc.xml', encoding='utf-8').read(); items = re.findall(r'<item>([\s\S]*?)</item>', ac)
acr = [{'id': 'accc-' + re.search(r'<guid[^>]*>([^<]*)', i).group(1)[:8], 'title': strip(re.search(r'<title>([^<]*)', i).group(1)), 'date': dt.datetime.strptime(re.search(r'<pubDate>[A-Za-z]+, (\d+ \w+ \d+)', i).group(1), '%d %b %Y').date(), 'g': gtins(strip(i)), 'text': strip(i), 'toks': toks(strip(re.search(r'<title>([^<]*)', i).group(1)))} for i in items]
res['accc'] = {'items_in_rss': len(acr), 'date_min': str(min(x['date'] for x in acr)), 'date_max': str(max(x['date'] for x in acr)), 'with_valid_gtin': sum(1 for x in acr if x['g']),
               'names_cpsc_or_health_canada': sum(1 for x in acr if re.search(r'(?i)cpsc|health canada|consumer product safety', x['text']))}

# ---- linkage ----
na = {'HC': hcr, 'CPSC': cpr}
def gtin_join(a, b, window=365):
    idx = collections.defaultdict(list)
    for x in b:
        for g in x['g']: idx[g].append(x)
    pairs = []
    for x in a:
        for g in x['g']:
            for y in idx.get(g, []):
                if x['date'] and y['date'] and abs((x['date'] - y['date']).days) <= window: pairs.append((x['id'], y['id'], g, str(x['date']), str(y['date'])))
    return pairs
links = {}
for nm, A in (('uk', ukr), ('eu', eur), ('accc', acr)):
    for ag, B in na.items():
        p = gtin_join(A, B)
        p_nowin = gtin_join(A, B, 10**6)
        links[f'{nm}_to_{ag.lower()}_gtin'] = {'pairs_365d': len(p), 'distinct_source_notices': len({x[0] for x in p}), 'pairs_any_date': len(p_nowin), 'sample': p[:6]}
# NA internal GTIN reference point
p = gtin_join(hcr, cpr, 365); links['hc_to_cpsc_gtin_reference'] = {'pairs_365d': len(p), 'distinct_hc': len({x[0] for x in p}), 'sample': p[:4]}
# candidate: shared >=2 distinctive title tokens, dates within 90 days
def cand_join(A, B, win=90, k=2):
    out = []
    for x in A:
        if not x['date']: continue
        best = None
        for y in B:
            if not y['date'] or abs((x['date'] - y['date']).days) > win: continue
            c = x['toks'] & y['toks']
            if len(c) >= k and (best is None or len(c) > len(best[1])): best = (y, c)
        if best: out.append((x, best[0], sorted(best[1])))
    return out
cands = {}
for nm, A in (('uk', ukr), ('eu', eur), ('accc', acr)):
    for ag, B in na.items():
        c = cand_join(A, B)
        cands[f'{nm}_to_{ag.lower()}'] = c
        links[f'{nm}_to_{ag.lower()}_title_tokens_90d'] = {'matched': len(c), 'of': len(A), 'sample_for_hand_check': [(a['id'], a['title'][:80], b['id'], b['title'][:80], t, str(a['date']), str(b['date'])) for a, b, t in random.sample(c, min(20, len(c)))]}
res['links'] = links
json.dump(res, open(f'{OUT}/results.json', 'w'), indent=1, default=str)
print(json.dumps({k: v for k, v in res.items() if k != 'links'}, indent=1, default=str)[:6000])
for k, v in links.items(): print(k, {a: b for a, b in v.items() if a != 'sample_for_hand_check'})
