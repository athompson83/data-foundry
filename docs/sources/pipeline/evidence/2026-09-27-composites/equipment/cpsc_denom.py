import re
from load import *
rec=cpsc()
KW=re.compile(r'\b(refrigerator|freezer|dishwasher|washer|dryer|range|oven|cooktop|microwave|dehumidifier|air conditioner|heat pump|furnace|boiler|water heater|ceiling fan|faucet|showerhead|toilet|ev charger|charging station|inverter|solar|downlight|light fixture|thermostat|pool pump|air purifier|air cleaner|ventilat)',re.I)
# Case-insensitive, like link_cpsc.py, so the denominator is the population the numerator is drawn from.
TOKEN=re.compile(r"\b(?=[A-Z0-9/\-\.]*\d)(?=[A-Z0-9/\-\.]*[A-Z])[A-Z0-9][A-Z0-9/\-\.]{3,}[A-Z0-9]\b",re.I)
d=[r for r in rec if r['RecallDate']>='2015' and KW.search(r['Title'] or '')]
def model_text(r):
    # The same text link_cpsc.py tokenizes: title, product and firm names, Description, and structured Products[].Model.
    head=' '.join([r.get('Title') or '']+[p.get('Name') or '' for p in r.get('Products') or []]+[m.get('Name') or '' for m in (r.get('Manufacturers') or [])+(r.get('Importers') or [])+(r.get('Distributors') or [])])
    return ' '.join([head, r.get('Description') or '']+[p.get('Model') or '' for p in r.get('Products') or []])
dt=[r for r in d if TOKEN.search(model_text(r))]
print('2015+ recalls with equipment keyword in title',len(d),'with a model-like token in the text the matcher reads',len(dt))
import json
h=json.load(open(os.path.join(OUT,'link_cpsc_matches.json')))['hits']
ids={x['recall'] for x in h}; print('matched in that set',len(ids&{r['RecallNumber'] for r in dt}))
