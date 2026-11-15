#!/usr/bin/env python3
"""Screening 2026-11-15: animal-disease-outbreaks. Fetches every source live (stdlib only).
Run from this directory with: python3 -I ahd_measure.py   -> writes ahd_measure.json
Output holds case/outbreak references, place names (towns/municipalities), dates and counts only. Premises owner
names are never collected (none of the sampled notices carries one).

Members screened:
  GOV.UK animal disease cases in England (Defra/APHA; search API + content API; prose notices with AIV case numbers)
  EU ADIS (European Commission DG SANTE; current-year and weekly outbreak PDF reports with outbreak references)
  Rijksoverheid (Netherlands; table of HPAI-infected and culled premises by date and place, plus news notices)
  USDA APHIS HPAI confirmed detections (Tableau dashboard; only the documented .csv view export is used)
  CFIA (Canada), WOAH WAHIS, Scottish Government, NZ MPI: reachability and terms only
Joins (both candidate; no publisher cites another's reference):
  ADIS weekly report (country, HPAI poultry, reporting week) <-> Rijksoverheid culling table rows dated in that week
  ADIS current-year municipality list (NL, HPAI poultry, 2026) <-> Rijksoverheid 2026 place / 'gemeente' name
"""
import json, re, time, zlib, html as H
import urllib.request, urllib.error, urllib.parse
from datetime import date

UA = "data-foundry-scout/1.0 (data@mail.proviciency.com)"
out = {"run_date": time.strftime("%Y-%m-%d")}


def get(u, tries=3):
    for i in range(tries):
        try:
            r = urllib.request.Request(u, headers={"User-Agent": UA, "Accept-Encoding": "identity"})
            with urllib.request.urlopen(r, timeout=120) as f:
                return f.status, f.geturl(), f.read()
        except urllib.error.HTTPError as e:
            if e.code >= 500 and i < tries - 1:
                time.sleep(10)
                continue
            return e.code, u, e.read()
        except Exception as e:
            if i == tries - 1:
                return 0, u, str(e).encode()
            time.sleep(3)
        finally:
            time.sleep(1)


def text(b):
    s = b.decode("utf8", "replace") if isinstance(b, bytes) else b
    s = re.sub(r"(?s)<script.*?</script>|<style.*?</style>", "", s)
    return " ".join(H.unescape(re.sub(r"<[^>]+>", " ", s)).split())


def norm(s):
    return re.sub(r"[^a-z0-9]+", "", (s or "").lower())


AIV = re.compile(r"AIV ?(\d{4})/(\d+)")

# ---------------- terms ----------------
terms = {}
s, u, b = get("https://www.gov.uk/help/terms-conditions")
t = text(b)
terms["gov_uk"] = {"url": u, "status": s,
                   "ogl_footer_present": "All content is available under the Open Government Licence v3.0" in t}
s, u, b = get("https://commission.europa.eu/legal-notice_en")
t = text(b)
terms["european_commission"] = {"url": u, "status": s,
                                "cc_by_present": "content owned by the EU on this website is licensed under the Creative Commons Attribution 4.0 International (CC BY 4.0) licence" in t}
s, u, b = get("https://www.rijksoverheid.nl/service/copyright")
t = text(b)
terms["rijksoverheid"] = {"url": u, "status": s,
                          "cc0_present": "Voor deze website geldt de Creative Commons zero-verklaring (CC0 1.0)." in t}
s, u, b = get("https://www.woah.org/en/terms-and-conditions/")
t = text(b)
terms["woah"] = {"url": u, "status": s,
                 "prohibition_present": "Without prior written permission of WOAH it is forbidden: to make any other use than those specified above, including commercial use, of information posted on the Site" in t}
s, u, b = get("https://www.canada.ca/en/transparency/terms.html")
t = text(b)
terms["canada_ca"] = {"url": u, "status": s,
                      "commercial_clause_present": "Unless otherwise specified, you may not reproduce materials on this site, in whole or in part, for the purposes of commercial redistribution without prior written permission from the copyright administrator." in t}
out["terms"] = terms

# ---------------- GOV.UK animal disease cases (England) ----------------
fields = ["title", "link", "public_timestamp", "disease_type", "disease_case_opened_date", "disease_case_closed_date",
          "zone_restriction", "zone_type", "virus_strain"]
q = "https://www.gov.uk/api/search.json?" + urllib.parse.urlencode(
    [("filter_format", "animal_disease_case"), ("count", "1000"), ("order", "-public_timestamp")] + [("fields", f) for f in fields])
s, u, b = get(q)
d = json.loads(b) if s == 200 else {}
res = d.get("results", [])
by_disease = {}
for r in res:
    for dt in r.get("disease_type") or ["(none)"]:
        by_disease[dt] = by_disease.get(dt, 0) + 1
