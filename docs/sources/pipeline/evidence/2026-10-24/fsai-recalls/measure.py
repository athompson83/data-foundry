"""Ireland FSAI food alerts (HTML list + detail pages) vs UK FSA food alerts (JSON): size, history, per-alert fields and candidate cross-links.
Usage: python3 -I measure.py <out.json> <candidates.json>"""
import sys,re,json,html,subprocess,datetime as dt
UA='data-foundry-scout/1.0 (data@mail.proviciency.com)'
def get(u): return subprocess.run(['curl','-sSL','-m','60','-A',UA,u],capture_output=True,text=True).stdout
base='https://www.fsai.ie'
alerts=[];page=1
while True:
    h=get(f'{base}/news-and-alerts/food-alerts?page={page}')
    links=re.findall(r'href="(/news-and-alerts/food-alerts/[^"?#]+)"',h)
    new=[l for l in dict.fromkeys(links) if l not in [a['path'] for a in alerts]]
    if not new or page>60: break
    alerts+=[{'path':l} for l in new]; page+=1
pages=page-1
for a in alerts[:40]:
    h=get(base+a['path']); t=re.sub(r'\s+',' ',html.unescape(re.sub(r'<[^>]+>',' ',h)))
    a['title']=re.sub(r'\s*\|.*','',re.search(r'<title>(.*?)</title>',h,re.S).group(1)).strip()
    d=re.search(r'(\d{1,2} \w+ 20\d\d)',t); a['date']=dt.datetime.strptime(d.group(1),'%d %B %Y').date().isoformat() if d else None
    a['has_batch_or_best_before']=bool(re.search(r'best before|batch code|use by|lot',t,re.I)); a['text_chars']=len(t)
fsa=json.loads(get('https://data.food.gov.uk/food-alerts/id?_limit=5000'))['items']
def toks(s): return {w for w in re.findall(r'[a-z]{6,}',s.lower()) if w not in {'recall','batches','batch','specific','products','product','various','several','smoked','salmon'}}
cands=[]
for a in alerts[:40]:
    if not a['date']: continue
    for f in fsa:
        fd=f.get('created','')[:10]
        if fd and abs((dt.date.fromisoformat(fd)-dt.date.fromisoformat(a['date'])).days)<=30 and toks(a['title'])&toks(f.get('title','')):
            cands.append({'fsai':a['title'],'fsai_date':a['date'],'fsa':f['title'],'fsa_date':fd,'shared':sorted(toks(a['title'])&toks(f['title']))})
out={'fsai_list_pages_scanned':pages,'fsai_alert_links_found':len(alerts),'detail_pages_fetched':min(40,len(alerts)),'detail_with_date':sum(1 for a in alerts[:40] if a.get('date')),'detail_with_batch_or_dates_text':sum(1 for a in alerts[:40] if a.get('has_batch_or_best_before')),
 'fsai_detail_dates':[min(a['date'] for a in alerts[:40] if a.get('date')),max(a['date'] for a in alerts[:40] if a.get('date'))],'fsa_alerts':len(fsa),'candidate_cross_links_fsai_fsa':len(cands)}
json.dump(out,open(sys.argv[1],'w'),indent=1); json.dump(cands,open(sys.argv[2],'w'),indent=1); print(json.dumps(out)); [print(c) for c in cands[:15]]
