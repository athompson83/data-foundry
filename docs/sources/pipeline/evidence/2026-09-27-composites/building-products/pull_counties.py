import requests,json,time
S=requests.Session();S.headers['User-Agent']="DataFoundry/1.0 (data@mail.proviciency.com)"
def pull(B,fields,n=2000):
  out=[];off=0
  while True:
    r=S.get(B+'/query',params={'where':'1=1','outFields':fields,'returnGeometry':'false','resultOffset':off,'resultRecordCount':n,'f':'json'}).json()
    F=[f['attributes'] for f in r.get('features',[])];out+=F;off+=len(F)
    if not F or not r.get('exceededTransferLimit'): break
    time.sleep(1)
  return out
nri=pull('https://services.arcgis.com/XG15cJAlne2vxtgt/arcgis/rest/services/National_Risk_Index_Counties/FeatureServer/0','STATEABBRV,COUNTY,STCOFIPS,HAIL_AFREQ,HAIL_RISKR,HRCN_AFREQ,HRCN_RISKR,SWND_AFREQ,SWND_RISKR,NRI_VER')
json.dump(nri,open('nri_counties.json','w'));print('nri',len(nri),nri[0])
bc=pull('https://services.arcgis.com/DN2fPfpggEPlLhP6/arcgis/rest/services/BCAT_Counties_Shareable_BCAT/FeatureServer/0','NAME,State,FIPS,Hurricane_Resistance,Wind_Resistance,Hurricane_Risk,Wind_Risk,Tornado_Risk')
json.dump(bc,open('bcat_counties.json','w'));print('bcat',len(bc))