aiv_titles = [r for r in res if AIV.search(r.get("title", ""))]
opened = sorted(r["disease_case_opened_date"] for r in res if r.get("disease_case_opened_date"))
out["gov_uk_cases"] = {"status": s, "total": d.get("total"), "fetched": len(res), "by_disease_type": by_disease,
                       "with_aiv_case_number_in_title": len(aiv_titles),
                       "newest_public_timestamp": res[0]["public_timestamp"] if res else None,
                       "opened_date_range": [opened[0], opened[-1]] if opened else None,
                       "zone_restriction_counts": {k: sum(1 for r in res if r.get("zone_restriction") == k) for k in {r.get("zone_restriction") for r in res}},
                       "virus_strains": sorted({r.get("virus_strain") for r in res if r.get("virus_strain")})}
samples = []
for r in aiv_titles[:5]:
    s2, u2, b2 = get("https://www.gov.uk/api/content" + r["link"])
    c = json.loads(b2) if s2 == 200 else {}
    body = text((c.get("details") or {}).get("body", ""))
    samples.append({"link": r["link"], "status": s2, "aiv": "/".join(AIV.search(r["title"]).groups()),
                    "body_chars": len(body), "body_mentions_zone_km": bool(re.search(r"\d+ ?km", body)),
                    "body_mentions_premises_type": bool(re.search(r"commercial|backyard|non-commercial|captive", body, re.I)),
                    "body_cites_aiv": bool(AIV.search(body)),
                    "detail_keys": sorted((c.get("details") or {}).keys())})
out["gov_uk_case_samples"] = samples
s, u, b = get("https://www.gov.uk/api/content/guidance/bird-flu-avian-influenza-latest-situation-in-england")
c = json.loads(b) if s == 200 else {}
body_html = (c.get("details") or {}).get("body", "")
body = text(body_html)
links = re.findall(r'href="([^"]+)"', body_html)
out["gov_uk_latest_situation"] = {"status": s, "public_updated_at": c.get("public_updated_at"),
                                  "aiv_numbers_cited": sorted({"/".join(m) for m in AIV.findall(body)}),
                                  "links_to_gov_scot_case_pages": [l for l in links if "gov.scot/publications/av" in l]}
s, u, b = get("https://www.gov.scot/publications/avian-influenza-outbreaks/")
out["gov_scot_outbreaks"] = {"status": s, "bytes": len(b), "note": "HTTP 202 with an empty body is a bot-challenge response; not bypassed"}

# ---------------- EU ADIS ----------------
def pdf_items(b):
    """Text items (x, y, string) per page. ADIS PDFs use Identity-H TrueType fonts whose glyph ids are char-29."""
    pages = []
    for m in re.finditer(rb"stream\r?\n(.*?)\r?\nendstream", b, re.S):
        try:
            d = zlib.decompress(m.group(1))
        except Exception:
            continue
        if b"Tj" not in d:
            continue
        items = []
        for bt in re.findall(rb"BT(.*?)ET", d, re.S):
            mm = re.search(rb"([\d.]+) ([\d.]+) Td", bt)
            if not mm:
                continue
            st = "".join("".join(chr(int(h[i:i + 4], 16) + 29) for i in range(0, len(h), 4))
                         for h in (x.decode() for x in re.findall(rb"<([0-9a-f]+)>Tj", bt)))
            items.append((float(mm.group(1)), float(mm.group(2)), st))
        pages.append(items)
    return pages


REF = re.compile(r"(?<![A-Z])([A-Z]{2})-([A-Z]+(?:\((?:NON-)?P\))?)-(\d{4})-(\d{5})(?!\d)")


def adis_blocks(pages):
    """Rows of the 'Summary of diseases ... by species and administrative division' pages, grouped into blocks."""
    blocks = []
    for items in pages:
        if not any("administrative division" in s for _, _, s in items):
            continue
        header_y = max(y for x, y, s in items if s.startswith("Country")) if any(s.startswith("Country") for _, _, s in items) else 9999
        body = sorted([it for it in items if it[1] < header_y - 10], key=lambda t: (-t[1], t[0]))
        ys = sorted({round(y, 1) for _, y, _ in body}, reverse=True)
        groups, cur, last = [], [], None
        for y in ys:
            if last is not None and last - y > 12:
                groups.append(cur)
                cur = []
            cur.append(y)
            last = y
        if cur:
            groups.append(cur)
        xs_admin = [x for x, _, s in items if s.startswith("Administrative")]
        admin_x = (xs_admin[0] - 15) if xs_admin else 480
        xs_sp = [x for x, _, s in items if s.startswith("Species")]
        species_x = (xs_sp[0] - 15) if xs_sp else admin_x - 60
        for g in groups:
            gi = [it for it in body if round(it[1], 1) in g]
            mid = "".join(s for x, y, s in sorted(gi, key=lambda t: (-t[1], t[0])) if 100 < x < species_x)
            country = " ".join(s.strip() for x, y, s in sorted(gi, key=lambda t: -t[1]) if x < 100 and s.strip())
            admins, buf = [], []
            for x, y, s in sorted([it for it in gi if it[0] >= admin_x], key=lambda t: -t[1]):
                if s.strip():
                    buf.append(s.strip())
                elif buf:
                    admins.append(" ".join(buf))
                    buf = []
            if buf:
                admins.append(" ".join(buf))
            refs = ["-".join(m) for m in REF.findall(mid.replace(" ", ""))]
            blocks.append({"country": country, "text": mid[:160], "refs": refs, "admins": admins})
    return blocks


