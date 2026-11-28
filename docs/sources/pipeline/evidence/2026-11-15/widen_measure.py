#!/usr/bin/env python3
"""Screening 2026-11-15: widening food-and-health-recalls-global (its LIVE member is fda-recalls).
Fetches every source live (stdlib only). Run from this directory with:
    python3 -I widen_measure.py   -> writes widen_measure.json
Sources: Hong Kong Centre for Food Safety (CFS) food alerts, Germany lebensmittelwarnung.de RSS, openFDA food
enforcement (the LIVE member). Output holds alert ids, firm/organisation names, product descriptions and counts only;
contact lines (hotline numbers) are not stored."""
import json, re, time, html, urllib.request, urllib.parse, xml.etree.ElementTree as ET
from datetime import datetime, timedelta

UA = "data-foundry-scout/1.0 (data@mail.proviciency.com)"
out = {"run_date": time.strftime("%Y-%m-%d")}


def get(u, tries=3):
    for i in range(tries):
        try:
            r = urllib.request.Request(u, headers={"User-Agent": UA})
            with urllib.request.urlopen(r, timeout=60) as f:
                return f.status, f.read()
        except urllib.error.HTTPError as e:
            return e.code, e.read()
        except Exception as e:  # connection resets from the CFS host: back off and retry
            if i == tries - 1:
                return 0, str(e).encode()
            time.sleep(10)


def text(b):
    t = b.decode("utf8", "replace")
    t = re.sub(r"<script.*?</script>|<style.*?</style>", " ", t, flags=re.S)
    return " ".join(html.unescape(re.sub(r"<[^>]+>", " ", t)).split())


# --- 1. Hong Kong CFS food alerts (2025 and 2026 year lists) ---------------
HK = "https://www.cfs.gov.hk/english/whatsnew/whatsnew_fa/"
hk = {"years": {}, "alerts": []}
for year in (2026, 2025):
    s, b = get(f"{HK}whatsnew_fa_{year}.html")
    ids = sorted(set(re.findall(rf'href="/english/whatsnew/whatsnew_fa/({year}_\d+)\.html"', b.decode("utf8", "replace"))))
    hk["years"][year] = {"status": s, "alerts_listed": len(ids)}
    for aid in ids:
        time.sleep(1.5)
        s, b = get(f"{HK}{aid}.html")
        if s != 200:
            hk["alerts"].append({"id": aid, "status": s})
            continue
        t = text(b)
        f = lambda a, z: (re.search(re.escape(a) + r"\s*(.*?)\s*" + re.escape(z), t) or [None, None])[1]
        hk["alerts"].append({
            "id": aid,
            "issue_date": f("Issue Date", "Source of Information"),
            "source": f("Source of Information", "Food Product"),
            "product": (f("Food Product", "Product Name and Description") or "")[:120],
            "description": (f("Product Name and Description", "Reason For Issuing Alert") or "")[:400],
            "reason_chars": len(f("Reason For Issuing Alert", "Action Taken") or ""),
        })
alerts = [a for a in hk["alerts"] if a.get("source")]
hk["parsed"] = len(alerts)
src_counts = {}
for a in alerts:
    src_counts[a["source"]] = src_counts.get(a["source"], 0) + 1
hk["source_of_information"] = dict(sorted(src_counts.items(), key=lambda kv: -kv[1]))
hk["field_fill"] = {k: sum(1 for a in alerts if a.get(k)) for k in ("issue_date", "source", "product", "description")}
dates = sorted(datetime.strptime(a["issue_date"], "%d.%m.%Y").date().isoformat() for a in alerts if re.fullmatch(r"\d{1,2}\.\d{1,2}\.\d{4}", a["issue_date"] or ""))
hk["issue_date_range"] = [dates[0], dates[-1]] if dates else None

# --- 2. Candidate join: CFS alerts whose source is the US FDA -> openFDA food enforcement by firm and date ---------
fda_alerts = [a for a in alerts if re.search(r"Food and Drugs? Administration|\bFDA\b", a["source"] or "")]
pairs = []
for a in fda_alerts:
    d = datetime.strptime(a["issue_date"], "%d.%m.%Y").date()
    m = re.search(r"(?:Manufacturer|Distributor|Recalling firm|Packer)\s*:\s*(.+?)(?:\s+(?:Place of origin|Net|Volume|Best|Use|Lot|Batch|Expiry|Pack|UPC|Product)\b|$)", a["description"])
    firm = m.group(1).strip() if m else None
    a["firm"] = firm
    if not firm:
        pairs.append({"cfs": a["id"], "firm": None, "fda": []})
        continue
    token = re.sub(r"[^A-Za-z0-9 ]", " ", firm).split()
    token = [w for w in token if len(w) > 2 and w.lower() not in ("inc", "llc", "ltd", "the", "co", "corp", "company", "foods", "food")][:2]
    q = " AND ".join(f'recalling_firm:"{w}"' for w in token)
    span = f"report_date:[{(d - timedelta(days=120)):%Y%m%d} TO {(d + timedelta(days=120)):%Y%m%d}]"
    url = "https://api.fda.gov/food/enforcement.json?" + urllib.parse.urlencode({"search": f"{q} AND {span}", "limit": 10})
    time.sleep(1)
    s, b = get(url)
    hits = json.loads(b).get("results", []) if s == 200 else []
    pairs.append({"cfs": a["id"], "cfs_date": d.isoformat(), "firm": firm, "cfs_product": a["product"],
                  "fda": [{"recall_number": h["recall_number"], "report_date": h["report_date"], "recalling_firm": h["recalling_firm"],
                           "product": h["product_description"][:160]} for h in hits]})
