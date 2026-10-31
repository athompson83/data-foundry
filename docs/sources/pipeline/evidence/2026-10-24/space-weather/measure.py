"""Space weather: NOAA SWPC alerts (free-text messages) vs GFZ Potsdam Kp index, joined on time.
For each SWPC 'Geomagnetic K-index of N' ALERT (threshold reached at T), find the GFZ 3-hour Kp interval containing T and
the next one, and test whether Kp >= N-1 (SWPC's real-time estimate vs the definitive GFZ value).
Usage: python3 -I measure.py <out.json> <handcheck.json>"""
import sys,json,re,subprocess,datetime as dt
UA='data-foundry-scout/1.0 (data@mail.proviciency.com)'
def get(u): return json.loads(subprocess.run(['curl','-sSL','-m','60','-A',UA,u],capture_output=True,text=True).stdout)
A=get('https://services.swpc.noaa.gov/products/alerts.json')
G=get('https://kp.gfz.de/app/json/?start=2026-09-20T00:00:00Z&end=2026-10-25T00:00:00Z&index=Kp')
gt=[dt.datetime.strptime(t,'%Y-%m-%dT%H:%M:%SZ') for t in G['datetime']]
kp=G['Kp']
mon={m:i for i,m in enumerate('Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(),1)}
rows=[];codes={}
for a in A:
    codes[a['product_id'][:3]]=codes.get(a['product_id'][:3],0)+1
    m=re.search(r'ALERT: Geomagnetic K-index of (\d)',a['message']); t=re.search(r'Threshold Reached: (\d{4}) (\w{3}) (\d+) (\d{4}) UTC',a['message'])
    ser=re.search(r'Serial Number: (\d+)',a['message'])
    if not (m and t): continue
    T=dt.datetime(int(t.group(1)),mon[t.group(2)],int(t.group(3)),int(t.group(4)[:2]),int(t.group(4)[2:]))
    idx=max((i for i,x in enumerate(gt) if x<=T),default=None)
    if idx is None: continue
    n=int(m.group(1)); k0=kp[idx]; k1=kp[idx+1] if idx+1<len(kp) else None
    rows.append({'serial':ser.group(1),'alert_k':n,'threshold_utc':T.isoformat(),'gfz_bin_start':gt[idx].isoformat(),'gfz_kp_bin':k0,'gfz_kp_next':k1,'ok':any(abs(x-n)<=1 for x in (k0,k1) if x is not None)})
ok=sum(r['ok'] for r in rows)
out={'swpc_alerts_30d':len(A),'swpc_product_prefix_counts':codes,'k_index_alerts':len(rows),'gfz_kp_values':len(kp),'gfz_range':[G['datetime'][0],G['datetime'][-1]],
 'k_alerts_with_gfz_kp_within_1_of_alert':ok,'alerts_with_serial_number':sum(1 for a in A if 'Serial Number:' in a['message']),'alerts_with_begin_or_valid_or_threshold_time':sum(1 for a in A if re.search(r'(Begin Time|Valid From|Threshold Reached|Observed Time|Deviation):',a['message']))}
json.dump(out,open(sys.argv[1],'w'),indent=1); json.dump(rows[:12],open(sys.argv[2],'w'),indent=1); print(json.dumps(out,indent=1)); [print(r) for r in rows[:12]]
