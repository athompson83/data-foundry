#!/usr/bin/env python3
"""Round 23 measurements. Re-fetches every source live. UA declared."""
import json, re, urllib.request, csv, io, zipfile, collections
UA="data-foundry-scout/1.0 (data@mail.proviciency.com)"
def get(u, n=None):
    r=urllib.request.Request(u,headers={"User-Agent":UA})
    with urllib.request.urlopen(r,timeout=90) as f: return f.read(n) if n else f.read()
out={}
# ACCC recalls feed: items, citations of CPSC / Health Canada, GTIN-like codes
x=get("https://www.productsafety.gov.au/rss/feed.xml/psa_recall").decode("utf8","replace")
items=re.findall(r"<item>(.*?)</item>",x,re.S)
out["accc_items"]=len(items)
out["accc_cite_cpsc_hc"]=sum(bool(re.search(r"CPSC|Consumer Product Safety Commission|Health Canada|saferproducts",i,re.I)) for i in items)
out["accc_gtin_like"]=sum(bool(re.search(r"\b\d{12,14}\b",i)) for i in items)
out["accc_dates"]=sorted(re.findall(r"<pubDate>(.*?)</pubDate>",x))[:1]+sorted(re.findall(r"<pubDate>(.*?)</pubDate>",x))[-1:]
# LDA: totals, text field availability on a page of filings
d=json.loads(get("https://lda.gov/api/v1/filings/?page_size=25&filing_year=2025"))
out["lda_total_2025"]=d["count"]
acts=[a for f in d["results"] for a in f.get("lobbying_activities",[])]
out["lda_sample_activities"]=len(acts)
out["lda_with_description"]=sum(bool(a.get("description")) for a in acts)
out["lda_sample_desc"]=[a.get("description","")[:160] for a in acts[:3]]
# Canada lobbying registrations zip
try:
    z=zipfile.ZipFile(io.BytesIO(get("https://lobbycanada.gc.ca/media/zwcjycef/registrations_enregistrements_ocl_cal.zip")))
    out["ca_lobby_files"]=[(i.filename,i.file_size) for i in z.infolist()]
except Exception as e:
    out["ca_lobby_files"]=str(e)
# NHLE heritage list
b="https://services-eu1.arcgis.com/ZOdPfBS3aqqDYPUQ/arcgis/rest/services/National_Heritage_List_for_England_NHLE_v02_VIEW/FeatureServer/0/query"
r=json.loads(get(b+"?where=1%3D1&outFields=ListEntry,Name,Grade,ListDate,hyperlink&resultRecordCount=3&returnGeometry=false&f=json"))
out["nhle_sample"]=[x["attributes"] for x in r["features"]]
r=json.loads(get(b+"?where=1%3D1&outStatistics=%5B%7B%22statisticType%22%3A%22max%22%2C%22onStatisticField%22%3A%22ListDate%22%2C%22outStatisticFieldName%22%3A%22m%22%7D%5D&f=json"))
out["nhle_max_listdate"]=r.get("features")
# NID dams: header + row count from first 3MB
raw=get("https://nid.sec.usace.army.mil/api/nation/csv", 3_000_000).decode("utf8","replace").splitlines()
rows=list(csv.reader(raw))
out["nid_columns"]=len(rows[1]) if rows and not rows[0][0].isdigit() else len(rows[0])
out["nid_header_sample"]=rows[1][:25] if len(rows)>1 else rows[0][:25]
json.dump(out,open("measure.json","w"),indent=1,default=str)
print(json.dumps(out,indent=1,default=str)[:5000])
