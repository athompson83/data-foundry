"""Deterministic extraction over a seeded sample of FDA 510(k) summary PDFs (EVIDENCED round, 2026-10-17).

Samples 60 'Summary' 510(k) records decided 2012..2026 (5 per decision year, seeded), downloads each summary PDF from
accessdata.fda.gov, runs pdftotext, and extracts with fixed regexes: the K-number itself (sanity), indications for use,
predicate K-numbers, product code and 21 CFR regulation number. Ground truth for product code is the openFDA record;
for regulation number, openFDA device/classification; predicate K-numbers are checked by resolving them in openFDA.
Usage: python3 -I extract.py <work_dir>   (PDFs are cached in work_dir, not committed; they are not republished)
"""
import json, os, random, re, subprocess, sys, time, urllib.parse, urllib.request

UA = 'data-foundry-scout/1.0 (data@mail.proviciency.com)'
WORK = sys.argv[1]
os.makedirs(WORK, exist_ok=True)
HERE = os.path.dirname(os.path.abspath(__file__))


def get(url, binary=False, retries=3):
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': UA})
            with urllib.request.urlopen(req, timeout=60) as r:
                data = r.read()
                return r.status, (data if binary else data.decode('utf-8', 'replace'))
        except urllib.error.HTTPError as e:
            if e.code in (404, 403):
                return e.code, b'' if binary else ''
            time.sleep(2 * (attempt + 1))
        except Exception:
            time.sleep(2 * (attempt + 1))
    return 0, b'' if binary else ''


def openfda(path, search, limit=100, skip=0):
    url = f'https://api.fda.gov/device/{path}.json?search={urllib.parse.quote(search)}&limit={limit}&skip={skip}'
    time.sleep(0.5)
    status, body = get(url)
    return json.loads(body)['results'] if status == 200 else []


rng = random.Random(20261017)
sample = []
for year in range(2012, 2027):
    rows = openfda('510k', f'statement_or_summary:Summary AND decision_date:[{year}0101 TO {year}1231] AND decision_code:SESE', 100)
    rng.shuffle(rows)
    sample += rows[:5]
print('sampled', len(sample))

IND = re.compile(r'(?is)indications?\s+for\s+use\s*(?:statement)?\s*[:\-]?\s*(.{40,1500}?)(?=\n\s*(?:device\s+description|technological|predicate|intended\s+use|contraindications?|substantial|summary\s+of|type\s+of\s+use|prescription\s+use|510\(k\)\s+summary|page\s+\d|section\s+\d|\Z))')
IND2 = re.compile(r'(?is)(?:is|are)\s+indicated\s+for\s+(.{30,800}?\.)')
PRED = re.compile(r'(?i)predicate[^\n]{0,60}?(?:device|devices)?[^K\n]{0,200}?((?:K|DEN|P)\d{6,7}(?:\s*[,;/and&]+\s*(?:K|DEN|P)\d{6,7})*)')
KNUM = re.compile(r'\bK\d{6}\b')
REG = re.compile(r'\b21\s*CFR\s*(?:Part\s*)?(?:§\s*)?(8\d\d\.\d{3,4})', re.I)
PC = re.compile(r'(?i)product\s*code[s]?\s*[:\-]?\s*([A-Z]{3})\b')

results = []
for i, rec in enumerate(sample):
    k = rec['k_number']
    yy = k[1:3]
    pdf = os.path.join(WORK, f'{k}.pdf')
    if not os.path.exists(pdf):
        time.sleep(0.6)
        status, data = get(f'https://www.accessdata.fda.gov/cdrh_docs/pdf{yy}/{k}.pdf', binary=True)
        if status != 200 or not data.startswith(b'%PDF'):
            results.append({'k_number': k, 'pdf_status': status, 'decision_date': rec.get('decision_date')})
            continue
        open(pdf, 'wb').write(data)
    txt = subprocess.run(['pdftotext', '-layout', pdf, '-'], capture_output=True, text=True).stdout
    chars = len(txt.strip())
    out = {'k_number': k, 'decision_date': rec.get('decision_date'), 'product_code_openfda': rec.get('product_code'), 'pdf_status': 200, 'text_chars': chars}
    if chars < 200:
        out['scanned_image_only'] = True
        results.append(out)
        continue
    flat = re.sub(r'[ \t]+', ' ', txt)
    out['k_number_in_text'] = k in flat
    m = IND.search(flat) or IND2.search(flat)
    out['indications'] = re.sub(r'\s+', ' ', m.group(1)).strip()[:600] if m else None
    others = set(KNUM.findall(flat)) - {k}
    pm = PRED.findall(flat)
    preds = sorted({x for grp in pm for x in re.findall(r'(?:K|DEN|P)\d{6,7}', grp)} - {k})
    out['predicates'] = preds
    out['k_numbers_other'] = sorted(others)
    regs = sorted(set(REG.findall(flat)))
    out['regulation_numbers'] = regs
    pcs = sorted(set(PC.findall(flat)))
    out['product_codes_in_text'] = pcs
    out['product_code_match'] = rec.get('product_code') in pcs or (rec.get('product_code') or '#') in flat
    results.append(out)

ok = [r for r in results if r.get('pdf_status') == 200 and not r.get('scanned_image_only')]
pdfs = [r for r in results if r.get('pdf_status') == 200]
# resolve predicates in openFDA
resolved = {}
allpred = sorted({p for r in ok for p in r.get('predicates', []) if p.startswith('K')})
for j in range(0, len(allpred), 20):
    chunk = allpred[j:j + 20]
    rows = openfda('510k', ' OR '.join(f'k_number:{p}' for p in chunk), 100)
    found = {x['k_number'] for x in rows}
    for p in chunk:
        resolved[p] = p in found
for r in ok:
    r['predicates_resolved'] = {p: resolved.get(p) for p in r.get('predicates', []) if p.startswith('K')}

# regulation number ground truth: classification record for the product code
reg_truth = {}
for pc in sorted({r['product_code_openfda'] for r in ok if r.get('product_code_openfda')}):
    rows = openfda('classification', f'product_code:{pc}', 1)
    reg_truth[pc] = rows[0].get('regulation_number') if rows else None
for r in ok:
    t = reg_truth.get(r.get('product_code_openfda'))
    r['regulation_truth'] = t
    r['regulation_match'] = bool(t) and any(t == x for x in r['regulation_numbers'])


def rate(pred, population):
    n = len(population)
    h = sum(1 for r in population if pred(r))
    return {'hits': h, 'of': n, 'rate': round(h / n, 3) if n else None}


summary = {
    'sampled': len(sample),
    'pdf_fetched': len(pdfs),
    'pdf_not_found_or_failed': len(results) - len(pdfs),
    'scanned_image_only_no_text_layer': len([r for r in pdfs if r.get('scanned_image_only')]),
    'text_extractable': len(ok),
    'k_number_in_text': rate(lambda r: r.get('k_number_in_text'), ok),
    'indications_extracted': rate(lambda r: r.get('indications'), ok),
    'has_predicate_k_number': rate(lambda r: r.get('predicates'), ok),
    'predicate_k_numbers_total': len(allpred),
    'predicate_k_numbers_resolved_in_openfda': sum(1 for v in resolved.values() if v),
    'regulation_number_in_text_equals_classification': rate(lambda r: r.get('regulation_match'), [r for r in ok if r.get('regulation_truth')]),
    'product_code_present_in_text': rate(lambda r: r.get('product_code_match'), ok),
}
json.dump({'retrieved_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'summary': summary, 'records': results}, open(os.path.join(HERE, 'extract.json'), 'w'), indent=1)
print(json.dumps(summary, indent=1))
