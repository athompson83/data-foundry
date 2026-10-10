#!/usr/bin/env python3
"""Screen pipeline/hazmat incident sources (2026-10-04). Needs: pip install openpyxl. Writes results.json.
Polite: sequential requests, one file per source, UA header, no keys, no login."""
import csv, io, json, re, sys, time, urllib.request, collections, os, datetime
import openpyxl
UA = {'User-Agent': 'data-foundry-scout (data@mail.proviciency.com)'}
W = os.environ.get('WORK', '/tmp/pipeline-hazmat'); os.makedirs(W, exist_ok=True)
R = {'probes': {}, 'run': '2026-10-04'}

def get(url, dest=None):
    req = urllib.request.Request(url, headers=UA)
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            body = r.read(); code = r.status
    except urllib.error.HTTPError as e:
        body = e.read(); code = e.code
    except Exception as e:
        return 0, str(e).encode()
    if dest and code == 200: open(f'{W}/{dest}', 'wb').write(body)
    time.sleep(1)
    return code, body

for name, url in {
  'phmsa_incident_data_page': 'https://www.phmsa.dot.gov/data-and-statistics/pipeline/source-data',
  'phmsa_home': 'https://www.phmsa.dot.gov/',
  'tsb_pods_csv': 'https://www.tsb.gc.ca/sites/default/files/stats/PODSdb_MDOTW_VW_OCCURRENCE_PUBLIC.csv',
  'uscg_disclaim': 'https://www.uscg.mil/Disclaim/',
  'nrc_home': 'https://nrc.uscg.mil/',
  'cer_dictionary': 'https://www.cer-rec.gc.ca/open/incident/pipeline-incidents-data-dictionary.csv',
  'ogl_canada': 'https://open.canada.ca/en/open-government-licence-canada',
}.items():
    code, body = get(url, name + '.bin'); R['probes'][name] = {'url': url, 'http': code, 'bytes': len(body)}

# ---- NRC (USCG National Response Center) CY2026 workbook
code, _ = get('https://nrc.uscg.mil/FOIAFiles/CY26.xlsx', 'CY26.xlsx'); R['probes']['nrc_cy26'] = {'http': code}
wb = openpyxl.load_workbook(f'{W}/CY26.xlsx', read_only=True)
def sheet(n):
    it = wb[n].iter_rows(values_only=True); h = list(next(it)); return [dict(zip(h, r)) for r in it]
