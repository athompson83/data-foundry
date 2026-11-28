#!/usr/bin/env python3
"""Round 30 (2026-11-21): stage advance for building-products-ibhs-fortified-incentives. Reads the IBHS
FORTIFIED incentives page, its legal page and robots.txt (three requests, 10 s apart as robots.txt asks).
Writes adv_measure.json. Stdlib only."""
import html, re, time
from scoutlib import get, write

out = {"run_date": "2026-11-21"}
page = get("ibhs_incentives.html", "https://fortifiedhome.org/incentives/").decode("utf-8", "replace"); time.sleep(10)
legal = get("ibhs_legal.html", "https://fortifiedhome.org/legal/").decode("utf-8", "replace"); time.sleep(10)
robots = get("ibhs_robots.txt", "https://fortifiedhome.org/robots.txt").decode("utf-8", "replace")
clean = lambda s: re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", s))).strip()
body = re.sub(r"(?s)<(script|style|noscript).*?</\1>", " ", page)
start = body.index("State-Specific Incentives"); end = body.index("Miss Out on Incentives")
block = body[start:end]
parts = re.split(r"(?s)<h5[^>]*>(.*?)</h5>", block)
states = []
for name, text in zip(parts[1::2], parts[2::2]):
    t = clean(text)
    labels = re.findall(r"\b(Discounts?|Grants?|Tax Credits?|Tax Deductions?|Endorsements?|Loans?|Rebates?) [–-] ", t)
    links = re.findall(r'href="([^"]+)"', text)
    states.append({"state": clean(name), "characters": len(t), "labelled_incentive_types": sorted({l.rstrip("s").lower() for l in labels}),
                   "percent_figures": re.findall(r"\d{1,3}(?:\.\d)?%", t), "dollar_figures": re.findall(r"\$\d[\d,]*\d", t),
                   "links": len(links), "external_link_hosts": sorted({re.sub(r"^https?://([^/]+).*", r"\1", l) for l in links if l.startswith("http") and "fortifiedhome.org" not in l}),
                   "defers_to_a_state_page": "Click here to learn more" in t})
split_at = block.index("Qualifies for Other Incentives")
first_group = len(re.findall(r"<h5", block[:split_at]))
out["ibhs_incentives_page"] = {
    "modified_time_meta": (re.search(r'article:modified_time" content="([^"]+)"', page) or [None, None])[1],
    "page_text_characters": len(clean(body)), "state_sections": len(states),
    "states_with_fortified_specific_incentives": first_group, "states_where_fortified_qualifies_for_other_incentives": len(states) - first_group,
    "state_section_characters": sum(s["characters"] for s in states),
    "states_with_a_labelled_incentive_type": sum(1 for s in states if s["labelled_incentive_types"]),
    "states_with_a_percent_or_dollar_figure": sum(1 for s in states if s["percent_figures"] or s["dollar_figures"]),
    "states_deferring_to_a_state_page": [s["state"] for s in states if s["defers_to_a_state_page"]],
    "states": states,
}
lt = clean(re.sub(r"(?s)<(script|style).*?</\1>", " ", legal))
m = re.search(r"Any reproduction, retransmission, or republication[^.]*\.", lt)
out["ibhs_legal_sentence"] = m.group(0) if m else None
out["robots_crawl_delay"] = (re.search(r"Crawl-delay:\s*(\d+)", robots) or [None, None])[1]
write(__file__, out)
