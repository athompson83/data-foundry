"""ENERGY STAR Model Index and UPC Codes: deterministic field hit rates over the full archived snapshot, and 25
evenly spaced sample rows (every 71,875th by pd_id) with what the deterministic rules read from them.
Run from the extracted archive root. Prints a stable text report."""
import csv
import re

csv.field_size_limit(10**9)
ROOT = 'equipment-energystar-model-index'
MARKETS = {'United States': 'US', 'Canada': 'CA', 'Japan': 'JP', 'Taiwan': 'TW', 'Switzerland': 'CH'}


def gtin_ok(code):
    if not re.fullmatch(r'\d{12,14}', code):
        return False
    body, check = code[:-1], int(code[-1])
    total = sum(int(d) * (3 if i % 2 == 0 else 1) for i, d in enumerate(reversed(body)))
    return (10 - total % 10) % 10 == check


def codes(text):
    return re.findall(r'(?<!\d)\d{8,14}(?!\d)', re.sub(r'(?<=\d)[ -](?=\d)', '', text or ''))


extra = {}
upc_rows = 0
with open('equipment-energystar-model-index/upc-codes.csv', newline='', encoding='utf-8') as handle:
    for row in csv.DictReader(handle):
        upc_rows += 1
        if row['upc']:
            extra.setdefault(row['pd_id'], []).append(row['upc'])

rows = []
with open('equipment-energystar-model-index/model-index.csv', newline='', encoding='utf-8') as handle:
    rows = list(csv.DictReader(handle))
rows.sort(key=lambda row: int(row['pd_id']))
n = len(rows)
hits = {name: 0 for name in ['brand', 'model', 'pattern', 'gtin', 'rejected_upc', 'markets', 'canada', 'date_certified', 'date_available']}
for row in rows:
    found = codes(', '.join([row['upc']] + extra.get(row['pd_id'], [])))
    markets = [MARKETS.get(part.strip()) for part in row['markets'].split(',') if part.strip()]
    hits['brand'] += bool(row['brand_name'].strip())
    hits['model'] += bool(re.sub(r'[^A-Za-z0-9]', '', row['model_number']))
    hits['pattern'] += bool(re.search(r'[*?#]', row['model_number']))
    hits['gtin'] += any(gtin_ok(code) for code in found)
    hits['rejected_upc'] += any(not gtin_ok(code) for code in found)
    hits['markets'] += any(markets)
    hits['canada'] += 'CA' in markets
    hits['date_certified'] += bool(re.fullmatch(r'\d{4}-\d{2}-\d{2}(T00:00:00(\.000)?)?', row['date_certified']))
    hits['date_available'] += bool(re.fullmatch(r'\d{4}-\d{2}-\d{2}(T00:00:00(\.000)?)?', row['date_available_on_market']))
print(f'model index rows: {n}; distinct pd_id: {len({row["pd_id"] for row in rows})}; upc-codes rows: {upc_rows}')
for name, count in hits.items():
    print(f'{name}: {count}/{n}')
print('sample (every 71875th row by pd_id):')
for i in range(25):
    row = rows[i * 71875]
    found = codes(', '.join([row['upc']] + extra.get(row['pd_id'], [])))
    gtins = sorted(code.zfill(14) for code in found if gtin_ok(code))
    print(f"{row['pd_id']}\t{row['product_category']}\t{row['brand_name']}\t{row['model_number']}\tpattern={bool(re.search(r'[*?#]', row['model_number']))}\tgtins={','.join(gtins) or '-'}\tcertified={row['date_certified'][:10]}")
