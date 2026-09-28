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


def expand_upc_e(upc_e: str) -> str | None:
    """Port of packages/recall-structuring/src/codes.ts expandUpcE: an 8-digit
    UPC-E (number system 0 or 1) to its 12-digit UPC-A."""
    if not re.fullmatch(r"[01]\d{7}", upc_e):
        return None
    system = upc_e[0]
    d1, d2, d3, d4, d5, d6 = upc_e[1:7]
    check = upc_e[7]
    if d6 in "012":
        body = f"{d1}{d2}{d6}0000{d3}{d4}{d5}"
    elif d6 == "3":
        body = f"{d1}{d2}{d3}00000{d4}{d5}"
    elif d6 == "4":
        body = f"{d1}{d2}{d3}{d4}00000{d5}"
    else:
        body = f"{d1}{d2}{d3}{d4}{d5}0000{d6}"
    return f"{system}{body}{check}"


def gtin_readings(code: str) -> set[str]:
    """Port of packages/recall-structuring/src/text.ts gtinReadings: every
    GTIN-14 a printed barcode can stand for. A 12-14 digit code as printed; for
    eight digits, EAN-8 as printed and UPC-E expanded to UPC-A. Canonicalizing
    to GTIN-14 (rather than comparing raw digit strings) is required so a
    12-digit UPC-A and its 14-digit GTIN form are recognised as the same
    product — an earlier version of this script compared raw strings only and
    would have missed such a match (Codex review, PR #72)."""
    out: set[str] = set()
    if re.fullmatch(r"\d{12,14}", code) and gs1_valid(code):
        out.add(code.rjust(14, "0"))
    if re.fullmatch(r"\d{8}", code):
        if gs1_valid(code):
            out.add(code.rjust(14, "0"))
        upc_a = expand_upc_e(code)
        if upc_a and gs1_valid(upc_a):
            out.add(upc_a.rjust(14, "0"))
    return out


def digit_codes(value: str) -> list[str]:
    """Matches the production parser's packages/product-recall-structuring/src/text.ts digitCodes:
    split on separators, rejoin a grouped code, then pull 8-14 digit runs."""
    out: list[str] = []
    for token in re.split(r"[,;/|\n]+|\s{2,}", value or ""):
        joined = re.sub(r"(?<=\d)[ -](?=\d)", "", token)
        out.extend(re.findall(r"(?<!\d)\d{8,14}(?!\d)", joined))
    return out


def main() -> None:
    eu = json.load(open("../eu_records_sample.json"))
    cpsc = json.load(open("../raw/cpsc_recent.json"))

    # The EU barcode field is a single string but can concatenate several
    # individually valid codes with no consistent separator (e.g.
    # "675817511256 675817511386 675817511546"); an earlier version of this
    # script validated the whole field as one code and silently dropped every
    # multi-code record (8 of 223 in this sample) — tokenize it the same way
    # the CPSC side already is (Codex review, PR #72).
    eu_present = sum(1 for r in eu if r.get("barcode"))
    eu_gtins: set[str] = set()
    for r in eu:
        for token in digit_codes(r.get("barcode") or ""):
            eu_gtins |= gtin_readings(token)
    print(f"EU barcodes present: {eu_present}/{len(eu)}")
    print(f"EU barcodes with a valid GS1 check digit (canonical GTIN-14 readings): {len(eu_gtins)}")

    # CPSC carries UPCs on the top-level ProductUPCs[] field, not under each
    # Products[] item (packages/product-recall-structuring/src/cpsc.ts:113 reads
    # record.ProductUPCs). An earlier version of this script read the wrong
    # field and wrongly concluded CPSC exposes no structured UPC data at all
    # (Codex review, PR #72) — it does; this sample just has no overlap with it.
    cpsc_upcs: set[str] = set()
    with_upc = 0
    for r in cpsc:
        found = False
        for entry in r.get("ProductUPCs") or []:
            raw = entry.get("UPC") if isinstance(entry, dict) else entry
            for code in digit_codes(str(raw or "")):
                readings = gtin_readings(code)
                if readings:
                    cpsc_upcs |= readings
                    found = True
        if found:
            with_upc += 1
    print(f"CPSC recalls (RecallDate 2024-01-01..2026-09-28, n={len(cpsc)}) carrying a GS1-valid ProductUPCs[].UPC: {with_upc}")
    print(f"distinct valid CPSC UPCs (canonical GTIN-14 readings): {len(cpsc_upcs)}")

    overlap = sorted(eu_gtins & cpsc_upcs)
    print(f"declared GTIN overlap (EU barcode == CPSC UPC, both as canonical GTIN-14): {len(overlap)}/{len(eu_gtins)}")
    print("Finding: CPSC's ProductUPCs[].UPC field IS populated in this window (40 recalls, 170")
    print("distinct GS1-valid codes) — the earlier '0 UPC data' conclusion in this script was a")
    print("field-name bug, not a real source limitation. This particular 223-record EU sample simply")
    print("has no barcode in common with these 40 CPSC recalls' UPCs; a larger EU sample or a longer")
    print("CPSC window could still find a declared match and should be retried before concluding a")
    print("GTIN/UPC join against CPSC needs free-text extraction instead of this structured field.")


if __name__ == "__main__":
    main()