s, u, b = get("https://webgate.ec.europa.eu/tracesnt/adis/public/notification/outbreaks-current-year-report")
year_pages = pdf_items(b) if s == 200 else []
yblocks = adis_blocks(year_pages)
all_refs = sorted({r for bl in yblocks for r in bl["refs"]})
by_code = {}
for r in all_refs:
    k = r.split("-2026-")[0] if "-2026-" in r else r
    by_code[k] = by_code.get(k, 0) + 1
period = re.search(r"Reporting period: (\S+) - (\S+)", " ".join(s for p in year_pages[:1] for _, _, s in p))
out["adis_current_year"] = {"status": s, "bytes": len(b), "pages": len(year_pages), "reporting_period": period.groups() if period else None,
                            "outbreak_references": len(all_refs), "countries": len({r[:2] for r in all_refs}),
                            "hpai_poultry_refs": sum(v for k, v in by_code.items() if k.endswith("HPAI(P)")),
                            "top_codes": sorted(by_code.items(), key=lambda kv: -kv[1])[:12]}
nl_p = [bl for bl in yblocks if any(r.startswith("NL-HPAI(P)-2026") for r in bl["refs"])]
nl_admins = sorted({a for bl in nl_p for a in bl["admins"]})
out["adis_nl_hpai_poultry_2026"] = {"refs": sorted({r for bl in nl_p for r in bl["refs"] if r.startswith("NL-HPAI(P)")}),
                                    "admin_divisions": nl_admins}
s, u, b = get("https://webgate.ec.europa.eu/tracesnt/adis/public/notification/outbreaks-weekly-report")
wpages = pdf_items(b) if s == 200 else []
wblocks = adis_blocks(wpages)
wtxt = " ".join(s for p in wpages for _, _, s in p)
wper = re.search(r"Reporting period: (\d\d)/(\d\d)/(\d{4}) - (\d\d)/(\d\d)/(\d{4})", wtxt)
wstart = date(int(wper.group(3)), int(wper.group(2)), int(wper.group(1))) if wper else None
wend = date(int(wper.group(6)), int(wper.group(5)), int(wper.group(4))) if wper else None
week_poultry = [{"country": bl["country"], "refs": [r for r in bl["refs"] if "HPAI(P)" in r], "admins": bl["admins"]}
                for bl in wblocks if any("HPAI(P)" in r for r in bl["refs"])]
out["adis_weekly"] = {"status": s, "bytes": len(b), "pages": len(wpages),
                      "period": [str(wstart), str(wend)] if wstart else None,
                      "outbreak_references": len({r for bl in wblocks for r in bl["refs"]}),
                      "hpai_poultry_blocks": week_poultry}

# ---------------- Rijksoverheid (Netherlands) ----------------
MONTHS = {m: i + 1 for i, m in enumerate(["januari", "februari", "maart", "april", "mei", "juni", "juli", "augustus",
                                          "september", "oktober", "november", "december"])}
s, u, b = get("https://www.rijksoverheid.nl/themas/klimaat-milieu-en-natuur/vogelgriep/besmettingen-vogelgriep-bij-bedrijven")
page = b.decode("utf8", "replace")
rows = []
for tb in re.findall(r"(?s)<table.*?</table>", page):
    for tr in re.findall(r"(?s)<tr.*?</tr>", tb):
        cells = [text(c) for c in re.findall(r"(?s)<t[dh][^>]*>(.*?)</t[dh]>", tr)]
        m = re.match(r"(\d{1,2}) (\w+) (\d{4})", cells[0]) if cells else None
        if m and m.group(2) in MONTHS:
            rows.append({"date": str(date(int(m.group(3)), MONTHS[m.group(2)], int(m.group(1)))), "place": cells[1],
                         "culled": cells[2] if len(cells) > 2 else ""})
r26 = [r for r in rows if r["date"].startswith("2026")]
out["rijksoverheid_table"] = {"status": s, "rows": len(rows), "rows_2026": len(r26),
                              "date_range": [min(r["date"] for r in rows), max(r["date"] for r in rows)] if rows else None,
                              "rows_2026_list": r26}
