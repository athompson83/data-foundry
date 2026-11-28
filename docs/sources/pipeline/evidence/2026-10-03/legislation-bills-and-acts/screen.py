#!/usr/bin/env python3
"""Screening run for the legislation-bills-and-acts data type (2026-10-03).

Measures reachability, counts, newest dates, identifier fields and one declared cross-source join:
  Canada Gazette Part III (PSPC, free-text PDFs + index pages)  <->  Justice Laws consolidated Acts (Dept of Justice, XML)
joined on the cited statute chapter reference number ("S.C. YYYY, c. N" == OfficialNumber "YYYY, c. N").
Also measured: Justice Laws Identification (Parliament/Session/BillNumber) <-> LEGISinfo bills (parked member).
Polite: <=2 req/s, small samples, nothing over 50MB. No keys, no login.
"""
import html
import json
import random
import re
import sys
import time
import urllib.request
import xml.etree.ElementTree as ET

UA = {"User-Agent": "data-foundry-scout (data@mail.proviciency.com)"}
OUT = {}


def get(url, rng=None, timeout=60):
    time.sleep(0.5)
    h = dict(UA)
    if rng:
        h["Range"] = rng
    req = urllib.request.Request(url, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read(), r.headers.get("content-type")
    except urllib.error.HTTPError as e:
        return e.code, b"", None
    except Exception as e:  # noqa: BLE001
        return 0, str(e).encode(), None


def text_of(b):
    t = re.sub(r"<script.*?</script>|<style.*?</style>", "", b.decode("utf-8", "ignore"), flags=re.S)
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", t)))


def quote(url, needle):
    s, b, _ = get(url)
    t = text_of(b)
    i = t.find(needle)
    return {"url": url, "status": s, "found": i >= 0, "quote": t[i:i + len(needle) + 120] if i >= 0 else None}


random.seed(20261003)

# ---------- Canada Justice Laws ----------
s, b, _ = get("https://laws-lois.justice.gc.ca/eng/XML/Legis.xml")
idx = b.decode("utf-8", "ignore")
acts = re.findall(r"<Act>(.*?)</Act>", idx, flags=re.S)
eng = [a for a in acts if "<Language>eng</Language>" in a]
chap = {}
for a in eng:
    on = re.search(r"<OfficialNumber>([^<]*)</OfficialNumber>", a).group(1)
    m = re.fullmatch(r"(\d{4}), c\. (\d+)", on)
    if m:
        chap[(int(m.group(1)), int(m.group(2)))] = (re.search(r"<UniqueId>([^<]*)", a).group(1), re.search(r"<Title>([^<]*)", a).group(1))
cur = sorted(set(re.findall(r"<CurrentToDate>([^<]*)", idx)))
OUT["justice_laws_index"] = {"status": s, "bytes": len(b), "acts_eng": len(eng), "acts_with_session_chapter_number": len(chap), "current_to_newest": cur[-1], "current_to_oldest": cur[0]}

# sample 25 Act XMLs: identification block, amendments, sections, dates
sample = random.sample(list(chap.items()), 25)
rows = []
for (yr, c), (uid, title) in sample:
    s, b, _ = get(f"https://laws-lois.justice.gc.ca/eng/XML/{uid}.xml")
    t = b.decode("utf-8", "ignore")
    row = {"uid": uid, "chapter": f"{yr}, c. {c}", "status": s, "bytes": len(b)}
    for tag in ("BillNumber", "AnnualStatuteNumber"):
        m = re.search(rf"<{tag}>([^<]*)</{tag}>", t)
        row[tag] = m.group(1).strip() if m else None
    pm = re.search(r"<Parliament><Session>(\d+)</Session><Number>(\d+)</Number>", t)
    row["Session"], row["Parliament"] = (pm.group(1), pm.group(2)) if pm else (None, None)
    row["sections"] = len(re.findall(r"<Section\b", t))
    row["amendment_citations"] = re.findall(r"<AmendmentCitation[^>]*>([^<]*)</AmendmentCitation>", t)[:5]
    row["in_force_dates"] = len(re.findall(r"lims:inforce-start-date=", t))
    row["free_text_chars"] = len(re.sub(r"<[^>]+>", "", t))
    rows.append(row)
OUT["justice_laws_sample"] = rows

# ---------- Canada Gazette Part III ----------
gaz = {}
for yr in range(2000, 2026):
    s, b, _ = get(f"https://gazette.gc.ca/rp-pr/p3/{yr}/index-eng.html")
    if s != 200:
        gaz[yr] = {"status": s}
        continue
    t = html.unescape(b.decode("utf-8", "ignore")).replace("\xa0", " ")
    cites = re.findall(r"\(S\.C\.\s+(\d{4}),\s+c\.\s*(\d+)\)", t)
    mod = re.search(r"Date modified: (\d{4}-\d{2}-\d{2})", t)
    gaz[yr] = {"status": s, "chapters": len(cites), "listed": [(int(y), int(c)) for y, c in cites], "modified": mod.group(1) if mod else None}
all_cites = {tuple(x) for v in gaz.values() for x in v.get("listed", [])}
OUT["gazette_part3"] = {"years_ok": sum(1 for v in gaz.values() if v["status"] == 200), "chapters_listed": len(all_cites),
                        "per_year": {y: v.get("chapters") for y, v in gaz.items()}, "newest_page_modified": max(v.get("modified") or "" for v in gaz.values())}
s, b, _ = get("https://gazette.gc.ca/rp-pr/p3/2025/g3-04801.pdf", rng="bytes=0-400000")
OUT["gazette_part3"]["pdf_probe"] = {"status": s, "bytes_read": len(b), "starts_pdf": b[:5] == b"%PDF-"}

# THE JOIN: Gazette cited chapter -> Justice Laws OfficialNumber
matched = sorted(all_cites & set(chap))
OUT["join_gazette_to_justice_laws"] = {"key": "cited statute chapter reference number (S.C. YYYY, c. N)", "gazette_chapters": len(all_cites),
                                       "matched": len(matched), "matched_sample": matched[:25],
                                       "justice_chapters_in_gazette_year_range": sum(1 for k in chap if 2000 <= k[0] <= 2025),
                                       "justice_chapters_matched_pct_of_range": round(100 * len(matched) / max(1, sum(1 for k in chap if 2000 <= k[0] <= 2025)), 1)}

# ---------- LEGISinfo (parked) ----------
s, b, ct = get("https://www.parl.ca/legisinfo/en/bills/json?parlsession=all")
leg = json.loads(b.decode("utf-8-sig")) if s == 200 else []
OUT["legisinfo"] = {"status": s, "bills": len(leg), "sessions": len({(x["ParliamentNumber"], x["SessionNumber"]) for x in leg}),
                    "newest_assent": max((x["ReceivedRoyalAssentDateTime"] or "")[:10] for x in leg) if leg else None,
                    "statute_chapter_populated": sum(1 for x in leg if x.get("StatuteChapter")),
                    "royal_assent": sum(1 for x in leg if x.get("ReceivedRoyalAssent"))}
lkey = {(x["ParliamentNumber"], x["SessionNumber"], x["NumberCode"]) for x in leg}
hit = tot = 0
for r in rows:
    if r["BillNumber"] and r["Parliament"] and r["Session"]:
        tot += 1
        hit += (int(r["Parliament"]), int(r["Session"]), r["BillNumber"]) in lkey
OUT["join_justice_laws_to_legisinfo"] = {"key": "Parliament-session-bill reference", "matched": hit, "of": tot, "note": "LEGISinfo is PARKED (terms unreadable); measured as evidence only"}

# ---------- UK legislation.gov.uk ----------
s, b, _ = get("https://www.legislation.gov.uk/ukpga/data.feed")
t = b.decode("utf-8", "ignore")
entries = re.findall(r"<entry>.*?</entry>", t, flags=re.S)
OUT["uk_legislation"] = {"status": s, "ukpga_total": int(re.search(r'UnitedKingdomPublicGeneralAct" href="[^"]*" value="(\d+)"', t).group(1)),
                         "feed_updated": re.search(r"<updated>([^<]*)", t).group(1), "entries_page1": len(entries),
                         "identifier_example": re.findall(r"<id>([^<]*)</id>", t)[1:3]}
uk = []
for yr in (2025, 2018, 2010):
    s, b, _ = get(f"https://www.legislation.gov.uk/ukpga/{yr}/data.feed")
    tt = b.decode("utf-8", "ignore")
    for e in re.findall(r"<entry>.*?</entry>", tt, flags=re.S)[:8]:
        uk.append({"id": re.search(r"<id>([^<]*)", e).group(1), "title": re.search(r"<title>([^<]*)", e).group(1),
                   "year": re.search(r'<ukm:Year Value="(\d+)"', e) and re.search(r'<ukm:Year Value="(\d+)"', e).group(1),
                   "number": re.search(r'<ukm:Number Value="(\d+)"', e) and re.search(r'<ukm:Number Value="(\d+)"', e).group(1),
                   "royal_assent": re.search(r'<ukm:EnactmentDate Date="([^"]*)"', e) and re.search(r'<ukm:EnactmentDate Date="([^"]*)"', e).group(1)})
OUT["uk_legislation"]["sample"] = uk
s, b, _ = get("https://www.legislation.gov.uk/ukpga/2018/12/data.xml")
t = b.decode("utf-8", "ignore")
OUT["uk_legislation"]["dpa2018_xml"] = {"status": s, "bytes": len(b), "sections": len(re.findall(r"<P1group", t)), "restrict_start_dates": len(re.findall(r"RestrictStartDate=", t)),
                                        "commentaries": len(re.findall(r"<Commentary ", t))}
OUT["uk_legislation"]["terms"] = quote("https://www.legislation.gov.uk/developer/formats/xml", "All content is available under the Open Government Licence v3.0 except where otherwise stated")

# ---------- US GovInfo BILLSTATUS ----------
s, b, _ = get("https://www.govinfo.gov/bulkdata/BILLSTATUS/119/hr")
names = re.findall(r'href="(/bulkdata/BILLSTATUS/119/hr/BILLSTATUS-119hr(\d+)\.xml)"', b.decode("utf-8", "ignore"))
OUT["us_billstatus"] = {"listing_status": s, "hr_119_files": len(names)}
bs = []
for path, n in [x for x in names if x[1] in ("1", "4")] + random.sample(names, 25):
    s, b, _ = get("https://www.govinfo.gov" + path)
    t = b.decode("utf-8", "ignore")
    laws = re.findall(r"<laws>.*?</laws>", t, flags=re.S)
    bs.append({"bill": f"HR {n}", "status": s, "bytes": len(b), "updateDate": re.search(r"<updateDate>([^<]*)", t).group(1) if "<updateDate>" in t else None,
               "introduced": re.search(r"<introducedDate>([^<]*)", t).group(1) if "<introducedDate>" in t else None,
               "actions": len(re.findall(r"<actionDate>", t)), "law": re.findall(r"<number>(\d+-\d+)</number>", laws[0]) if laws else [],
               "has_summary": "<summaries>" in t, "has_cbo": "<cboCostEstimates>" in t, "sponsor_bioguide": "<bioguideId>" in t})
OUT["us_billstatus"]["sample"] = bs
OUT["us_billstatus"]["newest_update"] = max(x["updateDate"] or "" for x in bs)
OUT["us_billstatus"]["terms"] = quote("https://www.govinfo.gov/about/policies", "Copyright protection under this title is not available for any work of the United States Government")

# ---------- Australia Federal Register of Legislation ----------
s, b, _ = get("https://api.prod.legislation.gov.au/v1/titles?%24top=1&%24count=true&%24filter=collection%20eq%20%27Act%27&%24select=id")
cnt = re.search(r'"@odata.count":(\d+)', b.decode("utf-8", "ignore"))
s2, b2, _ = get("https://api.prod.legislation.gov.au/v1/titles?%24top=3&%24filter=collection%20eq%20%27Act%27%20and%20year%20eq%202025&%24select=id,name,makingDate,year,number,status,originatingBillUri")
OUT["au_frl"] = {"status": s, "acts_count": int(cnt.group(1)) if cnt else None, "newest_status": s2, "newest": json.loads(b2).get("value") if s2 == 200 else None,
                 "copyright_page_text_readable": len(text_of(get("https://www.legislation.gov.au/help/copyright")[1])) > 1500}

# ---------- terms ----------
OUT["terms"] = {
    "justice_order": {"url": "https://laws-lois.justice.gc.ca/eng/XML/SI-97-5.xml",
                      "quote": "Anyone may, without charge or request for permission, reproduce enactments and consolidations of enactments of the Government of Canada"},
    "justice_notice": quote("https://laws-lois.justice.gc.ca/eng/ImportantNote", "The Department of Justice Canada assumes no responsibility for the accuracy or reliability of any reproduction derived from the legislative material on this site"),
    "parl_notice": quote("https://www.parl.ca/ImportantNotices-e.html", "Permission to reproduce\u2014in whole or in part\u2014or to otherwise use the content of this website may be sought from the appropriate source"),
    "ourcommons_notice": quote("https://www.ourcommons.ca/en/important-notices", "Permission to reproduce"),
    "parl_notices": {"url": "https://www.parl.ca/ImportantNotices-e.html", "status": get("https://www.parl.ca/ImportantNotices-e.html")[0]},
    "legislation_gov_uk_ogl": OUT["uk_legislation"].pop("terms"),
}
s, b, _ = get("https://laws-lois.justice.gc.ca/eng/XML/SI-97-5.xml")
OUT["terms"]["justice_order"]["found"] = "Anyone may, without charge or request for permission, reproduce enactments and consolidations of enactments of the Government of Canada" in text_of(b)

json.dump(OUT, open("results.json", "w"), indent=1, default=str)
print(json.dumps({k: v for k, v in OUT.items() if k not in ("justice_laws_sample",)}, default=str)[:6000])
