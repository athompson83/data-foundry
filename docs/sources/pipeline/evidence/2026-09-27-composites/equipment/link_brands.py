import collections, random
from load import *; from norm import *
import openpyxl
mi=es_mi(); cac=es_cac(); wsr=ws()
esb=collections.Counter(); esp=set()
for r in mi: esb[brand_key(r['brand_name'])]+=1; esp.add(brand_key(r['energy_star_partner']))
for r in cac: esb[brand_key(r['brand_name'])]+=1; esp.add(brand_key(r['energy_star_partner']))
wsb=collections.Counter(brand_key(r['Brand Name']) for r in wsr)
ws_raw=set(r['Brand Name'] for r in wsr)
inter=set(wsb)&set(esb)
print('WS raw brand strings',len(ws_raw),'WS brand keys',len(wsb),'ES brand keys',len(esb),'shared keys',len(inter),'WS rows under shared brands',sum(wsb[b] for b in inter),'/',len(wsr))
print('shared with ES partner keys (filer)',len(set(wsb)&esp))
random.seed(20260927); print(sorted(inter))
# CEC
B2='/tmp/claude-0/-home-user-data-foundry/ea325b01-a089-5c05-94c4-acbba3dfebfa/scratchpad/research2/electrical/'
cecm=set()
for f in ['cec_InvertersList.xlsx','cec_EnergyStorage.xlsx','cec_BatteryList.xlsx']:
    wb=openpyxl.load_workbook(B2+f,read_only=True)
    for ws_ in wb.worksheets:
        hdr=None
        for row in ws_.iter_rows(values_only=True):
            if hdr is None:
                if row and any(str(c).strip().lower().startswith('manufacturer') for c in row if c): hdr=[str(c).strip().lower() if c else '' for c in row]
                continue
            i=[j for j,h in enumerate(hdr) if h.startswith('manufacturer')][0]
            if row[i]: cecm.add(brand_key(str(row[i])))
print('CEC manufacturer keys',len(cecm),'shared with ES brand',len(cecm&set(esb)),sorted(cecm&set(esb)),'shared with ES partner',len(cecm&esp),'shared with WS',len(cecm&set(wsb)))
