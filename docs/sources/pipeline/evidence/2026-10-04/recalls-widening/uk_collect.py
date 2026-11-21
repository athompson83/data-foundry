"""Collect UK OPSS product-safety notices (GOV.UK search + content API, keyless, OGL v3). <=2 req/s, cached.
Writes /tmp/claude-0/rw/uk/<slug>.json (content API) and uk_index.json. Resumable."""
import json, os, re, subprocess, sys, time
UA = 'data-foundry-scout (data@mail.proviciency.com)'
D = '/tmp/claude-0/rw/uk'; os.makedirs(D, exist_ok=True)
def get(url):
    for a in range(4):
        r = subprocess.run(['curl', '-sS', '-m', '60', '-A', UA, url], capture_output=True, text=True)
        if r.stdout.startswith('{'): return r.stdout
        time.sleep(2 * (a + 1))
    return None
idx = []
start = 0
while True:
    t = get(f'https://www.gov.uk/api/search.json?filter_format=product_safety_alert_report_recall&count=500&start={start}&order=-public_timestamp&fields=title&fields=link&fields=public_timestamp&fields=description')
    d = json.loads(t); idx += [{k: r.get(k) for k in ('title', 'link', 'public_timestamp', 'description')} for r in d['results']]
    start += 500; time.sleep(0.5)
    if start >= d['total']: break
json.dump({'total': d['total'], 'results': idx}, open(f'{D}/uk_index.json', 'w'))
print('index', len(idx), flush=True)
n = 0
for r in idx:
    f = f"{D}/{r['link'].rsplit('/', 1)[-1]}.json"
    if os.path.exists(f): continue
    t = get('https://www.gov.uk/api/content' + r['link'])
    if t: open(f, 'w').write(t)
    n += 1; time.sleep(0.5)
    if n % 200 == 0: print(n, flush=True)
print('done', flush=True)
