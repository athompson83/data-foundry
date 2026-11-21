#!/usr/bin/env python3
"""Round 30 (2026-11-21): tariff schedule lines. USITC HTS REST export, UK Trade Tariff API and the
Department for Business and Trade commodities report. Writes hts_measure.json. Stdlib only."""
import collections, csv, io, json, re, random
from scoutlib import get, status, write

out = {"run_date": "2026-11-21"}

# --- USITC Harmonized Tariff Schedule -------------------------------------------------------
rel = json.loads(get("hts_release.json", "https://hts.usitc.gov/reststop/releaseList"))
cur = [r for r in rel if r.get("status") == "current"]
by_year = collections.Counter(m.group(0) for r in rel for m in [re.match(r"(19|20)\d\d", r["name"])] if m)
hts = json.loads(get("hts_full.json", "https://hts.usitc.gov/reststop/exportList?from=0101&to=9999&format=JSON&styles=false"))
digits = lambda s: re.sub(r"\D", "", s or "")
coded = [r for r in hts if r.get("htsno")]
length = collections.Counter(len(digits(r["htsno"])) for r in coded)
lines8 = [r for r in coded if len(digits(r["htsno"])) == 8]
stat10 = [r for r in coded if len(digits(r["htsno"])) == 10]
hts_hs6 = {digits(r["htsno"])[:6] for r in coded if len(digits(r["htsno"])) >= 6 and digits(r["htsno"])[:2] <= "97"}
out["usitc_hts"] = {
    "releases_listed": len(rel), "releases_by_year": dict(sorted(by_year.items())[-4:]),
    "current_release": [{k: r.get(k) for k in ("name", "date", "releaseStartDate", "status")} for r in cur],
    "rows": len(hts), "rows_with_htsno": len(coded), "rows_without_htsno_headings_text": len(hts) - len(coded),
    "htsno_digit_lengths": dict(sorted(length.items())),
    "distinct_htsno": len({r["htsno"] for r in coded}),
    "eight_digit_rate_lines": len(lines8),
    "eight_digit_with_general_rate": sum(1 for r in lines8 if (r.get("general") or "").strip()),
    "eight_digit_general_free": sum(1 for r in lines8 if (r.get("general") or "").strip() == "Free"),
    "eight_digit_with_special_rate": sum(1 for r in lines8 if (r.get("special") or "").strip()),
    "ten_digit_statistical_lines": len(stat10),
    "rows_with_units": sum(1 for r in coded if r.get("units")),
    "rows_with_footnotes": sum(1 for r in coded if r.get("footnotes")),
    "footnote_rows_citing_chapter_99": sum(1 for r in coded if any("99" in (f.get("value") or "")[:40] and "9903" in (f.get("value") or "") for f in (r.get("footnotes") or []))),
    "chapter_98_99_rows": sum(1 for r in coded if digits(r["htsno"])[:2] in ("98", "99")),
    "chapters_present": len({digits(r["htsno"])[:2] for r in coded}),
    "distinct_hs6_chapters_01_97": len(hts_hs6),
    "fields": sorted({k for r in hts for k in r}),
}

# --- UK Trade Tariff API ---------------------------------------------------------------------
sections = json.loads(get("uk_sections.json", "https://www.trade-tariff.service.gov.uk/api/v2/sections"))["data"]
chapters = json.loads(get("uk_chapters.json", "https://www.trade-tariff.service.gov.uk/api/v2/chapters"))["data"]
notes, headings = [], 0
for ch in chapters:
    code = ch["attributes"]["goods_nomenclature_item_id"][:2]
    d = json.loads(get(f"uk_ch{code}.json", f"https://www.trade-tariff.service.gov.uk/api/v2/chapters/{code}"))
    note = d["data"]["attributes"].get("chapter_note") or ""
    headings += sum(1 for i in d.get("included", []) if i["type"] == "heading")
    notes.append((code, len(note), len(re.findall(r"\bheading[s]? \d{4}", note))))
with_note = [n for n in notes if n[1] > 0]
out["uk_trade_tariff_api"] = {
    "sections": len(sections), "chapters": len(chapters), "headings_listed_under_chapters": headings,
    "chapters_with_chapter_note": len(with_note), "chapter_note_characters": sum(n[1] for n in notes),
    "chapter_note_median_characters": sorted(n[1] for n in with_note)[len(with_note) // 2] if with_note else 0,
    "chapter_notes_citing_a_heading_number": sum(1 for n in with_note if n[2] > 0),
    "heading_citations_in_chapter_notes": sum(n[2] for n in notes),
    "terms_page_status": {u: status(u) for u in ("https://www.trade-tariff.service.gov.uk/terms", "https://www.trade-tariff.service.gov.uk/find_commodity")},
}

# --- DBT commodities report (the UK goods nomenclature as one CSV) ---------------------------
raw = get("dbt.csv", "https://data.api.trade.gov.uk/v1/datasets/uk-tariff-2021-01-01/versions/latest/tables/commodities-report/data?format=csv")
rows = list(csv.DictReader(io.StringIO(raw.decode("utf-8-sig"))))
live = [r for r in rows if r["commodity__validity_end"] == "#NA"]
uk_codes = {r["commodity__code"] for r in live}
leaf_parent = {r["parent__code"] + r["parent__suffix"] for r in live}
# Any code below heading level carries its HS subheading in the first six digits (an undivided heading
# such as 0205 appears as 0205.00 in both schedules).
uk_hs6 = {c[:6] for c in uk_codes if (c[4:6] != "00" or c[6:] != "0000") and c[:2] <= "97"}
out["dbt_commodities_report"] = {
    "rows": len(rows), "rows_without_end_date": len(live), "distinct_commodity_codes_without_end_date": len(uk_codes),
    "newest_validity_start": max(r["commodity__validity_start"] for r in rows),
    "suffix_80_rows_without_end_date": sum(1 for r in live if r["commodity__suffix"] == "80"),
    "distinct_hs6_chapters_01_97": len(uk_hs6), "fields": list(rows[0]),
    "versions_endpoint_status": status("https://data.api.trade.gov.uk/v1/datasets/uk-tariff-2021-01-01/versions?format=json"),
}

# --- HS6 join: the first six digits are the internationally agreed HS subheading ------------
both = hts_hs6 & uk_hs6
out["hs6_join"] = {
    "hts_hs6": len(hts_hs6), "uk_hs6": len(uk_hs6), "in_both": len(both),
    "hts_only": len(hts_hs6 - uk_hs6), "uk_only": len(uk_hs6 - hts_hs6),
    "hts_only_sample": sorted(hts_hs6 - uk_hs6)[:15], "uk_only_sample": sorted(uk_hs6 - hts_hs6)[:15],
}
# Hand-check sample: 20 shared HS6 codes with both descriptions, fixed seed.
hts_desc, uk_desc = {}, {}
for r in coded:
    d = digits(r["htsno"])
    if len(d) == 6 or (len(d) >= 8 and d[:6] not in hts_desc):
        hts_desc[d[:6]] = (r["htsno"], r["description"])
for r in live:
    c = r["commodity__code"]
    if c[6:] == "0000" and c[4:6] != "00" and r["commodity__suffix"] == "80":
        uk_desc[c[:6]] = (c, r["commodity__description"])
random.seed(20261121)
pick = random.sample(sorted(b for b in both if b in hts_desc and b in uk_desc), 20)
out["hs6_handcheck_sample"] = [{"hs6": p, "hts": hts_desc[p], "uk": uk_desc[p]} for p in pick]
write(__file__, out)
