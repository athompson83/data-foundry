#!/usr/bin/env python3
"""Round 35 (2026-11-28) widening: Health Canada advisories and public notices, the rows of the recalls
open-data index published under "Communications and Public Affairs Branch" and "HC". The LIVE consumer-product
sync already downloads and archives this file. Counts the rows, reads 20 seeded advisory pages, and looks on each
page for links to other notices of the same index (the declared link: a cited notice URL). Writes
widen_measure.json. Stdlib only."""
import collections, json, random, re
import scoutlib as s
from termslib import check, visible

out = {"run_date": "2026-11-28"}
rows = json.loads(s.get("hc_index.json", "https://recalls-rappels.canada.ca/sites/default/files/opendata-donneesouvertes/HCRSAMOpenData.json?scout=20261128w").decode("utf-8-sig"))
by_nid = {str(r["NID"]): r for r in rows}
adv = [r for r in rows if r.get("Organization") in ("Communications and Public Affairs Branch", "HC")]
dates = sorted((r.get("Last updated") or "") for r in adv)
out["index"] = {"rows": len(rows), "by_organization": dict(collections.Counter(r.get("Organization") for r in rows).most_common()),
    "advisory_rows": len(adv), "by_advisory_organization": dict(collections.Counter(r.get("Organization") for r in adv)),
    "by_category": dict(collections.Counter(r.get("Category") or "(blank)" for r in adv).most_common(10)),
    "by_recall_class": dict(collections.Counter(r.get("Recall class") or "(blank)" for r in adv).most_common()),
    "archived_flag": dict(collections.Counter(str(r.get("Archived")) for r in adv)), "last_updated_range": [dates[0], dates[-1]],
    "by_last_updated_year": dict(sorted(collections.Counter(d[:4] for d in dates).items())),
    "with_issue": sum(1 for r in adv if (r.get("Issue") or "").strip()), "with_product": sum(1 for r in adv if (r.get("Product") or "").strip()),
    "with_what_you_should_do": sum(1 for r in adv if (r.get("What you should do") or "").strip()),
    "issue_values": dict(collections.Counter((r.get("Issue") or "").strip()[:60] for r in adv).most_common(8)),
    "titles_naming_an_unauthorized_product": sum(1 for r in adv if re.search(r"unauthori[sz]ed", r.get("Title") or "", re.I)),
    "titles_naming_a_recall": sum(1 for r in adv if re.search(r"recall", r.get("Title") or "", re.I)),
    "titles_naming_a_lot": sum(1 for r in adv if re.search(r"\blots?\b", r.get("Title") or "", re.I))}
random.seed(20261128)
recent = sorted((r for r in adv if (r.get("Last updated") or "") >= "2024-01-01"), key=lambda r: int(r["NID"]))
out["index"]["advisory_rows_updated_since_2024"] = len(recent)
sample, links = [], []
for r in random.sample(recent, 20):
    body, err = s.try_get(f"hc_advisory_{r['NID']}.html", r["URL"])
    if err:
        sample.append({"nid": r["NID"], "error": err}); continue
    markup = body.decode("utf-8", "replace")
    main = markup.split("<main", 1)[-1].split("</main>", 1)[0]
    t = visible(main)
    cited = set()
    for href in re.findall(r'href="([^"]+)"', main):
        m = re.search(r"/(?:en|fr)/(?:alert-recall|alerte-rappel)/([a-z0-9\-]+)", href)
        if m:
            cited.add(m.group(1))
    slug = r["URL"].rstrip("/").rsplit("/", 1)[-1]
    cited.discard(slug)
    slug_to_row = {x["URL"].rstrip("/").rsplit("/", 1)[-1]: x for x in rows}
    resolved = [slug_to_row[c] for c in cited if c in slug_to_row]
    for x in resolved:
        links.append({"advisory_nid": r["NID"], "advisory_title": r["Title"].strip()[:110], "cited_nid": x["NID"], "cited_title": x["Title"].strip()[:110], "cited_organization": x.get("Organization"), "cited_category": x.get("Category")})
    sample.append({"nid": r["NID"], "title": r["Title"].strip()[:110], "organization": r["Organization"], "category": r.get("Category"), "last_updated": r["Last updated"], "page_characters": len(t),
        "notice_links_on_page": len(cited), "notice_links_resolving_in_index": len(resolved), "din_or_npn_numbers": len(set(re.findall(r"\b(?:DIN|NPN|DIN-HM)\s*:?\s*(\d{8})\b", t))),
        "lot_mentions": len(re.findall(r"\b[Ll]ot\b", t)), "has_affected_products_section": "Affected products" in t, "has_what_you_should_do": "What you should do" in t,
        "names_a_company": bool(re.search(r"\b(?:Inc\.|Ltd\.|Corp\.|Limited|Company)", t))})
ok = [x for x in sample if "error" not in x]
out["advisory_pages"] = {"requested": 20, "read": len(ok), "page_characters": sum(x["page_characters"] for x in ok), "median_characters": sorted(x["page_characters"] for x in ok)[len(ok) // 2] if ok else None,
    "with_affected_products_section": sum(x["has_affected_products_section"] for x in ok), "with_what_you_should_do": sum(x["has_what_you_should_do"] for x in ok),
    "with_a_din_or_npn": sum(1 for x in ok if x["din_or_npn_numbers"]), "mentioning_a_lot": sum(1 for x in ok if x["lot_mentions"]), "naming_a_company": sum(x["names_a_company"] for x in ok),
    "pages_linking_to_another_notice": sum(1 for x in ok if x["notice_links_on_page"]), "pages_whose_link_resolves_in_the_index": sum(1 for x in ok if x["notice_links_resolving_in_index"])}
out["join_cited_notice_url"] = {"links_resolving_in_index": len(links), "by_cited_organization": dict(collections.Counter(l["cited_organization"] for l in links).most_common()), "links": links[:40]}
out["handcheck_sample"] = sample
ours = {}
for r in random.sample(recent, 6):
    ours[r["NID"]] = s.status(f"https://data.aroqon.com/product-recalls/hc-{r['NID']}")
out["our_public_pages_for_6_of_these_notices"] = {"http_status_by_nid": ours, "served": sum(1 for v in ours.values() if v == 200)}
out["terms"] = {"open_government_licence_canada": check("terms_ogl_canada.html", "https://open.canada.ca/en/open-government-licence-canada",
    ["The Information Provider grants you a worldwide, royalty-free, perpetual, non-exclusive licence to use the Information, including for commercial purposes, subject to the terms below."], ("Acknowledge the source", "does not grant"))}
s.write(__file__, out)
