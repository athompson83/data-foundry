#!/usr/bin/env python3
"""Screen water-system-compliance members (2026-10-04). Needs openpyxl. Work dir caches downloads (default /tmp/wsc)."""
import csv, io, json, os, re, statistics, sys, time, urllib.request, zipfile, random
W = sys.argv[1] if len(sys.argv) > 1 else '/tmp/wsc'; os.makedirs(W, exist_ok=True)
H = {"User-Agent": "data-foundry-scout (data@mail.proviciency.com)"}
def get(u, timeout=60):
    print("GET", u[:110], flush=True)
    time.sleep(0.6); return urllib.request.urlopen(urllib.request.Request(u, headers=H), timeout=timeout).read()
def cached(name, u):
    p = f'{W}/{name}'
    if not os.path.exists(p): open(p, 'wb').write(get(u))
    return p
def jget(u): return json.loads(get(u, 60))
EF = 'https://data.epa.gov/efservice'
R = {}
# --- EPA SDWIS via Envirofacts
R['epa_counts'] = {t: jget(f'{EF}/{t}/COUNT/JSON')[0]['TOTALQUERYRESULTS'] for t in ['WATER_SYSTEM', 'VIOLATION', 'ENFORCEMENT_ACTION']}
R['epa_ca_counts'] = {t: jget(f'{EF}/{t}/pwsid/BEGINNING/CA/COUNT/JSON')[0]['TOTALQUERYRESULTS'] for t in ['WATER_SYSTEM', 'VIOLATION', 'ENFORCEMENT_ACTION']}
ws = []
p = f'{W}/ca_ws_all.json'
if os.path.exists(p): ws = json.load(open(p))
else:
    while len(ws) < R['epa_ca_counts']['WATER_SYSTEM']:
        page = jget(f"{EF}/WATER_SYSTEM/pwsid/BEGINNING/CA/rows/{len(ws)}:{len(ws)+4000}/JSON")
        if not page: break
        ws += page
    json.dump(ws, open(p, 'w'))
viol = json.load(open(f'{W}/ca_viol.json')) if os.path.exists(f'{W}/ca_viol.json') else jget(f"{EF}/VIOLATION/pwsid/BEGINNING/CA/rows/0:2000/JSON")
enf = json.load(open(f'{W}/ca_enf.json')) if os.path.exists(f'{W}/ca_enf.json') else jget(f"{EF}/ENFORCEMENT_ACTION/pwsid/BEGINNING/CA/rows/0:5000/JSON")
json.dump(viol, open(f'{W}/ca_viol.json', 'w')); json.dump(enf, open(f'{W}/ca_enf.json', 'w'))
dates = lambda rows, k: sorted(r[k] for r in rows if r.get(k))
R['epa'] = {'ws_rows_ca_pulled': len(ws), 'viol_sample': len(viol), 'enf_sample': len(enf),
    'enf_with_comment_text': sum(1 for e in enf if e['enforcement_comment_text']),
    'enf_newest_date': dates(enf, 'enforcement_date')[-1], 'viol_newest_begin': dates(viol, 'compl_per_begin_date')[-1] if dates(viol, 'compl_per_begin_date') else None,
    'ws_fields': sorted(ws[0].keys()), 'viol_fields': sorted(viol[0].keys()), 'enf_fields': sorted(enf[0].keys()),
    'personal_fields_excluded': ['admin_name', 'phone_number', 'email_addr', 'alt_phone_number', 'fax_number'],
    'sample_enf_comments': [e['enforcement_comment_text'][:160] for e in enf if e['enforcement_comment_text']][:5]}
# --- CA SWRCB SAFER
pk = jget('https://data.ca.gov/api/3/action/package_show?id=safer-failing-and-at-risk-drinking-water-systems')['result']
url = [x['url'] for x in pk['resources'] if x['format'] == 'CSV'][0]
sp = f'{W}/safer.csv'
if not os.path.exists(sp): open(sp, 'wb').write(get(url))
safer = list(csv.DictReader(open(sp, encoding='utf-8-sig')))
R['safer'] = {'rows': len(safer), 'cols': len(safer[0]), 'created_date': safer[0]['CREATED_DATE'], 'metadata_modified': pk['metadata_modified'], 'license_title': pk['license_title'],
    'accrual': pk.get('accrualPeriodicity'), 'prose_fields': ['*_THRESHOLD_MET (criterion prose)', 'AUTOMATICALLY_AT_RISK_REASON', '*_ANALYTES'],
    'at_risk_reason_filled': sum(1 for r in safer if r['AUTOMATICALLY_AT_RISK_REASON'].strip())}
