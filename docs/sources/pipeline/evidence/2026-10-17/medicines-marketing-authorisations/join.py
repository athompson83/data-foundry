"""Measure EMA (EU centrally authorised medicines) <-> Drugs@FDA (openFDA drugsfda) linkage on the active substance.
No identifier names the counterpart record (EMA publishes INN, active substance, ATC; openFDA publishes application
number, ingredient names, rxcui, unii), so the substance name is a CANDIDATE join: a deterministic token match proposes
a link, and a reviewer hand-checks pairs (reviewed.json holds the human verdicts on the printed pairs).
Run: python3 -I join.py   (stdlib only; open endpoints; declared UA; <=2 req/s). Writes join.json next to this file."""
import json, os, re, sys, time, html, zipfile, subprocess, datetime, tempfile, urllib.parse
UA = 'data-foundry-scout/1.0 (data@mail.proviciency.com)'
HERE = os.path.dirname(os.path.abspath(__file__))
EMA = 'https://www.ema.europa.eu/en/documents/report/medicines-output-medicines-report_en.xlsx'
FDA = 'https://api.fda.gov/drug/drugsfda.json'
statuses = {}
def get(u, binary=False):
    time.sleep(0.5)
    r = subprocess.run(['curl', '-sS', '-m', '120', '-A', UA, '-w', '\n%{http_code}', u], capture_output=True)
    body, _, code = r.stdout.rpartition(b'\n')
    statuses[u.split('?')[0]] = int(code or 0)
    return (body if binary else body.decode('utf-8', 'replace')), int(code or 0)
def jget(u):
    b, c = get(u)
    try: return json.loads(b), c
    except Exception: return None, c
def read_xlsx(path):
    z = zipfile.ZipFile(path)
    ss = [html.unescape(re.sub(r'<[^>]+>', '', m)) for m in re.findall(r'<si>(.*?)</si>', z.read('xl/sharedStrings.xml').decode(), re.S)]
    rows = []
    for rm in re.finditer(r'<row [^>]*>(.*?)</row>', z.read('xl/worksheets/sheet1.xml').decode(), re.S):
        r = {}
        for c in re.finditer(r'<c r="([A-Z]+)\d+"([^>]*?)(?:/>|>(.*?)</c>)', rm.group(1), re.S):
            col, attr, body = c.groups()
            if not body: continue
            v = re.search(r'<v>(.*?)</v>', body, re.S)
            if v: r[col] = ss[int(v.group(1))] if 't="s"' in attr else html.unescape(v.group(1))
            else:
                t = re.search(r'<t[^>]*>(.*?)</t>', body, re.S)
                if t: r[col] = html.unescape(t.group(1))
        rows.append(r)
    return rows
tmp = tempfile.mkdtemp(prefix='ema-')
b, code = get(EMA, binary=True); ema_status = code
open(os.path.join(tmp, 'ema.xlsx'), 'wb').write(b)
rows = read_xlsx(os.path.join(tmp, 'ema.xlsx'))
hdr = next(r for r in rows if r.get('A') == 'Category')
gen = rows[0].get('D')
data = [{hdr[k].replace('\n', ' '): v for k, v in r.items() if k in hdr} for r in rows[rows.index(hdr) + 1:] if r.get('B')]
human = [d for d in data if d['Category'] == 'Human']
auth = [d for d in human if d['Medicine status'] == 'Authorised']
def dmy(s):
    try: return datetime.datetime.strptime(s, '%d/%m/%Y').date()
    except Exception: return None
