#!/usr/bin/env python3
# VALIDATION PROTOTYPE -- not product code, not wired to anything.
# Reproduces measurements in docs/commercial-validation/sec-canonical-facts-validation-20260917.md
import json,urllib.request,gzip,time,collections
UA='DataFoundryResearch/1.0'
CIKS={'AAPL':320193,'MSFT':789019,'GOOGL':1652044,'WMT':104169,'KO':21344,'PEP':77476,'GE':40545,'T':732717}
REV=['RevenueFromContractWithCustomerExcludingAssessedTax','RevenueFromContractWithCustomerIncludingAssessedTax','Revenues','SalesRevenueNet','SalesRevenueGoodsNet']
def fetch(cik):
    req=urllib.request.Request(f'https://data.sec.gov/api/xbrl/companyfacts/CIK{cik:010d}.json',
        headers={'User-Agent':UA,'Accept-Encoding':'gzip'})
    with urllib.request.urlopen(req,timeout=90) as r:
        raw=r.read()
        if r.headers.get('Content-Encoding')=='gzip': raw=gzip.decompress(raw)
        return json.loads(raw)
agree=disagree=0; rows=[]
for t,cik in CIKS.items():
    us=fetch(cik)['facts'].get('us-gaap',{})
    # annual (approx 365d) 10-K facts per concept, keyed by fiscal period end
    series=collections.defaultdict(dict)
    import datetime as dt
    for c in REV:
        if c not in us: continue
        for unit,rr in us[c]['units'].items():
            for f in rr:
                if f.get('form')!='10-K' or not f.get('start') or not f.get('end'): continue
                a=dt.date.fromisoformat(f['start']); b=dt.date.fromisoformat(f['end'])
                if not (330 <= (b-a).days <= 400): continue
                series[c][f['end']]=f['val']
            break
    ends=collections.Counter()
    for c,m in series.items():
        for e in m: ends[e]+=1
    shared=[e for e,n in ends.items() if n>1]
    for e in sorted(shared):
        vals={c:series[c][e] for c in series if e in series[c]}
        uniq=set(vals.values())
        if len(uniq)==1: agree+=1
        else:
            disagree+=1
            if len(rows)<6:
                rows.append((t,e,{c[:46]:f'{v:,}' for c,v in vals.items()}))
    time.sleep(0.6)
print(f'annual revenue periods where MULTIPLE concepts both report: {agree+disagree}')
print(f'  concepts AGREE on value:    {agree}')
print(f'  concepts DISAGREE on value: {disagree}')
if agree+disagree: print(f'  disagreement rate: {100*disagree/(agree+disagree):.1f}%')
print()
print('examples of disagreement (same company, same fiscal year end):')
for t,e,vals in rows:
    print(f'  {t} FY ending {e}:')
    for c,v in vals.items(): print(f'     {v:>18}  {c}')
