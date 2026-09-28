"""Collector-side pre-check for product-identifier candidates.

A line-by-line mirror of
``packages/product-recall-structuring/src/identifier-candidates.ts``: the
server's rules are authoritative and are re-run on every submission against
the stored R2 evidence. This copy only keeps obviously bad model output in
local quarantine instead of uploading it. Both implementations run the same
vectors (``packages/product-recall-structuring/test/identifier-candidate-vectors.json``).

All patterns use ``re.ASCII`` so ``\\b``, ``\\d`` and ``\\s`` behave as in JavaScript.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass

IDENTIFIER_TASK = "cpsc-product-identifiers@1"
IDENTIFIER_LABELS = ("model", "item", "style", "sku", "part", "catalog", "product")
_F = re.IGNORECASE | re.ASCII

LABEL_PATTERNS = [
    ("model", re.compile(r"\bmodels?\b(?:\s*(?:numbers?\b|nos?\b\.?|#))?", _F)),
    ("item", re.compile(r"\bitems?\b(?:\s*(?:numbers?\b|nos?\b\.?|#))?", _F)),
    ("style", re.compile(r"\bstyles?\b(?:\s*(?:numbers?\b|nos?\b\.?|#))?", _F)),
    ("sku", re.compile(r"\bskus?\b(?:\s*(?:numbers?\b|nos?\b\.?|#))?", _F)),
    ("part", re.compile(r"\bpart\s*(?:numbers?\b|nos?\b\.?|#)|\bp/n\b", _F)),
    ("catalog", re.compile(r"\bcatalog(?:ue)?s?\b(?:\s*(?:numbers?\b|nos?\b\.?|#))?|\bcat\.\s*nos?\b\.?", _F)),
    ("product", re.compile(r"\b(?:product|article|reference|stock)\s*(?:numbers?\b|nos?\b\.?|#|codes?\b)", _F)),
]
NEGATIVE = re.compile(
    r"\bmodel\s*years?\b|\b(?:lots?|batch(?:es)?|serial(?:s|\s*numbers?)?|(?:date|production|manufactur(?:e|ing))\s*codes?|codes?\s*dates?|vins?|rn|upcs?|eans?|gtins?|barcodes?|ca\s*#|wpl|recall\s*(?:numbers?|nos?\b\.?)|release\s*(?:numbers?|#)|phone|telephone|fax|call)\b|\btoll[- ]free\b",
    _F,
)
ABBREVIATION = re.compile(r"(?:\bno|\bnos|\bcat|\bref|\bapprox|\binc|\bco|\bcorp|\bltd|\bu\.s|\bst|\bjr|\bmr|\bmrs|\bdr|\bvs|\bft|\bin|\boz|\blbs?|\be\.g|\bi\.e)$", _F)
UNIT_AFTER = re.compile(
    r"^\s*(?:-\s*)?(?:watts?|volts?|amps?|amperes?|inch(?:es)?|in\.|feet|foot|ft|pounds?|lbs?|ounces?|oz|gallons?|gal|quarts?|liters?|litres?|ml|mm|cm|meters?|btus?|hp|mah|wh|kw|units?|pieces?|pcs|pairs?|sets?|percent|%|degrees?|months?|years?|days?|pack|count|ct)\b",
    _F,
)
MEASURE = re.compile(r"^\d+(?:\.\d+)?-?(?:cups?|inch(?:es)?|in|ft|foot|feet|oz|lbs?|mm|cm|m|v|volts?|w|watts?|amps?|a|packs?|pieces?|pcs?|gallons?|gal|quarts?|qt|l|ml|speed|pound|btu|hp|mah|wh|kw|piece|ct)$", _F)
SHAPE = re.compile(r"^[A-Za-z0-9](?:[A-Za-z0-9 .\-/#_]{0,38}[A-Za-z0-9])?$", re.ASCII)
FIELD = re.compile(r"^(?:Title|Description|Products\[(\d{1,3})\]\.(?:Name|Description|Model))$", re.ASCII)
AFTER_LABEL = re.compile(r"number|\bnos?\b|#|sku|p/n", _F)
MAX_ANCHOR_BEFORE = 800
NEGATIVE_NEAR_WORDS = 3
RANGE_NEIGHBOUR_BEFORE = re.compile(r"(?:\bthrough|\bthru|\bto|\s[-\u2013]|^[-\u2013])\s*$", _F)
RANGE_NEIGHBOUR_AFTER = re.compile(r"^\s*(?:through\b|thru\b|to\b|[-\u2013]\s)", _F)
MONTH = r"(?:0?[1-9]|1[0-2])"
DAY = r"(?:0?[1-9]|[12]\d|3[01])"
CALENDAR = [
    re.compile(rf"^{MONTH}[/.-]{DAY}(?:[/.-](?:\d{{2}}|\d{{4}}))?$", re.ASCII),
    re.compile(rf"^{DAY}[/.-]{MONTH}[/.-](?:\d{{2}}|\d{{4}})$", re.ASCII),
    re.compile(rf"^(?:19|20)\d\d[/.-]{MONTH}(?:[/.-]{DAY})?$", re.ASCII),
    re.compile(r"^(?:19|20)\d\d[-/](?:19|20)?\d\d$", re.ASCII),
]
LISTED = re.compile(r"\b(?:models?|items?|styles?|skus?|part|catalog(?:ue)?|product|article|stock)\s*(?:numbers?|nos?\.?|#)\s*(?:[:#]\s*)?(?:[A-Za-z0-9-]+\s*(?:,|and|or)\s*)*$", _F)
MAX_ANCHOR_AFTER = 40


@dataclass(frozen=True)
class Decision:
    ok: bool
    reason: str | None = None
    start: int | None = None
    end: int | None = None
    key: str | None = None
    label: str | None = None
    field: str | None = None


def model_key(value: str) -> str:
    folded = "".join(ch for ch in unicodedata.normalize("NFKD", value) if not ("̀" <= ch <= "ͯ"))
    return re.sub(r"[^A-Z0-9]", "", folded.upper())


def gs1_check_digit_valid(digits: str) -> bool:
    if not digits.isdigit() or len(digits) < 2:
        return False
    body, check = digits[:-1], int(digits[-1])
    total = sum(int(d) * (3 if i % 2 == 0 else 1) for i, d in enumerate(reversed(body)))
    return (10 - total % 10) % 10 == check


def candidate_field_text(record: object, field: str) -> str | None:
    match = FIELD.match(field)
    if not match or not isinstance(record, dict):
        return None
    if field in ("Title", "Description"):
        value = record.get(field)
        return value if isinstance(value, str) else None
    products = record.get("Products")
    if not isinstance(products, list):
        return None
    index = int(match.group(1))
    if index >= len(products) or not isinstance(products[index], dict):
        return None
    value = products[index].get(field.split(".", 1)[1])
    return value if isinstance(value, str) else None


def candidate_fields(record: object) -> list[str]:
    if not isinstance(record, dict):
        return []
    fields = [f for f in ("Title", "Description") if isinstance(record.get(f), str) and record[f].strip()]
    products = record.get("Products") if isinstance(record.get("Products"), list) else []
    for index, product in enumerate(products[:1000]):
        for name in ("Name", "Description", "Model"):
            if isinstance(product, dict) and isinstance(product.get(name), str) and product[name].strip():
                fields.append(f"Products[{index}].{name}")
    return fields


def _is_alnum(text: str, index: int) -> bool:
    return 0 <= index < len(text) and bool(re.match(r"[A-Za-z0-9]", text[index]))


def _sentence_bounds(text: str, start: int, end: int) -> tuple[int, int]:
    begin = 0
    for match in re.finditer(r"[.!?](?=\s)|\n", text[:start]):
        at = match.start()
        if match.group(0) == "." and ABBREVIATION.search(text[max(0, at - 6):at]):
            continue
        begin = at + 1
    finish = len(text)
    for match in re.finditer(r"[.!?](?=\s|$)|\n", text[end:]):
        at = end + match.start()
        if match.group(0) == "." and ABBREVIATION.search(text[max(0, at - 6):at]):
            continue
        finish = at
        break
    return begin, finish


def _keywords(text: str, begin: int, finish: int) -> list[tuple[int, int, str | None]]:
    piece = text[begin:finish]
    found: list[tuple[int, int, str | None]] = []
    for label, pattern in LABEL_PATTERNS:
        found.extend((begin + m.start(), begin + m.end(), label) for m in pattern.finditer(piece))
    found.extend((begin + m.start(), begin + m.end(), None) for m in NEGATIVE.finditer(piece))
    return found


def _anchor(text: str, start: int, end: int) -> str:
    begin, finish = _sentence_bounds(text, start, end)
    found = _keywords(text, max(begin, start - MAX_ANCHOR_BEFORE), min(finish, end + MAX_ANCHOR_AFTER))
    before = sorted((k for k in found if k[1] <= start), key=lambda k: (-k[1], k[0]))
    if before:
        tied = [k for k in before if k[1] == before[0][1]]
        if not any(k[2] is None for k in tied):
            return before[0][2]  # type: ignore[return-value]
        product = next((k for k in before if k[2] is not None), None)
        words_since_negative = len(re.findall(r"[A-Za-z0-9]+", text[before[0][1]:start]))
        range_endpoint = bool(RANGE_NEIGHBOUR_BEFORE.search(text[max(0, start - 12):start]) or RANGE_NEIGHBOUR_AFTER.search(text[end:end + 12]))
        if product and words_since_negative > NEGATIVE_NEAR_WORDS and not range_endpoint:
            return product[2]  # type: ignore[return-value]
        return "non_product_label"
    after = sorted((k for k in found if k[0] >= end and (k[2] is None or AFTER_LABEL.search(text[k[0]:k[1]]))), key=lambda k: k[0])
    if not after:
        return "no_product_label"
    return after[0][2] or "non_product_label"


def _is_year_or_date(value: str, text: str, end: int) -> bool:
    if any(p.match(value) for p in CALENDAR):
        return True
    if not re.fullmatch(r"(?:19|20)\d\d", value, re.ASCII):
        return False
    before = text[max(0, end - len(value) - 60):end - len(value)]
    return not LISTED.search(before) or bool(re.search(r"\byears?\s*$", before, _F))


def _shape_rejection(value: str, text: str, end: int) -> str | None:
    if not SHAPE.match(value) or value.count(" ") > 2 or not re.search(r"[0-9]", value) or len(model_key(value)) < 3:
        return "bad_shape"
    if _is_year_or_date(value, text, end):
        return "year_or_date"
    if re.fullmatch(r"\(?\d{3}\)?[ .-]?\d{3}[ .-]\d{4}", value, re.ASCII) or re.fullmatch(r"1-\d{3}-\d{3}-\d{4}", value, re.ASCII):
        return "phone"
    if MEASURE.match(value) or re.fullmatch(r"\d{1,3}(?:,\d{3})+", value, re.ASCII) or (re.fullmatch(r"\d+(?:\.\d+)?", value, re.ASCII) and UNIT_AFTER.match(text[end:])):
        return "measurement"
    digits = re.sub(r"[ -]", "", value)
    if digits.isdigit() and digits.isascii() and len(digits) in (8, 12, 13, 14) and gs1_check_digit_valid(digits):
        return "barcode"
    return None


def decide(text: str, value: str, field: str) -> Decision:
    if not FIELD.match(field):
        return Decision(False, "field_not_allowed")
    if not value or value != value.strip():
        return Decision(False, "bad_shape")
    first_rejection: str | None = None
    occurred = False
    at = text.find(value)
    while at != -1:
        end = at + len(value)
        if not (_is_alnum(text, at - 1) or _is_alnum(text, end)):
            occurred = True
            shape = _shape_rejection(value, text, end)
            if shape:
                return Decision(False, shape)
            label = "model" if field.endswith(".Model") else _anchor(text, at, end)
            if label in IDENTIFIER_LABELS:
                return Decision(True, start=at, end=end, key=model_key(value), label=label)
            first_rejection = first_rejection or label
        at = text.find(value, at + 1)
    if not occurred:
        return Decision(False, "not_in_source")
    return Decision(False, first_rejection or "no_product_label")


def decide_in_record(record: object, value: str, claimed_field: str) -> Decision:
    """Mirror of decideIdentifierInRecord: the field claim is a hint; the field where the value passes is recorded."""
    if not FIELD.match(claimed_field):
        return Decision(False, "field_not_allowed", field=claimed_field)
    order = [claimed_field] + [f for f in candidate_fields(record) if f != claimed_field]
    first_rejection: Decision | None = None
    for name in order:
        text = candidate_field_text(record, name)
        if text is None:
            continue
        decision = decide(text, value, name)
        if decision.ok:
            return Decision(True, start=decision.start, end=decision.end, key=decision.key, label=decision.label, field=name)
        if decision.reason != "not_in_source" and first_rejection is None:
            first_rejection = Decision(False, decision.reason, field=name)
    return first_rejection or Decision(False, "not_in_source", field=claimed_field)
