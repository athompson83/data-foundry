#!/usr/bin/env python3
"""Screen maritime casualty investigation sources (2026-10-03). Polite (<=2 req/s), cached under CACHE."""
import json, os, re, subprocess, sys, time, urllib.request, urllib.error, hashlib
UA = 'data-foundry-scout (data@mail.proviciency.com)'
CACHE = os.environ.get('CACHE', '/tmp/maritime_cache'); os.makedirs(CACHE, exist_ok=True)
def get(url, binary=False, method='GET'):
    p = os.path.join(CACHE, hashlib.md5((method+url).encode()).hexdigest())
    if os.path.exists(p + '.status'):
        st = int(open(p + '.status').read()); data = open(p, 'rb').read() if os.path.exists(p) else b''
        return st, data
    time.sleep(0.5)
    req = urllib.request.Request(url, headers={'User-Agent': UA}, method=method)
    try:
        with urllib.request.urlopen(req, timeout=60) as r: st, data = r.status, (r.read() if method == 'GET' else b'')
    except urllib.error.HTTPError as e: st, data = e.code, b''
    except Exception as e: st, data = 0, b''
    open(p, 'wb').write(data); open(p + '.status', 'w').write(str(st))
    return st, data
def imo_valid(s):
    return len(s) == 7 and s.isdigit() and sum(int(c) * w for c, w in zip(s, range(7, 1, -1))) % 10 == int(s[6])
IMO_RE = re.compile(r'\bIMO\b(?:\s*(?:number|No\.?|n[o°]\.?|ship\s*identification\s*number))?(?:/fishing numbers)?[ \t:\-–#]*(\d{7})\b', re.I)
def imos_in(text):
    return sorted({m for m in IMO_RE.findall(text) if imo_valid(m)})
def pdf_text(data, first=16):
    f = os.path.join(CACHE, 'tmp.pdf'); open(f, 'wb').write(data)
    return subprocess.run(['pdftotext', '-l', str(first), '-layout', f, '-'], capture_output=True, text=True).stdout
R = {'run_at': time.strftime('%Y-%m-%d %H:%M:%SZ', time.gmtime())}

# ---------- A. UK MAIB (gov.uk content API) ----------
maib = {}
st, d = get('https://www.gov.uk/api/search.json?filter_format=maib_report&count=0'); maib['total'] = json.loads(d)['total']
rows = []
for start in range(0, maib['total'], 500):
    st, d = get(f'https://www.gov.uk/api/search.json?filter_format=maib_report&count=500&start={start}&order=-public_timestamp&fields=title,link,public_timestamp,description')
    rows += json.loads(d)['results']
maib['listed'] = len(rows); maib['newest'] = rows[0]['public_timestamp']; maib['oldest'] = rows[-1]['public_timestamp']
maib['published_per_year_last5'] = {}
for r in rows:
    y = r['public_timestamp'][:4]
    if y >= '2021': maib['published_per_year_last5'][y] = maib['published_per_year_last5'].get(y, 0) + 1
maib_recs = {}
def maib_fetch(link):
    st, d = get('https://www.gov.uk/api/content' + link)
    if st != 200: return None
    c = json.loads(d); det = c['details']; md = det.get('metadata', {})
    pdfs = [a['url'] for a in det.get('attachments', []) if a.get('content_type') == 'application/pdf']
    return {'link': link, 'title': c['title'], 'first_published_at': c.get('first_published_at'), 'date_of_occurrence': md.get('date_of_occurrence'),
            'report_type': md.get('report_type'), 'vessel_type': md.get('vessel_type'), 'pdfs': pdfs, 'body_chars': len(det.get('body', '')), 'imo_in_body': imos_in(re.sub('<[^>]+>', ' ', det.get('body', '')))}
for r in rows[:120]:
    x = maib_fetch(r['link'])
    if x: maib_recs[r['link']] = x
vt = {}
for x in maib_recs.values():
    for v in x['vessel_type'] or ['none']: vt[v] = vt.get(v, 0) + 1
