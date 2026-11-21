#!/usr/bin/env python3
"""Screen rail accident investigation sources (2026-10-04). Writes results.json next to this file.
Polite (<=2 req/s), no keys, no login. NTSB PDFs are cached in a scratch dir, not committed."""
import json, re, time, os, sys, subprocess, urllib.request, urllib.parse, html
UA = {'User-Agent': 'data-foundry-scout (data@mail.proviciency.com)'}
OUT = os.path.dirname(os.path.abspath(__file__))
CACHE = os.environ.get('SCRATCH', '/tmp/w')
os.makedirs(CACHE, exist_ok=True)
R = {}

def get(url, binary=False, timeout=40):
    time.sleep(0.5)
    url = urllib.parse.quote(url, safe=":/?&=$,()*%'!")
    req = urllib.request.Request(url, headers=UA)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            b = r.read()
            return r.status, (b if binary else b.decode('utf-8', 'replace'))
    except urllib.error.HTTPError as e:
        return e.code, ''
    except Exception as e:
        return 0, str(e)

def status(url):
    s, b = get(url, binary=True)
    return s, len(b) if s else 0

# ---- reachability of every candidate
R['reachability'] = {u: status(u)[0] for u in [
    'https://data.transportation.gov/api/views/85tf-25kj.json',
    'https://www.gov.uk/api/search.json?filter_format=raib_report&count=1',
    'https://www.ntsb.gov/about/Pages/Website-Policies.aspx',
    'https://www.ntsb.gov/investigations/AccidentReports/Reports/RIR2301.pdf',
    'https://www.tsb.gc.ca/sites/default/files/stats/RODSdb_MDOTW_VW_OCCURRENCE_PUBLIC.csv',
    'https://www.tsb.gc.ca/sites/default/files/data/en/RODSdb-dd.csv',
    'https://www.atsb.gov.au/rail-investigations',
    'https://www.atsb.gov.au/robots.txt',
    'https://erail.era.europa.eu/',
    'https://railroads.dot.gov/safety-data',
]}

# ---- FRA Form 54 (Socrata)
S = 'https://data.transportation.gov'
fra = {}
s, b = get(f'{S}/api/views/85tf-25kj.json')
meta = json.loads(b)
fra['license'] = {'licenseId': meta.get('licenseId'), 'license': meta.get('license'), 'attribution': meta.get('attribution')}
fra['rowsUpdatedAt'] = meta.get('rowsUpdatedAt')
fra['columns'] = len(meta['columns'])
q = lambda p: json.loads(get(f'{S}/resource/85tf-25kj.json?{p}')[1])
fra['agg'] = q('$select=count(*),min(date),max(date)')[0]
fra['with_narrative'] = q("$select=count(*)&$where=narrative is not null and narrative!=''")[0]
fra['narrative_mentions_NTSB'] = q("$select=count(*)&$where=upper(narrative) like '%25NTSB%25'")[0]
fra['fatal_accidents'] = q('$select=count(*)&$where=totalpersonskilled>0')[0]
fra['by_year_last6'] = q("$select=year,count(*)&$where=year>='2020'&$group=year&$order=year")
fra['source_dataset_aqxq-n5hy_count'] = json.loads(get(f'{S}/resource/aqxq-n5hy.json?$select=count(*)')[1])[0]
fra['grade_crossing_7wn6-i5b9_count'] = json.loads(get(f'{S}/resource/7wn6-i5b9.json?$select=count(*),max(date)')[1])[0]
fra['id_fields'] = ['reportingrailroadcode', 'accidentnumber', 'incidentkey', 'reportkey', 'gxid', 'trainnumber', 'firstcarinitials+firstcarnumber', 'causingcarinitials+causingcarnumber', 'statecode', 'countycode', 'latitude', 'longitude', 'date']
fra['free_text_fields'] = ['narrative', 'primaryaccidentcause', 'accidentcause']
# sample of recent fatal records (the kind NTSB investigates) 2018-2026
fra_rows = q("$where=date>='2018-01-01' and totalpersonskilled>0&$limit=3000&$select=reportingrailroadcode,reportingrailroadname,accidentnumber,incidentkey,date,time,stateabbr,statename,countyname,station,subdivision,accidenttype,totalpersonskilled,totalpersonsinjured,totaldamagecost,primaryaccidentcause,latitude,longitude,narrative,trainnumber")
fra['fatal_since_2018_pulled'] = len(fra_rows)
fra['sample_rows'] = [{k: (v[:160] if isinstance(v, str) else v) for k, v in r.items()} for r in fra_rows[:3]]
R['fra'] = fra

