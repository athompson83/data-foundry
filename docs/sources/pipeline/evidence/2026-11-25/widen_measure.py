#!/usr/bin/env python3
"""Round 34 (2026-11-25) widening: Health Canada cannabis and controlled-substance recall notices, a part of
the same open-data index the LIVE consumer-product dataset already reads and archives. Counts the rows by
organisation and category, reads 12 seeded notice pages, and asks our own public pages whether 10 of the
notices are served. Writes widen_measure.json. Stdlib only."""
import collections, json, random, re
import scoutlib as s
from termslib import check, visible

out = {"run_date": "2026-11-25"}
rows = json.loads(s.get("hc_index.json", "https://recalls-rappels.canada.ca/sites/default/files/opendata-donneesouvertes/HCRSAMOpenData.json?scout=20261125w").decode("utf-8-sig"))
served = [r for r in rows if r.get("Organization") == "Consumer product safety"]
can = [r for r in rows if r.get("Organization") == "Controlled substances and cannabis"]
dates = sorted((r.get("Last updated") or "") for r in can)
out["index"] = {"rows": len(rows), "rows_served_today_consumer_product_safety": len(served),
    "controlled_substances_and_cannabis_rows": len(can), "by_category": dict(collections.Counter(r.get("Category") for r in can).most_common()),
    "by_recall_class": dict(collections.Counter(r.get("Recall class") or "(blank)" for r in can).most_common()),
    "archived_flag": dict(collections.Counter(str(r.get("Archived")) for r in can)), "last_updated_range": [dates[0], dates[-1]],
    "by_last_updated_year": dict(sorted(collections.Counter(d[:4] for d in dates).items())),
    "with_issue": sum(1 for r in can if (r.get("Issue") or "").strip()), "with_product": sum(1 for r in can if (r.get("Product") or "").strip()),
    "with_what_you_should_do": sum(1 for r in can if (r.get("What you should do") or "").strip()),
    "distinct_nids": len({r["NID"] for r in can}), "nids_shared_with_served_rows": len({r["NID"] for r in can} & {r["NID"] for r in served}),
    "titles_naming_a_lot": sum(1 for r in can if re.search(r"\blots?\b", r.get("Title") or "", re.I)),
    "issue_values": dict(collections.Counter((r.get("Issue") or "").strip() for r in can).most_common(8))}
random.seed(20261125)
pages, sample = [], []
for r in random.sample(sorted(can, key=lambda r: int(r["NID"])), 12):
    try:
        t = visible(s.get(f"hc_notice_{r['NID']}.html", r["URL"], timeout=90).decode("utf-8", "replace"))
    except Exception as e:
        sample.append({"nid": r["NID"], "error": type(e).__name__}); continue
    body = t.split("Affected products", 1)[-1] if "Affected products" in t else t
    rec = {"nid": r["NID"], "title": r["Title"].strip()[:110], "last_updated": r["Last updated"], "category": r.get("Category"), "page_characters": len(t),
           "has_affected_products_section": "Affected products" in t, "has_lot_number_column": bool(re.search(r"Lot Number|Lot number", body)), "lots_named_in_issue_text": len(set(re.findall(r"\bfrom lot ([A-Z0-9][A-Z0-9-]{2,})", t))),
           "upc_or_gtin_12_to_14_digits": len(set(re.findall(r"\b\d{12,14}\b", body))), "states_units_sold": bool(re.search(r"units? (?:of the )?(?:affected|recalled)? ?(?:products? )?(?:were|was) sold|were sold", t)),
           "names_licence_holder": bool(re.search(r"licen[cs]e holder|licensed (?:producer|processor)", t, re.I)), "mentions_thc_or_cbd": bool(re.search(r"\bTHC\b|\bCBD\b", t))}
    sample.append(rec); pages.append(rec)
out["notice_pages"] = {"requested": 12, "read": len(pages), "with_affected_products_section": sum(p["has_affected_products_section"] for p in pages),
    "with_a_lot_number_column": sum(p["has_lot_number_column"] for p in pages), "naming_a_lot_in_the_issue_text": sum(1 for p in pages if p["lots_named_in_issue_text"]),
    "with_a_12_to_14_digit_code": sum(1 for p in pages if p["upc_or_gtin_12_to_14_digits"]), "stating_units_sold": sum(p["states_units_sold"] for p in pages),
    "mentioning_thc_or_cbd": sum(p["mentions_thc_or_cbd"] for p in pages), "page_characters": sum(p["page_characters"] for p in pages)}
out["handcheck_sample"] = sample
ours = {}
for r in random.sample(sorted(can, key=lambda r: int(r["NID"])), 10):
    ours[r["NID"]] = s.status(f"https://data.aroqon.com/product-recalls/hc-{r['NID']}")
out["our_public_pages_for_10_of_these_notices"] = {"http_status_by_nid": ours, "served": sum(1 for v in ours.values() if v == 200)}
out["terms"] = {"open_government_licence_canada": check("terms_ogl_canada.html", "https://open.canada.ca/en/open-government-licence-canada", [], ("royalty-free", "Acknowledge the source", "does not grant"))}
s.write(__file__, out)
