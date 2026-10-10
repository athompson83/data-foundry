"""Resolve the alertas.gob.mx detail URLs that CPSC recalls cite (Inconjunctions[].URL), one request each (7 URLs, 0.6 s apart), and read the
Red de Alerta Rapida fields (Organismo notificador, Fecha, Marca, Modelo, Categoria, Riesgo). Measurement only; PROFECO stays PARKED."""
import json, re, subprocess, time, html
UA = 'data-foundry-scout (data@mail.proviciency.com)'
c = json.load(open('/tmp/claude-0/rw/cpsc.json')); out = []
for r in c:
    for i in r.get('Inconjunctions') or []:
        u = i.get('URL') or ''
        if 'alertas.gob.mx/detallealerta' not in u: continue
        h = subprocess.run(['curl', '-sS', '-m', '30', '-A', UA, u], capture_output=True, text=True).stdout
        t = re.sub(r'<(script|style)[\s\S]*?</\1>', '', h); t = re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', ' ', t)))
        m = re.search(r'Organismo notificador: (\S+) Fecha: (\S+) Marca: (.*?) Modelo: (.*?) Categoria: (.*?) Riesgo: (.*?) Descripci', t)
        out.append({'cpsc': r['RecallNumber'], 'cpsc_title': r['Title'][:90], 'cpsc_date': r['RecallDate'][:10], 'cited': u, 'profeco': list(m.groups()) if m else None}); time.sleep(0.6)
json.dump(out, open('/tmp/claude-0/rw/profeco_probe.json', 'w'), ensure_ascii=False)
