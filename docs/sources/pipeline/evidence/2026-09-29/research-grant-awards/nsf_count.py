import requests,time,json,sys
H={'User-Agent':'data-foundry-scout/1.0 (data@mail.proviciency.com)','Accept':'application/json'}
def has(q,off):
    for i in range(3):
        try:
            r=requests.get('https://api.nsf.gov/services/v1/awards.json',params=dict(q,rpp=1,offset=off),headers=H,timeout=60)
            j=r.json()['response']
            if 'award' in j: return True
            if 'serviceNotification' in j and j['serviceNotification'][0]['notificationCode']=='AwardAPI-004': return False
            return False
        except Exception as e: time.sleep(2)
    return False
def count(q):
    lo,hi=1,1
    while has(q,hi): lo=hi; hi*=2
    while hi-lo>1:
        m=(lo+hi)//2
        if has(q,m): lo=m
        else: hi=m
    return lo
tot={}
for y in [1985,2000,2010,2020,2024,2025,2026]:
    q={'dateStart':f'01/01/{y}','dateEnd':f'12/31/{y}'}
    tot[y]=count(q); print(y,tot[y],flush=True)
json.dump(tot,open('nsf_counts_by_year.json','w'))
