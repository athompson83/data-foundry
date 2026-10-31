"""Scholarly works: arXiv Atom API vs Crossref REST API. Declared join: arxiv:doi on an arXiv entry -> Crossref /works/<doi>.
Usage: python3 -I measure.py <out.json>. Sample: 300 most recently updated arXiv entries in astro-ph.CO,cs.LG,q-bio.NC (100 each)."""
import sys,re,json,time,subprocess,urllib.parse,xml.etree.ElementTree as ET
UA='data-foundry-scout/1.0 (mailto:data@mail.proviciency.com)'
A={'a':'http://www.w3.org/2005/Atom','x':'http://arxiv.org/schemas/atom'}
def get(u):
    for i in range(4):
        p=subprocess.run(['curl','-sSL','-m','45','-A',UA,u],capture_output=True)
        if p.returncode==0 and p.stdout: return p.stdout.decode('utf-8','replace')
        time.sleep(3)
    return ''
def norm(s): return re.sub(r'[^a-z0-9]+',' ',(s or '').lower()).strip()
rows=[]
for cat in ('astro-ph.CO','cs.LG','q-bio.NC'):
    x=get('https://export.arxiv.org/api/query?search_query=cat:%s&sortBy=lastUpdatedDate&sortOrder=descending&max_results=100'%cat); time.sleep(3)
    for e in ET.fromstring(x).findall('a:entry',A):
        doi=e.find('x:doi',A)
        rows.append({'cat':cat,'id':e.find('a:id',A).text.rsplit('/abs/')[1],'title':' '.join(e.find('a:title',A).text.split()),'abstract_chars':len(e.find('a:summary',A).text or ''),'doi':doi.text.strip() if doi is not None else None})
with_doi=[r for r in rows if r['doi']]
for r in with_doi:
    j=get('https://api.crossref.org/works/%s?mailto=data@mail.proviciency.com'%urllib.parse.quote(r['doi'])); time.sleep(0.3)
    try: m=json.loads(j)['message']
    except Exception: r['crossref']=None; continue
    ct=(m.get('title') or [''])[0]
    r['crossref']={'title':ct,'type':m.get('type'),'has_abstract':'abstract' in m,'title_agrees':norm(ct)[:40]==norm(r['title'])[:40] or norm(r['title'])[:40] in norm(ct) or norm(ct)[:40] in norm(r['title'])}
res=[r for r in with_doi if r.get('crossref')]
out={'arxiv_sampled':len(rows),'with_doi':len(with_doi),'doi_resolves_in_crossref':len(res),'title_agrees':sum(r['crossref']['title_agrees'] for r in res),'crossref_with_abstract':sum(r['crossref']['has_abstract'] for r in res),'arxiv_abstract_mean_chars':sum(r['abstract_chars'] for r in rows)//max(1,len(rows)),'rows':rows}
json.dump(out,open(sys.argv[1],'w'),indent=1)
print({k:v for k,v in out.items() if k!='rows'})
