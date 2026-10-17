"""Measure GTIN overlap between EU Safety Gate alerts (newest 52 weekly reports) and the live consumer-product-recalls members
(CPSC recall notices 2015-> and Health Canada open data).
Run from the repo root: python3 -I docs/sources/pipeline/evidence/2026-10-17/recalls-widening/safety-gate-gtin.py
Raw payloads are cached in RAW (default: /tmp/recalls-widening-raw), not committed. Open data only, declared UA, <=2 req/s/host.
GTIN rule: the repo's own TypeScript (gtin-extract.ts via `npx tsx`): CPSC = structureCpscRecall (ProductUPCs[].UPC + Description),
Health Canada = structureHcRecall + parseCodes over Title/Product/Issue/advice, Safety Gate = digitCodes+gtinReadings+parseCodes on <barcode>.
All GTINs are normalised to GTIN-14 (UPC-12 and EAN-13 left-padded with zeros), each gated by the GS1 check digit."""
import re, json, os, subprocess, time, datetime, html
UA = 'data-foundry-scout/1.0 (data@mail.proviciency.com)'
HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.environ.get('RAW', '/tmp/recalls-widening-raw'); os.makedirs(RAW, exist_ok=True)
def get(u, cache):
    p = os.path.join(RAW, cache)
    if os.path.exists(p) and os.path.getsize(p) > 0: return open(p, encoding='utf-8', errors='replace').read()
    r = subprocess.run(['curl', '-g', '-sS', '-L', '-m', '120', '-A', UA, '-w', '\n%{http_code}', u], capture_output=True)
    body, _, code = r.stdout.decode('utf-8', 'replace').rpartition('\n')
    time.sleep(0.5)
    if code != '200': raise SystemExit(f'{u} -> HTTP {code}')
    open(p, 'w', encoding='utf-8').write(body); return body
# --- Safety Gate: newest 52 weekly reports
lst = get('https://ec.europa.eu/safety-gate-alerts/api/download/weeklyReport/list/xml/en', 'sg-list.xml')
reps = [(r, d, html.unescape(u)) for r, d, u in re.findall(r'<reference>(Report-\d+-\d+)</reference>\s*<publicationDate>([^<]+)</publicationDate>.*?<URL>([^<]+)</URL>', lst, re.S)]
reps.sort(key=lambda x: tuple(int(n) for n in re.findall(r'\d+', x[0])), reverse=True)
reps = reps[:52]
alerts = []
for r, d, u in reps:
    t = get(u, f'sg-{r}.xml')
    for blk in re.findall(r'<notifications\b.*?</notifications>', t, re.S):
        f = lambda tag: (re.search(rf'<{tag}>(?:<!\[CDATA\[(.*?)\]\]>|([^<]*))</{tag}>', blk, re.S) or [None, '', ''])
        def v(tag):
            m = re.search(rf'<{tag}>(?:<!\[CDATA\[(.*?)\]\]>|([^<]*))</{tag}>', blk, re.S)
            return ((m.group(1) or m.group(2) or '') if m else '').strip()
        alerts.append({'report': r, 'published': d, 'case': v('caseNumber'), 'alert_url': v('reference'), 'category': v('category'), 'product': v('product'), 'brand': v('brand'), 'name': v('name'),
                       'model': v('type_numberOfModel'), 'barcode': v('barcode'), 'notifying_country': v('notifyingCountry'), 'recall_url': v('URLrecall'), 'type': v('type'), 'danger': v('danger')[:200]})
# --- CPSC recall notices 2015 -> today, one window per year (as the Worker does)
cpsc = []
today = datetime.date.today()
for y in range(2015, today.year + 1):
    u = f'https://www.saferproducts.gov/RestWebServices/Recall?format=json&RecallDateStart={y}-01-01&RecallDateEnd={y}-12-31'
    j = json.loads(get(u, f'cpsc-{y}.json')); assert isinstance(j, list), y; cpsc += j
