"""Occupation profiles: O*NET-SOC database (DOL/ETA) vs BLS Occupational Outlook Handbook pages.
Declared join: each OOH page links its occupations to O*NET-SOC codes (onetonline.org/link/summary/<code>).
Usage: python3 -I measure.py <out.json>. Fetches live; deterministic order (first 60 A-Z index pages by sorted URL stride)."""
import sys,re,json,time,subprocess
UA='data-foundry-scout/1.0 (data@mail.proviciency.com)'
def get(u):
    for i in range(3):
        p=subprocess.run(['curl','-sSL','-m','40','-A',UA,u],capture_output=True)
        if p.returncode==0 and p.stdout: return p.stdout.decode('utf-8','replace')
        time.sleep(2)
    return ''
occ=get('https://www.onetcenter.org/dl_files/database/db_29_3_text/Occupation%20Data.txt').splitlines()[1:]
onet={l.split('\t')[0]:l.split('\t')[1] for l in occ if '\t' in l}
az=get('https://www.bls.gov/ooh/a-z-index.htm')
pages=sorted(set(re.findall(r'href="(/ooh/[a-z-]+/[a-z0-9-]+\.htm)"',az)))
pages=[p for p in pages if not p.endswith(('/home.htm','/a-z-index.htm','/occupation-finder.htm'))]
sample=pages[::max(1,len(pages)//60)][:60]
rows=[]
for p in sample:
    h=get('https://www.bls.gov'+p); time.sleep(1)
    codes=sorted(set(re.findall(r'onetonline\.org/link/summary/(\d\d-\d{4}\.\d\d)',h)))
    title=re.search(r'<title>(.*?)</title>',h,re.S)
    summ=re.search(r'<meta name="description" content="([^"]*)"',h)
    rows.append({'page':p,'title':(title.group(1).strip() if title else ''),'onet_codes':codes,'in_onet':[c for c in codes if c in onet],'summary_chars':len(summ.group(1)) if summ else 0,'words':len(re.sub(r'<[^>]+>',' ',h).split())})
withc=[r for r in rows if r['onet_codes']]
ok=sum(1 for r in withc if r['in_onet'])
out={'onet_occupations':len(onet),'ooh_index_pages':len(pages),'sampled':len(rows),'with_onet_link':len(withc),'link_resolves_in_onet':ok,'codes_cited':sum(len(r['onet_codes']) for r in rows),'codes_resolving':sum(len(r['in_onet']) for r in rows),'rows':rows}
json.dump(out,open(sys.argv[1],'w'),indent=1)
print({k:v for k,v in out.items() if k!='rows'})
