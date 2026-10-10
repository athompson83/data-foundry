"""Collect the newest 156 EU Safety Gate weekly XML reports (3 years; CC0 distribution), 1 request per 2 s, cached."""
import os, re, subprocess, time, html
UA = 'data-foundry-scout (data@mail.proviciency.com)'
D = '/tmp/claude-0/rw/sg'; os.makedirs(D, exist_ok=True)
lst = open('/tmp/claude-0/rw/sg_list.xml', encoding='utf-8').read()
urls = [html.unescape(u) for u in re.findall(r'<URL>([^<]+)</URL>', lst)][:156]
for u in urls:
    rid = re.search(r'/xml/(\d+)\?', u).group(1)
    f = f'{D}/{rid}.xml'
    if os.path.exists(f): continue
    r = subprocess.run(['curl', '-sS', '-m', '60', '-A', UA, u], capture_output=True, text=True)
    if r.stdout.startswith('<?xml'): open(f, 'w').write(r.stdout)
    time.sleep(2)
print('done')
