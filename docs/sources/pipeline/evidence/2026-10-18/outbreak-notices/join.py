# WHO Disease Outbreak News (free text) vs ECDC epidemiological updates (RSS): candidate link by disease + country + date window.
import sys, json, re, html
sys.path.insert(0, '..'); from common import *
who = []
for skip in range(0, 5000, 100):
    p = get(f"https://www.who.int/api/news/diseaseoutbreaknews?sf_culture=en&$orderby=PublicationDateAndTime%20desc&$top=100&$skip={skip}")
    if not p or not p["value"]: break
    who += p["value"]
rows = [{"don": w.get("DonId"), "date": (w.get("PublicationDate") or "")[:10], "title": w.get("OverrideTitle") or w.get("Title"),
         "has_epi": bool(re.sub("<[^>]+", "", w.get("Epidemiology") or "").strip()), "has_assessment": bool(re.sub("<[^>]+", "", w.get("Assessment") or "").strip()),
         "has_advice": bool(re.sub("<[^>]+", "", w.get("Advice") or "").strip())} for w in who]
ecdc_xml = get("https://www.ecdc.europa.eu/en/taxonomy/term/1310/feed", raw=True).decode()
ecdc = [{"title": html.unescape(t), "date": d} for t, d in re.findall(r"<item>.*?<title>(.*?)</title>.*?<pubDate>(.*?)</pubDate>", ecdc_xml, re.S)]
stop = {"disease", "outbreak", "virus", "worldwide", "overview", "in", "the", "of", "and", "update", "infection", "cases", "epidemiological"}
tok = lambda s: {t for t in re.findall(r"[a-z\-]{4,}", s.lower()) if t not in stop}
recent = [r for r in rows if r["date"] >= "2025-01-01"]
links = []
for e in ecdc:
    et = tok(e["title"])
    m = [r for r in recent if len(et & tok(r["title"] or "")) >= 1]
    links.append({"ecdc": e["title"], "ecdc_date": e["date"], "who_candidates": [(r["don"], r["title"]) for r in m[:3]]})
out = {"who_total": len(rows), "who_first": min(r["date"] for r in rows), "who_last": max(r["date"] for r in rows),
       "who_with_epidemiology": sum(r["has_epi"] for r in rows), "who_with_assessment": sum(r["has_assessment"] for r in rows), "who_with_advice": sum(r["has_advice"] for r in rows),
       "who_since_2025": len(recent), "ecdc_items": len(ecdc), "ecdc_with_who_candidate": sum(1 for l in links if l["who_candidates"]), "links": links}
json.dump(out, open("join.json", "w"), indent=1); print({k: v for k, v in out.items() if k != "links"})
for l in links: print(l["ecdc"], "->", l["who_candidates"][:2])
