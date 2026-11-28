"""Measure retracted-publications linkage on declared identifiers (DOI, PMID) across independent publishers:
  Retraction Watch/Crossref CSV (api.labs.crossref.org/data/retractionwatch)  <->  Crossref REST works  <->  NCBI PubMed (efetch).
Sample A: 100 Retraction Watch rows (RetractionNature=Retraction, with original DOI and PMID), evenly spaced through the CSV.
Sample B: 50 random Crossref works with update-type:retraction (works?sample=50), looked up by original DOI in the RW CSV.
OpenAlex is probed once for is_retracted; its anonymous daily budget is shared per egress IP and may answer 429.
Run: python3 -I join.py   (downloads the 67 MB CSV into a fresh temp dir; writes join.json next to this script).
Open endpoints, declared UA, <= 2 req/s per host."""
import csv, json, os, re, subprocess, tempfile, time, datetime, urllib.parse
UA = 'data-foundry-scout/1.0 (data@mail.proviciency.com)'
HERE = os.path.dirname(os.path.abspath(__file__))
log = []
def get(u, timeout=300):
    time.sleep(0.5)
    p = subprocess.run(['curl', '-g', '-sS', '-m', str(timeout), '-A', UA, '-w', '\n%{http_code}', u], capture_output=True)
    body, _, code = p.stdout.decode('utf-8', 'replace').rpartition('\n')
    return int(code or 0), body
now = lambda: datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds')
out = {'run_at': now()}
# --- Retraction Watch CSV
tmp = tempfile.mkdtemp(prefix='rw-')
path = os.path.join(tmp, 'rw.csv')
st = subprocess.run(['curl', '-sS', '-L', '-m', '600', '-A', UA, '-o', path, '-w', '%{http_code}', 'https://api.labs.crossref.org/data/retractionwatch'], capture_output=True).stdout.decode()
csv.field_size_limit(10**9)
rows = list(csv.DictReader(open(path, encoding='utf-8', errors='replace')))
norm = lambda d: d.strip().lower().replace('https://doi.org/', '')
out['rw_csv'] = {'http': int(st), 'bytes': os.path.getsize(path), 'rows': len(rows),
  'nature': {k: sum(1 for r in rows if r['RetractionNature'] == k) for k in sorted({r['RetractionNature'] for r in rows})},
  'with_original_doi': sum(1 for r in rows if norm(r['OriginalPaperDOI']) not in ('', 'unavailable')),
  'with_original_pmid': sum(1 for r in rows if r['OriginalPaperPubMedID'] not in ('', '0')),
  'newest_retraction_date': max(datetime.datetime.strptime(r['RetractionDate'].split()[0], '%m/%d/%Y') for r in rows if r['RetractionDate']).date().isoformat(),
  'with_reason_text': sum(1 for r in rows if r['Reason'].strip()), 'with_notes_text': sum(1 for r in rows if r['Notes'].strip())}
cand = [r for r in rows if r['RetractionNature'] == 'Retraction' and norm(r['OriginalPaperDOI']) not in ('', 'unavailable') and r['OriginalPaperPubMedID'] not in ('', '0')]
step = len(cand) // 100
A = cand[::step][:100]
out['sample_A'] = {'eligible_rows': len(cand), 'step': step, 'n': len(A), 'record_ids': [r['Record ID'] for r in A]}
# --- A1: RW original DOI -> Crossref works, does Crossref record the retraction
a1 = []
for r in A:
    doi = norm(r['OriginalPaperDOI'])
    code, body = get('https://api.crossref.org/works/' + urllib.parse.quote(doi, safe='/') + '?mailto=data@mail.proviciency.com')
    res = {'record_id': r['Record ID'], 'doi': doi, 'http': code, 'crossref_found': code == 200, 'crossref_updated_by_retraction': False}
    if code == 200:
        m = json.loads(body)['message']
        res['crossref_updated_by_retraction'] = any(u.get('type') == 'retraction' for u in m.get('updated-by', []))
        res['crossref_has_updated_by'] = bool(m.get('updated-by'))
    a1.append(res)
out['A1_rw_to_crossref'] = {'total': len(a1), 'doi_found_in_crossref': sum(x['crossref_found'] for x in a1),
  'crossref_records_retraction_update': sum(x['crossref_updated_by_retraction'] for x in a1), 'items': a1}
# --- A2: RW original PMID -> PubMed efetch; DOI agrees and PublicationType Retracted Publication
pmids = [r['OriginalPaperPubMedID'] for r in A]
code, xml = get('https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&retmode=xml&id=' + ','.join(pmids) + '&tool=data-foundry-scout&email=data@mail.proviciency.com')
arts = {}
for blk in re.findall(r'<PubmedArticle>.*?</PubmedArticle>', xml, re.S):
    pm = re.search(r'<PMID Version="1">(\d+)</PMID>', blk).group(1)
    d = re.search(r'<ArticleId IdType="doi">([^<]+)</ArticleId>', blk)
    arts[pm] = {'doi': d.group(1).lower() if d else None, 'retracted_pubtype': 'Retracted Publication' in re.findall(r'<PublicationType[^>]*>([^<]+)<', blk),
                'has_abstract': '<AbstractText' in blk}
