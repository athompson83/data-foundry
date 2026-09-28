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

CHECKS = [
    ("N887PC", "TEXTRON AVIATION INC", "560XL", "fr_textron560xl.json"),
    ("N224RH", "ROBINSON HELICOPTER", "R44", "fr_robinsonR44.json"),
    ("N43TB", "CESSNA", "182", "fr_cessna182.json"),
    ("N566WN", "BOEING", "737-7CT", "fr_boeing737_v2.json"),
    ("N328NB", "AIRBUS INDUSTRIE", "A319-114", "fr_airbusA319.json"),
]


def model_matches(model: str, fr: dict) -> tuple[bool, str]:
    """Does any result actually name this exact model?

    A Codex review on PR #72 found the first version of this function was a
    hard-coded verdict that never inspected the fetched JSON: it called the
    Airbus A319-114 case a non-match by eyeballing only the first of three
    results, when the second (document 2026-17551) explicitly lists "Model
    A319-111, -112, -113, -114, -115, ..." among the types it covers. A plain
    substring search for "A319-114" still misses that, because the FAA writes
    a shared prefix once and lists sub-variant suffixes afterward, so this
    also expands and checks that list when the model contains a hyphenated
    family-suffix.
    """
    exact = re.compile(r"\b" + re.escape(model) + r"\b")
    family, sep, suffix = model.partition("-")
    list_pattern = re.compile(re.escape(family) + r"((?:[\s,;]*(?:and\s+)?-\s*\w+)+)") if sep else None
    for result in fr.get("results", []):
        text = f"{result.get('title', '')} {result.get('abstract', '')}"
        if exact.search(text):
            return True, f"{result.get('document_number')}: names {model!r} exactly"
        if list_pattern:
            match = list_pattern.search(text)
            if match and suffix in re.findall(r"-\s*(\w+)", match.group(1)):
                return True, f"{result.get('document_number')}: {family} sub-variant list includes -{suffix}"
    return False, "no result names this exact model or an explicit sub-variant of it"


def main() -> None:
    with open("../raw/aircraft.csv") as handle:
        aircraft = list(csv.DictReader(handle))
    print(f"NTSB aircraft population this round: {len(aircraft)}")
    print(f"models checked against a live Federal Register FAA-agency query: {len(CHECKS)}")
    correct = 0
    for regis_no, make, model, fr_file in CHECKS:
        row = next((a for a in aircraft if a["regis_no"] == regis_no), None)
        assert row is not None, f"{regis_no} not in this month's NTSB sample"
        fr = json.load(open(f"../raw/{fr_file}"))
        ok, note = model_matches(model, fr)
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
