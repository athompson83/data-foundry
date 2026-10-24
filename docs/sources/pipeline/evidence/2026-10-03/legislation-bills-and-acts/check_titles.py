"""Hand-check helper: print Gazette Part III title vs Justice Laws title for matched chapters (2023)."""
import html, re, time, urllib.request
UA = {"User-Agent": "data-foundry-scout (data@mail.proviciency.com)"}
g = html.unescape(urllib.request.urlopen(urllib.request.Request("https://gazette.gc.ca/rp-pr/p3/2023/index-eng.html", headers=UA)).read().decode()).replace("\xa0", " ")
rows = {int(c): re.sub(r"<[^>]+>|\s+", " ", t).strip() for t, c in re.findall(r"([^<>]{8,200}?)\s*\(S\.C\.\s+2023,\s+c\.\s*(\d+)\)", g)}
time.sleep(1)
idx = urllib.request.urlopen(urllib.request.Request("https://laws-lois.justice.gc.ca/eng/XML/Legis.xml", headers=UA)).read().decode()
for a in re.findall(r"<Act>(.*?)</Act>", idx, flags=re.S):
    m = re.search(r"<OfficialNumber>2023, c\. (\d+)</OfficialNumber>", a)
    if m and "<Language>eng</Language>" in a:
        print(m.group(1), "| Justice:", re.search(r"<Title>([^<]*)", a).group(1), "| Gazette:", rows.get(int(m.group(1))))
