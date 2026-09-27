import requests,time,json,random,io,pypdf,logging,re
logging.disable(logging.WARNING)
S=requests.Session();S.headers['User-Agent']="DataFoundry/1.0 (data@mail.proviciency.com)"
d=[x for x in json.load(open('tdi_int.json')) if x['productTypeDesc']=='Roof Coverings']
random.seed(27);samp=random.sample(d,22);res={}
for x in samp:
  k=x['reportNumber'];u="https://appscenter.tdi.texas.gov/windstorm/p/productReport/%s/"%k
  r=S.get(u,timeout=60);time.sleep(1.05)
  ok=r.content[:4]==b'%PDF'
  txt=''
  if ok:
    open('tdi_pdf/%s.pdf'%k,'wb').write(r.content)
    rd=pypdf.PdfReader(io.BytesIO(r.content));txt='\n'.join((p.extract_text() or '') for p in rd.pages)
  open('tdi_pdf/%s.txt'%k,'w').write(txt)
  res[k]=dict(url=u,status=r.status_code,pdf=ok,bytes=len(r.content),chars=len(txt),name=x['productName'],cat=x['productCategoryDesc'])
  print(k,r.status_code,ok,len(txt),x['productName'][:60])
json.dump(res,open('tdi_pdf.json','w'),indent=1)
