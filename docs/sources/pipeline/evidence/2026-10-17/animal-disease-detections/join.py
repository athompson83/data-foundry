"""Screening probe for animal-disease-detections (2026-10-17): reachability, counts and identifier overlap across
USDA APHIS (HPAI flocks), CFIA Canada (infected premises), Defra/APHA UK (case narrative) and WOAH WAHIS.
Result: no cross-publisher declared identifier and no measurable candidate join between jurisdictions; APHIS flock-level data
is not machine-reachable (Tableau dashboard; only the first sheet exports as CSV); WAHIS report bodies are 403 from this egress.
Run: python3 -I join.py (writes join.json next to it; <=2 req/s; declared UA)."""
import json, re, subprocess, time, datetime, os
UA = 'data-foundry-scout/1.0 (data@mail.proviciency.com)'
HERE = os.path.dirname(os.path.abspath(__file__))
probes = []
def req(url, method='GET', body=None, keep=False):
    cmd = ['curl', '-sS', '-L', '-m', '90', '-A', UA, '-o', '-', '-w', '\n%{http_code}', '--compressed', url]
    if method == 'POST': cmd[1:1] = ['-X', 'POST', '-H', 'content-type: application/json', '-d', body or '{}']
    r = subprocess.run(cmd, capture_output=True)
    out = r.stdout.decode('utf-8', 'replace'); text, code = out.rsplit('\n', 1)
    probes.append({'url': url, 'method': method, 'http': int(code) if code.isdigit() else None, 'bytes': len(text), 'at': datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds')})
    time.sleep(0.6)
    return text
res = {}
# APHIS: page, Tableau dashboard default sheet CSV (monthly counts only)
req('https://www.aphis.usda.gov/livestock-poultry-disease/avian/avian-influenza/hpai-detections/commercial-backyard-flocks')
t = req('https://publicdashboards.dl.usda.gov/t/MRP_PUB/views/VS_Avian_HPAIConfirmedDetections2022/HPAI2022ConfirmedDetections.csv')
res['aphis_tableau_default_sheet'] = {'header': t.splitlines()[0], 'rows': len(t.splitlines()) - 1, 'note': 'monthly backyard-flock counts only; no flock id, county or species'}
for sheet in ['HPAI2022ConfirmedDetectionsTable', 'ConfirmedDetectionsTable', 'Table']:
    req(f'https://publicdashboards.dl.usda.gov/t/MRP_PUB/views/VS_Avian_HPAIConfirmedDetections2022/{sheet}.csv')
# third-party ArcGIS mirror of the APHIS table (OSU), recorded only to show the schema exists
m = json.loads(req('https://services1.arcgis.com/jWQlP64OuwDh6GGX/arcgis/rest/services/hpai_commercial_backyard_usa/FeatureServer/0?f=json'))
res['osu_arcgis_mirror_fields'] = [f['name'] for f in m.get('fields', [])]
# CFIA infected premises table
h = req('https://inspection.canada.ca/en/animal-health/terrestrial-animals/diseases/reportable/avian-influenza/latest-bird-flu-situation/investigations-and-orders')
ids = re.findall(r'\b([A-Z]{2}-IP\d+)\b', h)
res['cfia_investigations_and_orders'] = {'distinct_infected_premises_ids': len(set(ids)), 'sample_ids': sorted(set(ids))[:10], 'fields': 'date detected, IP id, municipality, province, premises type, WOAH premises classification, PCZ id, order status'}
# Defra / APHA narrative (GOV.UK content API)
d = json.loads(req('https://www.gov.uk/api/content/guidance/bird-flu-avian-influenza-latest-situation-in-england'))
body = d['details']['body']; txt = re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', ' ', body))
res['defra_latest_situation'] = {'public_updated_at': d.get('public_updated_at'), 'text_chars': len(txt), 'case_ids_cited': sorted(set(re.findall(r'AIV \d{4}/\d+', txt)))}
# WOAH WAHIS: public list works, report bodies do not
w = json.loads(req('https://wahis.woah.org/api/v1/pi/event/filtered-list', 'POST', '{}'))
res['wahis_event_list'] = {'totalSize': w.get('totalSize'), 'pageSize': w.get('pageSize'), 'fields': sorted(w['list'][0].keys())}
req('https://wahis.woah.org/api/v1/pi/getReport/186594')
req('https://wahis.woah.org/pi/getReportList')
# identifier overlap across publishers
res['declared_identifier_overlap'] = {'cfia_ip_ids_in_defra_text': [i for i in set(ids) if i in txt], 'defra_aiv_ids_in_cfia_html': [i for i in res['defra_latest_situation']['case_ids_cited'] if i in h],
  'note': 'CFIA IP-nnn and Defra AIV yyyy/nn are national series; no APHIS flock id is reachable. Jurisdictions are disjoint, so no candidate join (date+region+species) can match the same record across them.'}
res['probes'] = probes
res['run_at'] = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds')
json.dump(res, open(os.path.join(HERE, 'join.json'), 'w'), indent=1)
print({k: v for k, v in res.items() if k != 'probes'}); print([(p['url'][-60:], p['http']) for p in probes])
