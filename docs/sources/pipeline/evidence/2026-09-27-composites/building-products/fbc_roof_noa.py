import json,random,re,io,time,pypdf,urllib.parse,html,logging
logging.disable(logging.WARNING)
from fbc_lib import S
L=json.load(open('fbc_list.json')); done=set(json.load(open('fbc_detail_sample.json')))
roof=sorted(k for k,v in L.items() if v['cat']=='ROOFING' and k not in done)
random.seed(2028); samp=random.sample(roof,40); out={}
for k in samp:
  r=S.get("https://www.floridabuilding.org/pr/pr_app_dtl.aspx?param="+L[k]['param'],timeout=60); time.sleep(1.1)
  pdfs=sorted(set(re.findall(r"href='\.\./upload/([^']*\.pdf)'",r.text,re.I)))
  hv='Approved for use in HVHZ: Yes' in re.sub(r'\s+',' ',html.unescape(re.sub('<[^>]+>',' ',r.text)))
  ae=[p for p in pdfs if '_AE_' in p][:2]; txt='';failed=0
  for p in ae:
    try:
      x=S.get('https://www.floridabuilding.org/upload/'+urllib.parse.quote(p),timeout=180); time.sleep(1.1)
      if len(x.content)<30e6: txt+=' '.join((pg.extract_text() or '') for pg in pypdf.PdfReader(io.BytesIO(x.content)).pages)
    except Exception as e: print('err',k,e,flush=True); failed+=1
  txt=re.sub(r'\s+',' ',txt); open('fbc_pdf/%s.txt'%k,'w').write(txt)
  ctx=[txt[max(0,m.start()-60):m.end()+10] for m in re.finditer(r'\b\d{2}-\d{4}\.\d{2}\b',txt)]
  out[k]={'hvhz':hv,'n_ae':len(ae),'pdf_failed':failed,'chars':len(txt),'noa_refs':sorted(set(re.findall(r'\b(\d{2}-\d{4}\.\d{2})\b',txt))),'ctx':ctx[:3],
          'mentions_noa':bool(re.search(r'(?i)\bNOA\b|notice of acceptance|miami[- ]dade',txt))}
  print('ROW',k,hv,len(ae),len(txt),out[k]['noa_refs'][:4],flush=True)
json.dump(out,open('fbc_roof_noa.json','w'),indent=1)
bad=[k for k,v in out.items() if v.get('pdf_failed')]
if bad: raise SystemExit(f'{len(bad)} approvals had unreadable PDFs (marked pdf_failed; exclude them from denominators): {bad[:20]}')