# ---- RAIB (GOV.UK search + content API)
raib = {}
items, start = [], 0
while True:
    s, b = get(f'https://www.gov.uk/api/search.json?filter_format=raib_report&count=100&start={start}&order=public_timestamp&fields=title&fields=link&fields=public_timestamp&fields=description&fields=date_of_occurrence&fields=railway_type&fields=report_type')
    d = json.loads(b)
    items += d['results']
    start += 100
    if start >= d['total']: break
raib['total'] = d['total']
raib['pulled'] = len(items)
raib['newest_public_timestamp'] = max(i['public_timestamp'] for i in items)
raib['oldest_occurrence'] = min(i.get('date_of_occurrence') or '9999' for i in items)
raib['newest_occurrence'] = max(i.get('date_of_occurrence') or '' for i in items)
from collections import Counter
raib['report_types'] = Counter(t for i in items for t in (i.get('report_type') or [])).most_common()
raib['railway_types'] = Counter(t for i in items for t in (i.get('railway_type') or [])).most_common()
raib['published_last_365d'] = sum(1 for i in items if i['public_timestamp'] >= '2025-10-04')
docs = []
pdf_n = 0
for it in [i for i in items if i['report_type'] == ['investigation-report']][:25]:
    s, b = get('https://www.gov.uk/api/content' + it['link'])
    if s != 200: continue
    d = json.loads(b)
    body = re.sub(r'<[^>]+>', ' ', d['details'].get('body', ''))
    att = [a.get('url') for a in d['details'].get('attachments', []) if a.get('url')]
    docs.append({'link': it['link'], 'title': it['title'], 'occurrence': it.get('date_of_occurrence'), 'summary_chars': len(html.unescape(body)), 'attachments': att[:2], 'metadata_keys': sorted(d['details'].get('metadata', {}).keys())})
raib['content_docs'] = docs
raib['docs_with_summary_over_300_chars'] = sum(1 for x in docs if x['summary_chars'] > 300)
raib['docs_with_pdf'] = sum(1 for x in docs if x['attachments'])
# page footer licence text
s, b = get('https://www.gov.uk' + items[0]['link'])
t = re.sub(r'\s+', ' ', html.unescape(re.sub(r'<script.*?</script>|<style.*?</style>|<[^>]+>', ' ', b, flags=re.S)))
m = re.search(r'.{0,80}Open Government Licence.{0,160}', t)
raib['page_licence_text'] = m.group(0) if m else None
R['raib'] = raib
RAIB_ITEMS = items

# ---- NTSB railroad investigation reports (RIR PDFs; enumerated by URL pattern)
MAXPDF = 40  # the 40 newest RIR reports (polite cap on transfer)
ntsb = {'tried': 0, 'found': []}
for yy in range(26, 14, -1):
    misses = 0
    for nn in range(1, 16):
        n = f'{yy:02d}{nn:02d}'
        u = f'https://www.ntsb.gov/investigations/AccidentReports/Reports/RIR{n}.pdf'
        ntsb['tried'] += 1
        p0 = f'{CACHE}/RIR{n}.pdf'
        if len(ntsb['found']) >= MAXPDF:
            break
        if os.path.exists(p0):  # reuse an earlier download (keeps total transfer under the 50MB cap)
            s, b = 200, open(p0, 'rb').read()
        else:
            s, b = get(u, binary=True, timeout=60)
        if s == 200 and b[:4] == b'%PDF':
            p = f'{CACHE}/RIR{n}.pdf'
            open(p, 'wb').write(b)
            ntsb['found'].append(n)
            misses = 0
        else:
            misses += 1
            if misses >= 2: break
