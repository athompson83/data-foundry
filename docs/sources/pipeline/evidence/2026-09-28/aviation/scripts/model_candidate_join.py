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

CHECKS = [
    ("N887PC", "TEXTRON AVIATION INC", "560XL", "fr_textron560xl.json", True, "abstract explicitly names 'the Textron Model 560XL airplane'"),
    ("N224RH", "ROBINSON HELICOPTER", "R44", "fr_robinsonR44.json", True, "abstract: 'Robinson Helicopter Company Model R44 and R44 II helicopters' - exact model match"),
    ("N43TB", "CESSNA", "182", "fr_cessna182.json", True, "abstract lists 'Models 180, 180A, ..., 182, 182A, 182B, ...' - exact model match"),
    ("N566WN", "BOEING", "737-7CT", "fr_boeing737_v2.json", False, "top AD is for Model 737-8, 737-9, 737-8200 - same family, but not the -7CT sub-variant on file"),
    ("N328NB", "AIRBUS INDUSTRIE", "A319-114", "fr_airbusA319.json", False, "top AD is for Model A319-115, -132, -133 - same family, but not the -114 sub-variant on file"),
]


def main() -> None:
    with open("../raw/aircraft.csv") as handle:
        aircraft = list(csv.DictReader(handle))
    print(f"NTSB aircraft population this round: {len(aircraft)}")
    print(f"models checked against a live Federal Register FAA-agency query: {len(CHECKS)}")
    correct = 0
    for regis_no, make, model, fr_file, ok, note in CHECKS:
        row = next((a for a in aircraft if a["regis_no"] == regis_no), None)
        assert row is not None, f"{regis_no} not in this month's NTSB sample"
        fr = json.load(open(f"../raw/{fr_file}"))
        correct += 1 if ok else 0
        print(f"  {regis_no} ({make} {model}) vs {fr_file} (FR count={fr['count']}): {'MATCH' if ok else 'no exact-model match'} - {note}")
    print(f"\nreviewed: {correct}/{len(CHECKS)} correct exact-model matches")
    print(
        f"Only these {len(CHECKS)} of this round's {len(aircraft)} NTSB aircraft records were queried against "
        "Federal Register; the other "
        f"{len(aircraft) - len(CHECKS)} were never checked and must not be counted as reviewed non-matches. "
        f"This is a {len(CHECKS)}-record reviewed sample, not a population-level match rate."
    )


if __name__ == "__main__":
    main()
