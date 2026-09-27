# Count CPSC recalls (population file cpsc_all.json, RecallDateStart=2020-01-01)
# whose Description names a model/item/style/SKU/part number, versus the
# structured Products.Model field.
import json, re
d = json.load(open('cpsc_all.json'))
pat = re.compile(r'\b(?:model|item|style|SKU|part)\s*(?:numbers?|nos?\.?|#)', re.I)
named = sum(bool(pat.search(r['Description'] or '')) for r in d)
structured = sum(any(p['Model'] for p in r['Products']) for r in d)
print(f'recalls={len(d)} description_names_model_marker={named} structured_model_nonempty={structured}')
