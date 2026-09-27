import requests,json,time
S=requests.Session();S.headers['User-Agent']="DataFoundry/1.0 (data@mail.proviciency.com)"
def pull(B,fields,n=2000):
  out=[];off=0
  while True:
    for attempt in range(3):
      try:
        x=S.get(B+'/query',params={'where':'1=1','outFields':fields,'returnGeometry':'false','resultOffset':off,'resultRecordCount':n,'f':'json'},timeout=120)
        x.raise_for_status(); r=x.json()
        if 'error' in r or 'features' not in r: raise ValueError(f'ArcGIS error: {r.get("error")}')
        break
      except Exception as e: print('retry',off,e,flush=True); r=None; time.sleep(5)
    if r is None: raise SystemExit(f'{B}: page at offset {off} failed after 3 attempts; population incomplete')
    F=[f['attributes'] for f in r['features']];out+=F;off+=len(F)
    if not F or not r.get('exceededTransferLimit'): break
    time.sleep(1)
  # Only a complete sequence may be saved: confirm the total against the service's own count.
  x=S.get(B+'/query',params={'where':'1=1','returnCountOnly':'true','f':'json'},timeout=120); x.raise_for_status()
  total=x.json()['count']
  if len(out)!=total: raise SystemExit(f'{B}: fetched {len(out)} of {total} features; population incomplete')
  return out
nri=pull('https://services.arcgis.com/XG15cJAlne2vxtgt/arcgis/rest/services/National_Risk_Index_Counties/FeatureServer/0','STATEABBRV,COUNTY,STCOFIPS,HAIL_AFREQ,HAIL_RISKR,HRCN_AFREQ,HRCN_RISKR,SWND_AFREQ,SWND_RISKR,NRI_VER')
json.dump(nri,open('nri_counties.json','w'));print('nri',len(nri),nri[0])
bc=pull('https://services.arcgis.com/DN2fPfpggEPlLhP6/arcgis/rest/services/BCAT_Counties_Shareable_BCAT/FeatureServer/0','NAME,State,FIPS,Hurricane_Resistance,Wind_Resistance,Hurricane_Risk,Wind_Risk,Tornado_Risk')
json.dump(bc,open('bcat_counties.json','w'));print('bcat',len(bc))
