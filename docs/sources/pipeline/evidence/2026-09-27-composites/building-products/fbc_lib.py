import re,html,requests,time
UA="DataFoundry/1.0 (data@mail.proviciency.com)"
S=requests.Session();S.headers['User-Agent']=UA
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
def search(cat,code='2023',status='APPROVED'):
  U="https://www.floridabuilding.org/pr/pr_app_srch.aspx"
  x=S.get(U,timeout=60); x.raise_for_status(); t=x.text; d=fields(t)
  d['lstCategory:drpCustomDropdown']=cat; d['lstCodeVersion:drpCustomDropdown']=code
  d['lstAppStatus:drpCustomDropdown']=status; d['rbGenOutPut']='1'
  d['__EVENTTARGET']='lnkSearch';d['__EVENTARGUMENT']=''
  time.sleep(1.1); r=S.post(U,data=d,timeout=120); r.raise_for_status(); return r.text
def nextpage(t,pg):
  d=fields(t); d.pop('__EVENTTARGET',None)
  d['pagTopPager:txtGoToPage']=str(pg); d['pagTopPager:btnPageJump.x']='5'; d['pagTopPager:btnPageJump.y']='5'
  time.sleep(1.1)
  r=S.post("https://www.floridabuilding.org/pr/pr_app_lst.aspx",data=d,timeout=120); r.raise_for_status(); return r.text
