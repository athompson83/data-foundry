"""Screening measurements for power-plant-registry (2026-10-17).
Members: EIA Form EIA-860 (annual generator report, Excel), EPA eGRID 2023 (Excel, plant file keyed by ORIS/EIA plant code),
NRC Event Notification Reports (free-text daily HTML, power-reactor events carry a docket number).
Joins: (A) eGRID ORISPL -> EIA-860 plant code (declared); (B) NRC power-reactor facility (+state) -> EIA-860 nuclear plant (candidate; hand-checked
in hand_check.json); also checks whether EIA-860/eGRID carry any NRC docket column.
Run: python3 -I join.py (downloads ~40 MB into a fresh temp dir; <=2 req/s; declared UA; 60 evenly spaced 2026 NRC daily reports)."""
import json, re, os, time, zipfile, tempfile, subprocess, datetime, collections
from xml.etree import ElementTree as ET
UA = 'data-foundry-scout/1.0 (data@mail.proviciency.com)'
HERE = os.path.dirname(os.path.abspath(__file__)); TMP = tempfile.mkdtemp(prefix='ppr-'); log = []
def get(url, name, binary=True):
    p = os.path.join(TMP, name)
    r = subprocess.run(['curl', '-sS', '-L', '-m', '300', '-A', UA, '-o', p, '-w', '%{http_code} %{size_download}', url], capture_output=True, text=True)
    code, size = r.stdout.split(); log.append({'url': url, 'http': int(code), 'bytes': int(size), 'at': datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds')})
    time.sleep(0.6); return p
NS = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
def colidx(ref):
    n = 0
    for ch in re.match(r'[A-Z]+', ref).group(0): n = n * 26 + ord(ch) - 64
    return n - 1
def xlsx_sheet(path, want):
    z = zipfile.ZipFile(path); ss = []
    for ev, el in ET.iterparse(z.open('xl/sharedStrings.xml')):
        if el.tag == NS + 'si': ss.append(''.join(t.text or '' for t in el.iter(NS + 't'))); el.clear()
    wb = ET.fromstring(z.read('xl/workbook.xml')); rels = {r.get('Id'): r.get('Target') for r in ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))}
    names = [(s.get('name'), rels[s.get('{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id')]) for s in wb.iter(NS + 'sheet')]
    name, target = next((n, t) for n, t in names if want(n))
    part = target.lstrip('/') if target.startswith('/') else 'xl/' + target
    rows = []
    for ev, el in ET.iterparse(z.open(part)):
        if el.tag == NS + 'row':
            r = {}
            for c in el.iter(NS + 'c'):
                v = c.find(NS + 'v')
                if v is None: continue
                r[colidx(c.get('r'))] = ss[int(v.text)] if c.get('t') == 's' else v.text
            rows.append([r.get(i) for i in range(max(r) + 1)] if r else []); el.clear()
    return name, rows
def table(rows, key):
    h = next(i for i, r in enumerate(rows) if key in r)
    hdr = rows[h]; return hdr, [dict(zip(hdr, r + [None] * (len(hdr) - len(r)))) for r in rows[h + 1:] if r]
