import requests,time,json,os,urllib.parse,pypdf,re,io
UA="DataFoundry/1.0 (data@mail.proviciency.com)"
S=requests.Session();S.headers['User-Agent']=UA
d=json.load(open('fbc_dtl.json'));res={}
for k,v in d.items():
  if not v['pdfs']: continue
  p=v['pdfs'][0]; u="https://www.floridabuilding.org/upload/"+urllib.parse.quote(p)
  r=S.get(u,timeout=60); time.sleep(1.05)
  fn='fbc_pdf/%s.pdf'%k; open(fn,'wb').write(r.content)
  try:
    rd=pypdf.PdfReader(io.BytesIO(r.content)); txt='\n'.join((pg.extract_text() or '') for pg in rd.pages); n=len(rd.pages)
  except Exception as e: txt='';n=-1
  open('fbc_pdf/%s.txt'%k,'w').write(txt)
  res[k]={'url':u,'status':r.status_code,'bytes':len(r.content),'pages':n,'chars':len(txt)}
  print(k,res[k])
json.dump(res,open('fbc_pdf.json','w'),indent=1)
