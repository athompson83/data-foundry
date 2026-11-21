"""Measure CVE-id linkage across CISA KEV, NVD, OSV.dev and FIRST EPSS on a systematic KEV sample.
Run: python3 -I join.py. Open endpoints, declared UA; NVD keyless limit (5 req/30 s) respected."""
import json, subprocess, time, concurrent.futures as cf
UA = 'data-foundry-scout/1.0 (data@mail.proviciency.com)'
def get(u):
    r = subprocess.run(['curl', '-g', '-sS', '-m', '60', '-A', UA, '-w', '\n%{http_code}', u], capture_output=True).stdout.decode('utf-8', 'replace')
    body, _, code = r.rpartition('\n'); return code, body
kev = json.loads(get('https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json')[1])
vs = kev['vulnerabilities']; step = len(vs) // 60
sample = [vs[i * step] for i in range(60)]
ids = [v['cveID'] for v in sample]
epss = json.loads(get('https://api.first.org/data/v1/epss?cve=' + ','.join(ids))[1])['data']
osv = {}
def o(i):
    c, b = get('https://api.osv.dev/v1/vulns/' + i); return i, (json.loads(b) if c == '200' else None)
with cf.ThreadPoolExecutor(8) as ex: osv = dict(ex.map(o, ids))
nvd = {}
for i in ids[:20]:
    c, b = get('https://services.nvd.nist.gov/rest/json/cves/2.0?cveId=' + i)
    nvd[i] = bool(c == '200' and json.loads(b).get('totalResults') == 1); time.sleep(6.5)
out = {'kev_count': kev['count'], 'kev_catalog_version': kev['catalogVersion'], 'sampled': len(ids), 'sample_ids': ids,
       'epss_hits': len(epss), 'osv_hits': sum(1 for v in osv.values() if v), 'osv_with_details_text': sum(1 for v in osv.values() if v and v.get('details')),
       'nvd_probed': len(nvd), 'nvd_hits': sum(nvd.values()),
       'kev_free_text_fields': ['shortDescription', 'requiredAction', 'notes'], 'kev_ransomware_flag_values': sorted({v['knownRansomwareCampaignUse'] for v in vs})}
json.dump(out, open('join.json', 'w'), indent=1); print({k: v for k, v in out.items() if k != 'sample_ids'})
