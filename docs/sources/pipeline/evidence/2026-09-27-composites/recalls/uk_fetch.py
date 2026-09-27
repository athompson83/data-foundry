import json,urllib.request,time,os,hashlib
UA="DataFoundry/1.0 (data@mail.proviciency.com)"
cats={'electrical-appliances-equipment','gas-appliances-and-components','lighting-products','adaptors-plugs-sockets','construction-products','pressure-equipment-vessels','kitchen-cooking-accessories'}
rs=[r for r in json.load(open('uk_index.json')) if r.get('product_category') in cats]
print(len(rs),flush=True)
for r in rs:
    slug=r['link'].rsplit('/',1)[1]; fn=f'uk/{slug}.json'
    if os.path.exists(fn): continue
    try:
        req=urllib.request.Request('https://www.gov.uk/api/content'+r['link'],headers={'User-Agent':UA})
        open(fn,'wb').write(urllib.request.urlopen(req,timeout=60).read())
    except Exception as e: print('ERR',slug,e,flush=True)
    time.sleep(1.0)
print('done')
