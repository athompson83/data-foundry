import json,sys,time,urllib.request,urllib.parse,xml.etree.ElementTree as ET
UA={'User-Agent':'data-foundry-research/1.0 (+https://data.aroqon.com)'}
def get(url,accept=None):
    h=dict(UA); 
    if accept: h['Accept']=accept
    t=time.time(); r=urllib.request.urlopen(urllib.request.Request(url,headers=h),timeout=40); b=r.read(); 
    return r.status, b, time.time()-t, dict(r.headers)
VINS=['1HGCV1F3XKA000000','5YJ3E1EA7KF000000','1FTFW1E5XKFA00000','2T1BURHE0JC000000','3VWDB7AJ5HM000000','1C4RJFBG0LC000000','JTDKARFU0K3000000','KM8J3CA46KU000000','WBA5A5C51FD000000','1GCUYDED0KZ000000','5NPE24AF0FH000000','JM3KFBDM0K0000000']
results=[]
for vin in VINS:
    row={'vin':vin}
    st,b,t,h=get(f'https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/{vin}?format=json')
    d=json.loads(b)['Results'][0]
    row['decode']={'status':st,'bytes':len(b),'s':round(t,2),'make':d.get('Make'),'model':d.get('Model'),'year':d.get('ModelYear'),'errorCode':d.get('ErrorCode'),'errorText':(d.get('ErrorText') or '')[:60],'bodyClass':d.get('BodyClass'),'fuel':d.get('FuelTypePrimary')}
    make,model,year=d.get('Make') or '',d.get('Model') or '',d.get('ModelYear') or ''
    try:
        st,b,t,h=get('https://api.nhtsa.gov/recalls/recallsByVehicle?'+urllib.parse.urlencode({'make':make,'model':model,'modelYear':year}))
        rj=json.loads(b); row['recalls']={'status':st,'bytes':len(b),'s':round(t,2),'count':rj.get('Count'),'campaigns':[r.get('NHTSACampaignNumber') for r in rj.get('results',[])][:5]}
    except Exception as e:
        row['recalls']={'error':str(e)[:80]}
    # fuel economy join: menu/make?year -> menu/model?year&make -> menu/options?year&make&model
    fe={'calls':0,'bytes':0}
    try:
        st,b,t,h=get(f'https://www.fueleconomy.gov/ws/rest/vehicle/menu/make?year={year}'); fe['calls']+=1; fe['bytes']+=len(b)
        makes=[m.findtext('value') for m in ET.fromstring(b).findall('menuItem')]
        fe['make_match']=[m for m in makes if m.lower()==make.lower()]
        if fe['make_match']:
            mk=fe['make_match'][0]
            st,b,t,h=get('https://www.fueleconomy.gov/ws/rest/vehicle/menu/model?'+urllib.parse.urlencode({'year':year,'make':mk})); fe['calls']+=1; fe['bytes']+=len(b)
            models=[m.findtext('value') for m in ET.fromstring(b).findall('menuItem')]
            exact=[m for m in models if m.lower()==model.lower()]
            fuzzy=[m for m in models if model.lower() in m.lower() or m.lower() in model.lower()]
            fe['model_exact']=exact; fe['model_fuzzy']=fuzzy[:6]; fe['model_count']=len(models)
            pick=(exact or fuzzy or [None])[0]
            if pick:
                st,b,t,h=get('https://www.fueleconomy.gov/ws/rest/vehicle/menu/options?'+urllib.parse.urlencode({'year':year,'make':mk,'model':pick})); fe['calls']+=1; fe['bytes']+=len(b)
                opts=[(m.findtext('text'),m.findtext('value')) for m in ET.fromstring(b).findall('menuItem')]
                fe['options']=len(opts)
                if opts:
                    vid=opts[0][1]
                    st,b,t,h=get(f'https://www.fueleconomy.gov/ws/rest/vehicle/{vid}'); fe['calls']+=1; fe['bytes']+=len(b)
                    v=ET.fromstring(b); fe['comb08']=v.findtext('comb08'); fe['fuelType']=v.findtext('fuelType'); fe['content_type']=h.get('Content-Type')
    except Exception as e:
        fe['error']=str(e)[:100]
    row['fueleconomy']=fe
    results.append(row)
    print(json.dumps(row))
json.dump(results,open('vehicle-bench.json','w'),indent=1)
