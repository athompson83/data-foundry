import json,random,requests,time,re,pypdf,io
S=requests.Session();S.headers['User-Agent']="DataFoundry/1.0 (data@mail.proviciency.com)"
d=json.load(open('md_index.json'))
keys=sorted(d); random.seed(2027); samp=random.sample(keys,80)
out={}
for k in samp:
  u="https://www.miamidade.gov/building/library/productcontrol/noa/%s.pdf"%d[k]['pdf']
  try:
    r=S.get(u,timeout=90); time.sleep(1.1)
    t=' '.join((p.extract_text() or '') for p in pypdf.PdfReader(io.BytesIO(r.content)).pages)
  except Exception as e: out[k]={'err':str(e)}; continue
  t=re.sub(r'\s+',' ',t); open('md_pdf/%s.txt'%k,'w').write(t)
  fl=sorted(set(re.findall(r'\bFL\s?#?\s?(\d{2,5})(?:[.\-]R?\d+)?\b',t)))
  out[k]={'bytes':len(r.content),'chars':len(t),'fl_numbers':fl,'noa_refs':sorted(set(re.findall(r'\b\d{2}-\d{4}\.\d{2}\b',t))-{k}),
          'category':d[k]['category']}
  print(k,d[k]['category'],len(t),fl[:5],flush=True)
json.dump(out,open('md_sample.json','w'),indent=1)