# ---- EIA-860 (2025 final)
p = get('https://www.eia.gov/electricity/data/eia860/xls/eia8602025.zip', 'eia860.zip')
z = zipfile.ZipFile(p); out = os.path.join(TMP, 'eia'); z.extractall(out)
files = sorted(os.listdir(out))
pf = next(f for f in files if f.startswith('2___Plant')); gf = next(f for f in files if f.startswith('3_1_Generator'))
_, prow = xlsx_sheet(os.path.join(out, pf), lambda n: n.lower().startswith('plant')); phdr, plants = table(prow, 'Plant Code')
_, grow = xlsx_sheet(os.path.join(out, gf), lambda n: n.lower().startswith('operable')); ghdr, gens = table(grow, 'Plant Code')
eia_codes = {str(int(float(r['Plant Code']))): r for r in plants if r.get('Plant Code')}
nuc_plants = {str(int(float(g['Plant Code']))) for g in gens if g.get('Energy Source 1') == 'NUC'}
# ---- eGRID 2023
p = get('https://www.epa.gov/system/files/documents/2025-06/egrid2023_data_rev2.xlsx', 'egrid.xlsx')
_, erow = xlsx_sheet(p, lambda n: n.upper().startswith('PLNT')); ehdr, eplants = table(erow, 'ORISPL')
eg = {str(int(float(r['ORISPL']))): r for r in eplants if r.get('ORISPL')}
A_match = [k for k in eg if k in eia_codes]
docket_cols = [c for c in (phdr + ghdr + ehdr) if c and 'docket' in str(c).lower()]
# NOTE: the NRC power-reactor event layout has Facility/Unit/State but no Docket field (checked below).
# ---- NRC event notification reports (sample of 2026 daily pages)
idx = subprocess.run(['curl', '-sS', '-L', '-A', UA, 'https://www.nrc.gov/reading-rm/doc-collections/event-status/event/2026/'], capture_output=True, text=True).stdout
log.append({'url': 'https://www.nrc.gov/reading-rm/doc-collections/event-status/event/2026/', 'http': 200, 'bytes': len(idx)})
days = sorted(set(re.findall(r'href="([^"]*/2026/(2026\d{4})en)"', idx)), key=lambda x: x[1])
step = max(1, len(days) // 60); sample = days[::step][:60]
events = []; pages = []
for href, d in sample:
    pth = get('https://www.nrc.gov' + href, f'en{d}.html'); h = open(pth, encoding='utf-8', errors='replace').read()
    t = re.sub(r'<script.*?</script>|<style.*?</style>', '', h, flags=re.S); t = re.sub(r'<[^>]+>', '\n', t); t = re.sub(r'&nbsp;', ' ', t); t = re.sub(r'\n\s*\n+', '\n', t)
    pages.append(d)
    for blk in re.split(r'\n(?=(?:Power Reactor|Agreement State|Non-Agreement State|Part 21|Fuel Cycle Facility|Research and Test Reactor|Test and Research Reactor|Hospital|Other[^\n]{0,30})\nEvent Number)', t)[1:]:
        kind = blk.split('\n', 1)[0].strip()
        g = lambda k: (re.search(k + r':\s*\n?\s*([^\n]*)', blk) or [None, None])[1]
        txt = re.search(r'Event Text\s*\n(.*)', blk, re.S)
        events.append({'day': d, 'kind': kind, 'event': g('Event Number'), 'facility': g('Facility') or g('Licensee'), 'unit': g('Unit'), 'docket': g('Docket'), 'state': g('State'), 'event_text_chars': len(txt.group(1)) if txt else 0})
reactor = [e for e in events if e['kind'] == 'Power Reactor']
fac = {}
for e in reactor: fac.setdefault((e['facility'] or '').strip(), e)
norm = lambda s: re.sub(r'[^a-z0-9]+', ' ', re.sub(r'\b(nuclear|power|plant|station|generating|energy|center|units?|facility)\b', ' ', (s or '').lower())).strip()
eia_nuc = {k: v for k, v in eia_codes.items() if k in nuc_plants}
B = []
for name, e in fac.items():
    c = [k for k, v in eia_nuc.items() if (v.get('State') == e['state']) and (norm(v['Plant Name']) == norm(name) or norm(v['Plant Name']) in norm(name) or norm(name) in norm(v['Plant Name']))]
    B.append({'nrc_facility': name, 'nrc_docket': e['docket'], 'nrc_state': e['state'], 'eia_candidates': [{'plant_code': k, 'plant_name': eia_nuc[k]['Plant Name'], 'state': eia_nuc[k]['State']} for k in c]})
hc = json.load(open(os.path.join(HERE, 'hand_check.json'))) if os.path.exists(os.path.join(HERE, 'hand_check.json')) else None
res = {'run_at': datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds'), 'requests': log,
 'eia860': {'release': '2025 final (released 2026-09-10 per the EIA-860 page)', 'plants': len(eia_codes), 'operable_generators': len(gens), 'nuclear_plants': len(nuc_plants), 'plant_columns': phdr},
 'egrid2023': {'plants': len(eg), 'columns_sample': ehdr[:12]},
 'docket_columns_in_eia860_or_egrid': docket_cols,
 'nrc_sample': {'daily_reports_fetched': len(pages), 'days_available_2026': len(days), 'events': len(events), 'by_kind': collections.Counter(e['kind'] for e in events), 'power_reactor_events': len(reactor),
                'power_reactor_events_with_a_docket_field': sum(1 for e in reactor if e['docket']), 'distinct_power_reactor_facilities': len(fac), 'events_detail': events},
 'join_A_egrid_orispl_to_eia860_plant_code': {'matched': len(A_match), 'total': len(eg), 'unmatched_sample': [k for k in eg if k not in eia_codes][:20]},
 'join_B_nrc_facility_to_eia860_nuclear_plant_candidate': {'facilities': len(B), 'with_exactly_one_candidate': sum(1 for b in B if len(b['eia_candidates']) == 1), 'pairs': B, 'hand_check': ({'checked': hc['checked'], 'correct': hc['correct']} if hc else None)}}
json.dump(res, open(os.path.join(HERE, 'join.json'), 'w'), indent=1, default=dict)
print({k: v for k, v in res.items() if k not in ('requests',)} if False else json.dumps({k: res[k] for k in ('eia860','egrid2023','docket_columns_in_eia860_or_egrid','join_A_egrid_orispl_to_eia860_plant_code')}, default=dict)[:1500])
print({k: v for k, v in res['nrc_sample'].items() if k != 'events_detail'}); print(res['join_B_nrc_facility_to_eia860_nuclear_plant_candidate']['facilities'], res['join_B_nrc_facility_to_eia860_nuclear_plant_candidate']['with_exactly_one_candidate'])
