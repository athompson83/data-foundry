import re,html,requests,time,json,random,os,urllib.parse
UA="DataFoundry/1.0 (data@mail.proviciency.com)"
S=requests.Session();S.headers['User-Agent']=UA
links=json.load(open('fbc_links.json'))
keys=sorted(links); random.seed(27); samp=random.sample(keys,26)
out={}
for k in samp:
  r=S.get("https://www.floridabuilding.org/pr/pr_app_dtl.aspx?param="+links[k]); time.sleep(1.05)
  open('fbc_dtl/%s.html'%k,'w').write(r.text)
  t=re.sub(r'<script.*?</script>|<style.*?</style>','',r.text,flags=re.S)
  s=re.sub(r'\s+',' ',html.unescape(re.sub('<[^>]+>',' ',t)))
  sub=re.search(r'Subcategory (.*?) Compliance Method',s)
  pdfs=sorted(set(re.findall(r"href='\.\./upload/(PR_Tech_Docs/[^']*\.pdf)'",r.text,re.I)))
  prods=re.findall(r'Design Pressure: ([^ ]+(?: [^ ]+){0,3}?) Other: (.*?) (?:Installation Instructions|Evaluation Reports|Verified By)',s)
  out[k]={'sub':sub and sub.group(1),'pdfs':pdfs,'nprod':s.count('Limits of Use'),'dp':[p[0] for p in prods],'other':[p[1][:200] for p in prods]}
  print(k,out[k]['sub'],out[k]['nprod'],len(pdfs))
json.dump(out,open('fbc_dtl.json','w'),indent=1)
