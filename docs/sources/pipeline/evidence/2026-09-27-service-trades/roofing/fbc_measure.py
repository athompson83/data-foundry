import json,re
d=json.load(open('fbc_pdf.json'))
pats={
 'text_extractable':r'\w{20}|\w+\s+\w+\s+\w+',
 'design_pressure_psf':r'-\s?\d{2,3}(?:\.\d+)?\s?(?:psf|PSF)|(?:MDP|Design Pressure|design pressure)[^\n]{0,60}?-?\d{2,3}(?:\.\d+)?',
 'deck_type':r'(?i)\b(plywood|OSB|steel deck|metal deck|concrete deck|structural concrete|wood plank|lightweight insulating concrete|gypsum deck|cementitious wood fiber)\b',
 'fastener_spacing_oc':r'(?i)\d+(?:\s\d/\d)?\s?(?:"|in\.?|inch(?:es)?)\s?o\.?\s?c\.?',
 'test_standard':r'\b(?:ASTM\s?[A-Z]\s?\d{2,5}|TAS\s?\d{3}|FM\s?4470|FM\s?4474|UL\s?580|UL\s?1897|UL\s?2218|ANSI/FM\s?4474)\b',
 'hvhz':r'\bHVHZ\b',
 'expiry_or_valid':r'(?i)(expir\w+|valid until|re-?evaluat\w+)',
 'copyright_notice':r'(?i)(©|copyright)',
}
out={};tot={k:0 for k in pats}
for k in d:
  t=open('fbc_pdf/%s.txt'%k).read(); row={}
  for p,rx in pats.items():
    m=re.findall(rx,t); row[p]=len(m)
    if m: tot[p]+=1
  out[k]=row
n=len(d)
for p in pats: print(p,tot[p],'/',n)
json.dump({'per_sample':out,'hits':tot,'n':n},open('fbc_measure.json','w'),indent=1)
# example values
import itertools
for k in ['FL5293-R73','FL42103-R1','FL18386-R4']:
  t=open('fbc_pdf/%s.txt'%k).read(); print(k, re.findall(pats['design_pressure_psf'],t)[:6], re.findall(pats['deck_type'],t)[:4])
