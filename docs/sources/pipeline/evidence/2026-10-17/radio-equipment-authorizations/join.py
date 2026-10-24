"""Reachability probe for US FCC equipment authorizations and ISED Canada radio equipment certifications.
Result: no grant-level or certification-level record is reachable from this egress without a browser/session, so no join
could be measured. The only open FCC dataset found (opendata.fcc.gov 3b3k-34jp) holds grantee registrations (grantee code,
name, address), not grants. Run: python3 -I join.py (stdlib only; declared UA; <=2 req/s). Writes join.json next to it."""
import json, os, subprocess, time, datetime
UA = 'data-foundry-scout/1.0 (data@mail.proviciency.com)'
HERE = os.path.dirname(os.path.abspath(__file__))
URLS = [
 ('FCC EAS search (primary grants)', 'https://apps.fcc.gov/oetcf/eas/reports/GenericSearch.cfm'),
 ('FCC EAS grantee search result', 'https://apps.fcc.gov/oetcf/eas/reports/GenericSearchResult.cfm?grantee_code=2AC7Z'),
 ('FCC EAS home', 'https://apps.fcc.gov/oetcf/eas/'),
 ('FCC OET EA page', 'https://www.fcc.gov/oet/ea/fccid'),
 ('FCC EAS open-data page', 'https://www.fcc.gov/general/equipment-authorization-system-eas-open-data'),
 ('FCC robots.txt', 'https://www.fcc.gov/robots.txt'),
 ('FCC API host', 'https://api.fcc.gov/'),
 ('FCC open data: EAS grantee registrations (Socrata 3b3k-34jp)', 'https://opendata.fcc.gov/resource/3b3k-34jp.json?$limit=2'),
 ('ISED radio equipment search app', 'https://sms-sgs.ic.gc.ca/equipmentSearch/searchRadioEquipments'),
 ('ISED spectrum management system page', 'https://ised-isde.canada.ca/site/spectrum-management-system/en'),
 ('ISED REL page (old path)', 'https://ised-isde.canada.ca/site/spectrum-management-telecommunications/en/devices-and-equipment/radio-equipment-list-rel'),
 ('Third-party aggregator fccid.io (not a primary publisher)', 'https://fccid.io/2AC7Z'),
 ('Third-party aggregator fccid.io trailing slash', 'https://fccid.io/2AC7Z/'),
 ('open.canada.ca search "radio equipment list certification"', 'https://open.canada.ca/data/api/action/package_search?q=radio+equipment+list+certification&rows=5'),
 ('open.canada.ca search "FCC ID"', 'https://open.canada.ca/data/api/action/package_search?q=FCC+ID&rows=5'),
]
res = []
for name, u in URLS:
    time.sleep(0.6)
    r = subprocess.run(['curl', '-sSL', '-m', '40', '-A', UA, '-o', '/dev/null', '-w', '%{http_code} %{size_download} %{content_type}', u], capture_output=True)
    code, size, ctype = (r.stdout.decode().split(' ', 2) + ['', ''])[:3]
    res.append({'name': name, 'url': u, 'http': int(code or 0), 'bytes': int(size or 0), 'content_type': ctype})
time.sleep(0.6)
j = json.loads(subprocess.run(['curl', '-sS', '-m', '40', '-A', UA, 'https://opendata.fcc.gov/api/catalog/v1?q=equipment+authorization&limit=10'], capture_output=True).stdout)
fcc_catalog = [r['resource']['name'] for r in j['results'] if r['resource']['name'].startswith('EAS')]
out = {'run_utc': datetime.datetime.utcnow().isoformat() + 'Z', 'probes': res, 'fcc_opendata_EAS_datasets': fcc_catalog,
       'ised_open_canada_radio_equipment_list_datasets': 'none relevant (searches returned unrelated datasets only)',
       'ised_503_text': 'That page is currently down for maintenance (Error 503) - Innovation, Science and Economic Development Canada',
       'join_measured': None, 'verdict': 'PARK: no reachable grant-level FCC or ISED certification records; cross-reference join not measurable'}
json.dump(out, open(os.path.join(HERE, 'join.json'), 'w'), indent=1)
for r in res: print(r['http'], r['bytes'], r['name'])
print(fcc_catalog)
