#!/usr/bin/env python3
"""Screen drug-shortage-notices members (2026-10-01). Polite (<=2 req/s), small samples, no keys, no login.
Usage: python3 screen.py [outdir]   (needs: requests-free stdlib + openpyxl)"""
import json, re, sys, time, collections, urllib.request, urllib.parse, io, random
UA = 'data-foundry-scout (data@mail.proviciency.com)'
OUT = sys.argv[1] if len(sys.argv) > 1 else '.'
def get(url, binary=False):
    time.sleep(0.6)
    req = urllib.request.Request(url, headers={'User-Agent': UA})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            b = r.read(); return r.status, (b if binary else b.decode('utf-8', 'ignore'))
    except urllib.error.HTTPError as e: return e.code, ''
    except Exception as e: return 0, str(e)
res = {'run_date': '2026-10-01'}

# ---- reachability of every candidate
probe = {
 'openfda_api': 'https://api.fda.gov/drug/shortages.json?limit=1',
 'fda_cder_db': 'https://www.accessdata.fda.gov/scripts/drugshortages/default.cfm',
 'dsc_ca': 'https://www.drugshortagescanada.ca/',
 'ema_page': 'https://www.ema.europa.eu/en/human-regulatory-overview/post-authorisation/medicine-shortages-availability-issues',
 'ema_xlsx': 'https://www.ema.europa.eu/en/documents/report/medicines-output-shortages-report_en.xlsx',
 'tga_msi': 'https://apps.tga.gov.au/prod/MSI/search',
 'tga_site_copyright': 'https://www.tga.gov.au/about-this-website/copyright',
 'ashp': 'https://www.ashp.org/drug-shortages/current-shortages',
 'rxnav_terms': 'https://lhncbc.nlm.nih.gov/RxNav/TermsofService.html',
 'dailymed': 'https://dailymed.nlm.nih.gov/dailymed/services/v2/spls.json?pagesize=1',
}
res['reachability'] = {k: get(u)[0] for k, u in probe.items()}

# ---- openFDA: every record
fda = []
for skip in (0, 1000):
    s, b = get(f'https://api.fda.gov/drug/shortages.json?limit=1000&skip={skip}')
    d = json.loads(b); fda += d['results']; meta = d['meta']
def fdate(x): m, dd, y = x.split('/'); return f'{y}-{m}-{dd}'
c = collections.Counter()
for x in fda: c.update(k for k, v in x.items() if v not in ('', [], None))
res['openfda'] = {
 'total_reported': meta['results']['total'], 'fetched': len(fda), 'meta_last_updated': meta['last_updated'],
 'status': collections.Counter(x.get('status') for x in fda),
 'newest_update_date': max(fdate(x['update_date']) for x in fda), 'oldest_initial_posting': min(fdate(x['initial_posting_date']) for x in fda),
 'updated_in_last_30d_of_newest': sum(1 for x in fda if fdate(x['update_date']) >= '2026-08-31'),
 'field_fill': dict(c),
 'with_openfda_block': sum(1 for x in fda if x.get('openfda')),
 'with_rxcui': sum(1 for x in fda if x.get('openfda', {}).get('rxcui')),
 'with_application_number': sum(1 for x in fda if x.get('openfda', {}).get('application_number')),
 'with_spl_set_id': sum(1 for x in fda if x.get('openfda', {}).get('spl_set_id')),
 'with_shortage_reason_text': sum(1 for x in fda if x.get('shortage_reason')),
 'with_related_info_text': sum(1 for x in fda if x.get('related_info')),
 'distinct_generic_names': len({x['generic_name'] for x in fda}),
 'distinct_shortage_reasons': collections.Counter(x.get('shortage_reason') for x in fda).most_common(8),
}