maib['content_api_sampled'] = len(maib_recs); maib['vessel_type_counts_sample'] = vt
maib['with_pdf'] = sum(1 for x in maib_recs.values() if x['pdfs'])
maib['with_date_of_occurrence'] = sum(1 for x in maib_recs.values() if x['date_of_occurrence'])
# PDFs: only reports with a pdf, size cap 6 MB, first 10 pages for IMO
pdf_done = 0
for x in maib_recs.values():
    if not x['pdfs']: continue
    if pdf_done >= 60: break
    url = x['pdfs'][0]
    st, d = get(url, method='GET')
    if st != 200 or len(d) > 12_000_000: x['pdf_status'] = st; continue
    txt = pdf_text(d); x['pdf_status'] = st; x['pdf_bytes'] = len(d); x['imo_in_pdf'] = imos_in(txt); pdf_done += 1
maib['pdfs_read'] = pdf_done
maib['pdfs_with_valid_imo'] = sum(1 for x in maib_recs.values() if x.get('imo_in_pdf'))
R['maib'] = maib
json.dump(maib_recs, open(os.path.join(CACHE, 'maib_recs.json'), 'w'))


# ---------- B. NTSB marine investigation reports (MIRyynn.pdf under /investigations/AccidentReports/Reports/) ----------
ntsb = {'url_pattern': 'https://www.ntsb.gov/investigations/AccidentReports/Reports/MIR{yy}{nn}.pdf'}
probe = {}
for yy in ('22', '23', '24', '25'):
    for nn in range(1, 21):
        u = ntsb['url_pattern'].format(yy=yy, nn=f'{nn:02d}')
        st, d = get(u, method='HEAD'); probe[f'MIR{yy}{nn:02d}'] = st
ntsb['head_probe_200'] = sorted(k for k, v in probe.items() if v == 200)
ntsb['head_probe_non200'] = sorted(k for k, v in probe.items() if v != 200)
ntsb_recs = {}
fetched = 0
for k in ntsb['head_probe_200']:
    if not (k.startswith('MIR24') or k.startswith('MIR25')) or fetched >= 22: continue
    st, d = get(ntsb['url_pattern'].format(yy=k[3:5], nn=k[5:7]))
    if st != 200 or d[:4] != b'%PDF': ntsb_recs[k] = {'status': st, 'not_pdf': True}; continue
    txt = pdf_text(d, 20); fetched += 1
    t = re.sub(r'\s+', ' ', txt)
    m = re.search(r'(?:Accident Report|Marine Investigation Report)\s*(NTSB/MIR-\d\d/\d+)', t)
    ntsb_recs[k] = {'bytes': len(d), 'report_no': m.group(1) if m else None, 'imo': imos_in(txt), 'head': t[:260]}
ntsb['pdfs_read'] = fetched; ntsb['pdfs_with_valid_imo'] = sum(1 for x in ntsb_recs.values() if x.get('imo'))
ntsb['bytes_downloaded'] = sum(x.get('bytes', 0) for x in ntsb_recs.values())
R['ntsb'] = ntsb
json.dump(ntsb_recs, open(os.path.join(CACHE, 'ntsb_recs.json'), 'w'))

# ---------- C. cross-source link on IMO (declared) ----------
maib_imo = {}
for x in maib_recs.values():
    for i in x.get('imo_in_pdf', []): maib_imo.setdefault(i, []).append(x['title'])
ntsb_imo = {}
for k, x in ntsb_recs.items():
    for i in x.get('imo', []): ntsb_imo.setdefault(i, []).append(k)
R['link'] = {'maib_reports_with_imo': sum(1 for x in maib_recs.values() if x.get('imo_in_pdf')), 'maib_distinct_imo': len(maib_imo),
             'ntsb_reports_with_imo': sum(1 for x in ntsb_recs.values() if x.get('imo')), 'ntsb_distinct_imo': len(ntsb_imo),
             'imo_overlap': sorted(set(maib_imo) & set(ntsb_imo))}
json.dump({'maib': {k: {kk: v for kk, v in x.items() if kk in ('title', 'date_of_occurrence', 'report_type', 'vessel_type', 'imo_in_pdf', 'pdf_bytes')} for k, x in list(maib_recs.items())[:120]},
          'ntsb': ntsb_recs, 'maib_imo': maib_imo, 'ntsb_imo': ntsb_imo}, open(os.path.join(CACHE, 'detail.json'), 'w'))
json.dump(R, open('results.json', 'w'), indent=1)
print(json.dumps(R, indent=1)[:3500])
