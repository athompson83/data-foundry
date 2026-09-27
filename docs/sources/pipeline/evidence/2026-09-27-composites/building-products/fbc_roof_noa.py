import json,random,re,io,time,pypdf,urllib.parse,html,logging
logging.disable(logging.WARNING)
from fbc_lib import S
L=json.load(open('fbc_list.json')); done=set(json.load(open('fbc_detail_sample.json')))
roof=sorted(k for k,v in L.items() if v['cat']=='ROOFING' and k not in done)
random.seed(2028); samp=random.sample(roof,40); out={}
for k in samp:
  r=None  # reset per key so a failed fetch can never reuse another approval's page
  for attempt in range(3):
    try:
      r=S.get("https://www.floridabuilding.org/pr/pr_app_dtl.aspx?param="+L[k]['param'],timeout=60); time.sleep(1.1)
      r.raise_for_status()
      # Same detail-only markers as fbc_detail.py: an interstitial can keep the generic heading.
      if 'Product Approval' not in r.text or 'Code Version' not in r.text: raise ValueError('not a product approval detail page')
      break
    except Exception as e: print('retry',k,attempt,e,flush=True); r=None; time.sleep(5)
  if r is None: out[k]={'fetch_failed':True}; continue  # excluded from every denominator
  pdfs=sorted(set(re.findall(r"href='\.\./upload/([^']*\.pdf)'",r.text,re.I)))
  hv='Approved for use in HVHZ: Yes' in re.sub(r'\s+',' ',html.unescape(re.sub('<[^>]+>',' ',r.text)))
  ae=[p for p in pdfs if '_AE_' in p]; txt='';failed=0;per_pdf=[]  # every evaluation report
  for p in ae:
    try:
      x=S.get('https://www.floridabuilding.org/upload/'+urllib.parse.quote(p),timeout=180); time.sleep(1.1)
      x.raise_for_status()
      if len(x.content)>=30e6: raise ValueError(f'{len(x.content)} bytes; too large to parse')
      one=re.sub(r'\s+',' ',' '.join((pg.extract_text() or '') for pg in pypdf.PdfReader(io.BytesIO(x.content)).pages))
      per_pdf.append(len(one)); txt+=' '+one
    except Exception as e: print('err',k,e,flush=True); failed+=1
  txt=re.sub(r'\s+',' ',txt); open('fbc_pdf/%s.txt'%k,'w').write(txt)
  ctx=[txt[max(0,m.start()-60):m.end()+10] for m in re.finditer(r'\b\d{2}-\d{4}\.\d{2}\b',txt)]
  # Testable only if there is an evaluation report and every one was fetched and yields text; untestable rows
  # (no report, or any image-only report) are kept but excluded from every denominator.
  out[k]={'hvhz':hv,'n_ae':len(ae),'pdf_failed':failed,'per_pdf_chars':per_pdf,'testable':bool(ae) and not failed and all(n>=200 for n in per_pdf),'chars':len(txt),'noa_refs':sorted(set(re.findall(r'\b(\d{2}-\d{4}\.\d{2})\b',txt))),'ctx':ctx[:3],
          'mentions_noa':bool(re.search(r'(?i)\bNOA\b|notice of acceptance|miami[- ]dade',txt))}
  print('ROW',k,hv,len(ae),len(txt),out[k]['noa_refs'][:4],flush=True)
json.dump(out,open('fbc_roof_noa.json','w'),indent=1)
bad=[k for k,v in out.items() if v.get('pdf_failed') or v.get('fetch_failed')]
if bad: raise SystemExit(f'{len(bad)} approvals failed (marked fetch_failed or pdf_failed; exclude them from denominators): {bad[:20]}')
for hz in (True,False):
  t=[v for v in out.values() if v.get('testable') and v['hvhz']==hz]
  print('HVHZ' if hz else 'non-HVHZ','cites an NOA',sum(1 for v in t if v['noa_refs']),'/',len(t),'testable')
