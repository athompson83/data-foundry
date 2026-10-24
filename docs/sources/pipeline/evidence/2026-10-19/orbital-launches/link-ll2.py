"""Launch Library 2 (most recent 40 previous launches, mode=normal) vs the GCAT launch log.
Candidate rule: GCAT Launch_Date within 1 day of the LL2 net time and a shared vehicle-name token (LL2 rocket full name vs GCAT LV_Type/Variant).
Usage: python3 -I link-ll2.py <ll2 json> <gcat launch.tsv> <out.json>"""
import sys,json,re,datetime as dt
ll=json.load(open(sys.argv[1]))['results']
MON={m:i+1 for i,m in enumerate('Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split())}
g=[]; hdr=None
for ln in open(sys.argv[2],encoding='utf-8',errors='replace'):
    if ln.startswith('#Launch_Tag'): hdr=ln[1:].rstrip('\n').split('\t'); continue
    if ln.startswith('#') or not ln.strip(): continue
    r=dict(zip(hdr,[x.strip() for x in ln.rstrip('\n').split('\t')]))
    m=re.match(r'(\d{4}) (\w{3})\s+(\d+)',r['Launch_Date'])
    if m and m.group(1)>='2026': r['d']=dt.date(int(m.group(1)),MON[m.group(2)],int(m.group(3))); g.append(r)
def toks(s): return set(re.findall(r'[a-z0-9]{3,}',s.lower()))-{'the','rocket','block','heavy'}
rows=[]; ok=0
for x in ll:
    d=dt.datetime.strptime(x['net'][:10],'%Y-%m-%d').date(); name=x['rocket']['configuration']['full_name']
    hit=[r['Launch_Tag'] for r in g if abs((r['d']-d).days)<=1 and toks(name)&toks(r['LV_Type']+' '+r['Variant'])]
    ok+=1 if hit else 0; rows.append({'ll2_id':x['id'],'net':x['net'][:10],'rocket':name,'gcat':hit})
out={'ll2_launches_checked':len(ll),'with_candidate_gcat_launch':ok,'gcat_launches_2026_loaded':len(g),'rows':rows}
json.dump(out,open(sys.argv[3],'w'),indent=1); print(len(ll),ok,len(g))
