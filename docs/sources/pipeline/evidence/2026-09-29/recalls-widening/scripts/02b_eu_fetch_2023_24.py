import sys,re,html,json;sys.path.insert(0,'scripts')
from common import *
s=open('raw/eu_report_list.xml').read()
reps=re.findall(r'<reference>(Report-[\d-]+)</reference><publicationDate>(\d\d)/(\d\d)/(\d{4})</publicationDate>.*?<URL>(.*?)</URL>',s)
todo=[(r[0],html.unescape(r[4])) for r in reps if r[3] in('2023','2024')]
fails=[]
for ref,u in todo:
    fn=f'raw/eu/{ref}.xml'
    if os.path.exists(fn): continue
    b,st=get(u,binary=True,timeout=120)
    if b: open(fn,'wb').write(b)
    else: fails.append((ref,st))
    time.sleep(0.5)
json.dump({'requested':len(todo),'fails':fails},open('results/02b_eu_fetch_2023_24.json','w'))
print('done',len(todo),fails)
