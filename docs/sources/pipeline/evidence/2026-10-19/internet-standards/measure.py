"""RFC Editor index vs IETF datatracker, joined on the RFC number. Usage: python3 -I measure.py <rfc-index.xml> <out.json>
Samples 40 published RFC numbers with random.Random(20261019) and queries datatracker once per number."""
import sys,re,json,random,subprocess,html
UA='data-foundry-scout/1.0 (data@mail.proviciency.com)'
x=open(sys.argv[1],encoding='utf-8').read()
ent=re.findall(r'<rfc-entry>(.*?)</rfc-entry>',x,re.S)
rows=[]
for e in ent:
    n=int(re.search(r'<doc-id>RFC(\d+)</doc-id>',e).group(1)); t=html.unescape(re.search(r'<title>(.*?)</title>',e,re.S).group(1)).strip()
    st=re.search(r'<current-status>(.*?)</current-status>',e); ab=re.search(r'<abstract>(.*?)</abstract>',e,re.S)
    rows.append({'n':n,'title':t,'status':st.group(1) if st else None,'has_abstract':bool(ab),'obsoleted_by':re.findall(r'<obsoleted-by>.*?<doc-id>RFC(\d+)</doc-id>',e,re.S)})
pub=[r for r in rows if r['status']!='NOT ISSUED']
rnd=random.Random(20261019); smp=rnd.sample(pub,40); ok=0; ttl=0; ab=0; miss=[]
for r in smp:
    p=subprocess.run(['curl','-sS','-m','40','-A',UA,'https://datatracker.ietf.org/api/v1/doc/document/?format=json&limit=1&name=rfc%d'%r['n']],capture_output=True,text=True)
    try: o=json.loads(p.stdout)['objects']
    except Exception: o=[]
    if o and o[0].get('rfc_number')==r['n']:
        ok+=1; ab+=1 if o[0].get('abstract') else 0
        ttl+= 1 if re.sub(r'\W','',o[0]['title'].lower())==re.sub(r'\W','',r['title'].lower()) else 0
    else: miss.append(r['n'])
out={'rfc_index_entries':len(rows),'published':len(pub),'with_abstract_in_index':sum(r['has_abstract'] for r in pub),'sampled':len(smp),'found_in_datatracker_by_rfc_number':ok,'title_equal':ttl,'datatracker_abstract_present':ab,'missing':miss,'sample_rfc_numbers':sorted(r['n'] for r in smp)}
json.dump(out,open(sys.argv[2],'w'),indent=1); print(out)
