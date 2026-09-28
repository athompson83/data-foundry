"""Parse EU Safety Gate weekly-report detail XML into flat notification records
and measure field extraction hit rates.

Input: raw/detail_<id>.xml (fetched 2026-09-28 from
https://ec.europa.eu/safety-gate-alerts/api/download/weeklyReport/detail/xml/<id>?language=en
with User-Agent "Data Foundry Scout (data@mail.proviciency.com)").
Run from this scripts/ directory: python3 parse_weekly_reports.py
"""

import json
import re

REPORTS = ["detail_10000324.xml", "detail_10000323.xml", "detail_10000322.xml"]
FIELDS = ["caseNumber", "category", "product", "brand", "name", "model", "batchNumber", "barcode", "riskType", "notifyingCountry", "level"]
FIELD_TAGS = {"model": "type_numberOfModel"}


def field(block: str, tag: str) -> str | None:
    match = re.search(rf"<{tag}(?:\s[^>]*)?>(.*?)</{tag}>", block, re.S)
    if not match:
        return None
    value = match.group(1)
    cdata = re.search(r"<!\[CDATA\[(.*?)\]\]>", value, re.S)
    if cdata:
        value = cdata.group(1)
    value = value.strip()
    return value or None


def main() -> None:
    records = []
    for report in REPORTS:
        xml = open(f"../raw/{report}", encoding="utf-8").read()
        for block in re.findall(r"<notifications[^>]*>(.*?)</notifications>", xml, re.S):
            record = {name: field(block, FIELD_TAGS.get(name, name)) for name in FIELDS}
            record["source_report"] = report
            records.append(record)
    print(f"{len(records)} notifications parsed from {len(REPORTS)} weekly reports")
    for name in FIELDS:
        hits = sum(1 for r in records if r[name])
        print(f"{name}: {hits}/{len(records)}")
    json.dump(records, open("../eu_records_sample.json", "w"), indent=1)


if __name__ == "__main__":
    main()
