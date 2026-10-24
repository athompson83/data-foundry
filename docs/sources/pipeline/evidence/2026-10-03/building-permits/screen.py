#!/usr/bin/env python3
"""Screen the building-permits data type (2026-10-03). Writes results.json next to this script.

Polite: <=2 req/s, small samples, no keys, no login. Re-run: python3 screen.py
"""
import json, os, re, time, urllib.parse, urllib.request, collections

UA = {'User-Agent': 'data-foundry-scout (data@mail.proviciency.com)'}
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'results.json')
R = {}


def get(url, timeout=60):
    time.sleep(0.5)
    req = urllib.request.Request(url, headers=UA)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, json.loads(r.read().decode('utf-8', 'replace'))
    except urllib.error.HTTPError as e:
        return e.code, None
    except Exception as e:  # noqa
        return 0, str(e)


def soda(host, rid, **params):
    q = urllib.parse.urlencode({('$' + k): v for k, v in params.items()})
    return get(f'https://{host}/resource/{rid}.json?{q}')


def meta(host, rid):
    st, d = get(f'https://{host}/api/views/{rid}.json')
    if not isinstance(d, dict):
        return {'http': st}
    return {
        'http': st, 'name': d.get('name'), 'license': (d.get('license') or {}).get('name'),
        'attribution': d.get('attribution'), 'rows_updated_at': time.strftime('%Y-%m-%d', time.gmtime(d.get('rowsUpdatedAt', 0))),
        'columns': len(d.get('columns', [])),
    }


def norm(s):
    s = (s or '').upper().replace('&', ' AND ')
    s = re.sub(r'[^A-Z0-9 ]', ' ', s)
    stop = {'LLC', 'INC', 'CORP', 'CORPORATION', 'CO', 'COMPANY', 'LTD', 'LP', 'LLP', 'PLLC', 'PC', 'THE', 'DBA', 'INCORPORATED', 'AND'}
    return ' '.join(t for t in s.split() if t not in stop)


# ---- SOURCES: (key, host, resource id, date field, text field, id field)
SRC = {
    'nyc-dob-now': ('data.cityofnewyork.us', 'rbx6-tga4', 'issued_date', 'job_description', 'job_filing_number'),
    'nyc-dob-bis': ('data.cityofnewyork.us', 'ipu4-2q9a', 'dobrundate', None, 'job__'),
    'chicago': ('data.cityofchicago.org', 'ydr8-5enu', 'issue_date', 'work_description', 'permit_'),
    'sf': ('data.sfgov.org', 'i98e-djp9', 'issued_date', 'description', 'permit_number'),
    'sf-contacts': ('data.sfgov.org', '3pee-9qhc', 'from_date', None, 'permit_number'),
    'seattle': ('data.seattle.gov', '76t5-zqzr', 'issueddate', 'description', 'permitnum'),
    'la-issued': ('data.lacity.org', 'pi9x-tg5x', 'issue_date', 'work_desc', 'permit_nbr'),
}
for k, (host, rid, datef, textf, idf) in SRC.items():
    e = {'meta': meta(host, rid)}
    st, c = soda(host, rid, select='count(*)')
    e['count_http'] = st
    e['count'] = int(c[0]['count']) if isinstance(c, list) and c else None
    st, m = soda(host, rid, select=f'max({datef}) as newest,min({datef}) as oldest')
    e['date_range'] = m[0] if isinstance(m, list) and m else None
    if textf:
        st, m = soda(host, rid, select='count(*)', where=f"{textf} is not null and {textf}!=''")
        e['text_nonempty'] = int(m[0]['count']) if isinstance(m, list) and m else None
    R[k] = e

# ---- Sample 40 recent records per member (for the parked ones too, to record field coverage and PII exposure)
samples = {}
for k, (host, rid, datef, textf, idf) in SRC.items():
    st, rows = soda(host, rid, limit=40, where=f'{datef} is not null', order=f'{datef} desc')
    samples[k] = rows if isinstance(rows, list) else []
    R[k]['sample_http'] = st
    R[k]['sample_n'] = len(samples[k])
    if textf and samples[k]:
        R[k]['sample_text_examples'] = [str(r.get(textf, ''))[:140] for r in samples[k][:3]]
    if samples[k]:
        R[k]['sample_newest'] = max(str(r.get(datef, ''))[:10] for r in samples[k])

