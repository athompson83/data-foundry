# Health Canada consumer-product recalls: open-data index (OGL-Canada), assessed 2026-09-27.
# Population: every "Consumer product safety" record in HCRSAMOpenData.json; seeded sample of 40 for per-record checks.
import json, random, re, collections
recs = json.load(open('hc_open.json'))
cp = [r for r in recs if r['Organization'] == 'Consumer product safety']
JOINT = re.compile(r'joint recall with.{0,300}?(?:Consumer Product Safety Commission|CPSC)', re.I | re.S)
print('index records', len(recs), 'consumer product safety', len(cp))
print('last updated range', min(r['Last updated'] for r in cp), max(r['Last updated'] for r in cp))
print('archived', collections.Counter(r['Archived'] for r in cp).most_common())
for field in ('Title', 'URL', 'Product', 'Issue', 'Category', 'What you should do'):
    print('non-empty', field, sum(1 for r in cp if (r[field] or '').strip()))
print('joint CPSC marker', sum(1 for r in cp if JOINT.search(r['What you should do'] or '')))
print('categories', collections.Counter(r['Category'] for r in cp).most_common(10))
print('issues', collections.Counter(r['Issue'] for r in cp).most_common(10))
print('unique NID', len({r['NID'] for r in cp}), 'unique URL', len({r['URL'].lower().rstrip('/') for r in cp}))
random.seed(20260927)
sample = sorted(random.sample(cp, 40), key=lambda r: int(r['NID']))
for r in sample:
    print(r['NID'], r['Last updated'], repr(r['Issue']), repr(r['Category']), 'product' if (r['Product'] or '').strip() else '-', 'joint' if JOINT.search(r['What you should do'] or '') else '-', r['Title'][:70])
