"""FAA airport layer (ArcGIS) vs OurAirports, joined on ICAO / FAA location identifier.
Usage: python3 -I measure.py <ourairports airports.csv> <ourairports airport-comments.csv> <out.json>; pages the FAA layer 1000 at a time."""
import sys,csv,json,subprocess,math
UA='data-foundry-scout/1.0 (data@mail.proviciency.com)'
U='https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/arcgis/rest/services/US_Airport/FeatureServer/0/query?where=1%3D1&outFields=IDENT,ICAO_ID,NAME,LATITUDE,LONGITUDE,TYPE_CODE,OPERSTATUS,STATE&orderByFields=OBJECTID&resultRecordCount=1000&f=json&resultOffset='
faa=[]; off=0
while True:
    p=subprocess.run(['curl','-sS','-m','60','-A',UA,U+str(off)],capture_output=True,text=True); j=json.loads(p.stdout)
    fs=[f['attributes'] for f in j.get('features',[])]; faa+=fs; off+=1000
    if len(fs)<1000: break
oa=list(csv.DictReader(open(sys.argv[1],encoding='utf-8')))
by_ident={}; by_local={}
for r in oa:
    for k in ('ident','icao_code','gps_code'):
        if r[k]: by_ident.setdefault(r[k],r)
    if r['local_code']: by_local.setdefault((r['iso_country'],r['local_code']),r)
def dms(s):
    try:
        h=s[-1]; d,m,sec=s[:-1].split('-'); v=int(d)+int(m)/60+float(sec)/3600; return -v if h in 'SW' else v
    except Exception: return None
icao=[a for a in faa if a['ICAO_ID']]; m_icao=0; m_local=0; any_m=0; near=0; chk=0; matched=[]
for a in faa:
    r=by_ident.get(a['ICAO_ID']) if a['ICAO_ID'] else None
    if r: m_icao+=1
    r2=by_local.get(('US',a['IDENT'])) or by_ident.get(a['IDENT'])
    if r2: m_local+=1
    rr=r or r2
    if rr:
        any_m+=1; matched.append(rr['id'])
        la,lo=dms(a['LATITUDE']),dms(a['LONGITUDE'])
        if la is not None:
            chk+=1; d=math.hypot((la-float(rr['latitude_deg']))*111,(lo-float(rr['longitude_deg']))*111*math.cos(math.radians(la)))
            if d<2: near+=1
cm=list(csv.DictReader(open(sys.argv[2],encoding='utf-8'),skipinitialspace=True))
ms=set(matched); cmm=sum(1 for c in cm if c['airportRef'] in ms)
out={'faa_features':len(faa),'faa_with_icao_id':len(icao),'ourairports_rows':len(oa),'match_by_icao_id':m_icao,'match_by_faa_ident_local_code':m_local,'matched_either':any_m,
 'matched_coords_within_2km':near,'matched_coords_checked':chk,'ourairports_comments':len(cm),'comments_on_matched_us_airports':cmm,'operstatus':{k:sum(1 for a in faa if a['OPERSTATUS']==k) for k in {a['OPERSTATUS'] for a in faa}}}
json.dump(out,open(sys.argv[3],'w'),indent=1); print(out)
