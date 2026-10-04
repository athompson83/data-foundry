"""Resolve every legacy Health Canada URL cited by a CPSC recall (healthycanadians.gc.ca/recall-alert-rappel-avis/hc-sc/YYYY/NNNNNr-eng.php)
with one HEAD request that follows redirects, then test whether the final URL is a Consumer product safety notice in the HC open-data index."""
import json, re, subprocess, time
UA = 'data-foundry-scout (data@mail.proviciency.com)'
c = json.load(open('/tmp/claude-0/rw/cpsc.json')); hc = json.load(open('/tmp/claude-0/rw/hc.json'))
idx = {r['URL'].lower().rstrip('/'): r for r in hc if r['Organization'] == 'Consumer product safety'}
allidx = {r['URL'].lower().rstrip('/'): r['Organization'] for r in hc if r.get('URL')}
cites = []
for r in c:
    for i in r.get('Inconjunctions') or []:
        u = (i.get('URL') or '').strip()
        if re.search(r'healthycanadians\.gc\.ca/recall-alert-rappel-avis/hc-sc/\d{4}/\d+r-eng\.php', u, re.I): cites.append((r['RecallNumber'], u))
out = []
for rn, u in cites:
    o = subprocess.run(['curl', '-sSI', '-L', '-m', '30', '-A', UA, '-o', '/dev/null', '-w', '%{http_code} %{url_effective}', u.replace('http://', 'https://')], capture_output=True, text=True).stdout.split(' ')
    eff = o[-1].split('?')[0].lower().rstrip('/')
    out.append({'recall': rn, 'cited': u, 'status': o[0], 'final': eff, 'in_consumer_index': eff in idx, 'in_other_index_org': allidx.get(eff) if eff not in idx else None})
    time.sleep(0.4)
json.dump(out, open('/tmp/claude-0/rw/legacy_resolve.json', 'w'))
print('done', len(out), sum(1 for x in out if x['in_consumer_index']))
