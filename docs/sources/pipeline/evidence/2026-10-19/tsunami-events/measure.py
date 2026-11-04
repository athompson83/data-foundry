"""NOAA NCEI tsunami events + runups, and USGS earthquake catalogue as the candidate counterpart.
Usage: python3 -I measure.py <out.json> <rows.json>. Candidate rule: NCEI event with causeCode earthquake and a magnitude, since 2000,
matches a USGS event within 5 minutes of the NCEI origin time, magnitude within 0.4 and epicentre within 2 degrees."""
import sys,json,subprocess,datetime as dt
UA='data-foundry-scout/1.0 (data@mail.proviciency.com)'
def get(u):
    for i in range(3):
        p=subprocess.run(['curl','-sS','-m','60','-A',UA,u],capture_output=True,text=True)
        try: return json.loads(p.stdout)
        except Exception: pass
    return {}
B='https://www.ngdc.noaa.gov/hazel/hazard-service/api/v1/tsunamis/'
ev=get(B+'events'); items=ev['items']; pages=ev['totalPages']
for p in range(2,pages+1): items+=get(B+'events?page=%d'%p)['items']
ru=get(B+'runups'); n_ru=ru.get('totalItems'); 
seis=[e for e in items if e.get('causeCode')==1 and e.get('eqMagnitude') and e['year']>=2000 and e.get('month') and e.get('day') and 'latitude' in e]
rows=[]; ok=0
for e in seis:
    t=dt.datetime(e['year'],e['month'],e['day'],e.get('hour') or 0,e.get('minute') or 0,int(e.get('second') or 0))
    u='https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&starttime=%s&endtime=%s&minmagnitude=%.1f'%((t-dt.timedelta(minutes=5)).isoformat(),(t+dt.timedelta(minutes=5)).isoformat(),e['eqMagnitude']-0.4)
    f=get(u).get('features',[]); hit=None
    for x in f:
        lo,la=x['geometry']['coordinates'][:2]
        if abs(x['properties']['mag']-e['eqMagnitude'])<=0.4 and abs(la-e['latitude'])<=2 and abs(lo-e['longitude'])<=2: hit=x['id']
    ok+=1 if hit else 0; rows.append({'ncei_id':e['id'],'usgs_id':hit,'year':e['year'],'mag':e['eqMagnitude']})
out={'ncei_events':len(items),'ncei_events_since_2000':sum(1 for e in items if e['year']>=2000),'ncei_runups_total':n_ru,'earthquake_caused_since_2000_with_magnitude':len(seis),'matched_usgs_event':ok,'latest_ncei_event_year':max(e['year'] for e in items),
 'events_with_deaths':sum(1 for e in items if e.get('deathsTotal')),'events_with_damage_usd':sum(1 for e in items if e.get('damageMillionsDollarsTotal'))}
json.dump(out,open(sys.argv[1],'w'),indent=1); json.dump(rows,open(sys.argv[2],'w')); print(out)
