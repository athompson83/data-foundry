"""Measure Open Food Facts <-> USDA FoodData Central branded foods linkage on GTIN.
Run: python3 -I join.py <fdc.zip>. OFF sample: US-sold products via the v2 search API (open, declared UA)."""
import sys, io, csv, json, zipfile, subprocess
UA = 'data-foundry-scout/1.0 (data@mail.proviciency.com)'
csv.field_size_limit(10**9)
z = zipfile.ZipFile(sys.argv[1])
name = [n for n in z.namelist() if n.endswith('branded_food.csv')][0]
fdc = {}
with z.open(name) as f:
    for r in csv.DictReader(io.TextIOWrapper(f, 'utf-8', errors='replace')):
        g = r['gtin_upc'].lstrip('0')
        if g: fdc[g] = (r['fdc_id'], bool(r['ingredients'].strip()), r['data_source'])
def get(u):
    return subprocess.run(['curl', '-g', '-sS', '-m', '90', '-A', UA, u], capture_output=True).stdout.decode('utf-8', 'replace')
# The OFF search API answered "Page temporarily unavailable"; the single-product endpoint works, so sample FDC GTINs
# systematically (every Nth branded row that has an ingredient statement) and look each up in OFF.
import time
keys = [k for k, v in fdc.items() if v[1]]
step = len(keys) // 100
sample = [keys[i * step] for i in range(100)]
off = {}
for g in sample:
    d = json.loads(get(f'https://world.openfoodfacts.org/api/v2/product/{g.zfill(13)}.json?fields=code,ingredients_text,allergens_tags') or '{}')
    if d.get('status') == 1 and d.get('product'): off[g] = d['product']
    time.sleep(0.8)
codes = sample
hit = list(off)
both_text = [g for g, p in off.items() if p.get('ingredients_text')]
out = {'fdc_branded_rows_with_gtin': len(fdc), 'fdc_gtins_sampled': len(codes), 'found_in_off': len(hit),
       'found_with_ingredient_text_in_off': len(both_text), 'sample_matches': hit[:20]}
json.dump(out, open('join.json', 'w'), indent=1); print(out)