s, u, b = get("https://www.rijksoverheid.nl/themas/klimaat-milieu-en-natuur/vogelgriep")
news = sorted(set(re.findall(r'href="(/actueel/nieuws/\d{4}/\d\d/\d\d/[^"]*vogelgriep[^"]*)"', b.decode("utf8", "replace"))))
out["rijksoverheid_news_links"] = news
nsamp = []
for l in news[:3]:
    s2, u2, b2 = get("https://www.rijksoverheid.nl" + l)
    t2 = text(b2)
    i = t2.find("Vogelgriep")
    nsamp.append({"link": l, "status": s2, "mentions_gemeente": "gemeente" in t2,
                  "mentions_count_of_birds": bool(re.search(r"\d[\d.]* (?:kippen|eenden|dieren|vleeskuikens|leghennen)", t2)),
                  "mentions_zone_km": bool(re.search(r"\d+ ?kilometer", t2))})
out["rijksoverheid_news_samples"] = nsamp

# Join A (candidate): ADIS weekly HPAI-poultry block for NL <-> Rijksoverheid rows dated inside the ADIS week.
pairs_week = []
nl_week = [bl for bl in week_poultry if any(r.startswith("NL-") for r in bl["refs"])]
in_week = [r for r in rows if wstart and wstart <= date.fromisoformat(r["date"]) <= wend]
for bl in nl_week:
    for r in in_week:
        pairs_week.append({"adis_refs": bl["refs"], "adis_admins": bl["admins"], "ro_date": r["date"], "ro_place": r["place"]})
out["join_adis_week_to_rijksoverheid"] = {"adis_nl_poultry_refs_in_week": sum(len(bl["refs"]) for bl in nl_week),
                                          "rijksoverheid_rows_in_week": len(in_week), "pairs": pairs_week}

# Join B (candidate): Rijksoverheid 2026 place or 'gemeente X' equals an ADIS NL HPAI(P) 2026 admin division.
na = {norm(a): a for a in nl_admins}
jb = []
for r in r26:
    names = [r["place"].split("(")[0].split(",")[0].strip()] + re.findall(r"gemeente ([^,)]+)", r["place"])
    hit = next((na[norm(n)] for n in names if norm(n) in na), None)
    jb.append({"ro_date": r["date"], "ro_place": r["place"], "adis_admin": hit})
out["join_adis_year_admin_to_rijksoverheid"] = {"matched": sum(1 for x in jb if x["adis_admin"]), "total": len(jb), "rows": jb}

# ---------------- USDA APHIS ----------------
s, u, b = get("https://www.aphis.usda.gov/livestock-poultry-disease/avian/avian-influenza/hpai-detections/commercial-backyard-flocks")
iframes = re.findall(r'<iframe[^>]*src="([^"]+)"', b.decode("utf8", "replace"))
out["aphis_page"] = {"status": s, "dashboard_iframes": [H.unescape(x).split("?")[0] for x in iframes]}
s, u, b = get("https://publicdashboards.dl.usda.gov/t/MRP_PUB/views/VS_Avian_HPAIConfirmedDetections2022/HPAI2022ConfirmedDetections.csv")
lines = b.decode("utf8", "replace").splitlines()
out["aphis_view_csv"] = {"status": s, "header": lines[0] if lines else None, "rows": max(0, len(lines) - 1), "rows_sample": lines[1:5],
                         "note": "The documented Tableau '.csv' view export returns only the dashboard's first worksheet (monthly backyard-flock counts); per-detection rows were not requested through the Tableau session API"}

# ---------------- CFIA, NZ MPI, WAHIS reachability ----------------
s, u, b = get("https://inspection.canada.ca/en/animal-health/terrestrial-animals/diseases/reportable/avian-influenza/latest-bird-flu-situation/status-ongoing-avian-influenza-response")
out["cfia"] = {"status": s, "final_url": u, "terms_link": "https://www.canada.ca/en/transparency/terms.html" in b.decode("utf8", "replace"),
               "has_table": "<table" in b.decode("utf8", "replace")}
s, u, b = get("https://www.mpi.govt.nz/biosecurity/exotic-pests-and-diseases-in-new-zealand/active-biosecurity-responses/")
out["nz_mpi"] = {"status": s, "bytes": len(b), "bot_challenge": b"_Incapsula_Resource" in b}
s, u, b = get("https://wahis.woah.org/")
out["woah_wahis"] = {"status": s, "bytes": len(b), "note": "app shell; API not called because the WOAH terms forbid data-mining tools and commercial use"}

with open("ahd_measure.json", "w") as f:
    json.dump(out, f, indent=1, ensure_ascii=False)
print(json.dumps(out, indent=1, ensure_ascii=False)[:9000])
