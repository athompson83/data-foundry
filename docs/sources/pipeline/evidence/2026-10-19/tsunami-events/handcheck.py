"""Hand-check input: 12 random NCEI tsunami events matched to a USGS event, with both place names side by side.
Usage: python3 -I handcheck.py <rows.json> <out.json>. Verdicts are written by reading the two place strings, in handcheck-verdicts.json."""
import sys,json,random,subprocess
UA='data-foundry-scout/1.0 (data@mail.proviciency.com)'
rows=[r for r in json.load(open(sys.argv[1])) if r['usgs_id']]
random.Random(20261019).shuffle(rows); out=[]
B='https://www.ngdc.noaa.gov/hazel/hazard-service/api/v1/tsunamis/events/'
for r in rows[:12]:
    n=json.loads(subprocess.run(['curl','-sS','-m','40','-A',UA,B+str(r['ncei_id'])],capture_output=True,text=True).stdout)
    u=json.loads(subprocess.run(['curl','-sS','-m','40','-A',UA,'https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&eventid='+r['usgs_id']],capture_output=True,text=True).stdout)
    out.append({'ncei_id':r['ncei_id'],'ncei_place':n.get('locationName'),'ncei_year':n.get('year'),'ncei_mag':n.get('eqMagnitude'),'usgs_id':r['usgs_id'],'usgs_place':u['properties']['place'],'usgs_mag':u['properties']['mag']})
json.dump(out,open(sys.argv[2],'w'),indent=1)
for o in out: print(o)
