import requests,time,json,random,io,pypdf,logging
logging.disable(logging.WARNING)
UA="DataFoundry/1.0 (data@mail.proviciency.com)"
S=requests.Session();S.headers['User-Agent']=UA
recs=json.load(open('md_roof.json'));random.seed(2709);samp=random.sample(recs,24);res={}
for r in samp:
  u="https://www.miamidade.gov/building/"+r['pdf']
  x=S.get(u,timeout=60);time.sleep(1.05)
  k=r['noa'];open('md_pdf/%s.pdf'%k,'wb').write(x.content)
  try:
    rd=pypdf.PdfReader(io.BytesIO(x.content));txt='\n'.join((p.extract_text() or '') for p in rd.pages);n=len(rd.pages)
  except Exception as e: txt='';n=-1
  open('md_pdf/%s.txt'%k,'w').write(txt)
  res[k]=dict(url=u,status=x.status_code,bytes=len(x.content),pages=n,chars=len(txt),sub=r['sub'],mdpn=r['mdpn'])
  print(k,res[k]['status'],n,len(txt),r['sub'],r['mdpn'])
json.dump(res,open('md_pdf.json','w'),indent=1)
