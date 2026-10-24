"""Health Canada's open-data index has no barcode field; the public detail pages may list UPCs. Fetch the detail page of every consumer-product
record last updated since 2025-10-01 (the Safety Gate window), extract GTINs with the repo rule (tooling/scripts/scout-gtin-extract.ts) and compare with Safety Gate GTINs.
Run from the repo root after safety-gate-gtin.py: python3 -I docs/sources/pipeline/evidence/2026-10-17/recalls-widening/hc-detail.py. Declared UA, 2 req/s. Pages are Open Government Licence - Canada."""
import re, json, os, subprocess, time, html
UA = 'data-foundry-scout/1.0 (data@mail.proviciency.com)'
HERE = os.path.dirname(os.path.abspath(__file__)); RAW = os.environ.get('RAW', '/tmp/recalls-widening-raw'); os.makedirs(RAW + '/hc', exist_ok=True)
hc = [r for r in json.load(open(RAW + '/hc.json')) if r.get('Organization') == 'Consumer product safety' and (r.get('Last updated') or '') >= '2025-10-01']
def page(u, name):
    p = f'{RAW}/hc/{name}.html'
    if os.path.exists(p): return open(p, encoding='utf-8').read()
    r = subprocess.run(['curl', '-g', '-sS', '-L', '-m', '60', '-A', UA, '-w', '\n%{http_code}', u], capture_output=True)
    b, _, c = r.stdout.decode('utf-8', 'replace').rpartition('\n'); time.sleep(0.5)
    if c != '200': return ''
    open(p, 'w', encoding='utf-8').write(b); return b
def text(h):
    m = re.search(r'<main.*?</main>', h, re.S); h = m.group(0) if m else h
    return re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', ' ', re.sub(r'<(script|style)\b.*?</\1>', ' ', h, flags=re.S)))).strip()
rows = []
for r in hc:
    t = text(page(r['URL'], r['NID'])); rows.append({'id': r['NID'], 'url': r['URL'], 'title': r['Title'], 'text': t[:8000], 'fetched': bool(t), 'mentions_upc_or_barcode': bool(re.search(r'\b(UPC|EAN|GTIN|barcode|bar code)\b', t, re.I))})
inp, outp = RAW + '/hc-in.json', RAW + '/hc-out.json'
json.dump({'texts': [{'id': r['id'], 'text': r['text'], 'anchored': True} for r in rows]}, open(inp, 'w'))
subprocess.run(['npx', 'tsx', os.path.join(os.path.abspath(os.path.join(HERE, *['..'] * 6)), 'tooling', 'scripts', 'scout-gtin-extract.ts'), inp, outp], check=True, cwd=os.path.abspath(os.path.join(HERE, *['..'] * 6)))
gt = {t['id']: t['gtins'] for t in json.load(open(outp))['texts']}
sg = json.load(open(RAW + '/extract-out.json'))  # not used for SG; SG GTINs come from safety-gate-gtin.json matches? recompute below from cached SG XML
sgg = {}
for f in os.listdir(RAW):
    if f.startswith('sg-Report'):
        for b in re.findall(r'<barcode><!\[CDATA\[(.*?)\]\]></barcode>', open(f'{RAW}/{f}', encoding='utf-8').read(), re.S): sgg.setdefault(b.strip(), 0)
json.dump({'texts': [{'id': b, 'text': b} for b in sgg]}, open(RAW + '/sgb-in.json', 'w'))
subprocess.run(['npx', 'tsx', os.path.join(os.path.abspath(os.path.join(HERE, *['..'] * 6)), 'tooling', 'scripts', 'scout-gtin-extract.ts'), RAW + '/sgb-in.json', RAW + '/sgb-out.json'], check=True, cwd=os.path.abspath(os.path.join(HERE, *['..'] * 6)))
sg_set = {g for t in json.load(open(RAW + '/sgb-out.json'))['texts'] for g in t['gtins']}
for r in rows: r['gtins'] = gt[r['id']]; r['sg_matches'] = sorted(set(r['gtins']) & sg_set); del r['text']
withg = [r for r in rows if r['gtins']]
out = {'run_date': time.strftime('%Y-%m-%d'), 'hc_consumer_records_updated_since_2025_10_01': len(rows), 'pages_fetched': sum(r['fetched'] for r in rows), 'pages_mentioning_upc_or_barcode': sum(r['mentions_upc_or_barcode'] for r in rows),
       'pages_with_valid_gtin': len(withg), 'distinct_hc_gtin14': len({g for r in withg for g in r['gtins']}), 'safety_gate_distinct_gtin14_all_cached_reports': len(sg_set),
       'hc_pages_matching_safety_gate': f"{sum(1 for r in withg if r['sg_matches'])}/{len(withg)}", 'matches': [r for r in rows if r['sg_matches']]}
json.dump(out, open(os.path.join(HERE, 'hc-detail.json'), 'w'), indent=1, ensure_ascii=False); print(json.dumps({k: v for k, v in out.items() if k != 'matches'}, indent=1)); print(json.dumps(out['matches'][:10], indent=1))