# --- Health Canada open data (whole file)
hc = json.loads(get('https://recalls-rappels.canada.ca/sites/default/files/opendata-donneesouvertes/HCRSAMOpenData.json', 'hc.json'))
hc_fields = sorted({k for r in hc for k in r})
inp = os.path.join(RAW, 'extract-in.json'); outp = os.path.join(RAW, 'extract-out.json')
json.dump({'cpsc': cpsc, 'hc': hc, 'texts': [{'id': f'{i}', 'text': a['barcode']} for i, a in enumerate(alerts)]}, open(inp, 'w'))
root = os.path.abspath(os.path.join(HERE, *['..'] * 6))
subprocess.run(['npx', 'tsx', os.path.join(HERE, 'gtin-extract.ts'), inp, outp], check=True, cwd=root)
ex = json.load(open(outp))
def index(rows, key):
    m = {}
    for r in rows:
        for g in r[key]: m.setdefault(g, []).append(r)
    return m
cp = index(ex['cpsc'], 'gtins'); hci = index(ex['hc'], 'text_gtins')
res = []
for a, t in zip(alerts, ex['texts']):
    a['gtins'] = t['gtins']; a['digit_runs'] = t['digit_runs']
    a['cpsc_matches'] = sorted({f"{r['id']}" for g in a['gtins'] for r in cp.get(g, [])})
    a['hc_matches'] = sorted({f"{r['id']}" for g in a['gtins'] for r in hci.get(g, [])})
with_barcode = [a for a in alerts if a['barcode']]
with_gtin = [a for a in alerts if a['gtins']]
m_cp = [a for a in with_gtin if a['cpsc_matches']]; m_hc = [a for a in with_gtin if a['hc_matches']]
sg_g = {g for a in with_gtin for g in a['gtins']}
cpsc_with_gtin = [r for r in ex['cpsc'] if r['gtins']]
out = {
 'run_date': str(today), 'reports': [r for r, _, _ in reps], 'newest_report': reps[0][:2], 'oldest_report': reps[-1][:2],
 'safety_gate': {'alerts': len(alerts), 'alerts_with_barcode_text': len(with_barcode), 'alerts_with_check_digit_valid_gtin': len(with_gtin), 'distinct_gtin14': len(sg_g),
                 'barcode_text_but_no_valid_gtin': len(with_barcode) - len(with_gtin)},
 'cpsc': {'recalls_fetched_2015_on': len(cpsc), 'structured': len(ex['cpsc']), 'structure_errors': ex['cpsc_errors'], 'recalls_with_gtin': len(cpsc_with_gtin), 'distinct_gtin14': len(cp)},
 'health_canada': {'records': len(hc), 'consumer_product_records': len(ex['hc']), 'fields': hc_fields, 'barcode_field_present': any(re.search(r'barcode|upc|gtin|ean', f, re.I) for f in hc_fields),
                   'records_with_structured_gtin': sum(1 for r in ex['hc'] if r['structured_gtins']), 'records_with_gtin_in_text': sum(1 for r in ex['hc'] if r['text_gtins']), 'distinct_gtin14_in_text': len(hci)},
 'match': {'alerts_matching_cpsc': f'{len(m_cp)}/{len(with_gtin)}', 'alerts_matching_hc': f'{len(m_hc)}/{len(with_gtin)}', 'alerts_matching_cpsc_per_all_alerts': f'{len(m_cp)}/{len(alerts)}',
           'distinct_gtins_matching_cpsc': f"{len(sg_g & set(cp))}/{len(sg_g)}", 'distinct_gtins_matching_hc': f"{len(sg_g & set(hci))}/{len(sg_g)}"},
 'matches': [{k: a[k] for k in ('report', 'published', 'case', 'alert_url', 'brand', 'product', 'name', 'model', 'barcode', 'gtins', 'notifying_country', 'cpsc_matches', 'hc_matches')} for a in alerts if a['cpsc_matches'] or a['hc_matches']],
}
cp_title = {r['id']: r for r in ex['cpsc']}
for m in out['matches']:
    m['cpsc_notices'] = [{'id': i, 'title': cp_title[i]['title'], 'url': cp_title[i]['url'], 'models': cp_title[i]['models'][:5]} for i in m['cpsc_matches']]
vp = os.path.join(HERE, 'handcheck.json')
if os.path.exists(vp):
    out['hand_check'] = json.load(open(vp))
json.dump(out, open(os.path.join(HERE, 'safety-gate-gtin.json'), 'w'), indent=1, ensure_ascii=False)
print(json.dumps({k: v for k, v in out.items() if k not in ('matches', 'reports')}, indent=1))
