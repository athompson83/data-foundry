#!/usr/bin/env python3
"""Screen workplace-injury-incident-narratives (2026-10-01). Polite, UA-labelled, small samples.
MSHA Accidents.zip is 52 MB, so only a 25 MB byte range is fetched (limit: <50 MB) and stream-inflated;
the first ~48% of the table is therefore measured, not the whole."""
import csv, io, json, os, re, struct, subprocess, sys, time, zipfile, zlib, collections
UA = 'User-Agent: data-foundry-scout (data@mail.proviciency.com)'
S = os.environ.get('SCRATCH', '/tmp/wi'); os.makedirs(S, exist_ok=True)
def curl(url, out=None, rng=None, head=False):
    cmd = ['curl', '-sS', '-m', '120', '-L', '-H', UA, '-w', '%{http_code} %{size_download}']
    if head: cmd += ['-I', '-o', '/dev/null', '-w', '%{http_code} %header{content-length} %header{last-modified}']
    elif out: cmd += ['-o', out]
    else: cmd += ['-o', '/dev/null']
    if rng: cmd += ['-r', rng]
    time.sleep(0.6)
    return subprocess.run(cmd + [url], capture_output=True, text=True).stdout.strip().split('\n')[-1]
R = {'reach': {}}
for k, u in {
 'osha_severe_injury_page': 'https://www.osha.gov/severe-injury',
 'osha_severe_injury_csv': 'https://www.osha.gov/sites/default/files/severeinjury.csv',
 'osha_disclaimers': 'https://www.osha.gov/disclaimers',
 'enforcedata_catalog': 'https://enforcedata.dol.gov/views/data_catalogs.php',
 'msha_ogi_page': 'https://arlweb.msha.gov/OpenGovernmentData/OGIMSHA.asp',
 'msha_accidents_zip': 'https://arlweb.msha.gov/OpenGovernmentData/DataSets/Accidents.zip',
 'msha_mines_zip': 'https://arlweb.msha.gov/OpenGovernmentData/DataSets/Mines.zip',
 'dol_copyright': 'https://www.dol.gov/general/aboutdol/copyright',
 'neiss_page': 'https://www.cpsc.gov/Research--Statistics/NEISS-Injury-Data',
 'eia_copyright': 'https://www.eia.gov/about/copyrights_reuse.php',
 'eia_coalpublic2022': 'https://www.eia.gov/coal/data/public/xls/coalpublic2022.xls',
 'eia_coalpublic2023': 'https://www.eia.gov/coal/data/public/xls/coalpublic2023.xls',
}.items():
    R['reach'][k] = curl(u, head=True)
# MSHA accidents (range)
acc = f'{S}/acc_part.zip'
if not os.path.exists(acc): R['acc_fetch'] = curl('https://arlweb.msha.gov/OpenGovernmentData/DataSets/Accidents.zip', acc, '0-24999999')
d = open(acc, 'rb').read()
nl, el = struct.unpack('<HH', d[26:30])
txt = zlib.decompressobj(-15).decompress(d[30+nl+el:]).decode('latin-1')
last_nl = txt.rfind('\n'); txt = txt[:last_nl]
rows = list(csv.DictReader(io.StringIO(txt), delimiter='|'))
rows = [r for r in rows if r.get('MINE_ID')]
R['msha_accidents'] = {'partial_bytes_fetched': 25000000, 'full_zip_bytes': 52240903, 'rows_parsed_partial': len(rows),
  'fields': list(rows[0].keys())}
dt = lambda r: (r['ACCIDENT_DT'][6:]+r['ACCIDENT_DT'][:2]+r['ACCIDENT_DT'][3:5]) if r['ACCIDENT_DT'] else ''
ds = sorted(x for x in map(dt, rows) if x)
R['msha_accidents'].update(oldest=ds[0], newest_in_partial=ds[-1])
nar = [r for r in rows if r['NARRATIVE'].strip()]
R['msha_accidents']['rows_with_narrative'] = len(nar)
R['msha_accidents']['narrative_pct'] = round(100*len(nar)/len(rows), 1)
R['msha_accidents']['narrative_by_year_pct'] = {y: round(100*sum(1 for r in rows if r['CAL_YR']==y and r['NARRATIVE'].strip())/n, 1) for y, n in sorted(collections.Counter(r['CAL_YR'] for r in rows).items()) if int(y) % 5 == 0}
R['msha_accidents']['rows_per_year'] = dict(sorted(collections.Counter(r['CAL_YR'] for r in rows).items())[-6:])
R['msha_accidents']['degree_injury'] = collections.Counter(r['DEGREE_INJURY'] for r in rows).most_common(8)
R['msha_accidents']['has_contractor_id_pct'] = round(100*sum(1 for r in rows if r['CONTRACTOR_ID'])/len(rows), 1)
R['msha_accidents']['has_operator_id_pct'] = round(100*sum(1 for r in rows if r['OPERATOR_ID'])/len(rows), 1)
# Mines
mz = f'{S}/Mines.zip'
if not os.path.exists(mz): R['mines_fetch'] = curl('https://arlweb.msha.gov/OpenGovernmentData/DataSets/Mines.zip', mz)
mt = zipfile.ZipFile(mz).read('Mines.txt').decode('latin-1')
mines = {r['MINE_ID']: r for r in csv.DictReader(io.StringIO(mt), delimiter='|') if r.get('MINE_ID')}
R['msha_mines'] = {'rows': len(mines), 'fields': list(next(iter(mines.values())).keys())}
# declared join: accidents.MINE_ID -> Mines.MINE_ID (same publisher, MSHA) on a 2000-row sample
import random; random.seed(1)
samp = random.sample(rows, 2000)
R['join_acc_to_mines'] = {'total': len(samp), 'matched': sum(1 for r in samp if r['MINE_ID'] in mines)}
# EIA coal producers (independent publisher) keyed by MSHA ID
def eia(path):
    s = open(path, encoding='latin-1').read()
    out = []
    for r in re.findall(r'<Row.*?</Row>', s, re.S):
        c = [re.sub('<[^>]+>', '', x).strip() for x in re.findall(r'<Cell.*?</Cell>', r, re.S)]
        out.append(c)
    h = next(i for i, c in enumerate(out) if c[:2] == ['Year', 'MSHA ID'])
    return [dict(zip(out[h], c)) for c in out[h+1:] if len(c) >= 10 and c[1].isdigit()]
