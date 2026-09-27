import json,random,re,io,time,pypdf,urllib.parse
from fbc_lib import S
d=json.load(open('fbc_detail_sample.json'))
cands=[k for k,v in sorted(d.items()) if any('_AE_' in p for p in v['pdfs'])]
random.seed(2027); samp=random.sample(cands,min(70,len(cands)))
out={}
for k in samp:
  ae=[p for p in d[k]['pdfs'] if '_AE_' in p][:2]
  txt=''
  for p in ae:
    u='https://www.floridabuilding.org/upload/'+urllib.parse.quote(p)
    try:
      r=S.get(u,timeout=120); time.sleep(1.1)
      if len(r.content)>25e6: continue
      txt+=' '.join((pg.extract_text() or '') for pg in pypdf.PdfReader(io.BytesIO(r.content)).pages)
    except Exception as e: print('err',k,e)
  txt=re.sub(r'\s+',' ',txt); open('fbc_pdf/%s.txt'%k,'w').write(txt)
  noas=sorted(set(re.findall(r'\b(\d{2}-\d{4}\.\d{2})\b',txt)))
  out[k]={'cat':d[k]['cat'],'hvhz':any(p['hvhz']=='Yes' for p in d[k]['products']),'n_ae':len(ae),'chars':len(txt),'noa_refs':noas,
          'mentions_noa':bool(re.search(r'(?i)\bNOA\b|notice of acceptance|miami[- ]dade',txt))}
  print(k,out[k]['cat'],out[k]['hvhz'],len(txt),noas[:4],flush=True)
json.dump(out,open('fbc_pdf_sample.json','w'),indent=1)
