import re,html,requests,time,sys
UA="DataFoundry/1.0 (data@mail.proviciency.com)"
S=requests.Session();S.headers['User-Agent']=UA
U="https://www.floridabuilding.org/pr/pr_app_srch.aspx"
r=S.get(U);t=r.text
def fields(t):
  d={}
  for m in re.finditer(r'<input[^>]*>',t):
    tag=m.group(0);n=re.search(r'name="([^"]*)"',tag);v=re.search(r'value="([^"]*)"',tag)
    ty=re.search(r'type="([^"]*)"',tag)
    if n and (not ty or ty.group(1).lower() in('hidden','text')): d[n.group(1)]=html.unescape(v.group(1)) if v else ''
  for m in re.finditer(r'<select[^>]*name="([^"]*)"[^>]*>(.*?)</select>',t,re.S):
    sel=re.search(r'<option[^>]*selected[^>]*value="([^"]*)"',m.group(2)) or re.search(r'<option[^>]*value="([^"]*)"',m.group(2))
    d[m.group(1)]=sel.group(1) if sel else ''
  return d
d=fields(t)
d['lstCategory:drpCustomDropdown']='ROOFING'
d['lstCodeVersion:drpCustomDropdown']='2023'
d['lstAppStatus:drpCustomDropdown']='APPROVED'
d['rbGenOutPut']='rbHTML' if 'rbHTML' in t else d.get('rbGenOutPut','')
print(re.findall(r'name="rbGenOutPut"[^>]*value="([^"]*)"',t))
d['__EVENTTARGET']='lnkSearch';d['__EVENTARGUMENT']=''
time.sleep(1)
r=S.post(U,data=d);open('fbc_res.html','w').write(r.text)
print(r.status_code,len(r.text),r.url)
import json
t=r.text; links={}
def grab(t):
  for m in re.finditer(r"href='\.\./pr/pr_app_dtl\.aspx\?param=([^']*)'>(FL[^<]*)</a>",t): links[m.group(2)]=m.group(1)
grab(t)
print('rows page1',len(links))
for pg in [10,25,40,55,70,85,97]:
  d=fields(t); d.pop('__EVENTTARGET',None)
  d['pagTopPager:txtGoToPage']=str(pg); d['pagTopPager:btnPageJump.x']='5'; d['pagTopPager:btnPageJump.y']='5'
  time.sleep(1.1)
  r=S.post("https://www.floridabuilding.org/pr/pr_app_lst.aspx",data=d); t=r.text
  cp=re.search(r'lblCurrentPage">(\d+)',t); n0=len(links); grab(t); print(pg,cp and cp.group(1),len(links)-n0)
json.dump(links,open('fbc_links.json','w'),indent=0)