ntsb['found_count'] = len(ntsb['found'])
recs = []
MON = 'January|February|March|April|May|June|July|August|September|October|November|December'
for n in ntsb['found']:
    p = f'{CACHE}/RIR{n}.pdf'
    txt = subprocess.run(['pdftotext', '-l', '4', p, '-'], capture_output=True, text=True).stdout
    flat = re.sub(r'\s+', ' ', txt)
    title = txt.strip().split('\n')[0]
    case = re.findall(r'case number ([A-Z]{3}\d{2}[A-Z]{2}\d{3})', flat)
    d = re.search(r'\n((?:%s) \d{1,2}, \d{4})\n' % MON, txt[:600])
    iss = re.search(r'Issued: ((?:%s) \d{1,2}, \d{4})' % MON, txt)
    loc = re.search(r'\n([A-Z][A-Za-z .\'-]+, [A-Z][A-Za-z ]+)\n(?:%s)' % MON, txt[:600])
    recs.append({'rir': n, 'title': title, 'occurrence_date': d.group(1) if d else None, 'issued': iss.group(1) if iss else None, 'location': loc.group(1) if loc else None, 'ntsb_case_number': case[0] if case else None, 'cites_fra_report_no': bool(re.search(r'FRA (?:accident|report|Form)|6180', flat)), 'pdf_bytes': os.path.getsize(p)})
ntsb['records'] = recs
ntsb['with_case_number'] = sum(1 for r in recs if r['ntsb_case_number'])
ntsb['with_date_and_location'] = sum(1 for r in recs if r['occurrence_date'] and r['location'])
R['ntsb'] = ntsb

# ---- NTSB <-> FRA link: occurrence date + state (+ railroad token), CANDIDATE only
from datetime import datetime
ST = {'Alabama':'AL','Alaska':'AK','Arizona':'AZ','Arkansas':'AR','California':'CA','Colorado':'CO','Connecticut':'CT','Delaware':'DE','Florida':'FL','Georgia':'GA','Idaho':'ID','Illinois':'IL','Indiana':'IN','Iowa':'IA','Kansas':'KS','Kentucky':'KY','Louisiana':'LA','Maine':'ME','Maryland':'MD','Massachusetts':'MA','Michigan':'MI','Minnesota':'MN','Mississippi':'MS','Missouri':'MO','Montana':'MT','Nebraska':'NE','Nevada':'NV','New Hampshire':'NH','New Jersey':'NJ','New Mexico':'NM','New York':'NY','North Carolina':'NC','North Dakota':'ND','Ohio':'OH','Oklahoma':'OK','Oregon':'OR','Pennsylvania':'PA','Rhode Island':'RI','South Carolina':'SC','South Dakota':'SD','Tennessee':'TN','Texas':'TX','Utah':'UT','Vermont':'VT','Virginia':'VA','Washington':'WA','West Virginia':'WV','Wisconsin':'WI','Wyoming':'WY','District of Columbia':'DC'}
link = {'rule': 'FRA record with same calendar date and same state as the NTSB occurrence; candidate only', 'rows': []}
for r in recs:
    if not (r['occurrence_date'] and r['location']): continue
    dt = datetime.strptime(r['occurrence_date'], '%B %d, %Y').strftime('%Y-%m-%d')
    stn = r['location'].split(',')[-1].strip()
    ab = ST.get(stn, stn)
    city = r['location'].split(',')[0].strip().lower()
    # query FRA directly for that date+state (any severity), so absence in the fatal sample does not bias
    rows = json.loads(get(f"{S}/resource/85tf-25kj.json?$where=date='{dt}T00:00:00.000' and stateabbr='{ab}'&$select=reportingrailroadcode,accidentnumber,station,countyname,accidenttype,totalpersonskilled,narrative&$limit=50")[1])
    link['rows'].append({'rir': r['rir'], 'title': r['title'], 'date': dt, 'state': ab, 'city': city, 'fra_same_date_state': len(rows),
        'fra_candidates': [{'rr': x['reportingrailroadcode'], 'no': x['accidentnumber'], 'station': x.get('station'), 'county': x.get('countyname'), 'type': x.get('accidenttype'), 'killed': x.get('totalpersonskilled'), 'city_in_text': city in (x.get('station', '') + ' ' + x.get('narrative', '')).lower()} for x in rows[:6]]})
link['ntsb_with_date_state'] = len(link['rows'])
link['with_any_fra_same_date_state'] = sum(1 for x in link['rows'] if x['fra_same_date_state'])
link['with_city_confirmed_candidate'] = sum(1 for x in link['rows'] if any(c['city_in_text'] for c in x['fra_candidates']))
R['ntsb_fra_link'] = link
json.dump(R, open(f'{OUT}/results.json', 'w'), indent=1, default=str)
print('done', json.dumps({k: R[k] for k in ['reachability']}, indent=0)[:600])
