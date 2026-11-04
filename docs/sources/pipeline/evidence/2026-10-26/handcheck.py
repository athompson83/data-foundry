#!/usr/bin/env python3
"""Pulls 12 seeded USGS/EMSC matched pairs (M>=5, 2026-09-26..2026-10-26) for a hand check; writes handcheck.json."""
import json, random, math, urllib.request, datetime as dt
UA = "data-foundry-scout/1.0 (data@mail.proviciency.com)"
g = lambda u: json.loads(urllib.request.urlopen(urllib.request.Request(u, headers={"User-Agent": UA}), timeout=60).read())
u = g("https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&minmagnitude=5&starttime=2026-09-26&endtime=2026-10-26")
e = g("https://www.seismicportal.eu/fdsnws/event/1/query?format=json&minmag=5&start=2026-09-26&end=2026-10-26")
def hav(a,b,c,d):
    p=math.pi/180; x=math.sin((c-a)*p/2)**2+math.cos(a*p)*math.cos(c*p)*math.sin((d-b)*p/2)**2; return 12742*math.asin(math.sqrt(x))
ef=[f["properties"] for f in e["features"]]
random.seed(20261026); rows=[]
for f in random.sample(u["features"], 12):
    p=f["properties"]; lon,lat=f["geometry"]["coordinates"][:2]; t=p["time"]/1000
    c=[x for x in ef if abs(dt.datetime.fromisoformat(x["time"].replace("Z","+00:00")).timestamp()-t)<60 and hav(lat,lon,x["lat"],x["lon"])<100]
    rows.append({"usgs_id":f["id"],"usgs_place":p["place"],"usgs_mag":p["mag"],"emsc_id":[x["unid"] for x in c],"emsc_region":[x["flynn_region"] for x in c],"emsc_mag":[x["mag"] for x in c]})
json.dump(rows,open("handcheck.json","w"),indent=1)
for r in rows: print(r["usgs_place"],"|",r["usgs_mag"],"|",r["emsc_region"],r["emsc_mag"])
