import json,random,re,html,time,sys
from fbc_lib import S
d=json.load(open('fbc_list.json'))
keys=sorted(d); random.seed(2027); samp=random.sample(keys,int(sys.argv[1]))
out={}
def between(s,a,b):
  m=re.search(re.escape(a)+r'\s*(.*?)\s*'+re.escape(b),s); return m.group(1) if m else None
for k in samp:
  r=None  # reset per key, so a failed fetch can never reuse the previous approval's page
  for att in range(3):
    try: r=S.get("https://www.floridabuilding.org/pr/pr_app_dtl.aspx?param="+d[k]['param'],timeout=60); r.raise_for_status(); break
    except Exception as e: r=None; time.sleep(5)
  time.sleep(1.1)
  if r is None:
    print(k,'FETCH_FAILED',flush=True); out[k]={'cat':d[k]['cat'],'fetch_failed':True}; continue
  raw=r.text
  t=re.sub(r'<script.*?</script>|<style.*?</style>','',raw,flags=re.S)
  s=re.sub(r'\s+',' ',html.unescape(re.sub('<[^>]+>',' ',t)))
  s=s[s.find('Code Version'):s.find('Back Next Contact Us')]
  prods=[]
  for m in re.finditer(r'(\d+\.\d+) (.*?) Limits of Use Approved for use in HVHZ: (\w+) Approved for use outside HVHZ: (\w+) Impact Resistant: (\S+) Design Pressure: (\S+) Other: (.*?)(?= Installation Instructions| Evaluation Reports| Verified By| \d+\.\d+ |$)',s):
    prods.append({'fl_sub':m.group(1),'name_desc':m.group(2)[:300],'hvhz':m.group(3),'non_hvhz':m.group(4),'impact':m.group(5),'dp':m.group(6),'other':m.group(7)[:400]})
  pdfs=sorted(set(re.findall(r"href='\.\./upload/([^']*\.pdf)'",raw,re.I)))
  out[k]={'cat':d[k]['cat'],'manufacturer':between(s,'Product Manufacturer','Address/Phone/Email'),
    'subcategory':between(s,'Subcategory','Compliance Method'),'compliance':between(s,'Compliance Method','Evaluation Report') or between(s,'Compliance Method','Quality Assurance'),
    'qa_entity':between(s,'Quality Assurance Entity','Quality Assurance Contract'),'qa_exp':between(s,'Contract Expiration Date','Validated By'),
    'standards':re.findall(r'\b((?:ASTM|TAS|FM|UL|AAMA|ANSI|ASCE|FBC|AC|DASMA|SPRI|CSA|ICC|NFPA)[ /]?[A-Z]?\s?\d{2,5}(?:\.\d)?)\s+(\d{4})\b',between(s,'Referenced Standard and Year','Equivalence') or ''),
    'date_approved':between(s,'Date Approved','Date Revised') or between(s,'Date Approved','Summary'),'products':prods,'pdfs':pdfs,
    'noa_refs':sorted(set(re.findall(r'\b\d{2}-\d{4}\.\d{2}\b',s))),'mentions_miami_dade':bool(re.search(r'(?i)miami[- ]dade|\bNOA\b',s))}
  print(k,out[k]['cat'],len(prods),out[k]['noa_refs'],flush=True)
json.dump(out,open('fbc_detail_sample.json','w'),indent=1)