# ---- Personal-data exposure per member (field presence in the 40-row sample)
pii = {
    'nyc-dob-now': ['owner_name', 'applicant_first_name', 'applicant_last_name', 'filing_representative_first_name', 'owner_street_address'],
    'nyc-dob-bis': ['permittee_s_first_name', 'permittee_s_last_name', 'permittee_s_phone__', 'owner_s_first_name', 'owner_s_last_name', 'superintendent_first___last_name'],
    'chicago': ['contact_1_name', 'contact_2_name', 'contact_3_name'],
    'sf': [],
    'sf-contacts': ['first_name', 'last_name', 'agent_address'],
    'seattle': [],
    'la-issued': [],
}
for k, fields in pii.items():
    rows = samples[k]
    R[k]['pii_fields_present_in_sample'] = {f: sum(1 for r in rows if r.get(f) not in (None, '', 'N/A')) for f in fields}

# Contractor fields per member
if samples['seattle']:
    R['seattle']['sample_contractor_name_present'] = sum(1 for r in samples['seattle'] if r.get('contractorcompanyname'))
if samples['la-issued']:
    R['la-issued']['sample_has_contractor_field'] = False  # no contractor column in metadata
    R['la-issued']['sample_apn_present'] = sum(1 for r in samples['la-issued'] if r.get('apn'))
if samples['chicago']:
    types = collections.Counter()
    for r in samples['chicago']:
        for i in range(1, 16):
            t = r.get(f'contact_{i}_type')
            if t:
                types[t] += 1
    R['chicago']['sample_contact_types'] = dict(types.most_common(8))
    R['chicago']['sample_pin_list_present'] = sum(1 for r in samples['chicago'] if r.get('pin_list'))
    R['chicago']['contractor_licence_column'] = False

# ---- Contractor-licence field presence, NYC BIS
st, m = soda('data.cityofnewyork.us', 'ipu4-2q9a', select='count(*)', where="hic_license is not null and hic_license!=''")
R['nyc-dob-bis']['rows_with_hic_license'] = int(m[0]['count']) if isinstance(m, list) else None
st, m = soda('data.cityofnewyork.us', 'ipu4-2q9a', select='max(issuance_date)', where="issuance_date like '%/%/2026'")
R['nyc-dob-bis']['has_2026_issuance_rows'] = m if isinstance(m, list) else None

# ---- SF contacts: contractor role + CSLB licence number coverage
st, m = soda('data.sfgov.org', '3pee-9qhc', select='role,count(*)', group='role', order='count desc', limit=6)
R['sf-contacts']['top_roles'] = m
st, m = soda('data.sfgov.org', '3pee-9qhc', select='count(*)', where="role='contractor' and license1 is not null")
R['sf-contacts']['contractor_rows_with_license1'] = int(m[0]['count']) if isinstance(m, list) else None

# ---- LINK 1 (declared, independent publishers): SF DBI permits -> SF Assessor secured roll, block + lot
sf_rows = [r for r in samples['sf'] if r.get('block') and r.get('lot')]
# widen to 60 distinct recent permits across recent filing dates for a bigger test
st, more = soda('data.sfgov.org', 'i98e-djp9', limit=60, where="issued_date > '2025-01-01' and block is not null and lot is not null", order='issued_date desc')
sf_rows = [r for r in (more if isinstance(more, list) else []) if r.get('block') and r.get('lot')]
matched, details = 0, []
latest_roll = None
st, mr = soda('data.sfgov.org', 'wv5m-vpq2', select='max(closed_roll_year)')
latest_roll = mr[0].get('max_closed_roll_year') if isinstance(mr, list) and mr else None
for r in sf_rows:
    blk, lot = r['block'], r['lot']
    st, a = soda('data.sfgov.org', 'wv5m-vpq2', select='parcel_number,property_location,use_definition,year_property_built,closed_roll_year', where=f"block='{blk}' and lot='{lot}'", order='closed_roll_year desc', limit=1)
    hit = bool(isinstance(a, list) and a)
    matched += hit
    if len(details) < 8:
        details.append({'permit': r['permit_number'], 'block': blk, 'lot': lot, 'address': f"{r.get('street_number')} {r.get('street_name')} {r.get('street_suffix')}", 'assessor': a[0] if hit else None})
