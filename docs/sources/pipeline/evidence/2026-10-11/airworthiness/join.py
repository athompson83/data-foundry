"""Measure FAA ADs (Federal Register) citing EASA AD numbers, and whether the EASA page for that number resolves.
Run: python3 -I join.py. Open endpoints, declared UA."""
import json, re, subprocess, concurrent.futures as cf
UA = 'data-foundry-scout/1.0 (data@mail.proviciency.com)'
def get(u, code=False):
    a = ['curl', '-g', '-L', '-sS', '-m', '90', '-A', UA]
    if code: a += ['-o', '/dev/null', '-w', '%{http_code} %{size_download}']
    return subprocess.run(a + [u], capture_output=True).stdout.decode('utf-8', 'replace')
q = ('https://www.federalregister.gov/api/v1/documents.json?conditions[agencies][]=federal-aviation-administration'
     '&conditions[type][]=RULE&conditions[publication_date][gte]=2026-01-01&conditions[publication_date][lte]=2026-10-10&per_page=100&order=newest&fields[]=document_number&fields[]=title&fields[]=full_text_xml_url&fields[]=publication_date')
d = json.loads(get(q))
docs = [x for x in d['results'] if x['title'].startswith('Airworthiness Directives')]
def text(x):  # -L: the full-text URL redirects
    return x, get(x['full_text_xml_url'])
with cf.ThreadPoolExecutor(8) as ex: txt = list(ex.map(text, docs[:100]))
rows = []
for x, t in txt:
    easa = sorted(set(re.findall(r'EASA\s+(?:Emergency\s+)?AD\s+(?:No\.\s*)?(\d{4}-\d{4}(?:-E)?(?:R\d+)?)', t)))
    rows.append({'fr': x['document_number'], 'date': x['publication_date'], 'easa_ads': easa, 'chars': len(t)})
cited = [r for r in rows if r['easa_ads']]
def chk(r):
    r['easa_page'] = get('https://ad.easa.europa.eu/ad/' + r['easa_ads'][0].split('R')[0], code=True)
    return r
with cf.ThreadPoolExecutor(6) as ex: list(ex.map(chk, cited[:30]))
out = {'fr_total_this_year': d.get('count'), 'fr_sampled': len(rows), 'citing_easa_ad_number': len(cited),
       'easa_pages_probed': len(cited[:30]), 'easa_pages_200': sum(1 for r in cited[:30] if r['easa_page'].startswith('200')), 'rows': rows}
json.dump(out, open('join.json', 'w'), indent=1)
print({k: v for k, v in out.items() if k != 'rows'}); print([ (r['easa_ads'],r['easa_page']) for r in cited[:4]])
