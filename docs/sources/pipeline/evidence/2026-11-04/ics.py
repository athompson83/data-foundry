# ICS/OT security advisories screening, 2026-11-04. Re-fetches live. Output ics.json
import json,re,urllib.request,concurrent.futures as cf
UA="data-foundry-scout/1.0 (data@mail.proviciency.com)"
def get(u,t=40):
    return urllib.request.urlopen(urllib.request.Request(u,headers={"User-Agent":UA}),timeout=t).read()
R={}
base="https://raw.githubusercontent.com/cisagov/CSAF/develop/csaf_files/OT/white/"
idx=[l for l in get(base+"index.txt").decode().split() if l]
ch=[l.split(',') for l in get(base+"changes.csv").decode().splitlines()]
R['cisa']={'index_files':len(idx),'by_year':{y:sum(1 for i in idx if i.startswith(y+'/')) for y in sorted({i[:4] for i in idx})},
 'newest_change':max(c[1].strip('"') for c in ch)}
# sample newest 60 + oldest-year spread
def doc(u):
    try:return json.loads(get(u))
    except Exception as e:return {'err':str(e)}
newest=[c[0].strip('"') for c in sorted(ch,key=lambda c:c[1],reverse=True)[:60]]
with cf.ThreadPoolExecutor(8) as ex: cisa=list(ex.map(lambda p:doc(base+p),newest))
def cves(d):
    s=set()
    for v in d.get('vulnerabilities',[]) or []:
        if v.get('cve'):s.add(v['cve'])
    return s
ok=[d for d in cisa if 'err' not in d]
R['cisa']['sampled']=len(ok)
R['cisa']['with_cve']=sum(1 for d in ok if cves(d))
R['cisa']['with_notes_text']=sum(1 for d in ok if d.get('document',{}).get('notes'))
R['cisa']['with_remediation']=sum(1 for d in ok if any(v.get('remediations') for v in d.get('vulnerabilities',[])))
R['cisa']['license_or_tlp']=sorted({json.dumps(d.get('document',{}).get('distribution',{}).get('tlp',{}).get('label')) for d in ok})
R['cisa']['sample_ids']=[d['document']['tracking']['id'] for d in ok][:60]
cisa_cves=set().union(*[cves(d) for d in ok]) if ok else set()
cisa_refs=[ (d['document']['tracking']['id'],[r['url'] for r in d['document'].get('references',[]) if 'siemens' in r['url'].lower() or 'se.com' in r['url'].lower()]) for d in ok]
R['cisa']['cite_siemens_or_schneider']=sum(1 for _,u in cisa_refs if u)
# Siemens
sf=json.loads(get("https://cert-portal.siemens.com/productcert/csaf/ssa-feed-tlp-white.json"))
ents=sf['feed']['entry']
R['siemens']={'feed_entries':len(ents),'newest':max(e.get('updated','') for e in ents)}
links=[ [l['href'] for l in e['link'] if l.get('rel')=='self'] or [c for c in [e.get('content',{}).get('src')] if c] for e in ents]
links=[l[0] for l in links if l]
R['siemens']['doc_links']=len(links)
with cf.ThreadPoolExecutor(8) as ex: sd=list(ex.map(doc,links[:60]))
sok=[d for d in sd if 'err' not in d]
R['siemens']['sampled']=len(sok)
R['siemens']['with_cve']=sum(1 for d in sok if cves(d))
R['siemens']['with_notes_text']=sum(1 for d in sok if d.get('document',{}).get('notes'))
scv=set().union(*[cves(d) for d in sok]) if sok else set()
R['siemens']['sample_ids']=[d['document']['tracking']['id'] for d in sok]
R['join_cve']={'cisa_cves':len(cisa_cves),'siemens_cves':len(scv),'shared':len(cisa_cves&scv)}
# CISA advisories citing a Siemens SSA id
ssa=re.compile(r'SSA-\d{6}')
ssa_ids={d['document']['tracking']['id'] for d in sok}
cisa_text=[json.dumps(d) for d in ok]
R['join_ssa']={'cisa_docs_citing_any_SSA':sum(1 for t in cisa_text if ssa.search(t)),
 'cited_ssa_total':len({m for t in cisa_text for m in ssa.findall(t)})}
# Schneider
try:
    pm=json.loads(get("https://www.se.com/.well-known/csaf/provider-metadata.json"))
    R['schneider']={'directory_url':pm['distributions'][0].get('directory_url'),'license_publisher':pm.get('publisher')}
    for u in [pm['distributions'][0].get('directory_url','')+'/changes.csv', pm['distributions'][0].get('directory_url','')+'/index.txt']:
        try:
            t=get(u).decode(); R['schneider'][u.rsplit('/',1)[1]]=len(t.splitlines())
        except Exception as e: R['schneider'][u.rsplit('/',1)[1]]='ERR '+str(e)[:60]
except Exception as e: R['schneider']={'err':str(e)}
json.dump(R,open('ics.json','w'),indent=1)
print(json.dumps({k:{a:b for a,b in v.items() if a!='sample_ids'} for k,v in R.items()},indent=1))
