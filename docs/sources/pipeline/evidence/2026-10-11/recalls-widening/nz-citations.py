"""Does New Zealand Product Safety (MBIE) cite CPSC or Health Canada notices? Pages the recalls listing and fetches detail pages.
Run: python3 -I nz-citations.py. Open pages, declared UA."""
import re, json, subprocess, concurrent.futures as cf
UA = 'data-foundry-scout/1.0 (data@mail.proviciency.com)'
def get(u):
    return subprocess.run(['curl', '-g', '-sS', '-L', '-m', '60', '-A', UA, u], capture_output=True).stdout.decode('utf-8', 'replace')
first = get('https://www.productsafety.govt.nz/recalls')
nxt = sorted(set(re.findall(r'href="([^"]*recalls[^"]*(?:start|page)=\d+[^"]*)"', first)))
total = re.search(r'([\d,]+)\s+(?:recalls|results)', first)
links = []
for p in range(0, 400, 20):  # listing pages are offset by 20 via ?start=
    h = get(f'https://www.productsafety.govt.nz/recalls?start={p}')
    ls = re.findall(r'href="(/recalls/[^"#?]+)"', h)
    new = [l for l in ls if l not in links]
    if not new: break
    links += new
links = links[:200]
def one(l):
    h = get('https://www.productsafety.govt.nz' + l)
    return {'path': l, 'cites_cpsc': bool(re.search(r'cpsc\.gov', h)), 'cites_health_canada': bool(re.search(r'recalls-rappels\.canada\.ca|healthycanadians', h)),
            'mentions_gtin_or_barcode': bool(re.search(r'\b(?:[Bb]arcode|GTIN|EAN-?13|UPC)\b', h)), 'chars': len(h)}
with cf.ThreadPoolExecutor(8) as ex: rows = list(ex.map(one, links))
out = {'listing_total_text': total.group(0) if total else None, 'next_links_seen': nxt[:3], 'pages_fetched': len(rows),
       'cite_cpsc': sum(r['cites_cpsc'] for r in rows), 'cite_health_canada': sum(r['cites_health_canada'] for r in rows),
       'mention_barcode': sum(r['mentions_gtin_or_barcode'] for r in rows), 'rows': rows}
json.dump(out, open('nz-citations.json', 'w'), indent=1); print({k: v for k, v in out.items() if k != 'rows'})
