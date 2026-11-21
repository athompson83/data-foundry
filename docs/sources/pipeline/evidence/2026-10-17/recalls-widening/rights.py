"""Verify the rights quotes for EU Safety Gate and UK OPSS against the live pages. Run: python3 -I rights.py. Writes rights.json."""
import subprocess, json, re, html, time
UA = 'data-foundry-scout/1.0 (data@mail.proviciency.com)'
def get(u):
    r = subprocess.run(['curl', '-g', '-sS', '-L', '-m', '60', '-A', UA, '-w', '\n%{http_code}', u], capture_output=True)
    b, _, c = r.stdout.decode('utf-8', 'replace').rpartition('\n'); time.sleep(0.5); return c, b
def txt(b): return re.sub(r'\s+', ' ', html.unescape(re.sub(r'<(script|style)\b.*?</\1>', ' ', b, flags=re.S | re.I).replace('&nbsp;', ' ')) if False else html.unescape(re.sub(r'<[^>]+>', ' ', re.sub(r'<(script|style)\b.*?</\1>', ' ', b, flags=re.S | re.I)))).strip()
CHECKS = [
 ('eu_safety_gate', 'https://data.europa.eu/api/hub/search/datasets/rapex-rapid-alert-system-non-food', ['creativecommons.org/publicdomain/zero/1.0', 'Creative Commons CC0 1.0 Universal', 'Weekly Reports - XML format']),
 ('eu_safety_gate', 'https://commission.europa.eu/legal-notice_en', ['licensed under the Creative Commons Attribution 4.0 International (CC BY 4.0) licence', 'reuse is allowed, provided appropriate credit is given and changes are indicated', 'are excluded from the Commission']),
 ('eu_safety_gate', 'https://commission.europa.eu/legal-notice_en#reuse-of-commission-documents', ['Reuse of Commission documents']),
 ('uk_opss', 'https://www.gov.uk/help/terms-conditions', ['Open Government Licence', 'Crown copyright']),
 ('uk_opss', 'https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/', ['exploit the Information commercially and non-commercially', 'Attribution statement', 'Contains public sector information licensed under the Open Government Licence v3.0', 'does not include', 'personal data']),
]
out = []
for who, u, quotes in CHECKS:
    c, b = get(u); t = txt(b); res = {'agency': who, 'url': u, 'http': c, 'quotes': []}
    for q in quotes:
        i = t.find(q); res['quotes'].append({'text': q, 'found': i >= 0, 'context': t[max(0, i - 250): i + len(q) + 350] if i >= 0 else None})
    out.append(res)
json.dump(out, open('rights.json', 'w'), indent=1, ensure_ascii=False)
for r in out: print(r['agency'], r['url'], r['http'], [q['found'] for q in r['quotes']])
