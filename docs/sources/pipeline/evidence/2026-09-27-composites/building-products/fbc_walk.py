import json,sys,re,html
from fbc_lib import *
out={}
try: out=json.load(open('fbc_list.json'))  # other categories from earlier runs are kept
except FileNotFoundError: pass
# Each requested category is walked from page 1, so drop its old rows first: an approval that has left the
# APPROVED view must not survive a rerun.
out={k:v for k,v in out.items() if v['cat'] not in sys.argv[1:]}
def rows(t,cat):
  n=0
  for m in re.finditer(r"href='\.\./pr/pr_app_dtl\.aspx\?param=([^']*)'>(FL[^<]*)</a>(.*?)(?=href='\.\./pr/pr_app_dtl|lblCurrentPage|$)",t,re.S):
    s=re.sub(r'\s+',' ',html.unescape(re.sub('<[^>]+>',' | ',m.group(3))))
    cells=[c.strip() for c in s.split('|') if c.strip()]
    out[m.group(2)]={'param':m.group(1),'cat':cat,'cells':cells[:14]}; n+=1
  return n
for cat in sys.argv[1:]:
  t=search(cat); tp=int(re.search(r'lblTotalPages">(\d+)',t).group(1)); n=rows(t,cat)
  print(cat,'pages',tp,'p1',n,flush=True)
  for pg in range(2,tp+1):
    page=None  # the postback chain needs each page, so a page that cannot be fetched ends the run
    for attempt in range(3):
      try: page=nextpage(t,pg); break
      except Exception as e: print('retry',pg,e,flush=True); time.sleep(5)
    if page is None: raise SystemExit(f'{cat}: page {pg} failed after 3 attempts; population incomplete')
    t=page
    cp=re.search(r'lblCurrentPage">(\d+)',t)
    if not cp or int(cp.group(1))!=pg: raise SystemExit(f'{cat}: expected page {pg}, got {cp and cp.group(1)}')
    n=rows(t,cat)
    if pg%10==0 or n==0: print(cat,pg,cp and cp.group(1),n,len(out),flush=True)
  json.dump(out,open('fbc_list.json','w'))
json.dump(out,open('fbc_list.json','w'))
print('done',len(out))