# ---- FDA CDER database page (HTML): ingredient entries by status
s, html = get('https://www.accessdata.fda.gov/scripts/drugshortages/default.cfm')
ents = re.findall(r'dsp_ActiveIngredientDetails\.cfm\?AI=([^&"]*)&st=(\w)', html)
res['fda_cder_db'] = {'ingredient_entries': len(ents), 'by_status_code': collections.Counter(st for _, st in ents),
  'note': 'c=current, r=resolved, d=discontinuation; detail pages carry per-presentation Shortage Reason (per FDASIA) and Related Information free text'}
s, det = get('https://www.accessdata.fda.gov/scripts/drugshortages/dsp_ActiveIngredientDetails.cfm?AI=Atropine%20Sulfate%20Injection&st=c&tab=tabs-1')
res['fda_cder_db']['detail_sample_status'] = s

# ---- EMA shortages xlsx (positional columns)
import openpyxl
s, xb = get('https://www.ema.europa.eu/en/documents/report/medicines-output-shortages-report_en.xlsx', binary=True)
wb = openpyxl.load_workbook(io.BytesIO(xb), read_only=True); ws = wb.active
rows = [list(r) for r in ws.iter_rows(values_only=True)]
hi = next(i for i, r in enumerate(rows) if r and r[0] == 'Category')
hdr = [h for h in rows[hi] if h]; ema = []
for r in rows[hi + 1:]:
    if r[0]: ema.append(dict(zip(hdr, [None if v is None else str(v) for v in r[:len(hdr)]])))
res['ema'] = {'http': s, 'bytes': len(xb), 'columns': hdr, 'records': len(ema),
  'generated_on': rows[0][3] if len(rows[0]) > 3 else None,
  'status': collections.Counter(x['Supply shortage status'] for x in ema),
  'newest_last_updated': max(re.sub(r'(\d+)/(\d+)/(\d+).*', r'\3-\2-\1', x.get('Last updated date') or '') for x in ema)}
# EMA detail page: free-text "Reason for shortage" section
ema_reason_hits = 0; ema_checked = 0; ema_ex = None
for x in [e for e in ema if e.get('Shortage URL')][:20]:
    s, h = get(x['Shortage URL']); ema_checked += 1
    t = re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', ' ', re.sub(r'<(style|script).*?</\1>', '', h, flags=re.S)))
    m = re.search(r'Reason for shortage (.{40,400}?)(?: Member States| Monitoring| Alternative)', t)
    if m: ema_reason_hits += 1; ema_ex = ema_ex or {'url': x['Shortage URL'], 'text': m.group(1)[:300]}
res['ema']['detail_pages_checked'] = ema_checked; res['ema']['detail_pages_with_reason_text'] = ema_reason_hits; res['ema']['reason_example'] = ema_ex

# ---- TGA (parked): embedded JSON on the MSI page
s, h = get('https://apps.tga.gov.au/prod/MSI/search')
i = h.find('var tabularData = ') + len('var tabularData = '); tga = json.JSONDecoder().raw_decode(h[i:])[0]['records']
res['tga'] = {'http': s, 'records': len(tga), 'status': collections.Counter(x['status'] for x in tga),
  'newest_sorting_date': max(re.sub(r'(\d+)-(\d+)-(\d+)', r'\3-\2-\1', x['sorting_date']) for x in tga),
  'with_artg': sum(1 for x in tga if x.get('artg_numb')), 'with_atc_level1': sum(1 for x in tga if x.get('atc_level1')),
  'with_management_action_text': sum(1 for x in tga if x.get('tga_shortage_management_action')),
  'note': 'terms page www.tga.gov.au unreachable (HTTP/2 INTERNAL_ERROR / empty reply) so rights are UNKNOWN: PARKED'}

