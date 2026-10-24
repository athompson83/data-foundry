"""Foodborne outbreaks: FDA CORE investigations table vs CDC newsroom outbreak items.
A CDC item is a candidate for an FDA row when its title names the pathogen genus and an identified product token, dated -10 to +60 days from the FDA posted date.
Usage: python3 -I measure.py <out.json> <handcheck.json>"""
import sys,re,json,html,subprocess,datetime as dt
UA='data-foundry-scout/1.0 (data@mail.proviciency.com)'
def get(u): return subprocess.run(['curl','-sSL','-m','90','-A',UA,u],capture_output=True,text=True).stdout
h=get('https://www.fda.gov/food/outbreaks-foodborne-illness/investigations-foodborne-illness-outbreaks')
rows=[]
for t in re.findall(r'<table.*?</table>',h,re.S):
    for r in re.findall(r'<tr.*?</tr>',t,re.S)[1:]:
        c=[re.sub(r'\s+',' ',html.unescape(re.sub(r'<[^>]+>',' ',x)).replace('\xa0',' ')).strip() for x in re.findall(r'<t[dh].*?</t[dh]>',r,re.S)]
        if c and re.match(r'\d+/\d+/\d{4}',c[0]): rows.append({'posted':dt.datetime.strptime(c[0],'%m/%d/%Y'),'ref':c[1],'pathogen':c[2],'product':c[3],'cases':c[4],'status':c[5]})
x=get('https://tools.cdc.gov/api/v2/resources/media/132608.rss')
items=[]
for i in re.findall(r'<item>(.*?)</item>',x,re.S):
    t=re.sub(r'<[^>]+>','',html.unescape(re.search(r'<title>(.*?)</title>',i,re.S).group(1))); d=re.search(r'<pubDate>(.*?)</pubDate>',i)
    if d: items.append((dt.datetime.strptime(d.group(1)[5:16],'%d %b %Y'),t))
outb=[(d,t) for d,t in items if re.search(r'outbreak|salmonella|listeria|coli|cyclospora|botulism',t,re.I)]
GENUS={'salmonella':'salmonella','listeria':'listeria','e. coli':'coli','cyclospora':'cyclospora','botulism':'botulism|botulinum'}
def genus(p):
    for k,v in GENUS.items():
        if k in p.lower(): return v
STOP={'not yet identified','see advisory',''}
recent=[r for r in rows if r['posted']>=dt.datetime(2026,1,1)]
named=[r for r in recent if r['product'].lower() not in STOP]
out_rows=[]
for r in named:
    g=genus(r['pathogen']); toks=[w for w in re.findall(r'[a-zñ]{5,}',r['product'].lower().replace('peppers','pepper'))]
    hit=[(d,t) for d,t in outb if g and re.search(g,t,re.I) and any(w.rstrip('s') in t.lower() for w in toks) and -10<=(d-r['posted']).days<=60]
    out_rows.append({'ref':r['ref'],'posted':r['posted'].date().isoformat(),'pathogen':r['pathogen'],'product':r['product'],'cdc':[(d.date().isoformat(),t[:90]) for d,t in hit]})
out={'fda_core_rows':len(rows),'fda_core_years':sorted({r['posted'].year for r in rows}),'fda_rows_citing_usda_reference':sum(1 for r in rows if 'USDA' in r['ref']),'fda_rows_since_2026':len(recent),
 'fda_rows_since_2026_with_named_product':len(named),'cdc_feed_items':len(items),'cdc_feed_oldest':min(d for d,_ in items).date().isoformat(),'cdc_feed_newest':max(d for d,_ in items).date().isoformat(),'cdc_outbreak_titled_items':len(outb),
 'named_product_rows_with_cdc_candidate':sum(1 for r in out_rows if r['cdc'])}
json.dump(out,open(sys.argv[1],'w'),indent=1); json.dump(out_rows,open(sys.argv[2],'w'),indent=1); print(json.dumps(out,indent=1)); [print(r) for r in out_rows]
