"""Candidate (review-only) join: does an aircraft make/model named in an NTSB
accident/incident record also appear in a current FAA airworthiness/special-
conditions document, as published by the Federal Register API? This is a
shared-attribute candidate join (README: "shared attributes select nothing on
their own"), never a declared identifier; only a hand-reviewed match counts
(AGENTS.md rule 7).

Inputs (raw/, fetched 2026-09-28 from federalregister.gov/api/v1/documents.json
with conditions[agencies][]=federal-aviation-administration, conditions[term]=
<manufacturer + model>, conditions[type][]=RULE, with the declared scout
User-Agent):
  fr_boeing737_v2.json     term "Boeing 737"
  fr_airbusA319.json       term "Airbus A319"
  fr_textron560xl.json     term "Textron Aviation 560XL"
  fr_robinsonR44.json      term "Robinson Helicopter R44"
  fr_cessna182.json        term "Cessna 182"
"""

import csv
import json
import re

# (registration, make, model, FR response file, a regex the model must match
# somewhere in a cached result's title+abstract to count as an exact-model hit)
CHECKS = [
    ("N887PC", "TEXTRON AVIATION INC", "560XL", "fr_textron560xl.json", r"560XL"),
    ("N224RH", "ROBINSON HELICOPTER", "R44", "fr_robinsonR44.json", r"\bR44\b"),
    ("N43TB", "CESSNA", "182", "fr_cessna182.json", r"\b182\b"),
    ("N566WN", "BOEING", "737-7CT", "fr_boeing737_v2.json", r"737-7CT\b"),
    ("N328NB", "AIRBUS INDUSTRIE", "A319-114", "fr_airbusA319.json", r"-114\b"),
]


def main() -> None:
    with open("../raw/aircraft.csv") as handle:
        aircraft = list(csv.DictReader(handle))
    print(f"NTSB aircraft population this round: {len(aircraft)}")
    print(f"models checked against a live Federal Register FAA-agency query: {len(CHECKS)}")
    correct = 0
    for regis_no, make, model, fr_file, pattern in CHECKS:
        row = next((a for a in aircraft if a["regis_no"] == regis_no), None)
        assert row is not None, f"{regis_no} not in this month's NTSB sample"
        fr = json.load(open(f"../raw/{fr_file}"))
        # Search every cached result, not just the first — an earlier version
        # of this script only inspected fr["count"] and hard-coded the verdict
        # by hand, missing that the FR results actually go on to list Model
        # A319-114 explicitly (document 2026-17551) further down the page
        # (Codex review, PR #72).
        matches = [
            r["document_number"]
            for r in fr.get("results", [])
            if re.search(pattern, (r.get("title", "") or "") + " " + (r.get("abstract", "") or ""), re.I)
        ]
        ok = bool(matches)
        correct += 1 if ok else 0
        detail = f"matched {matches[0]}" if ok else f"no result in the cached page (of {len(fr.get('results', []))}) names this model"
        print(f"  {regis_no} ({make} {model}) vs {fr_file} (FR count={fr['count']}): {'MATCH' if ok else 'no exact-model match'} - {detail}")
    print(f"\nreviewed: {correct}/{len(CHECKS)} correct exact-model matches")
    print(
        f"Only these {len(CHECKS)} of this round's {len(aircraft)} NTSB aircraft records were queried against "
        "Federal Register; the other "
        f"{len(aircraft) - len(CHECKS)} were never checked and must not be counted as reviewed non-matches. "
        f"This is a {len(CHECKS)}-record reviewed sample, not a population-level match rate."
    )


if __name__ == "__main__":
    main()
