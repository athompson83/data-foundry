import re
from load import *
rec=cpsc()
KW=re.compile(r'\b(refrigerator|freezer|dishwasher|washer|dryer|range|oven|cooktop|microwave|dehumidifier|air conditioner|heat pump|furnace|boiler|water heater|ceiling fan|faucet|showerhead|toilet|ev charger|charging station|inverter|solar|downlight|light fixture|thermostat|pool pump|air purifier|air cleaner|ventilat)',re.I)
TOKEN=re.compile(r"\b(?=[A-Z0-9/\-\.]*\d)(?=[A-Z0-9/\-\.]*[A-Z])[A-Z0-9][A-Z0-9/\-\.]{3,}[A-Z0-9]\b")
d=[r for r in rec if r['RecallDate']>='2015' and KW.search(r['Title'] or '')]
dt=[r for r in d if TOKEN.search(r.get('Description') or '')]
print('2015+ recalls with equipment keyword in title',len(d),'with a model-like token in Description',len(dt))
import json
h=json.load(open(E3+'/link_cpsc_matches.json'))['hits']
ids={x['recall'] for x in h}; print('matched in that set',len(ids&{r['RecallNumber'] for r in dt}))
