#!/usr/bin/env python3
"""Round 22 measurements. Re-fetches live; prints JSON. Declared UA."""
import json, urllib.request, urllib.parse, csv, io, time, random, ssl
UA={"User-Agent":"data-foundry-scout/1.0 (data@mail.proviciency.com)"}
def get(u,t=90):
    return urllib.request.urlopen(urllib.request.Request(u,headers=UA),timeout=t).read()
out={}
# A. RIR delegated ASNs vs PeeringDB nets (declared ASN)
rirs={"ripencc":"https://ftp.ripe.net/pub/stats/ripencc/delegated-ripencc-extended-latest",
"arin":"https://ftp.arin.net/pub/stats/arin/delegated-arin-extended-latest",
"apnic":"https://ftp.apnic.net/stats/apnic/delegated-apnic-extended-latest",
"lacnic":"https://ftp.lacnic.net/pub/stats/lacnic/delegated-lacnic-extended-latest",
"afrinic":"https://ftp.afrinic.net/pub/stats/afrinic/delegated-afrinic-extended-latest"}
asn={}; rc={}
for k,u in rirs.items():
    try:
        rows=get(u,180).decode().splitlines(); n=0
        for r in rows:
            f=r.split("|")
            if len(f)>6 and f[2]=="asn" and f[6] in("allocated","assigned"):
                s=int(f[3]); c=int(f[4]); n+=c
                for a in range(s,s+c): asn[a]=k
        rc[k]=n
    except Exception as e: rc[k]="ERR "+str(e)[:60]
out["rir_asn_counts"]=rc; out["rir_asn_total"]=len(asn)
try:
    nets=json.loads(get("https://www.peeringdb.com/api/net?limit=250&skip=0&fields=asn,name,notes,info_type"))["data"]
    hit=sum(1 for n in nets if n["asn"] in asn)
    out["peeringdb_sample"]={"nets":len(nets),"asn_in_rir":hit,"with_notes":sum(1 for n in nets if (n.get("notes") or "").strip())}
except Exception as e: out["peeringdb_sample"]="ERR "+str(e)[:80]
# B. GHCN stations WMO id and NWS stations
try:
    raw=get("https://www.ncei.noaa.gov/pub/data/ghcn/daily/ghcnd-stations.txt").decode().splitlines()
    wmo=[(l[:11],l[80:85].strip()) for l in raw if l[80:85].strip()]
    out["ghcn"]={"stations":len(raw),"with_wmo":len(wmo)}
    try:
        j=json.loads(get("https://api.weather.gov/stations?limit=500"))
        out["nws_stations_page"]=len(j.get("features",[]))
    except Exception as e: out["nws_stations_page"]="ERR "+str(e)[:80]
    # WMO ids in OSCAR? skip; check ICAO overlap via NWS ids "K***"
except Exception as e: out["ghcn"]="ERR "+str(e)[:80]
# C. MusicBrainz artists in Wikidata P434 (declared)
try:
    q="SELECT ?mb WHERE{?s wdt:P434 ?mb} LIMIT 60"
    r=json.loads(get("https://query.wikidata.org/sparql?format=json&query="+urllib.parse.quote(q)))
    mbids=[b["mb"]["value"] for b in r["results"]["bindings"]]
    ok=0;names=0;ann=0;n=0
    for m in mbids[:25]:
        time.sleep(1.1)
        try:
            a=json.loads(get(f"https://musicbrainz.org/ws/2/artist/{m}?fmt=json&inc=url-rels"))
            n+=1; ok+=1
            ann+= 1 if a.get("disambiguation") else 0
        except Exception: n+=1
    out["musicbrainz_wikidata"]={"wikidata_sample":len(mbids),"resolved_in_mb":ok,"checked":n,"with_disambiguation_text":ann}
except Exception as e: out["musicbrainz_wikidata"]="ERR "+str(e)[:80]
# D. UK Electoral Commission donations
try:
    raw=get("https://search.electoralcommission.org.uk/api/csv/Donations?start=0&rows=5000&query=&sort=AcceptedDate&order=desc&et=pp&et=ppm&et=tp&et=perpar&et=rd&date=&from=&to=&rptPd=&prePoll=false&postPoll=true&register=gb&register=ni&register=none&isIrishSourceYes=true&isIrishSourceNo=true&optCols=CompanyRegistrationNumber&optCols=Postcode&optCols=NatureOfDonation&optCols=PurposeOfVisit&optCols=DonationAction&optCols=ReportedDate&optCols=IsReportedPrePoll&optCols=ReportingPeriodName&optCols=IsBequest&optCols=IsAggregation&optCols=RegulatedEntityId&optCols=AccountingUnitId&optCols=DonorId&optCols=CampaigningName&optCols=RegisterName&optCols=IsIrishSource",120).decode("utf-8-sig")
    rows=list(csv.DictReader(io.StringIO(raw)))
    out["uk_donations"]={"rows":len(rows),"newest":max(r["AcceptedDate"][:10] if r.get("AcceptedDate") else "" for r in rows) if rows else None,
      "with_company_no":sum(1 for r in rows if (r.get("CompanyRegistrationNumber") or "").strip()),"cols":list(rows[0].keys())[:12] if rows else None}
except Exception as e: out["uk_donations"]="ERR "+str(e)[:80]
# E. exoplanets NASA vs exoplanet.eu
try:
    nasa=json.loads(get("https://exoplanetarchive.ipac.caltech.edu/TAP/sync?query=select+pl_name,hostname,disc_year+from+pscomppars&format=json"))
    nn={x["pl_name"].lower().replace(" ","") for x in nasa}
    out["nasa_exoplanets"]={"composite_rows":len(nasa)}
    try:
        eu=get("https://exoplanet.eu/catalog/csv/",120).decode("utf-8","replace")
        er=list(csv.DictReader(io.StringIO(eu)))
        en={(r.get("name") or r.get("# name") or "").lower().replace(" ","") for r in er}
        out["exoplanet_eu"]={"rows":len(er),"exact_name_overlap":len(nn&en),"cols":list(er[0].keys())[:8] if er else None}
    except Exception as e: out["exoplanet_eu"]="ERR "+str(e)[:80]
except Exception as e: out["nasa_exoplanets"]="ERR "+str(e)[:80]
print(json.dumps(out,indent=1))