# ---- JOIN A (declared): openFDA package NDC -> RxNorm RxCUI / DailyMed set id (NLM). 25 random records with NDC + openfda block.
random.seed(20261001)
pool = [x for x in fda if x.get('openfda', {}).get('rxcui') and x.get('openfda', {}).get('spl_set_id')]
sample = random.sample(pool, 25); ja = []
for x in sample:
    ndc = x['package_ndc']; row = {'package_ndc': ndc, 'fda_rxcuis': len(x['openfda']['rxcui'])}
    s, b = get('https://rxnav.nlm.nih.gov/REST/ndcstatus.json?ndc=' + ndc)
    st = json.loads(b).get('ndcStatus', {}) if s == 200 else {}
    row['rxnorm_rxcui'] = st.get('rxcui') or None; row['rxnorm_status'] = st.get('status')
    row['rxcui_in_fda_openfda_rxcui'] = bool(st.get('rxcui')) and st['rxcui'] in x['openfda']['rxcui']
    s, b = get('https://dailymed.nlm.nih.gov/dailymed/services/v2/spls.json?ndc=' + ndc)
    ids = [d['setid'] for d in json.loads(b)['data']] if s == 200 else []
    row['dailymed_setids'] = len(ids); row['dailymed_setid_in_fda_spl_set_id'] = any(i in x['openfda']['spl_set_id'] for i in ids)
    ing = None
    if st.get('rxcui'):
        s, b = get(f'https://rxnav.nlm.nih.gov/REST/rxclass/class/byRxcui.json?rxcui={st["rxcui"]}&relaSource=ATC')
        if s == 200:
            lst = (json.loads(b).get('rxclassDrugInfoList') or {}).get('rxclassDrugInfo') or []
            ing = sorted({i['rxclassMinConceptItem']['classId'] for i in lst})
    row['atc_codes_from_rxclass'] = ing or []
    ja.append(row)
res['join_ndc_rxnorm_dailymed'] = {
 'sampled': len(ja), 'ndc_to_rxcui_resolved': sum(1 for r in ja if r['rxnorm_rxcui']),
 'rxcui_confirmed_in_openfda_block': sum(1 for r in ja if r['rxcui_in_fda_openfda_rxcui']),
 'dailymed_found_by_ndc': sum(1 for r in ja if r['dailymed_setids']),
 'dailymed_setid_confirmed_in_openfda_block': sum(1 for r in ja if r['dailymed_setid_in_fda_spl_set_id']),
 'with_atc_via_rxclass': sum(1 for r in ja if r['atc_codes_from_rxclass']), 'rows': ja}

# ---- JOIN B (candidate): EMA INN vs openFDA substance_name / generic_name; exact normalised equality, then hand check
def norm(s): return re.sub(r'[^a-z0-9 ]', '', s.lower()).strip()
fda_sub = collections.defaultdict(list)
for x in fda:
    names = set(map(norm, x.get('openfda', {}).get('substance_name', []))) | {norm(x['generic_name'])}
    for n in names:
        if n: fda_sub[n].append(x['package_ndc'])
jb = []
for e in ema:
    inn = e['International non-proprietary name (INN) or common name']
    parts = [norm(p) for p in re.split(r'[;,/]| and ', inn or '')]
    hit = [p for p in parts if p in fda_sub]
    # also full-string equality against a single generic name that contains the INN as a whole word list
    jb.append({'ema_medicine': e['Medicine affected'], 'ema_inn': inn, 'ema_status': e['Supply shortage status'], 'inn_exact_hits': hit,
               'fda_notice_count_for_hit': sum(len(fda_sub[h]) for h in hit)})
res['join_ema_inn_openfda'] = {'ema_records': len(ema), 'with_exact_hit': sum(1 for r in jb if r['inn_exact_hits']), 'rows': jb}
json.dump(res, open(f'{OUT}/results_full.json', 'w'), default=str)
print(json.dumps({k: (v if k != 'join_ema_inn_openfda' else {kk: vv for kk, vv in v.items() if kk != 'rows'}) for k, v in res.items() if k != 'join_ndc_rxnorm_dailymed'}, default=str, indent=1)[:6000])
print({k: v for k, v in res['join_ndc_rxnorm_dailymed'].items() if k != 'rows'})
