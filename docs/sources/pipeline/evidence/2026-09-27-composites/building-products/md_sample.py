import json,random,requests,time,re,pypdf,io
import os; os.makedirs('md_pdf',exist_ok=True)  # per-document text is written here
S=requests.Session();S.headers['User-Agent']="DataFoundry/1.0 (data@mail.proviciency.com)"
d=json.load(open('md_index.json'))
keys=sorted(d); random.seed(2027); samp=random.sample(keys,80)
out={}
for k in samp:
  u="https://www.miamidade.gov/building/library/productcontrol/noa/%s.pdf"%d[k]['pdf']
  try:
    r=S.get(u,timeout=90); time.sleep(1.1); r.raise_for_status()
    t=' '.join((p.extract_text() or '') for p in pypdf.PdfReader(io.BytesIO(r.content)).pages)
  except Exception as e: out[k]={'err':str(e)}; continue  # excluded from every denominator below
  t=re.sub(r'\s+',' ',t); open('md_pdf/%s.txt'%k,'w').write(t)
  fl=sorted(set(re.findall(r'\bFL\s?#?\s?(\d{2,5})(?:[.\-]R?\d+)?\b',t)))
  # An image-only scan parses without error but yields no text: keep the row, exclude it from every denominator.
  out[k]={'testable':len(t)>=200,'bytes':len(r.content),'chars':len(t),'fl_numbers':fl,'noa_refs':sorted(set(re.findall(r'\b\d{2}-\d{4}\.\d{2}\b',t))-{k}),
          'category':d[k]['category']}
  print(k,d[k]['category'],len(t),fl[:5],flush=True)
json.dump(out,open('md_sample.json','w'),indent=1)
t=[v for v in out.values() if v.get('testable')]
print('raw FL-number hits (hand-check before reporting)',sum(1 for v in t if v['fl_numbers']),'/',len(t),'testable NOAs')
failed=[k for k,v in out.items() if 'err' in v]
if failed:
  # An unreadable NOA is not a tested non-match: report the reduced denominator and fail the run.
  raise SystemExit(f'{len(failed)} of {len(out)} NOAs unreadable; denominator is {len(out)-len(failed)}: {failed[:20]}')
