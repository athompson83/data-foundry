"""Re-measure the UK OPSS -> EU Safety Gate GTIN join with GS1 check-digit validation.

Input: intl_recs.json (the parsed international notices behind xmatch.py), archived in R2 at
data-foundry-raw-artifacts/research/pipeline/2026-09-27-composites/intl_recs.json (see gtin_validated.txt
for bytes and SHA-256). Only codes whose GS1 check digit is valid count as GTINs.
"""
import json
from collections import defaultdict

import datetime

WINDOW_DAYS = 365  # as in xmatch.py


def gs1_valid(code: str) -> bool:
    digits = code.lstrip('0').zfill(13) if len(code) >= 12 else code
    for candidate in {digits, code}:
        if candidate.isdigit() and len(candidate) in (8, 12, 13, 14):
            body, check = candidate[:-1], int(candidate[-1])
            total = sum(int(ch) * (3 if i % 2 == 0 else 1) for i, ch in enumerate(reversed(body)))
            if (10 - total % 10) % 10 == check:
                return True
    return False


def day(s: str) -> datetime.date:
    return datetime.date.fromisoformat(s)


recs = json.load(open('intl_recs.json'))
uk = [r for r in recs if r['src'] == 'uk']  # xmatch.py: only home categories were fetched for the UK
eu = [r for r in recs if r['src'] == 'eu']
lo = min(r['date'] for r in eu if r['date']); hi = max(r['date'] for r in eu if r['date'])
index = defaultdict(list)
for r in eu:
    for g in r['gtins']:
        index[g].append(r)
den = [r for r in uk if (r['models'] or r['gtins']) and r['date'] and lo <= r['date'] <= hi]


def gtin_matches(r, validated):
    out = []
    for g in r['gtins']:
        if validated and not gs1_valid(g):
            continue
        for b in index.get(g, []):
            if b['date'] and abs((day(b['date']) - day(r['date'])).days) <= WINDOW_DAYS:
                out.append((g, b['id']))
    return out


raw = [r for r in den if gtin_matches(r, False)]
valid = [r for r in den if gtin_matches(r, True)]
failing = sorted({g for r in raw for g, _ in gtin_matches(r, False) if not gs1_valid(g)})
print(f'UK home cats -> EU Safety Gate (window {lo}..{hi}): denominator {len(den)}')
print(f'exact code match, as screened (no check-digit validation): {len(raw)}')
print(f'exact GTIN match with a valid GS1 check digit: {len(valid)}')
print(f'matched codes failing the check digit: {len(failing)} {failing}')
print('UK notices matched by a valid GTIN:', sorted(r['id'] for r in valid))
