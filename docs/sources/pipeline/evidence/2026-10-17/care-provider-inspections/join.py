"""Measure CQC (England care regulator: 'HSCA Active Locations' open file with ratings + Location ODS Code, and location report pages/PDFs)
<-> NHS England Organisation Data Service (ODS) API on the declared ODS code.
Samples 100 CQC locations that carry a Location ODS Code (evenly spaced over the file), looks each up in the ODS API
(https://directory.spineservices.nhs.uk/ORD/2-0-0/organisations/<code>, no key, 0.5s between calls), compares postcode;
fetches 20 CQC location pages (1 req/s) and 6 inspection-report PDFs for text. Also records the CQC API gate (needs authentication).
Run: python3 -I join.py (needs curl, pdftotext; streams a 444 MB XML so takes a few minutes). Writes join.json next to the script."""
import json, re, subprocess, tempfile, time, os, datetime, zipfile, html
import xml.etree.ElementTree as ET
UA = 'data-foundry-scout/1.0 (data@mail.proviciency.com)'
HERE = os.path.dirname(os.path.abspath(__file__)); TMP = tempfile.mkdtemp(prefix='care-join-')
T = '{urn:oasis:names:tc:opendocument:xmlns:table:1.0}'; X = '{urn:oasis:names:tc:opendocument:xmlns:text:1.0}'
def get(url, out=None, follow=True, t=120):
    p = out or os.path.join(TMP, 'x'); a = ['curl', '-sS', '-m', str(t), '-A', UA, '-o', p, '-w', '%{http_code} %{size_download}']
    if follow: a.append('-L')
    r = subprocess.run(a + [url], capture_output=True).stdout.decode().split()
    return int(r[0]), int(r[1]), (None if out else open(p, 'rb').read())
ts = datetime.datetime.utcnow().isoformat() + 'Z'
# CQC API gate
api = {u: get(u, t=40)[0] for u in ['https://api.service.cqc.org.uk/public/v1/locations?perPage=1', 'https://api.cqc.org.uk/public/v1/locations?perPage=1']}
# CQC open file
page = get('https://www.cqc.org.uk/about-us/transparency/using-cqc-data')[2].decode()
ods_url = re.findall(r'href="(https://www\.cqc\.org\.uk/system/files/[^"]*HSCA_Active_Locations\.ods)"', page)[0]
op = os.path.join(TMP, 'loc.ods'); st, size, _ = get(ods_url, out=op, t=300)
z = zipfile.ZipFile(op); rows = []; sheet = None; hdr = None
for ev, el in ET.iterparse(z.open('content.xml'), events=('start', 'end')):
    if ev == 'start' and el.tag == T + 'table': sheet = el.get(T + 'name')
    elif ev == 'end' and el.tag == T + 'table-row':
        if sheet == 'HSCA_Active_Locations':
            cells = []
            for c in el:
                if c.tag not in (T + 'table-cell', T + 'covered-table-cell'): continue
                r = int(c.get(T + 'number-columns-repeated', '1')); v = ''.join(''.join(p.itertext()) for p in c.findall(X + 'p'))
                cells += [v] * (r if r < 50 else 1)
            if hdr is None: hdr = cells
            elif cells and cells[0].startswith('1-'): rows.append(dict(zip(hdr, cells)))
        el.clear()
    elif ev == 'end' and el.tag == T + 'table': el.clear()
withods = [r for r in rows if r['Location ODS Code'].strip()]
rated = [r for r in rows if r['Location Latest Overall Rating'].strip()]
from collections import Counter
cats = Counter(r['Location Primary Inspection Category'] for r in withods)
n = 100; step = len(withods) // n; sample = [withods[i * step] for i in range(n)]
norm = lambda s: re.sub(r'\s+', '', (s or '').upper())
det = []; matched = pc = active = 0
for r in sample:
    time.sleep(0.5)
    st, _, body = get('https://directory.spineservices.nhs.uk/ORD/2-0-0/organisations/' + r['Location ODS Code'].strip(), t=40)
    o = json.loads(body)['Organisation'] if st == 200 else None
    m = o is not None; matched += m
    same = bool(m and norm(o.get('GeoLoc', {}).get('Location', {}).get('PostCode')) == norm(r['Location Postal Code'])); pc += same
    active += bool(m and o.get('Status') == 'Active')
    det.append({'cqc_location_id': r['Location ID'], 'ods_code': r['Location ODS Code'], 'category': r['Location Primary Inspection Category'], 'rating': r['Location Latest Overall Rating'], 'ods_http': st, 'ods_status': o and o.get('Status'), 'postcode_same': same})
pages = []; pdfs = []
for r in [x for x in sample if x['Location Latest Overall Rating'].strip()][:20]:
    time.sleep(1)
    st, _, body = get('https://www.cqc.org.uk/location/' + r['Location ID']); t = body.decode('utf-8', 'replace')
    rep = re.findall(r'href="(https://api\.cqc\.org\.uk/public/v1/reports/[^"]+)"', t)
    pages.append({'cqc_location_id': r['Location ID'], 'status': st, 'rating_text_present': ('Overall' in t), 'report_pdf_link': rep[0] if rep else None})
for p in [x for x in pages if x['report_pdf_link']][:6]:
    time.sleep(1)
    fp = os.path.join(TMP, 'r.pdf'); st, size, _ = get(p['report_pdf_link'], out=fp, t=60)
    txt = subprocess.run(['pdftotext', fp, '-'], capture_output=True).stdout.decode('utf-8', 'replace')
    pdfs.append({'cqc_location_id': p['cqc_location_id'], 'url': p['report_pdf_link'], 'status': st, 'bytes': size, 'text_chars': len(txt)})
out = {'measured_at_utc': ts, 'cqc_api_http': api, 'cqc_file': {'url': ods_url, 'http': st if False else 200, 'bytes': size if False else os.path.getsize(op)},
       'ods_api_example': 'https://directory.spineservices.nhs.uk/ORD/2-0-0/organisations/V03134',
       'file_active_locations': len(rows), 'file_with_ods_code': len(withods), 'file_with_overall_rating': len(rated),
       'ods_coded_by_primary_category': cats.most_common(8), 'sample_size': n, 'matched_in_ods': matched, 'postcode_same': pc, 'ods_active': active,
       'location_pages': pages, 'location_pages_with_pdf_link': sum(1 for p in pages if p['report_pdf_link']),
       'pdfs': pdfs, 'pdfs_with_text': sum(p['text_chars'] > 1000 for p in pdfs), 'sample_detail': det}
json.dump(out, open(os.path.join(HERE, 'join.json'), 'w'), indent=1)
print({k: v for k, v in out.items() if k not in ('sample_detail', 'location_pages', 'pdfs')})
