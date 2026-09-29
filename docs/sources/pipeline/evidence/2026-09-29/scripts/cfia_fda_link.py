"""Measure whether check-digit-valid GTINs in CFIA notices (sample from cfia_sample.py) appear in openFDA food enforcement
records (product_description / code_info), i.e. a declared GTIN link across the two agencies. Writes results/cfia-fda-link.json."""
import json,urllib.request,urllib.parse
UA="data-foundry-scout/1.0 (data@mail.proviciency.com)"
s=json.load(open('results/cfia-sample.json'))
rows=[];hits=0;total=0
for r in s['records']:
    for g in r.get('valid_gtins',[])[:3]:
        digits=''.join(c for c in g if c.isdigit()); total+=1
        found=0
        for variant in {digits, digits.lstrip('0')}:
            for field in ('product_description','code_info'):
                q=urllib.parse.quote(f'{field}:"{variant}"')
                try:
                    j=json.load(urllib.request.urlopen(urllib.request.Request(f'https://api.fda.gov/food/enforcement.json?search={q}&limit=1',headers={'User-Agent':UA}),timeout=40))
                    found=max(found,j['meta']['results']['total'])
                except Exception: pass
        rows.append({'nid':r['nid'],'gtin':digits,'fda_food_matches':found}); hits+= found>0
json.dump({'gtins_checked':total,'with_fda_food_match':hits,'rows':rows},open('results/cfia-fda-link.json','w'),indent=1)
print(total,hits)
