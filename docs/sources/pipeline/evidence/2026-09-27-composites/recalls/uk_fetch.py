import json,urllib.request,time,os,hashlib
UA="DataFoundry/1.0 (data@mail.proviciency.com)"
cats={'electrical-appliances-equipment','gas-appliances-and-components','lighting-products','adaptors-plugs-sockets','construction-products','pressure-equipment-vessels','kitchen-cooking-accessories'}
rs=[r for r in json.load(open('uk_index.json')) if r.get('product_category') in cats]
print(len(rs),flush=True)
# The cache is reconciled to the current filtered index on every run: every current notice is refetched (a notice
# can be revised in place), notices that left the index or the category set are deleted, and the manifest names
# exactly the notices parse_all.py may read.
os.makedirs('uk',exist_ok=True)
want={r['link'].rsplit('/',1)[1] for r in rs}
for f in os.listdir('uk'):
    if f.endswith('.json') and f[:-5] not in want: os.remove(os.path.join('uk',f))
failed=[]
for r in rs:
    slug=r['link'].rsplit('/',1)[1]; fn=f'uk/{slug}.json'
    for attempt in range(3):
        try:
            req=urllib.request.Request('https://www.gov.uk/api/content'+r['link'],headers={'User-Agent':UA})
            body=urllib.request.urlopen(req,timeout=60).read(); json.loads(body)
            open(fn,'wb').write(body); break
        except Exception as e: print('retry',slug,e,flush=True); time.sleep(5)
    else: failed.append(slug)
    time.sleep(1.0)
if failed:
    # A missing notice would silently shrink the denominator of every UK join.
    raise SystemExit(f'{len(failed)} notices failed after 3 attempts: {failed[:20]}')
json.dump(sorted(want),open('uk_manifest.json','w'))
print('done',len(want))
