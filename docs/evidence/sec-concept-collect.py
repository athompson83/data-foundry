#!/usr/bin/env python3
# VALIDATION PROTOTYPE -- not product code, not wired to anything.
# Reproduces measurements in docs/commercial-validation/sec-canonical-facts-validation-20260917.md
import json, os, time, urllib.request, collections, sys

UA = 'DataFoundryResearch/1.0'
CIKS = {  # 28 companies across industries and filing histories
 'AAPL':320193,'MSFT':789019,'NVDA':1045810,'AMZN':1018724,'GOOGL':1652044,
 'META':1326801,'TSLA':1318605,'JPM':19617,'BAC':70858,'WFC':72971,
 'XOM':34088,'CVX':93410,'JNJ':200406,'PFE':78003,'MRK':310158,
 'WMT':104169,'COST':909832,'HD':354950,'PG':80424,'KO':21344,
 'PEP':77476,'BA':12927,'CAT':18230,'GE':40545,'F':37996,
 'GM':1467858,'T':732717,'VZ':732712,
}
# metric -> candidate us-gaap concepts, most-specific first
METRICS = {
 'revenue':['RevenueFromContractWithCustomerExcludingAssessedTax','RevenueFromContractWithCustomerIncludingAssessedTax','Revenues','SalesRevenueNet','SalesRevenueGoodsNet','RevenuesNetOfInterestExpense'],
 'net_income':['NetIncomeLoss','ProfitLoss','NetIncomeLossAvailableToCommonStockholdersBasic'],
 'operating_income':['OperatingIncomeLoss'],
 'assets':['Assets'],
 'liabilities':['Liabilities'],
 'cash':['CashAndCashEquivalentsAtCarryingValue','CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents'],
 'operating_cash_flow':['NetCashProvidedByUsedInOperatingActivities','NetCashProvidedByUsedInOperatingActivitiesContinuingOperations'],
 'capex':['PaymentsToAcquirePropertyPlantAndEquipment','PaymentsToAcquireProductiveAssets'],
 'shares_outstanding':['CommonStockSharesOutstanding','EntityCommonStockSharesOutstanding','WeightedAverageNumberOfSharesOutstandingBasic'],
 'eps_basic':['EarningsPerShareBasic'],
 'eps_diluted':['EarningsPerShareDiluted'],
 'gross_profit':['GrossProfit'],
 'rnd':['ResearchAndDevelopmentExpense'],
 'inventory':['InventoryNet'],
 'stockholders_equity':['StockholdersEquity','StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest'],
 'income_tax':['IncomeTaxExpenseBenefit'],
}

def fetch(cik):
    url=f'https://data.sec.gov/api/xbrl/companyfacts/CIK{cik:010d}.json'
    req=urllib.request.Request(url, headers={'User-Agent':UA,'Accept-Encoding':'gzip'})
    import gzip,io
    with urllib.request.urlopen(req, timeout=90) as r:
        raw=r.read()
        if r.headers.get('Content-Encoding')=='gzip': raw=gzip.decompress(raw)
        return json.loads(raw), len(raw)

out={}
for tick,cik in CIKS.items():
    try:
        d,nbytes=fetch(cik)
    except Exception as e:
        print(f'  {tick}: FETCH FAIL {str(e)[:60]}', file=sys.stderr); continue
    us=d.get('facts',{}).get('us-gaap',{})
    dei=d.get('facts',{}).get('dei',{})
    rec={'bytes':nbytes,'concepts':len(us),'rows':0,'metrics':{}}
    for cv in us.values():
        for rows in cv['units'].values(): rec['rows']+=len(rows)
    for metric,cands in METRICS.items():
        per_concept={}
        for c in cands:
            src = us.get(c) or dei.get(c)
            if not src: continue
            for unit,rows in src['units'].items():
                yrs=sorted({r['end'][:4] for r in rows if r.get('end')})
                if not yrs: continue
                per_concept[c]={'unit':unit,'n':len(rows),'first':yrs[0],'last':yrs[-1]}
                break
        rec['metrics'][metric]=per_concept
    out[tick]=rec
    print(f'  {tick}: {nbytes/1e6:.1f}MB  {rec["concepts"]} concepts  {rec["rows"]} rows', file=sys.stderr)
    time.sleep(0.6)
json.dump(out, open('/tmp/sec/summary.json','w'))
print(f'\ncollected {len(out)} companies', file=sys.stderr)
