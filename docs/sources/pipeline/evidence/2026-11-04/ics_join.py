import json,re,urllib.request,concurrent.futures as cf
UA="data-foundry-scout/1.0 (data@mail.proviciency.com)"
get=lambda u:urllib.request.urlopen(urllib.request.Request(u,headers={"User-Agent":UA}),timeout=40).read()
R=json.load(open('ics.json'))
base="https://raw.githubusercontent.com/cisagov/CSAF/develop/csaf_files/OT/white/"
ch=[l.split(',') for l in get(base+"changes.csv").decode().splitlines()]
newest=[c[0].strip('"') for c in sorted(ch,key=lambda c:c[1],reverse=True)[:200]]
docs=list(cf.ThreadPoolExecutor(8).map(lambda p:json.loads(get(base+p)),newest))
sf=json.loads(get("https://cert-portal.siemens.com/productcert/csaf/ssa-feed-tlp-white.json"))
feed_ids={e['id'].lower() if isinstance(e['id'],str) else '' for e in sf['feed']['entry']}
titles=[e.get('title','') for e in sf['feed']['entry']]
sid=set(re.findall(r'ssa-\d{6}',json.dumps(sf).lower()))
ssa=re.compile(r'SSA-\d{6}',re.I)
cited={}
for d in docs:
    m={x.upper() for x in ssa.findall(json.dumps(d))}
    if m: cited[d['document']['tracking']['id']]=sorted(m)
allc={x for v in cited.values() for x in v}
res={'cisa_docs_examined':len(docs),'cisa_docs_citing_SSA':len(cited),'distinct_SSA_cited':len(allc),
 'SSA_present_in_siemens_feed':sum(1 for x in allc if x.lower() in sid),'siemens_feed_ssa_ids':len(sid)}
res['sample_pairs']=dict(list(cited.items())[:25])
json.dump(res,open('ics_join.json','w'),indent=1);print({k:v for k,v in res.items() if k!='sample_pairs'})
