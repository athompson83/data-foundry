import json,time,urllib.request,urllib.parse,re
UA="DataFoundry/1.0 (data@mail.proviciency.com)"
brands=["Goodman Global","Amana","Janitrol","Bryant Heating and Cooling","Payne heating cooling","Heil heating cooling","Tempstar","Comfortmaker","KeepRite","Rheem","Ruud Manufacturing","American Standard heating air conditioning","Ameristar HVAC","Armstrong Air","AirEase","Ducane furnace","Luxaire","Coleman furnace air conditioner","York International","Nortek Global HVAC","Friedrich Air Conditioning","Mitsubishi Electric Trane HVAC","Fujitsu General","Bosch Thermotechnology","Daikin Comfort Technologies","Carrier Global","Lennox International","Trane Technologies","Weil-McLain","AAON","Heat Controller","Gree Electric","Midea Group"]
def get(u):
    for i in range(6):
        try:
            r=urllib.request.Request(u,headers={"User-Agent":UA});return json.load(urllib.request.urlopen(r,timeout=30))
        except urllib.error.HTTPError as e:
            if e.code==429: time.sleep(20*(i+1)); continue
            raise
    raise SystemExit("429 persistent")
pat=re.compile(r"(subsidiary of|brand (?:name )?(?:of|owned by)|owned by|division of|acquired by|acquired|part of|parent company|sold (?:to|its)|merged with|brands? (?:include|including|such as)|marketed under)",re.I)
out=[]
for b in brands:
    s=get("https://en.wikipedia.org/w/api.php?"+urllib.parse.urlencode({"action":"query","list":"search","srsearch":b,"srlimit":1,"format":"json"}))
    time.sleep(3)
    hits=s["query"]["search"]
    if not hits: out.append({"q":b,"title":None});continue
    t=hits[0]["title"]
    e=get("https://en.wikipedia.org/w/api.php?"+urllib.parse.urlencode({"action":"query","prop":"extracts|pageprops","explaintext":1,"titles":t,"format":"json","redirects":1}))
    time.sleep(3)
    p=list(e["query"]["pages"].values())[0]
    txt=p.get("extract","")
    m=[mm.group(0) for mm in pat.finditer(txt)]
    sents=[x for x in re.split(r'(?<=[.])\s+',txt) if pat.search(x)][:4]
    out.append({"q":b,"title":t,"pageid":p.get("pageid"),"qid":p.get("pageprops",{}).get("wikibase_item"),"len":len(txt),"n_ownership_markers":len(m),"sents":sents})
    print(b,"->",t,p.get("pageprops",{}).get("wikibase_item"),len(txt),len(m))
json.dump(out,open("wp_brands.json","w"),indent=1)
