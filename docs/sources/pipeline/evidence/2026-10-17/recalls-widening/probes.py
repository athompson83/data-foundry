"""Re-probe once each: statuses only. Run: python3 -I probes.py. Declared UA, one request per URL."""
import subprocess, json, time
UA = 'data-foundry-scout/1.0 (data@mail.proviciency.com)'
URLS = {
 'usda_fsis_recall_api': ['https://www.fsis.usda.gov/fsis/api/recall/v/1'],
 'accc_product_safety_recalls': ['https://www.productsafety.gov.au/recalls', 'https://www.productsafety.gov.au/rss/feed.xml/psa_recall'],
 'transport_canada_vrdb': ['https://opendatatc.tc.canada.ca/vrdb_60days_daily.csv', 'https://data.tc.gc.ca/v1.3/api/eng/vehicle-recall-database/recall'],
 'nhtsa_recalls_api': ['https://api.nhtsa.gov/recalls/recallsByVehicle?make=ford&model=f-150&modelYear=2020', 'https://static.nhtsa.gov/odi/ffdd/rcl/RCL.txt'],
}
out = {}
for k, us in URLS.items():
    out[k] = []
    for u in us:
        r = subprocess.run(['curl', '-g', '-sS', '-m', '60', '-A', UA, '-r', '0-2047', '-o', '/dev/null', '-w', '%{http_code} %{size_download} %{content_type}', u], capture_output=True)
        code, size, ctype = (r.stdout.decode().split(' ', 2) + ['', ''])[:3]
        out[k].append({'url': u, 'http_status': code, 'bytes_read_of_first_2KiB': int(size or 0), 'content_type': ctype, 'curl_error': r.stderr.decode().strip()[:200] or None}); time.sleep(0.6)
out['probed_on'] = time.strftime('%Y-%m-%d')
json.dump(out, open('probes.json', 'w'), indent=1); print(json.dumps(out, indent=1))