# --- Declared join on PWSID: SAFER WATER_SYSTEM_NUMBER == EPA pwsid
ids = {w['pwsid']: w for w in ws}
hit = [r for r in safer if r['WATER_SYSTEM_NUMBER'] in ids]
R['join_pwsid_safer_epa'] = {'matched': len(hit), 'total': len(safer)}
pop = [(int(r['POPULATION'] or 0), ids[r['WATER_SYSTEM_NUMBER']]['population_served_count']) for r in hit]
R['join_pwsid_safer_epa']['population_equal'] = sum(1 for a, b in pop if b is not None and a == b)
R['join_pwsid_safer_epa']['epa_active_status'] = sum(1 for r in hit if ids[r['WATER_SYSTEM_NUMBER']]['pws_activity_code'] == 'A')
# cross-check 25 SAFER systems flagged with a primary-MCL violation against EPA violation records fetched by PWSID
random.seed(7)
flagged = [r for r in safer if r['PRIMARY_MCL_VIOLATION'] == 'YES']
samp = random.sample(flagged, 25)
chk = []
for r in samp:
    try: v = jget(f"{EF}/VIOLATION/pwsid/{r['WATER_SYSTEM_NUMBER']}/rows/0:1000/JSON")
    except Exception as e:
        chk.append({'pwsid': r['WATER_SYSTEM_NUMBER'], 'error': str(e)}); continue
    chk.append({'pwsid': r['WATER_SYSTEM_NUMBER'], 'epa_violations': len(v), 'epa_mcl_violations': sum(1 for x in v if x['violation_category_code'] == 'MCL')})
R['join_pwsid_safer_epa']['mcl_flag_crosscheck'] = {'flagged_total_in_safer': len(flagged), 'sampled': len(chk), 'sampled_with_epa_mcl_record': sum(1 for c in chk if c.get('epa_mcl_violations', 0) > 0), 'errors': sum(1 for c in chk if 'error' in c), 'sample': chk}
# --- Ontario
import openpyxl
zp = cached('on.zip', 'https://files.ontario.ca/moe_mapping/downloads/2Water/DWMD/DW_2024-25-EN.zip')
z = zipfile.ZipFile(zp)
def sheet(n):
    ws_ = openpyxl.load_workbook(io.BytesIO(z.read(n)), read_only=True).worksheets[0]; r = list(ws_.iter_rows(values_only=True)); return r[0], r[1:]
ha, awqi = sheet('English/AWQI Data 2024-25 EN.xlsx'); ho, orders = sheet('English/DWS Orders 2024-25 EN.xlsx'); hi, insp = sheet('English/DWS Inspections 2024-25 EN.xlsx')
L = [len(str(o[6])) for o in orders]
R['ontario'] = {'fiscal_year': '2024-25 (files stamped 2025-11-28; dataset metadata_modified 2026-08-12, yearly)', 'awqi_rows': len(awqi), 'orders_rows': len(orders), 'inspection_rows': len(insp),
    'awqi_cols': list(ha), 'orders_cols': [str(c).strip() for c in ho], 'inspection_cols': list(hi),
    'awqi_incident_range': [str(min(a[7] for a in awqi)), str(max(a[7] for a in awqi))], 'order_issue_range': [str(min(o[10] for o in orders)), str(max(o[10] for o in orders))],
    'order_summary_chars_min_median_max': [min(L), statistics.median(L), max(L)], 'order_summary_sample': str(orders[3][6])[:300],
    'identifier': 'DWS # (Ontario 9-digit, 26xxxxxxx); no US PWSID, no FIPS'}
R['ontario']['join_to_us_members'] = 'none: no shared identifier with PWSID; name-matching across countries not attempted'
json.dump(R, open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'results.json'), 'w'), indent=1, default=str)
print(json.dumps({k: R[k] for k in ['epa_counts', 'epa_ca_counts', 'join_pwsid_safer_epa']}, indent=1, default=str)[:2500])
