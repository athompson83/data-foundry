"""UK OPSS product safety alerts, reports and recalls (GOV.UK): size, newest date, fields, and whether notices cite barcodes/models/CPSC,
and how many carry a check-digit-valid GTIN equal to one extracted from CPSC recall notices (2015->) or Health Canada.
Run from the repo root (after safety-gate-gtin.py has cached the CPSC/HC payloads in RAW): python3 -I docs/sources/pipeline/evidence/2026-10-17/recalls-widening/opss.py
Open GOV.UK Search + Content APIs, declared UA, 2 req/s. GTIN rule = the repo's TypeScript via gtin-extract.ts (digitCodes+gtinReadings+parseCodes)."""
import re, json, os, subprocess, time, html, collections
UA = 'data-foundry-scout/1.0 (data@mail.proviciency.com)'
HERE = os.path.dirname(os.path.abspath(__file__)); RAW = os.environ.get('RAW', '/tmp/recalls-widening-raw'); os.makedirs(RAW + '/opss', exist_ok=True)
def get(u, cache):
    p = os.path.join(RAW, cache)
    if os.path.exists(p) and os.path.getsize(p) > 0: return open(p, encoding='utf-8').read()
    for attempt in range(3):
        r = subprocess.run(['curl', '-g', '-sS', '-L', '-m', '60', '-A', UA, '-w', '\n%{http_code}', u], capture_output=True)
        body, _, code = r.stdout.decode('utf-8', 'replace').rpartition('\n'); time.sleep(0.5)
        if code == '200': open(p, 'w', encoding='utf-8').write(body); return body
        if code not in ('429', '500', '502', '503', '504', '000'): return None
        time.sleep(3)
    return None
BASE = 'https://www.gov.uk/api/search.json?filter_format=product_safety_alert_report_recall&order=-public_timestamp&count=100'
first = json.loads(get(BASE + '&start=0', 'opss/search-0.json')); total = first['total']; items = list(first['results'])
for s in range(100, total, 100): items += json.loads(get(f'{BASE}&start={s}', f'opss/search-{s}.json'))['results']
search_fields = sorted({k for i in items for k in i})
dates = sorted(i['public_timestamp'] for i in items)
def text(h): return re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', ' ', h))).strip()
def tables(body):
    """label->value from 2-col tables and header-named columns from multi-col tables."""
    out = collections.defaultdict(list)
    for tb in re.findall(r'<table.*?</table>', body, re.S):
        heads = [text(h) for h in re.findall(r'<th[^>]*>(.*?)</th>', tb, re.S)]
        rows = [[text(c) for c in re.findall(r'<t[dh][^>]*>(.*?)</t[dh]>', r, re.S)] for r in re.findall(r'<tr[^>]*>(.*?)</tr>', tb, re.S)]
        body_rows = [r for r in rows if r and r != heads]
        if heads and len(heads) >= 2 and rows and rows[0] == heads:
            for r in body_rows:
                for h, c in zip(heads, r): out[h].append(c)
        else:
            for r in rows:
                if len(r) >= 2: out[r[0]].append(' '.join(r[1:]))
    return out
recs = []
for n, i in enumerate(items):
    slug = i['link'].rsplit('/', 1)[-1]
    raw = get('https://www.gov.uk/api/content' + i['link'], f'opss/c-{slug[:150]}.json')
    if raw is None: recs.append({'link': i['link'], 'fetch_failed': True}); continue
    c = json.loads(raw); d = c.get('details', {}); body = d.get('body', '') or ''
    tb = tables(body)
    md = d.get('metadata', {})
    recs.append({'link': i['link'], 'title': i['title'], 'public_timestamp': i['public_timestamp'], 'alert_type': md.get('alert_type'), 'product_category': md.get('product_category'),
                 'country_of_origin': md.get('country_of_origin'), 'hazard': md.get('hazard'), 'product_alert_type': md.get('product_alert_type'),
                 'metadata_keys': sorted(md), 'detail_keys': sorted(d), 'table_labels': sorted(tb), 'text': text(body)[:6000],
                 'barcode_cells': [v for k, vs in tb.items() if re.search(r'barcode|\bean\b|\bupc\b|gtin', k, re.I) for v in vs],
                 'model_cells': [v for k, vs in tb.items() if re.search(r'model|type number|part number', k, re.I) for v in vs],
                 'attachments': [a.get('url') for a in d.get('attachments', [])]})