R['link_sf_permit_to_assessor_block_lot'] = {
    'mode': 'declared (parcel block+lot names the counterpart parcel)', 'total': len(sf_rows), 'matched': matched,
    'assessor_latest_closed_roll_year': latest_roll, 'examples': details,
    'distinct_parcels': len({(r['block'], r['lot']) for r in sf_rows}), 'distinct_permits': len({r['permit_number'] for r in sf_rows}),
}
# Address cross-check on matches: assessor property_location contains the street name token
chk = 0
for d in details:
    if d['assessor']:
        chk += int(str(d['assessor']['property_location']).upper().find(str(d['address']).split()[1].upper()) >= 0)
R['link_sf_permit_to_assessor_block_lot']['address_consistency_of_shown_examples'] = f"{chk}/{sum(1 for d in details if d['assessor'])}"

# ---- LINK 2 (candidate, independent publishers): Seattle SDCI contractor company name -> WA L&I contractor licences
st, sea = soda('data.seattle.gov', '76t5-zqzr', limit=120, where="contractorcompanyname is not null and issueddate > '2025-06-01'", order='issueddate desc')
sea = sea if isinstance(sea, list) else []
seen, pairs = set(), []
for r in sea:
    n = norm(r['contractorcompanyname'])
    if len(n) >= 6 and n not in seen:
        seen.add(n)
        pairs.append(r)
    if len(pairs) >= 40:
        break
hits = []
for r in pairs:
    n = norm(r['contractorcompanyname'])
    first = n.split()[0].replace("'", '')
    st, w = soda('data.wa.gov', 'm8qx-ubtq', select='businessname,contractorlicensenumber,businesstypecodedesc,city,zip,contractorlicensestatus,ubi', where=f"upper(businessname) like '{first}%' and businesstypecodedesc!='Individual'", limit=200)
    cands = [x for x in (w if isinstance(w, list) else []) if norm(x.get('businessname')) == n]
    if cands:
        c = cands[0]
        hits.append({'seattle_name': r['contractorcompanyname'], 'seattle_permit': r['permitnum'], 'seattle_address': r.get('originaladdress1'), 'wa_name': c['businessname'], 'wa_licence': c['contractorlicensenumber'], 'wa_city': c.get('city'), 'wa_zip': c.get('zip'), 'wa_type': c.get('businesstypecodedesc'), 'wa_status': c.get('contractorlicensestatus'), 'n_wa_candidates': len(cands)})
st, m = soda('data.seattle.gov', '76t5-zqzr', select='count(*)', where="contractorcompanyname is not null and contractorcompanyname!=''")
sea_contractor_rows = int(m[0]['count']) if isinstance(m, list) else None
R['link_seattle_contractor_to_wa_lni'] = {
    'mode': 'candidate (normalised name only; Seattle publishes no licence number)', 'distinct_contractor_names_tested': len(pairs), 'name_matches': len(hits),
    'matches': hits,
    'seattle_rows_with_contractor_name': sea_contractor_rows,
}

# ---- NYC (parked) own-publisher checks: BBL present on DOB NOW rows
nyc = samples['nyc-dob-now']
R['nyc-dob-now']['sample_bbl_present'] = sum(1 for r in nyc if r.get('bbl'))
R['nyc-dob-now']['sample_with_description'] = sum(1 for r in nyc if r.get('job_description'))
R['nyc-dob-now']['sample_applicant_license_present'] = sum(1 for r in nyc if r.get('applicant_license'))

for k in samples:  # keep only trimmed identifiers (no personal data) from the samples
    ids = SRC[k][4]
    R[k]['sample_ids'] = [r.get(ids) for r in samples[k]][:40]

with open(OUT, 'w') as f:
    json.dump(R, f, indent=1, default=str)
print('wrote', OUT)
