"""Screen EU Safety Gate weekly reports: size, fields, and whether alerts cite CPSC or Health Canada notices.
Run: python3 -I safety-gate.py. Open XML, declared UA."""
import re, json, subprocess, concurrent.futures as cf
UA = 'data-foundry-scout/1.0 (data@mail.proviciency.com)'
def get(u):
    return subprocess.run(['curl', '-g', '-sS', '-L', '-m', '90', '-A', UA, u], capture_output=True).stdout.decode('utf-8', 'replace')
lst = get('https://ec.europa.eu/safety-gate-alerts/api/download/weeklyReport/list/xml/en')
reps = re.findall(r'<reference>(Report-\d+-\d+)</reference>\s*<publicationDate>([^<]+)</publicationDate>.*?<URL>([^<]+)</URL>', lst, re.S)
reps = [(r, d, u.replace('&amp;', '&')) for r, d, u in reps]
def key(x): y, w = re.findall(r'\d+', x[0]); return (int(y), int(w))
reps.sort(key=key, reverse=True)
sel = reps[:1] + reps[len(reps) // 4::len(reps) // 4][:3] + reps[-1:] + reps[1:52]  # plus the last year of weekly reports
def one(x):
    r, d, u = x; t = get(u)
    return {'report': r, 'published': d, 'bytes': len(t), 'alerts': len(re.findall(r'<caseNumber>', t)), 'recall_urls': re.findall(r'<URLrecall><!\[CDATA\[([^\]]*)\]\]></URLrecall>', t), 'barcodes': len([b for b in re.findall(r'<barcode><!\[CDATA\[([^\]]*)\]\]></barcode>', t) if b.strip()]),
            'cites_cpsc': len(re.findall(r'cpsc\.gov|saferproducts', t)), 'cites_health_canada': len(re.findall(r'recalls-rappels\.canada|healthycanadians', t)),
            'tags_seen': sorted(set(re.findall(r'<([a-zA-Z_]+)>', t)))[:60]}
with cf.ThreadPoolExecutor(5) as ex: rows = list(ex.map(one, sel))
out = {'reports_listed': len(reps), 'newest': reps[0][:2], 'oldest': reps[-1][:2], 'sampled': rows}
json.dump(out, open('safety-gate.json', 'w'), indent=1); print(json.dumps({k: v for k, v in out.items() if k != 'sampled'}))
last = rows[:1] + rows[5:]
print('last-year reports', len(last), 'alerts', sum(r['alerts'] for r in last), 'cpsc-citing', sum(r['cites_cpsc'] for r in last), 'hc-citing', sum(r['cites_health_canada'] for r in last), 'barcodes', sum(r['barcodes'] for r in last), 'recall urls', sum(len(r['recall_urls']) for r in last))
