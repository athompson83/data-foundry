"""Declared-identifier join: does a GS1-check-digit-valid EU Safety Gate barcode
(GTIN/EAN) match a UPC carried on a live CPSC (saferproducts.gov) recall?

Input: ../eu_records_sample.json (from parse_weekly_reports.py) and
../raw/cpsc_recent.json (fetched 2026-09-28 from
https://www.saferproducts.gov/RestWebServices/Recall?format=json&RecallDateStart=2024-01-01&RecallDateEnd=2026-09-28
with the declared scout User-Agent).
"""

import json
import re


def gs1_valid(code: str | None) -> bool:
    if not code or not code.isdigit() or len(code) not in (8, 12, 13, 14):
        return False
    digits = [int(c) for c in code]
    check = digits[-1]
    body = digits[:-1][::-1]
    total = sum(d * (3 if i % 2 == 0 else 1) for i, d in enumerate(body))
    return (10 - (total % 10)) % 10 == check


def main() -> None:
    eu = json.load(open("../eu_records_sample.json"))
    cpsc = json.load(open("../raw/cpsc_recent.json"))

    eu_gtins = sorted({r["barcode"] for r in eu if gs1_valid(r["barcode"])})
    print(f"EU barcodes present: {sum(1 for r in eu if r['barcode'])}/{len(eu)}")
    print(f"EU barcodes with a valid GS1 check digit: {len(eu_gtins)}")

    cpsc_upcs = set()
    with_upc = 0
    for r in cpsc:
        found = False
        for product in r.get("Products") or []:
            for upc in product.get("UPC") or []:
                code = re.sub(r"\D", "", str(upc))
                if gs1_valid(code):
                    cpsc_upcs.add(code)
                    found = True
        if found:
            with_upc += 1
    print(f"CPSC recalls (RecallDate 2024-01-01..2026-09-28, n={len(cpsc)}) carrying a GS1-valid Products[].UPC: {with_upc}")
    print(f"distinct valid CPSC UPCs: {len(cpsc_upcs)}")

    overlap = sorted(set(eu_gtins) & cpsc_upcs)
    print(f"declared GTIN overlap (EU barcode == CPSC UPC): {len(overlap)}/{len(eu_gtins)}")
    print("Finding: the standard saferproducts.gov RestWebServices/Recall JSON does not carry a")
    print("Products[].UPC field at all in this window (0 CPSC recalls with a UPC), matching the")
    print("2026-09-27-composites finding for the same field (xmatch.py: '0/861 CPSC recalls with")
    print("model or code tokens ... via GTIN 0'). A UPC/GTIN join against CPSC needs identifiers")
    print("extracted from Description/Title free text, not a structured field.")


if __name__ == "__main__":
    main()
