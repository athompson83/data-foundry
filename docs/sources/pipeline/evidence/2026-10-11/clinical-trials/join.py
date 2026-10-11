"""Measure ClinicalTrials.gov <-> ISRCTN linkage on declared registry identifiers (NCT number cited by ISRCTN).
Run: python3 -I join.py. Open endpoints, declared UA."""
import json, re, subprocess, concurrent.futures as cf
UA = 'data-foundry-scout/1.0 (data@mail.proviciency.com)'
def get(u):
    return subprocess.run(['curl', '-sS', '--fail', '-m', '120', '-A', UA, u], check=True, capture_output=True).stdout.decode('utf-8', 'replace')
head = get('https://www.isrctn.com/api/query/format/default?q=&limit=1')
total = int(re.search(r'totalCount="(\d+)"', head).group(1))
# spread 400 ISRCTN trials across the register: 4 samples of 100 at offsets through the total
trials = []
for off in (0, total // 4, total // 2, 3 * total // 4):
    x = get(f'https://www.isrctn.com/api/query/format/default?q=&limit=100&offset={off}')
    for t in re.findall(r'<fullTrial>.*?</fullTrial>', x, re.S):
        isr = re.search(r'publicIdentifierCanonical="(ISRCTN\d+)"', t)
        ncts = sorted(set(re.findall(r'NCT\d{8}', t)))
        elig = '<eligibility>' in t or 'inclusion' in t.lower()
        trials.append((isr.group(1), ncts, elig))
cited = [(i, n) for i, n, _ in trials if n]
def check(p):
    i, ncts = p
    ok = []
    for n in ncts:
        b = json.loads(get(f'https://clinicaltrials.gov/api/v2/studies/{n}?fields=NCTId,SecondaryId'))
        if b.get('protocolSection', {}).get('identificationModule', {}).get('nctId') == n: ok.append(n)
    # reverse direction: does the CT.gov record cite the ISRCTN?
    rev = any(i in get(f'https://clinicaltrials.gov/api/v2/studies/{n}?fields=SecondaryId') for n in ok)
    return {'isrctn': i, 'nct': ncts, 'exists_in_ctgov': ok, 'ctgov_cites_isrctn': rev}
with cf.ThreadPoolExecutor(8) as ex: res = list(ex.map(check, cited))
out = {'isrctn_total': total, 'isrctn_sampled': len(trials), 'isrctn_citing_nct': len(cited),
       'nct_resolves_in_ctgov': sum(1 for r in res if r['exists_in_ctgov']),
       'ctgov_cites_back': sum(1 for r in res if r['ctgov_cites_isrctn']),
       'ctgov_total': json.loads(get('https://clinicaltrials.gov/api/v2/stats/size'))['totalStudies'], 'links': res}
json.dump(out, open('join.json', 'w'), indent=1)
print({k: v for k, v in out.items() if k != 'links'})
