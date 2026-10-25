"""Link FDA company recall announcements (datatables XLSX) to openFDA enforcement reports.
Usage: python3 -I link.py <announcements.xlsx> <out.json>. Candidate rule: same normalised firm name, enforcement
recall_initiation_date or report_date (either one) within -30..+150 days of the announcement date, and a shared 5+ letter product token."""
import sys,zipfile,re,json,time,urllib.request,urllib.parse,datetime as dt,xml.etree.ElementTree as ET
UA='data-foundry-scout/1.0 (data@mail.proviciency.com)'
ns={'m':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
def rows(path):
    z=zipfile.ZipFile(path); ss=[]
    for si in ET.fromstring(z.read('xl/sharedStrings.xml')).findall('m:si',ns): ss.append(''.join(t.text or '' for t in si.iter('{%s}t'%ns['m'])))
    out=[]
    for r in ET.fromstring(z.read('xl/worksheets/sheet1.xml')).iter('{%s}row'%ns['m']):
        row=[]
        for c in r.findall('m:c',ns):
            v=c.find('m:v',ns); row.append(ss[int(v.text)] if c.get('t')=='s' and v is not None else (v.text if v is not None else ''))
        out.append(row)
    return out
def norm(s): return re.sub(r'\b(inc|llc|ltd|co|corp|corporation|company|the|dba|lp|usa|us)\b','',re.sub(r'[^a-z0-9 ]',' ',s.lower())).split()
def toks(s): return {t for t in re.findall(r'[a-z]{5,}',s.lower())} - {'product','products','brand','foods','organic','natural'}
def get(url):
    import subprocess
    for i in range(4):
        p=subprocess.run(['curl','-sS','-m','40','-A',UA,url],capture_output=True,text=True)
        try: return json.loads(p.stdout)
        except Exception:
            if '"NOT_FOUND"' in p.stdout: return {'results':[]}
            time.sleep(2+i*2)
    return {'results':[]}
R=rows(sys.argv[1]); hdr=R[0]; data=[dict(zip(hdr,r)) for r in R[1:]]
def d(s): return dt.datetime.strptime(s,'%m/%d/%Y').date()
since=dt.date(2026,1,1)
recent=[x for x in data if x['Date'] and d(x['Date'])>=since]
res=[]; firms={}
for x in recent:
    key=' '.join(norm(x['Company-Name']))
    if not key: continue
    if key not in firms:
        q='recalling_firm:"%s"'%' '.join(norm(x['Company-Name'])[:3])
        firms[key]=[]
        for ep in ('food','drug','device'):
            j=get('https://api.fda.gov/%s/enforcement.json?search=%s&limit=100'%(ep,urllib.parse.quote(q)))
            firms[key]+=j.get('results',[])
        time.sleep(0.3)
    a=d(x['Date']); ev={}; pt=toks(x['Brand-Names']+' '+x['Product-Description']); hits=[]
    for e in firms[key]:
        if norm(e.get('recalling_firm',''))[:3]!=norm(x['Company-Name'])[:3]: continue
        eds=[]
        for k in ('recall_initiation_date','report_date'):
            try: eds.append(dt.datetime.strptime(e.get(k) or '','%Y%m%d').date())
            except Exception: pass
        if any(-30<=(ed-a).days<=150 for ed in eds) and pt & toks(e.get('product_description','')):
            hits.append(e['recall_number']); ev[e['recall_number']]={k:e.get(k) for k in ('recalling_firm','product_description','recall_initiation_date','report_date')}
    res.append({'date':x['Date'],'firm':x['Company-Name'],'brand':x['Brand-Names'],'matches':sorted(set(hits)),'enforcement':{h:ev[h] for h in sorted(set(hits))}})
n=len(res); m=sum(1 for r in res if r['matches'])
json.dump({'announcements_total':len(data),'since':str(since),'announcements_since':n,'with_candidate_enforcement_match':m,'rows':res},open(sys.argv[2],'w'),indent=1)
print(len(data),n,m)
