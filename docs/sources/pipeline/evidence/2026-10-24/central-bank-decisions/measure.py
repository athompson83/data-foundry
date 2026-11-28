"""Central-bank policy decisions: Federal Reserve FOMC statements (free text) vs NY Fed published EFFR target range (structured), joined on decision date.
Rule: statement date D -> NY Fed targetRateFrom/To on the first business day after D must equal the 'target range for the federal funds rate to X to Y percent' sentence in the statement.
Usage: python3 -I measure.py <out.json> <rows.json>"""
import sys,re,json,subprocess,datetime as dt,html
UA='data-foundry-scout/1.0 (data@mail.proviciency.com)'
def get(u): return subprocess.run(['curl','-sSL','-m','60','-A',UA,u],capture_output=True,text=True).stdout
cal=get('https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm')
urls=sorted(set(re.findall(r'/newsevents/pressreleases/monetary(20(?:24|25|26)\d{4})a\.htm',cal)))
ny=json.loads(get('https://markets.newyorkfed.org/api/rates/unsecured/effr/search.json?startDate=2024-01-01&endDate=2026-10-24'))['refRates']
tr={r['effectiveDate']:(r['targetRateFrom'],r['targetRateTo']) for r in ny}
rows=[];fails=[]
for d in urls:
    t=html.unescape(re.sub(r'<[^>]+>',' ',get(f'https://www.federalreserve.gov/newsevents/pressreleases/monetary{d}a.htm')))
    flat=re.sub(r'\s+',' ',t).replace('\u2011','-')
    dec=re.search(r'[^.]*decided to [^.]*target range[^.]*\.',flat)
    NUM=r'(\d+-\d/\d|\d+(?:\.\d+)?)'
    m=re.search(r'(?:at|to) '+NUM+' to '+NUM+' percent',dec.group(0)) if dec else None
    if not m: fails.append(d); continue
    cv=lambda s:float(s.split('-')[0])+(int(s.split('-')[1].split('/')[0])/int(s.split('-')[1].split('/')[1]) if '-' in s else 0)
    lo,hi=cv(m.group(1)),cv(m.group(2))
    D=dt.date(int(d[:4]),int(d[4:6]),int(d[6:]))
    nxt=next((D+dt.timedelta(days=k) for k in range(1,6) if (D+dt.timedelta(days=k)).isoformat() in tr),None)
    got=tr.get(nxt.isoformat()) if nxt else None
    rows.append({'statement_date':D.isoformat(),'stated':[lo,hi],'nyfed_next_business_day':nxt.isoformat() if nxt else None,'nyfed_target':list(got) if got else None,'agree':got==(lo,hi)})
out={'statement_urls_in_calendar_2024_2026':len(urls),'statements_with_parsed_target_range':len(rows),'unparsed_statements':fails,'nyfed_effr_days':len(ny),'agree_with_nyfed_target':sum(r['agree'] for r in rows)}
json.dump(out,open(sys.argv[1],'w'),indent=1); json.dump(rows,open(sys.argv[2],'w'),indent=1); print(json.dumps(out)); [print(r) for r in rows]
