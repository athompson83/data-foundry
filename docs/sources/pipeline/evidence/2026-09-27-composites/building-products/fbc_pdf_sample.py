import json,random,re,io,time,pypdf,urllib.parse
from fbc_lib import S
d=json.load(open('fbc_detail_sample.json'))
cands=[k for k,v in sorted(d.items()) if any('_AE_' in p for p in v['pdfs'])]
random.seed(2027); samp=random.sample(cands,min(70,len(cands)))
out={}
for k in samp:
  ae=[p for p in d[k]['pdfs'] if '_AE_' in p]  # every evaluation report: a citation can be in any of them
  txt='';failed=0;per_pdf=[]
  for p in ae:
    u='https://www.floridabuilding.org/upload/'+urllib.parse.quote(p)
    try:
      r=S.get(u,timeout=120); time.sleep(1.1); r.raise_for_status()
      if len(r.content)>25e6: raise ValueError(f'{len(r.content)} bytes; too large to parse')
      one=re.sub(r'\s+',' ',' '.join((pg.extract_text() or '') for pg in pypdf.PdfReader(io.BytesIO(r.content)).pages))
      per_pdf.append(len(one)); txt+=' '+one
    except Exception as e: print('err',k,e); failed+=1
  txt=re.sub(r'\s+',' ',txt); open('fbc_pdf/%s.txt'%k,'w').write(txt)
  noas=sorted(set(re.findall(r'\b(\d{2}-\d{4}\.\d{2})\b',txt)))
  ctx=[txt[max(0,m.start()-60):m.end()+10] for m in re.finditer(r'\b\d{2}-\d{4}\.\d{2}\b',txt)]
  # An approval is testable only if every evaluation report was fetched and each one yields text: one image-only
  # report could hold the citation, so a partly inspected approval is excluded from every denominator.
  out[k]={'testable':bool(ae) and not failed and all(n>=200 for n in per_pdf),'per_pdf_chars':per_pdf,'ctx':ctx[:5],'cat':d[k]['cat'],'hvhz':any(p['hvhz']=='Yes' for p in d[k]['products']),'n_ae':len(ae),'pdf_failed':failed,'chars':len(txt),'noa_refs':noas,
          'mentions_noa':bool(re.search(r'(?i)\bNOA\b|notice of acceptance|miami[- ]dade',txt))}
  print(k,out[k]['cat'],out[k]['hvhz'],len(txt),noas[:4],flush=True)
json.dump(out,open('fbc_pdf_sample.json','w'),indent=1)
bad=[k for k,v in out.items() if v.get('pdf_failed')]
if bad: raise SystemExit(f'{len(bad)} approvals had unreadable PDFs (marked pdf_failed; exclude them from denominators): {bad[:20]}')
t=[v for v in out.values() if v['testable']]
print('cites an NOA (raw regex; hand-check before reporting)',sum(1 for v in t if v['noa_refs']),'/',len(t),'testable')