a2 = []
for r in A:
    pm = r['OriginalPaperPubMedID']; a = arts.get(pm)
    a2.append({'record_id': r['Record ID'], 'pmid': pm, 'pubmed_found': bool(a), 'doi_matches_rw': bool(a and a['doi'] == norm(r['OriginalPaperDOI'])),
               'pubmed_flags_retracted': bool(a and a['retracted_pubtype']), 'has_abstract': bool(a and a['has_abstract'])})
out['A2_rw_to_pubmed'] = {'http': code, 'total': len(a2), 'pmid_found': sum(x['pubmed_found'] for x in a2), 'doi_agrees': sum(x['doi_matches_rw'] for x in a2),
  'pubmed_publication_type_retracted': sum(x['pubmed_flags_retracted'] for x in a2), 'with_abstract_text': sum(x['has_abstract'] for x in a2), 'items': a2}
# --- B: random Crossref retraction-update works -> RW CSV by original DOI
code, body = get('https://api.crossref.org/works?filter=update-type:retraction&sample=50&select=DOI,update-to&mailto=data@mail.proviciency.com')
items = json.loads(body)['message']['items']
rwdois = {norm(r['OriginalPaperDOI']) for r in rows}
b = []
for it in items:
    tgt = [norm(u['DOI']) for u in it.get('update-to', []) if u.get('type') == 'retraction']
    srcs = [u.get('source') for u in it.get('update-to', []) if u.get('type') == 'retraction']
    b.append({'notice_doi': it['DOI'], 'retracted_doi': tgt, 'source': srcs, 'in_rw': any(t in rwdois for t in tgt)})
out['B_crossref_to_rw'] = {'http': code, 'total': len(b), 'retracted_doi_in_rw_csv': sum(x['in_rw'] for x in b),
  'by_source': {s: {'n': sum(1 for x in b if s in x['source']), 'in_rw': sum(1 for x in b if s in x['source'] and x['in_rw'])} for s in {s for x in b for s in x['source']}}, 'items': b}
# --- totals
c, t = get('https://api.crossref.org/works?filter=update-type:retraction&rows=0&mailto=data@mail.proviciency.com'); out['crossref_retraction_updates_total'] = {'http': c, 'total': json.loads(t)['message']['total-results']}
c, t = get('https://api.crossref.org/works?filter=update-type:retraction,source:retraction-watch&rows=0&mailto=data@mail.proviciency.com'); out['crossref_source_retraction_watch_total'] = {'http': c, 'total': json.loads(t)['message']['total-results'] if c == 200 else None}
c, t = get('https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&retmode=json&retmax=0&term=' + urllib.parse.quote('Retracted Publication[Publication Type]') + '&tool=data-foundry-scout&email=data@mail.proviciency.com')
out['pubmed_retracted_publication_total'] = {'http': c, 'count': int(json.loads(t)['esearchresult']['count']) if c == 200 else None}
c, t = get('https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&retmode=json&retmax=0&term=' + urllib.parse.quote('Retracted Publication[Publication Type] AND 2026/10/01:2026/10/17[edat]') + '&tool=data-foundry-scout&email=data@mail.proviciency.com')
out['pubmed_retracted_added_2026_10_01_to_17'] = {'http': c, 'count': int(json.loads(t)['esearchresult']['count']) if c == 200 else None}
# --- OpenAlex probe
c, t = get('https://api.openalex.org/works?filter=is_retracted:true&per-page=1&select=id,doi,is_retracted,ids')
out['openalex_probe'] = {'http': c, 'body_head': t[:300]}
if c == 200:
    out['openalex_probe']['count'] = json.loads(t)['meta']['count']
    ok = 0; res = []
    for r in A[:40]:
        cc, tt = get('https://api.openalex.org/works/https://doi.org/' + norm(r['OriginalPaperDOI']) + '?select=id,doi,is_retracted,ids')
        if cc == 200: j = json.loads(tt); res.append({'doi': norm(r['OriginalPaperDOI']), 'is_retracted': j.get('is_retracted'), 'pmid': (j.get('ids') or {}).get('pmid')})
        else: res.append({'doi': norm(r['OriginalPaperDOI']), 'http': cc})
    out['openalex_rw_to_openalex'] = {'total': len(res), 'found': sum(1 for x in res if 'is_retracted' in x), 'flags_retracted': sum(1 for x in res if x.get('is_retracted')), 'items': res}
json.dump(out, open(os.path.join(HERE, 'join.json'), 'w'), indent=1)
print({k: (v if not isinstance(v, dict) else {a: b for a, b in v.items() if a != 'items'}) for k, v in out.items()})
