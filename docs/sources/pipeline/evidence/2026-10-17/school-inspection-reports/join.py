"""Measure Ofsted (state-funded school inspection outcomes + report pages/PDFs) <-> DfE Get Information About Schools (GIAS) on the declared URN.
Samples 100 Ofsted URNs evenly spaced over the 'latest inspections' management-information CSV, looks each up in the GIAS daily
'edubasealldata' CSV, compares postcode, then fetches 20 Ofsted report pages (1 req/s) and 8 inspection-report PDFs for text.
Run: python3 -I join.py (needs curl, pdftotext). Open endpoints, declared UA. Writes join.json next to the script."""
import csv, io, json, re, subprocess, tempfile, time, os, datetime
UA = 'data-foundry-scout/1.0 (data@mail.proviciency.com)'
HERE = os.path.dirname(os.path.abspath(__file__))
TMP = tempfile.mkdtemp(prefix='school-join-')
def curl(url, out=None, follow=False):
    args = ['curl', '-sS', '-m', '180', '-A', UA, '-w', '%{http_code} %{size_download} %{url_effective}']
    if follow: args.append('-L')
    args += ['-o', out or '/dev/stdout', url] if out else [url]
    r = subprocess.run(args, capture_output=True)
    if out: code, size, eff = r.stdout.decode().split(' ', 2); return int(code), int(size), eff, None
    body = r.stdout[:-0 or None]
    return body
def get(url, follow=True):
    p = os.path.join(TMP, 'x'); a = ['curl', '-sS', '-m', '120', '-A', UA, '-o', p, '-w', '%{http_code} %{url_effective}']
    if follow: a.append('-L')
    r = subprocess.run(a + [url], capture_output=True).stdout.decode().split(' ', 1)
    return int(r[0]), r[1], (open(p, 'rb').read() if os.path.exists(p) else b'')
ts = datetime.datetime.utcnow().isoformat() + 'Z'
# 1 Ofsted CSV: find the latest-inspections link from the statistical data set page
st, _, page = get('https://www.gov.uk/government/statistical-data-sets/monthly-management-information-ofsteds-school-inspections-outcomes')
links = re.findall(r'href="(https://assets\.publishing\.service\.gov\.uk/media/[^"]*latest_inspections[^"]*\.csv)"', page.decode())
ofsted_url = links[0]
of_path = os.path.join(TMP, 'ofsted.csv')
oc = curl(ofsted_url, of_path)
rows = list(csv.DictReader(open(of_path, encoding='utf-8-sig', errors='replace')))
# 2 GIAS daily CSV (today, else yesterday)
gias = {}
for off in (0, 1):
    d = (datetime.date.today() - datetime.timedelta(days=off)).strftime('%Y%m%d')
    gias_url = f'https://ea-edubase-api-prod.azurewebsites.net/edubase/downloads/public/edubasealldata{d}.csv'
    gp = os.path.join(TMP, 'gias.csv'); gc = curl(gias_url, gp)
    if gc[0] == 200: break
grows = list(csv.DictReader(open(gp, encoding='latin-1')))
gias = {r['URN']: r for r in grows}
norm = lambda s: re.sub(r'\s+', '', (s or '').upper())
n = 100; step = len(rows) // n
sample = [rows[i * step] for i in range(n)]
matched, pc_same, open_ct, graded, details = 0, 0, 0, 0, []
for r in sample:
    g = gias.get(r['URN']); m = g is not None
    matched += m
    if m:
        pc_same += norm(g['Postcode']) == norm(r['Postcode']); open_ct += g['EstablishmentStatus (name)'] in ('Open', 'Open, but proposed to close')
    has = r['Latest OEIF overall effectiveness'] not in ('NULL', '') or r['Ungraded inspection overall outcome'] not in ('NULL', '') or r['Inspection type'] not in ('NULL', '')
    graded += has
    details.append({'urn': r['URN'], 'in_gias': m, 'postcode_same': bool(m and norm(g['Postcode']) == norm(r['Postcode'])), 'gias_status': g and g['EstablishmentStatus (name)'], 'ofsted_has_inspection_fields': has})
# whole-file coverage
of_urns = {r['URN'] for r in rows}
whole = {'ofsted_rows': len(rows), 'ofsted_distinct_urn': len(of_urns), 'ofsted_urns_in_gias': sum(u in gias for u in of_urns), 'gias_rows': len(grows)}
# 3 report pages (free text) for the first 20 sampled URNs with a report link
pages, pdfs = [], []
for r in sample[:20]:
    time.sleep(1)
    st, eff, body = get(r['Web Link'])
    t = body.decode('utf-8', 'replace')
    pdf = re.findall(r'href="(https://files\.ofsted\.gov\.uk/v1/file/\d+)"', t)
    pages.append({'urn': r['URN'], 'status': st, 'final_url': eff, 'pdf_links': len(pdf), 'first_pdf': pdf[0] if pdf else None})
for p in [x for x in pages if x['first_pdf']][:8]:
    time.sleep(1)
    st, eff, body = get(p['first_pdf']); fp = os.path.join(TMP, 'r.pdf'); open(fp, 'wb').write(body)
    txt = subprocess.run(['pdftotext', fp, '-'], capture_output=True).stdout.decode('utf-8', 'replace')
    pdfs.append({'urn': p['urn'], 'url': p['first_pdf'], 'status': st, 'bytes': len(body), 'text_chars': len(txt), 'has_outcome_heading': 'Outcome' in txt})
out = {'measured_at_utc': ts, 'ofsted_csv': {'url': ofsted_url, 'http': oc[0], 'bytes': oc[1]}, 'gias_csv': {'url': gias_url, 'http': gc[0], 'bytes': gc[1]},
       'whole_file': whole, 'sample_size': n, 'sample_urns': [r['URN'] for r in sample],
       'matched_in_gias': matched, 'postcode_same': pc_same, 'gias_open': open_ct, 'ofsted_rows_with_inspection_fields': graded,
       'report_pages': pages, 'report_pages_ok': sum(p['status'] == 200 and p['pdf_links'] > 0 for p in pages),
       'pdfs': pdfs, 'pdfs_with_text': sum(p['text_chars'] > 1000 for p in pdfs), 'sample_detail': details}
json.dump(out, open(os.path.join(HERE, 'join.json'), 'w'), indent=1)
print({k: v for k, v in out.items() if k not in ('sample_urns', 'sample_detail', 'report_pages', 'pdfs')})
