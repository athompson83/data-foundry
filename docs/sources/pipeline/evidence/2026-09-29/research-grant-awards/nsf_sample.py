import requests,random,re,json,time,collections
H={'User-Agent':'data-foundry-scout/1.0 (data@mail.proviciency.com)','Accept':'application/json'}
random.seed(29)
S=[]
while len(S)<20:
    y=random.choice(range(2015,2027)); off=random.randrange(0,3000)
    try:
        r=requests.get('https://api.nsf.gov/services/v1/awards.json',params=dict(rpp=1,offset=off,dateStart=f'01/01/{y}',dateEnd=f'12/31/{y}',printFields='id,title,abstractText,awardeeName,ueiNumber,cfdaNumber,pubs,publicationResearch,publicationConference'),headers=H,timeout=60).json()['response']['award'][0]
        S.append(r)
    except Exception as e: print('err',e)
    time.sleep(1)
json.dump(S,open('nsf_samples.json','w'))
h=lambda f:sum(1 for r in S if f(r))
print('n',len(S))
print('id 7digit',h(lambda r:re.fullmatch(r'\d{7}',r['id'])))
print('uei 12',h(lambda r:re.fullmatch(r'[A-Z0-9]{12}',r.get('ueiNumber') or '')))
print('cfda',h(lambda r:re.match(r'\d{2}\.\d{3}',r.get('cfdaNumber') or '')))
print('abstract>50',h(lambda r:len(r.get('abstractText') or '')>50))
print('pi email',h(lambda r:bool(r.get('piEmail'))))
print('has publicationResearch',h(lambda r:bool(r.get('publicationResearch'))))
dois=[d for r in S for d in re.findall(r'10\.\d{4,9}/[^\s"<>;,]+',' '.join(map(str,(r.get('publicationResearch') or [])+(r.get('publicationConference') or []))))]
print('dois in pubs',len(dois),dois[:5])
print('keys',sorted(S[0].keys()))
print('max date',max(r['date'] for r in S))