ok = [r for r in recs if not r.get('fetch_failed')]
inp = os.path.join(RAW, 'opss-in.json'); outp = os.path.join(RAW, 'opss-out.json')
json.dump({'texts': [{'id': r['link'], 'text': ' ; '.join(r['barcode_cells']) + '\n' + r['text']} for r in ok]}, open(inp, 'w'))
root = os.path.abspath(os.path.join(HERE, *['..'] * 6))
subprocess.run(['npx', 'tsx', os.path.join(HERE, 'gtin-extract.ts'), inp, outp], check=True, cwd=root)
gt = {t['id']: t['gtins'] for t in json.load(open(outp))['texts']}
ex = json.load(open(os.path.join(RAW, 'extract-out.json')))   # CPSC + HC extraction from safety-gate-gtin.py
cp = {}; hci = {}
for r in ex['cpsc']:
    for g in r['gtins']: cp.setdefault(g, []).append(r['id'])
for r in ex['hc']:
    for g in r['text_gtins']: hci.setdefault(g, []).append(r['id'])
for r in ok:
    r['gtins'] = gt[r['link']]; r['cpsc_matches'] = sorted({x for g in r['gtins'] for x in cp.get(g, [])}); r['hc_matches'] = sorted({x for g in r['gtins'] for x in hci.get(g, [])})
cite = re.compile(r'cpsc|saferproducts|consumer product safety commission|recalls-rappels|health canada|healthycanadians|safety gate|rapex|accc|productsafety\.gov\.au', re.I)
cites = collections.Counter(m.lower() for r in ok for m in set(cite.findall(r['text'])))
with_g = [r for r in ok if r['gtins']]
cpsc_models = {m for r in ex['cpsc'] for m in r['models']}
out = {'run_date': time.strftime('%Y-%m-%d'), 'search_total': total, 'listed': len(items), 'newest': dates[-1], 'oldest': dates[0], 'search_result_fields': search_fields,
       'content_fetched': len(ok), 'content_failed': len(recs) - len(ok), 'content_detail_keys': sorted({k for r in ok for k in r['detail_keys']}), 'metadata_keys': sorted({k for r in ok for k in r['metadata_keys']}),
       'table_labels_top': collections.Counter(l for r in ok for l in r['table_labels']).most_common(25),
       'alerts_with_barcode_cell': sum(1 for r in ok if r['barcode_cells']), 'alerts_with_model_cell': sum(1 for r in ok if r['model_cells']),
       'alerts_with_valid_gtin_anywhere_in_text': len(with_g), 'distinct_gtin14': len({g for r in with_g for g in r['gtins']}),
       'text_citations_of_other_agencies': dict(cites), 'alerts_citing_cpsc': sum(1 for r in ok if re.search(r'cpsc|saferproducts|consumer product safety commission', r['text'], re.I)),
       'gtin_match_cpsc': f"{sum(1 for r in with_g if r['cpsc_matches'])}/{len(with_g)}", 'gtin_match_hc': f"{sum(1 for r in with_g if r['hc_matches'])}/{len(with_g)}",
       'by_year': dict(sorted(collections.Counter(r['public_timestamp'][:4] for r in ok).items())),
       'matches': [{k: r[k] for k in ('link', 'title', 'gtins', 'cpsc_matches', 'hc_matches')} for r in with_g if r['cpsc_matches'] or r['hc_matches']],
       'examples_with_gtin': [{'link': r['link'], 'title': r['title'], 'gtins': r['gtins'], 'barcode_cells': r['barcode_cells'][:3]} for r in with_g[:8]]}
json.dump(out, open(os.path.join(HERE, 'opss.json'), 'w'), indent=1, ensure_ascii=False)
print(json.dumps({k: v for k, v in out.items() if k not in ('matches', 'examples_with_gtin')}, indent=1, ensure_ascii=False))