ep = f'{S}/coal2022.xls'
if not os.path.exists(ep): R['eia_fetch'] = curl('https://www.eia.gov/coal/data/public/xls/coalpublic2022.xls', ep)
coal = eia(ep)
R['eia_coal2022'] = {'rows': len(coal), 'year': coal[0]['Year'], 'fields': list(coal[0].keys())}
byid = {r['MSHA ID'].zfill(7): r for r in coal}
# restrict accidents to coal mines (COAL_METAL_IND == 'C') in 2022 or any year; link by MINE_ID == EIA MSHA ID
coal_acc = [r for r in rows if r['COAL_METAL_IND'] == 'C']
R['msha_accidents']['coal_rows_partial'] = len(coal_acc)
yrs = collections.Counter(r['CAL_YR'] for r in coal_acc)
tot = len(coal_acc); m = [r for r in coal_acc if r['MINE_ID'] in byid]
R['join_acc_to_eia_all_years'] = {'total_coal_accidents_partial': tot, 'matched_to_2022_EIA_mine': len(m),
   'note': 'EIA 2022 file lists only mines producing/employing in 2022; older accidents at closed mines cannot match'}
recent = [r for r in coal_acc if int(r['CAL_YR']) >= 2020]
mr = [r for r in recent if r['MINE_ID'] in byid]
R['join_acc_to_eia_2020plus'] = {'total': len(recent), 'matched': len(mr)}
# distinct mines in accidents vs EIA
am = {r['MINE_ID'] for r in coal_acc if int(r['CAL_YR']) >= 2020}
R['join_mine_ids_2020plus'] = {'distinct_accident_coal_mines': len(am), 'in_EIA_2022': len(am & set(byid))}
# hand check: 25 matched records: EIA state/name vs MSHA mine name/state
fips = {}
check = []
random.seed(2)
for r in random.sample(mr, min(25, len(mr))):
    mm = mines.get(r['MINE_ID'], {}); e = byid[r['MINE_ID']]
    check.append({'mine_id': r['MINE_ID'], 'msha_mine': mm.get('CURRENT_MINE_NAME'), 'eia_mine': e['Mine Name'], 'msha_state': mm.get('STATE'), 'eia_state': e['Mine State'],
                  'msha_operator_acc': r['OPERATOR_NAME'], 'eia_operator': e['Operating Company'], 'doc_no': r['DOCUMENT_NO'], 'date': r['ACCIDENT_DT']})
R['check_sample'] = check
R['check_name_agree'] = sum(1 for c in check if c['msha_mine'] and c['msha_mine'].lower()[:6] == c['eia_mine'].lower()[:6])
# samples: 20+ narratives from recent MSHA, 20+ EIA rows
R['sample_accidents'] = [{k: r[k] for k in ('MINE_ID', 'DOCUMENT_NO', 'ACCIDENT_DT', 'OPERATOR_ID', 'OPERATOR_NAME', 'DEGREE_INJURY', 'NATURE_INJURY', 'NARRATIVE')} for r in nar[-1:-26:-1]]
R['sample_eia'] = [{k: r[k] for k in ('MSHA ID', 'Mine Name', 'Mine State', 'Operating Company', 'Production (short tons)', 'Average Employees')} for r in coal[:20]]
# NAICS present in MSHA?
R['msha_has_naics_field'] = any('NAICS' in f for f in R['msha_accidents']['fields'])
R['msha_narrative_len_median'] = sorted(len(r['NARRATIVE']) for r in nar)[len(nar)//2]
R['mines_nonblank'] = {f: sum(1 for m_ in mines.values() if m_.get(f)) for f in ('CURRENT_MINE_NAME','STATE','CURRENT_OPERATOR_ID','COAL_METAL_IND')}
json.dump(R, open('results.json', 'w'), indent=1, default=list)
print(json.dumps({k: v for k, v in R.items() if not k.startswith('sample')}, indent=1, default=list)[:6000])