out["hk_cfs"] = {k: v for k, v in hk.items() if k != "alerts"}
out["hk_cfs"]["sample_ids"] = [a["id"] for a in hk["alerts"]][:400]
out["join_cfs_fda"] = {"cfs_alerts_sourced_from_fda": len(fda_alerts), "with_firm": sum(1 for p in pairs if p["firm"]),
                       "with_fda_match": sum(1 for p in pairs if p["fda"]), "pairs": pairs}


# --- 3b. The DATA.GOV.HK route for the same alerts (dataset cfs-foodalert-foodalert) ---------------------------
s, b = get("https://data.gov.hk/en-data/api/3/action/package_show?id=cfs-foodalert-foodalert")
pkg = json.loads(b).get("result", {}) if s == 200 else {}
s2, b2 = get("https://www.cfs.gov.hk/filemanager/foodalert/english/foodalert_datagovhk.xml")
feed = {"package_status": s, "package_title": pkg.get("title"), "update_frequency": pkg.get("update_frequency") or pkg.get("frequency"),
        "resources": [r.get("url") for r in pkg.get("resources", [])], "feed_status": s2, "feed_bytes": len(b2)}
if s2 == 200:
    items = ET.fromstring(b2.decode("utf-8-sig").encode()).findall(".//item")
    feed["items"] = len(items)
    feed["pubdates"] = [i.findtext("pubDate") for i in items]
    feed["links"] = [i.findtext("link") for i in items]
    feed["items_with_description_fields"] = sum(1 for i in items if (i.findtext("description") or "").strip())
    feed["links_in_parsed_alerts"] = sum(1 for l in feed["links"] if re.search(r"whatsnew_fa/(\d{4}_\d+)\.html", l or "") and re.search(r"whatsnew_fa/(\d{4}_\d+)\.html", l).group(1) in {a["id"] for a in hk["alerts"]})
out["hk_datagovhk_feed"] = feed
for k, u in {"datagovhk_terms": "https://data.gov.hk/en/terms-and-conditions", "cfs_site_notices": "https://www.cfs.gov.hk/english/notices/notices.html"}.items():
    s, b = get(u)
    out.setdefault("terms_pages", {})[k] = {"url": u, "status": s, "bytes": len(b)}

# --- 3. Germany: lebensmittelwarnung.de (federal/state portal) RSS -----------------------------------------------
s, b = get("https://www.lebensmittelwarnung.de/___LMW-Redaktion/RSSNewsfeed/Functions/RssFeeds/rssnewsfeed_Alle_DE.xml?nn=314268")
de = {"status": s, "bytes": len(b)}
if s == 200:
    items = ET.fromstring(b).findall(".//item")
    labels = {}
    for i in items:
        for m in re.findall(r"<b>([^<]{2,60}?):?</b>", i.findtext("description") or ""):
            labels[m.strip(": ")] = labels.get(m.strip(": "), 0) + 1
    de.update({
        "items": len(items),
        "newest": items[0].findtext("pubDate") if items else None,
        "oldest": items[-1].findtext("pubDate") if items else None,
        "field_labels": labels,
        "items_with_13_digit_code": sum(1 for i in items if re.search(r"\b\d{13}\b", i.findtext("description") or "")),
        "by_state_code": {},
        "sample_links": [i.findtext("link") for i in items[:25]],
    })
    for i in items:
        m = re.search(r"/\d{6}_\d+_([A-Z]{2})_", i.findtext("link") or "")
        if m:
            de["by_state_code"][m.group(1)] = de["by_state_code"].get(m.group(1), 0) + 1
out["de_lebensmittelwarnung"] = de

# --- 4. Terms pages (status only; quotes are in the research record) ---------------------------------------------
for k, u in {"lmw_impressum": "https://www.lebensmittelwarnung.de/DE/Service/Impressum/impressum_node.html"}.items():
    s, b = get(u)
    out.setdefault("terms_pages", {})[k] = {"url": u, "status": s, "bytes": len(b)}

json.dump(out, open("widen_measure.json", "w"), indent=1, ensure_ascii=False)
print(json.dumps({k: v for k, v in out.items() if k not in ("join_cfs_fda",)}, ensure_ascii=False)[:3000])
print(json.dumps({k: v for k, v in out["join_cfs_fda"].items() if k != "pairs"}))