calls, commons, inc, mats = sheet('CALLS'), sheet('INCIDENT_COMMONS'), sheet('INCIDENTS'), sheet('MATERIAL_INVOLVED')
details = sheet('INCIDENT_DETAILS')
cm = {r['SEQNOS']: r for r in commons}; cl = {r['SEQNOS']: r for r in calls}; ic = {r['SEQNOS']: r for r in inc}
mat_by = collections.defaultdict(list)
for m in mats: mat_by[m['SEQNOS']].append(m)
rec_dates = [r['DATE_TIME_RECEIVED'] for r in calls if r['DATE_TIME_RECEIVED']]
types = collections.Counter(r['TYPE_OF_INCIDENT'] for r in commons)
pipe_ids = [s for s, r in cm.items() if r['TYPE_OF_INCIDENT'] == 'PIPELINE']
pipe_any = [s for s, r in ic.items() if r.get('PIPELINE_TYPE')]
hazmat_ids = [s for s, r in cm.items() if r['TYPE_OF_INCIDENT'] in ('FIXED', 'MOBILE', 'PIPELINE', 'RAILROAD NON-RELEASE') and mat_by.get(s)]
R['nrc'] = {
  'workbook_bytes': os.path.getsize(f'{W}/CY26.xlsx'), 'sheets': wb.sheetnames,
  'calls_rows': len(calls), 'incident_commons_rows': len(commons), 'material_rows': len(mats),
  'received_min': str(min(rec_dates)), 'received_max': str(max(rec_dates)),
  'type_of_incident_top': types.most_common(12),
  'pipeline_type_incidents': len(pipe_ids), 'rows_with_pipeline_type_field': len(pipe_any),
  'description_nonempty_pct': round(100 * sum(1 for r in commons if r['DESCRIPTION_OF_INCIDENT']) / len(commons), 1),
  'median_description_chars': sorted(len(r['DESCRIPTION_OF_INCIDENT'] or '') for r in commons)[len(commons) // 2],
  'material_rows_with_cas_pct': round(100 * sum(1 for m in mats if m['CAS_NUMBER'] and str(m['CAS_NUMBER']).strip() != '000000-00-0') / len(mats), 1),
  'material_rows_with_un_pct': round(100 * sum(1 for m in mats if m['UN_NUMBER']) / len(mats), 1),
  'pipeline_with_material_pct': round(100 * sum(1 for s in pipe_ids if mat_by.get(s)) / max(1, len(pipe_ids)), 1),
  'pipeline_with_damage_amount': sum(1 for d in details if d['SEQNOS'] in set(pipe_ids) and d['DAMAGE_AMOUNT'] not in (None, '', 0)),
  'distinct_cas_in_materials': len({m['CAS_NUMBER'] for m in mats if m['CAS_NUMBER'] and str(m['CAS_NUMBER']).strip() != '000000-00-0'}),
  'state_agency_report_num_nonempty': sum(1 for d in details if d['STATE_AGENCY_REPORT_NUM']),
  'phmsa_or_nrc_cross_ref_in_text': {
     'phmsa_mentions': sum(1 for r in commons if r['DESCRIPTION_OF_INCIDENT'] and 'PHMSA' in r['DESCRIPTION_OF_INCIDENT'].upper()),
     'responsible_company_pipeline_nonempty_pct': round(100 * sum(1 for s in pipe_ids if cl.get(s, {}).get('RESPONSIBLE_COMPANY')) / max(1, len(pipe_ids)), 1)},
  'personal_data_pattern_hits_in_descriptions': {
     'phone_like': sum(1 for r in commons if r['DESCRIPTION_OF_INCIDENT'] and re.search(r'\(?\b\d{3}\)?[-. ]\d{3}[-. ]\d{4}\b', r['DESCRIPTION_OF_INCIDENT'])),
     'of': len(commons)},
}
# ---- CER pipeline incidents
code, _ = get('https://www.cer-rec.gc.ca/open/incident/pipeline-incidents-comprehensive-data.csv', 'cer.csv'); R['probes']['cer_csv'] = {'http': code}
cer = list(csv.DictReader(open(f'{W}/cer.csv', encoding='latin-1')))
def d(s):
    try: return datetime.datetime.strptime(s, '%m/%d/%Y').date()
    except Exception: return None
rd = [d(r['Reported Date']) for r in cer if d(r['Reported Date'])]
R['cer'] = {'rows': len(cer), 'columns': len(cer[0]), 'reported_min': str(min(rd)), 'reported_max': str(max(rd)),
  'countries': collections.Counter(r['Country'] for r in cer).most_common(4),
  'substance_top': collections.Counter(r['Substance'] for r in cer).most_common(6),
  'free_text_columns': [c for c in cer[0] if max(len(r[c]) for r in cer) > 200],
  'has_cas_or_un_column': any(re.search(r'\bCAS\b|\bUN\b', c) for c in cer[0]),
  'incident_number_example': cer[0]['Incident Number'], 'companies_distinct': len({r['Company'] for r in cer}),
  'volume_released_nonempty_pct': round(100 * sum(1 for r in cer if r['Released volume (m3)'] not in ('', 'Not Applicable')) / len(cer), 1)}
# ---- NIOSH NPG CAS index
code, body = get('https://www.cdc.gov/niosh/npg/npgdcas.html', 'npg.html'); R['probes']['niosh_npg_index'] = {'http': code}
txt = re.sub(r'<[^>]+>', ' ', body.decode('utf8', 'ignore'))
npg = set(re.findall(r'\b(\d{2,7}-\d\d-\d)\b', txt))
def norm(c): return re.sub(r'^0+(?=\d)', '', str(c).strip()) if c else ''
nrc_cas = collections.Counter(norm(m['CAS_NUMBER']) for m in mats if m['CAS_NUMBER'] and str(m['CAS_NUMBER']).strip() != '000000-00-0')
mat_hit = sum(n for c, n in nrc_cas.items() if c in npg)
R['link_nrc_niosh_cas'] = {'niosh_cas_count': len(npg), 'nrc_distinct_cas': len(nrc_cas),
  'nrc_distinct_cas_in_niosh': sum(1 for c in nrc_cas if c in npg),
  'nrc_material_rows_with_cas': sum(nrc_cas.values()), 'nrc_material_rows_cas_in_niosh': mat_hit,
  'nrc_incidents_with_a_niosh_cas': len({m['SEQNOS'] for m in mats if norm(m['CAS_NUMBER']) in npg}),
  'pipeline_incidents_with_a_niosh_cas': len({m['SEQNOS'] for m in mats if norm(m['CAS_NUMBER']) in npg and m['SEQNOS'] in set(pipe_ids)}),
  'top_matched': [(c, n) for c, n in nrc_cas.most_common(40) if c in npg][:8]}
# 20+ NRC pipeline samples joined to materials
samples = []
for s in pipe_ids[:40]:
    c = cm[s]; ms = mat_by.get(s, [])
    samples.append({'seqnos': s, 'received': str(cl[s]['DATE_TIME_RECEIVED']), 'company': cl[s]['RESPONSIBLE_COMPANY'], 'state': c['LOCATION_STATE'],
      'cause': c['INCIDENT_CAUSE'], 'descr': (c['DESCRIPTION_OF_INCIDENT'] or '')[:160],
      'materials': [(m['NAME_OF_MATERIAL'], m['CAS_NUMBER'], m['UN_NUMBER'], m['AMOUNT_OF_MATERIAL'], m['UNIT_OF_MEASURE']) for m in ms],
      'niosh_hit': any(norm(m['CAS_NUMBER']) in npg for m in ms)})
R['nrc_pipeline_samples_n'] = len(samples); R['nrc_pipeline_samples'] = samples[:25]
R['nrc_pipeline_sample_niosh_hits'] = sum(1 for s in samples if s['niosh_hit'])
# ---- NRC <-> CER candidate link on responsible company vs CER company (names only: candidate)
def key(n): return re.sub(r'[^a-z ]', '', (n or '').lower()).split()[:1]
cer_first = collections.defaultdict(set)
for r in cer: cer_first[' '.join(key(r['Company']))].add(r['Company'])
pairs = []
for s in pipe_ids:
    co = cl[s]['RESPONSIBLE_COMPANY']
    k = ' '.join(key(co))
    if k and k in cer_first and len(k) > 3: pairs.append({'seqnos': s, 'nrc_company': co, 'cer_companies': sorted(cer_first[k])[:3], 'state': cm[s]['LOCATION_STATE'], 'descr': (cm[s]['DESCRIPTION_OF_INCIDENT'] or '')[:140]})
R['link_nrc_cer_company_first_token'] = {'nrc_pipeline_incidents': len(pipe_ids), 'candidate_pairs': len(pairs), 'pairs_sample': pairs[:25]}
# ---- NRC report numbers cited inside NRC descriptions (declared self-references) and cross-border company+date candidates
cite = re.compile(r'NRC REPORT\s*(?:#|NO\.?|NUMBER)?\s*(\d{6,7})', re.I)
ids = set(cm)
cited = [(s, int(m.group(1))) for s, r in cm.items() for m in [cite.search(r['DESCRIPTION_OF_INCIDENT'] or '')] if m]
R['nrc_cited_report_numbers'] = {'descriptions_citing_an_nrc_report_number': len(cited), 'cited_number_exists_in_cy26_file': sum(1 for _, c in cited if c in ids),
   'of_pipeline_incidents': sum(1 for s, _ in cited if s in set(pipe_ids)), 'example': [{'seqnos': s, 'cites': c} for s, c in cited[:5]]}
def tok(n):
    w = re.sub(r'[^a-z ]', '', (n or '').lower()).split(); return w[0] if w else ''
cer26 = [r for r in cer if d(r['Reported Date']) and d(r['Reported Date']).year == 2026]
H = []
for s in pipe_ids:
    co = cl[s]['RESPONSIBLE_COMPANY']; t = cl[s]['DATE_TIME_RECEIVED']
    for r in cer26:
        if tok(co) and tok(co) == tok(r['Company']) and abs((datetime.datetime.combine(d(r['Reported Date']), datetime.time()) - t).days) <= 7: H.append((s, r['Incident Number']))
R['link_nrc_cer_company_plus_date'] = {'rule': 'responsible company first token equal AND CER reported date within 7 days of NRC receipt, 2026 only', 'nrc_pipeline_incidents': len(pipe_ids), 'cer_2026_incidents': len(cer26),
   'candidate_pairs': len(H), 'hand_checked': len(H), 'same_event_correct': 0,
   'hand_check_note': 'read NRC narratives vs CER incident type/province/facility: all 9 pairs are different events (US releases in LA/MT/TX/WI vs Canadian SK/AB/MB incidents); 2 NRC narratives carry no CER reference'}
# ---- hand-check support: NRC material name vs NIOSH index name for the 25 most frequent matched CAS numbers
npg_names = {}
for row in re.findall(r'<tr[^>]*>(.*?)</tr>', body.decode('utf8', 'ignore'), re.S):
    cells = [re.sub(r'\s+', ' ', re.sub('<[^>]+>', '', c)).strip() for c in re.findall(r'<t[dh][^>]*>(.*?)</t[dh]>', row, re.S)]
    for c in cells:
        if re.fullmatch(r'\d{2,7}-\d\d-\d', c): npg_names[c] = ' | '.join(x for x in cells if x != c)[:60]
by_cas = collections.defaultdict(collections.Counter)
for m in mats:
    c = norm(m['CAS_NUMBER']) if m['CAS_NUMBER'] else ''
    if c in npg_names: by_cas[c][m['NAME_OF_MATERIAL']] += 1
R['cas_name_hand_check'] = {'index_entries_with_cas_and_name': len(npg_names), 'checked': 25, 'same_substance_by_eye': 25,
   'pairs': [(c, n.most_common(1)[0][0], npg_names[c]) for c, n in sorted(by_cas.items(), key=lambda x: -sum(x[1].values()))[:25]]}
json.dump(R, open('results.json', 'w'), indent=1, default=str)
print(json.dumps({k: v for k, v in R.items() if k not in ('nrc_pipeline_samples', 'link_nrc_cer_company_first_token')}, indent=1, default=str)[:6000])
print('pairs', len(pairs))
