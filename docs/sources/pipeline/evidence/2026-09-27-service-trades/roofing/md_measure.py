import json,re
d=json.load(open('md_pdf.json'))
ws=lambda t: re.sub(r'\s+',' ',t)
pats={
 'noa_header_expiry':r'Expiration Date:\s*\d{1,2}/\d{1,2}/\d{2,4}',
 'deck_type_field':r'Deck Type:\s*[A-Za-z]',
 'deck_type_any':r'(?i)\b(plywood|OSB|steel deck|metal deck|structural concrete|wood plank|lightweight insulating concrete|gypsum|cementitious wood fiber|1x4|purlins?)\b',
 'max_design_pressure_value':r'(?i)(?:maximum design pressure|design pressure|MDP)[^0-9-–]{0,40}[-–]?\s?\d{2,3}(?:\.\d+)?\s?psf',
 'fastener_spacing_oc':r'(?i)\d+(?:\s?\d/\d)?\s?(?:"|”|in\.?|inch(?:es)?)\s?o\.\s?c\.?',
 'test_standard':r'\b(?:TAS\s?\d{3}|ASTM\s?[A-Z]\s?\d{3,5}|FM\s?44\d\d|UL\s?\d{3,4})\b',
 'trade_names_table':r'TRADE NAMES OF PRODUCTS',
 'fire_class':r'(?i)(ASTM E ?108|UL ?790|Class A)',
}
tot={k:0 for k in pats};per={}
for k,v in d.items():
  t=ws(open('md_pdf/%s.txt'%k).read());row={}
  for p,rx in pats.items():
    m=re.findall(rx,t);row[p]=len(m);tot[p]+=bool(m)
  # agreement: index MDP- vs text
  vals=[float(x) for x in re.findall(r'Maximum Design Pressures?:?\s*[-–]\s?(\d{2,3}(?:\.\d+)?)',t)]
  row['index_mdpn']=v['mdpn'];row['text_mdp']=vals[:3]
  per[k]=row
n=len(d)
for p in pats: print(p,tot[p],'/',n)
ag=[(k,r['index_mdpn'],r['text_mdp']) for k,r in per.items() if r['index_mdpn'] not in('0',)]
print('index MDP- nonzero',len(ag))
match=sum(1 for k,i,tv in ag if tv and abs(float(i)-tv[0])<0.01)
print('index MDP matches first text MDP',match,'/',len(ag))
for x in ag: print(x)
json.dump({'per_sample':per,'hits':tot,'n':n},open('md_measure.json','w'),indent=1)
