import re,json,urllib.request,time,random,html
UA={"User-Agent":"data-foundry-scout/1.0 (data@mail.proviciency.com)"}
def get(u,t=60):
    return urllib.request.urlopen(urllib.request.Request(u,headers=UA),timeout=t)
feed=get("https://caselaw.nationalarchives.gov.uk/atom.xml?per_page=50").read().decode()
entries=re.findall(r"<entry>(.*?)</entry>",feed,flags=re.S)
def f(e,tag):
    m=re.search(rf"<{tag}[^>]*>([^<]*)</{tag}>",e);return html.unescape(m.group(1)) if m else None
print("feed entries",len(entries))
print("entry tags:",sorted(set(re.findall(r"<([a-z:]+)[ >/]",entries[0]))))
print(entries[0][:900])
# oldest page
last=get("https://caselaw.nationalarchives.gov.uk/atom.xml?per_page=50&page=8203").read().decode()
le=re.findall(r"<entry>(.*?)</entry>",last,flags=re.S)
print("last page entries",len(le),"oldest published",[f(e,'published') for e in le][-3:])
random.seed(3)
sample=random.sample(entries,20)
NC=re.compile(r"\[(\d{4})\]\s+(UKSC|UKPC|UKHL|EWCA\s+(?:Civ|Crim)|EWHC|UKUT|UKFTT|EAT|CSIH|CSOH|NICA|NIQB|UKSC)\s*(?:\(([A-Za-z]+)\)\s*)?(\d+)")
REP=re.compile(r"\[(\d{4})\]\s+(\d+\s+)?(?:AC|WLR|All ER|QB|Ch|KB|Cr App R|BCLC|Lloyd's Rep|ICR|IRLR|FLR|EWLandRA)\s+\d+")
STAT=re.compile(r"\b(?:[A-Z][A-Za-z()' ,&-]{3,60}?\s(?:Act|Regulations|Order|Rules)\s+(?:19|20)\d{2})\b")
SEC=re.compile(r"\b(?:section|s\.|sections|regulation|Article|article|rule|paragraph)\s+\d+[A-Z]?(?:\(\d+\))?")
rows=[];allnc=set()
for e in sample:
    link=re.search(r'<link href="([^"]+)" rel="alternate"',e).group(1)
    title=f(e,'title')
    tnc=None
    m=re.search(r'<tna:identifier[^>]*type="ukncn"[^>]*>([^<]*)<',e) or re.search(r'ukncn[^>]*>([^<]*)<',e)
    tnc=m.group(1) if m else None
    try:
        x=get(link+"/data.xml").read().decode("utf-8","replace")
    except Exception as ex:
        rows.append({"link":link,"err":str(ex)});continue
    body=re.sub(r"<[^>]+>"," ",x);body=re.sub(r"\s+"," ",html.unescape(body))
    ncs=["[%s] %s %s"%(a,re.sub(r"\s+"," ",b),d) for a,b,c,d in NC.findall(body)]
    reps=[m.group(0) for m in REP.finditer(body)]
    stats=STAT.findall(body)
    secs=SEC.findall(body)
    rows.append({"link":link,"title":title,"tna_ncn_in_feed":tnc,"chars":len(body),"own_nc_in_text":bool(tnc and tnc in body) if tnc else None,"neutral_cites":sorted(set(ncs)),"reporter_cites":sorted(set(reps))[:10],"n_statute":len(set(stats)),"n_section":len(secs),"docket_like":re.findall(r"(?:Case No\.?|Claim No\.?|Appeal No\.?|Reference)[:\s]+([A-Z0-9/\-\.]+)",body)[:2]})
    allnc|=set(ncs); time.sleep(0.7)
json.dump(rows,open("uk_sample20.json","w"),indent=1)
n=len([r for r in rows if 'err' not in r])
print("docs fetched",n)
print("feed ncn present",sum(1 for r in rows if r.get('tna_ncn_in_feed')),"/",n)
print("own NC appears in text",sum(1 for r in rows if r.get('own_nc_in_text')),"/",n)
print("docs with >=1 neutral cite",sum(1 for r in rows if r.get('neutral_cites')),"/",n)
print("docs with >=1 reporter cite",sum(1 for r in rows if r.get('reporter_cites')),"/",n)
print("docs with >=1 statute name",sum(1 for r in rows if r.get('n_statute')),"/",n)
print("docs with >=1 section ref",sum(1 for r in rows if r.get('n_section')),"/",n)
print("docs with docket-like",sum(1 for r in rows if r.get('docket_like')),"/",n)
# cross-citation resolve
court={"UKSC":"uksc","UKPC":"ukpc","UKHL":"ukhl","EWCA Civ":"ewca/civ","EWCA Crim":"ewca/crim","EWHC":"ewhc","UKUT":"ukut","UKFTT":"ukftt","EAT":"eat"}
res=[]
for c in sorted(allnc)[:60]:
    m=re.match(r"\[(\d{4})\] (.+?) (?:\(([A-Za-z]+)\) )?(\d+)$",c)
    yr,ct,_,num=m.groups() if m else (None,)*4
    ct=re.sub(r"\s+"," ",ct)
    if ct not in court: res.append((c,"unmapped"));continue
    u=f"https://caselaw.nationalarchives.gov.uk/{court[ct]}/{yr}/{num}"
    try:
        r=get(u);res.append((c,r.status))
    except urllib.error.HTTPError as ex: res.append((c,ex.code))
    except Exception as ex: res.append((c,str(ex)[:30]))
    time.sleep(0.7)
json.dump(res,open("uk_crosscite.json","w"),indent=1)
ok=sum(1 for c,s in res if s==200);un=sum(1 for c,s in res if s=="unmapped")
print("unique neutral cites",len(allnc),"tested",len(res),"resolved 200:",ok,"unmapped court",un,"non-200",len(res)-ok-un)
print(res[:12])
