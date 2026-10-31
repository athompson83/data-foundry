"""Measure ClinicalTrials.gov <-> ISRCTN linkage on declared registry identifiers (NCT number cited by ISRCTN).
The ISRCTN query API has no working offset/page parameter (checked 2026-10-11: offset, page, start and first all return
the first page), so the sample is built from 12 topic queries of 100 trials each, de-duplicated by ISRCTN id, and the
register's own search for "NCT" gives a second, whole-register count.
Run: python3 -I join.py. Open endpoints, declared UA."""
import json, re, subprocess, concurrent.futures as cf
UA = 'data-foundry-scout/1.0 (data@mail.proviciency.com)'
def get(u):
    return subprocess.run(['curl', '-g', '-sS', '--fail', '-m', '120', '-A', UA, u], check=True, capture_output=True).stdout.decode('utf-8', 'replace')
isr = lambda q: get(f'https://www.isrctn.com/api/query/format/default?q={q}&limit=100')
total = int(re.search(r'totalCount="(\d+)"', get('https://www.isrctn.com/api/query/format/default?q=&limit=1')).group(1))
def parse(x):
    out = {}
    for t in re.findall(r'<fullTrial>.*?</fullTrial>', x, re.S):
        i = re.search(r'publicIdentifierCanonical="(ISRCTN\d+)"', t).group(1)
        out[i] = sorted(set(re.findall(r'NCT\d{8}', t)))
    return out
topics = ['cancer', 'diabetes', 'asthma', 'stroke', 'depression', 'surgery', 'children', 'heart', 'infection', 'pain', 'dementia', 'vaccine']
sample = {}
for q in topics: sample.update(parse(isr(q)))
nct_q = isr('NCT'); nct_total = int(re.search(r'totalCount="(\d+)"', nct_q).group(1)); nct_hits = parse(nct_q)
cited = {i: n for i, n in {**sample, **nct_hits}.items() if n}
def check(p):
    i, ncts = p
    ok = [n for n in ncts if json.loads(get(f'https://clinicaltrials.gov/api/v2/studies/{n}?fields=NCTId')).get('protocolSection', {}).get('identificationModule', {}).get('nctId') == n]
    rev = any(i in get(f'https://clinicaltrials.gov/api/v2/studies/{n}?fields=SecondaryId') for n in ok)
    return {'isrctn': i, 'nct': ncts, 'exists_in_ctgov': ok, 'ctgov_cites_isrctn': rev}
with cf.ThreadPoolExecutor(8) as ex: res = list(ex.map(check, cited.items()))
out = {'isrctn_total': total, 'distinct_trials_sampled': len(sample), 'sampled_citing_nct': sum(1 for n in sample.values() if n),
       'isrctn_search_NCT_total': nct_total, 'search_NCT_returned': len(nct_hits), 'search_NCT_returned_citing_nct': sum(1 for n in nct_hits.values() if n),
       'checked_links': len(res), 'records_with_all_nct_resolving': sum(1 for r in res if set(r['exists_in_ctgov']) == set(r['nct'])), 'nct_ids_cited': sum(len(r['nct']) for r in res), 'nct_ids_resolving': sum(len(r['exists_in_ctgov']) for r in res),
       'ctgov_cites_back': sum(1 for r in res if r['ctgov_cites_isrctn']),
       'ctgov_total': json.loads(get('https://clinicaltrials.gov/api/v2/stats/size'))['totalStudies'], 'links': res}
json.dump(out, open('join.json', 'w'), indent=1)
print({k: v for k, v in out.items() if k != 'links'})