ema_stats = {'rows': len(data), 'human': len(human), 'human_authorised': len(auth),
             'authorised_with_indication_text': sum(1 for d in auth if d.get('Therapeutic indication')),
             'authorised_with_atc': sum(1 for d in auth if d.get('ATC code (human)')),
             'authorised_with_ma_date': sum(1 for d in auth if d.get('Marketing authorisation date')),
             'latest_last_updated': max(str(dmy(d['Last updated date'])) for d in data if dmy(d.get('Last updated date', ''))),
             'file_generated': gen,
             'median_indication_chars': sorted(len(d['Therapeutic indication']) for d in auth if d.get('Therapeutic indication'))[len(auth) // 2]}
fda_total = jget(FDA + '?limit=1')[0]['meta']
fda_apps_total = fda_total['results']['total']
fda_docs = jget(FDA + '?search=_exists_:submissions.application_docs&limit=1')[0]['meta']['results']['total']
fda_review = jget(FDA + '?search=submissions.application_docs.type:Review&limit=1')[0]['meta']['results']['total']
# deterministic sample: single-substance authorised human medicines sorted by EMA product number, evenly spaced
single = sorted([d for d in auth if d.get('Active substance') and not re.search(r'[;,/]| and ', d['Active substance']) and d.get('ATC code (human)')], key=lambda d: d['EMA product number'])
N = 100; step = len(single) / N
sample = [single[int(i * step)] for i in range(N)]
SALTS = set('sodium potassium calcium magnesium hydrochloride hcl mesylate maleate tartrate sulfate sulphate besylate fumarate succinate citrate phosphate acetate bromide chloride hydrobromide dihydrate monohydrate anhydrous disodium dipotassium hemihydrate nitrate'.split())
tok = lambda s: [t for t in re.findall(r'[a-z0-9]+', s.lower()) if t not in SALTS and len(t) > 2]
def ing_match(ema_sub, fda_ing):
    a, b = set(tok(ema_sub)), set(tok(fda_ing))
    return bool(a) and a <= b          # every EMA substance token is in the FDA ingredient name (BLA suffixes such as -ejfv ignored)
results = []
for d in sample:
    sub = d['Active substance']; ts = tok(sub)
    entry = {'ema_product_number': d['EMA product number'], 'ema_name': d['Name of medicine'], 'active_substance': sub,
             'atc': d['ATC code (human)'], 'ema_marketing_authorisation_date': d.get('Marketing authorisation date'), 'fda': []}
    if ts:
        q = '+AND+'.join(f'products.active_ingredients.name:{urllib.parse.quote(t)}' for t in ts)
        j, c = jget(f'{FDA}?search={q}&limit=100'); entry['openfda_http'] = c
        entry['openfda_total_for_query'] = (j or {}).get('meta', {}).get('results', {}).get('total', 0)
        for a in (j or {}).get('results', []):
            ings = sorted({i['name'] for p in a['products'] for i in p['active_ingredients']})
            if any(ing_match(sub, i) and len(tok(i)) <= len(ts) + 1 for i in ings):
                orig = [s['submission_status_date'] for s in a.get('submissions', []) if s.get('submission_type') == 'ORIG' and s.get('submission_status') == 'AP' and s.get('submission_status_date')]
                entry['fda'].append({'application_number': a['application_number'], 'sponsor': a['sponsor_name'], 'ingredients': ings,
                                     'marketing_status': sorted({p.get('marketing_status') for p in a['products']}),
                                     'orig_approval_date': min(orig) if orig else None,
                                     'rxcui': (a.get('openfda') or {}).get('rxcui', [])[:3]})
    # propose the single-ingredient applications first (a combination product containing the substance is a weaker proposal)
    entry['fda'].sort(key=lambda f: (len(f['ingredients']) != 1, f['application_number']))
    entry['fda_matches'] = len(entry['fda'])
    entry['fda_single_ingredient_matches'] = sum(1 for f in entry['fda'] if len(f['ingredients']) == 1)
    results.append(entry)
matched = sum(1 for e in results if e['fda_matches'])
matched_single = sum(1 for e in results if e['fda_single_ingredient_matches'])
# corroboration: ATC of the first RxCUI via RxClass vs EMA ATC (same 7-character code or same 5-character level-4 prefix)
atc_checked = atc_same7 = atc_same5 = 0
for e in results:
    rx = next((r for f in e['fda'] for r in f['rxcui']), None)
    if not rx: continue
    j, c = jget(f'https://rxnav.nlm.nih.gov/REST/rxclass/class/byRxcui.json?rxcui={rx}&relaSource=ATC')
    codes = sorted({x['rxclassMinConceptItem']['classId'] for x in (j or {}).get('rxclassDrugInfoList', {}).get('rxclassDrugInfo', [])})
    e['rxclass_atc'] = codes; atc_checked += 1
    if e['atc'] in codes: atc_same7 += 1
    if any(c_[:5] == e['atc'][:5] for c_ in codes): atc_same5 += 1
# are FDA review documents fetchable? (free-text review pages)
doc_probe = []
j, _ = jget(FDA + '?search=submissions.application_docs.type:Review&limit=5')
for a in (j or {}).get('results', [])[:3]:
    for s in a.get('submissions', []):
        for dd in s.get('application_docs', []):
            if dd.get('type') == 'Review':
                _, c = get(dd['url'].replace('http://', 'https://')); doc_probe.append({'application_number': a['application_number'], 'url': dd['url'].replace('http://', 'https://'), 'http': c}); break
        else: continue
        break
out = {'run_utc': datetime.datetime.utcnow().isoformat() + 'Z', 'ema_url': EMA, 'ema_http': ema_status, 'ema': ema_stats,
       'openfda_url': FDA, 'openfda_meta': {k: fda_total.get(k) for k in ('last_updated', 'license', 'terms')}, 'openfda_applications_total': fda_apps_total,
       'openfda_applications_with_application_docs': fda_docs, 'openfda_applications_with_Review_doc': fda_review, 'fda_review_doc_probe': doc_probe,
       'sample_size': N, 'sample_rule': 'single-substance authorised human EMA medicines with ATC, sorted by EMA product number, evenly spaced',
       'ema_sample_with_fda_application_by_substance_tokens': matched, 'ema_sample_without_match': [e['active_substance'] for e in results if not e['fda_matches']],
       'atc_corroboration': {'matched_with_rxcui_checked': atc_checked, 'same_7char_atc': atc_same7, 'same_level4_prefix': atc_same5},
       'http_statuses': statuses, 'results': results}
rp = os.path.join(HERE, 'reviewed.json')
if os.path.exists(rp):   # hand-check of proposed pairs, written by the reviewer after reading the printed pairs
    rv = json.load(open(rp)); out['reviewed'] = {'checked': len(rv['pairs']), 'correct': sum(1 for p in rv['pairs'] if p['verdict'] == 'same-substance'), 'reviewer_note': rv['note'], 'pairs': rv['pairs']}
json.dump(out, open(os.path.join(HERE, 'join.json'), 'w'), indent=1)
print({k: v for k, v in out.items() if k not in ('results',)})
