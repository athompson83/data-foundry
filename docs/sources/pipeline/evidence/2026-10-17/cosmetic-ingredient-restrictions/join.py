"""Measure cosmetic-ingredient-restrictions linkage on the declared CAS registry number across independent publishers:
  EU CosIng annex exports (European Commission, structured CSV, Annex II prohibited, III-VI restricted/allowed lists)
  Health Canada Cosmetic Ingredient Hotlist (canada.ca HTML tables; prohibited + restricted, conditions are free text)
  UK retained Regulation (EC) 1223/2009 annexes (legislation.gov.uk XML, OGL v3)
  FDA prohibited/restricted page (prose; probed for CAS only).
Whole lists are small (hundreds to ~1,500 entries), so the join is measured on every row, not a sample.
Run: python3 -I join.py (writes join.json next to this script). Open endpoints, declared UA, <= 2 req/s per host."""
import csv, io, json, os, re, subprocess, time, datetime, html
from html.parser import HTMLParser
UA = 'data-foundry-scout/1.0 (data@mail.proviciency.com)'
HERE = os.path.dirname(os.path.abspath(__file__))
def get(u):
    time.sleep(0.6)
    p = subprocess.run(['curl', '-g', '-sS', '-L', '-m', '120', '-A', UA, '-w', '\n%{http_code}', u], capture_output=True)
    body, _, code = p.stdout.decode('utf-8', 'replace').rpartition('\n')
    return int(code or 0), body
CAS = re.compile(r'(?<![\d-])(\d{2,7})-(\d{2})-(\d)(?![\d-])')
def cas_set(text):
    out = set()
    for a, b, c in CAS.findall(text):
        d = a + b
        if (sum((i + 1) * int(x) for i, x in enumerate(reversed(d))) % 10) == int(c): out.add(f'{a}-{b}-{c}')   # checksum-valid only
    return out
out = {'run_at': datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds')}
# ---- CosIng
cos = {}; cos_rows = {}
for a in ['II', 'III', 'IV', 'V', 'VI']:
    code, body = get(f'https://api.tech.ec.europa.eu/cosing20/1.0/api/annexes/{a}/export-csv')
    lines = body.split('\n')
    upd = re.search(r'Last update: (\S+)"', body); crt = re.search(r'File creation date: (\S+)"', body)
    # header row begins with "Reference Number" (annex II) or "Reference Number" after a group row
    i = next(k for k, l in enumerate(lines) if l.startswith('"Reference Number"') or l.startswith('"Ref'))
    rows = list(csv.DictReader(io.StringIO('\n'.join(lines[i:]))))
    cs = set(); with_cas = 0; byrow = {}
    for r in rows:
        c = cas_set(r.get('CAS Number', ''))
        if c: with_cas += 1
        cs |= c
        for x in c: byrow.setdefault(x, r)
    cos[a] = cs; cos_rows[a] = byrow
    out.setdefault('cosing', {})[f'annex_{a}'] = {'http': code, 'bytes': len(body), 'rows': len(rows), 'rows_with_valid_cas': with_cas, 'distinct_cas': len(cs),
        'last_update': upd.group(1) if upd else None, 'file_creation_date': crt.group(1) if crt else None,
        'columns': list(rows[0].keys()) if rows else None, 'free_text_condition_rows': sum(1 for r in rows if (r.get('Wording of conditions of use and warnings') or r.get('Other') or '').strip())}
# ---- Health Canada Hotlist
class T(HTMLParser):
    def __init__(s): super().__init__(); s.tables = []; s.cur = None; s.row = None; s.cell = None
    def handle_starttag(s, t, a):
        if t == 'table': s.cur = []
        elif t == 'tr' and s.cur is not None: s.row = []
        elif t in ('td', 'th') and s.row is not None: s.cell = []
        elif t == 'li' and s.cell is not None: s.cell.append(' ; ')
    def handle_endtag(s, t):
        if t in ('td', 'th') and s.cell is not None: s.row.append(re.sub(r'\s+', ' ', ''.join(s.cell)).strip()); s.cell = None
        elif t == 'tr' and s.row is not None:
            if s.row: s.cur.append(s.row)
            s.row = None
        elif t == 'table': s.tables.append(s.cur); s.cur = None
    def handle_data(s, d):
        if s.cell is not None: s.cell.append(d)
    def handle_entityref(s, n): s.handle_data(html.unescape(f'&{n};'))
    def handle_charref(s, n): s.handle_data(html.unescape(f'&#{n};'))
hl = 'https://www.canada.ca/en/health-canada/services/consumer-product-safety/cosmetics/cosmetic-ingredient-hotlist-prohibited-restricted-ingredients/hotlist.html'
code, page = get(hl); p = T(); p.feed(page)
proh = [r for r in p.tables[0] if len(r) >= 2 and r[0] != 'Ingredient']; rest = [r for r in p.tables[1] if len(r) >= 5 and r[0] not in ('Ingredient', 'Chemical')]
hc_proh = set().union(*[cas_set(r[1]) for r in proh]); hc_rest = set().union(*[cas_set(r[1]) for r in rest])
mod = re.search(r'name="dcterms.modified"[^>]*content="([0-9-]{10})"|dcterms.modified" content="([0-9-]{10})"', page)
out['health_canada_hotlist'] = {'http': code, 'bytes': len(page), 'prohibited_rows': len(proh), 'prohibited_rows_with_cas': sum(1 for r in proh if cas_set(r[1])), 'prohibited_distinct_cas': len(hc_proh),
   'restricted_rows': len(rest), 'restricted_rows_with_cas': sum(1 for r in rest if cas_set(r[1])), 'restricted_distinct_cas': len(hc_rest),
   'restricted_rows_with_conditions_text': sum(1 for r in rest if r[3].strip() or r[4].strip()), 'date_modified': (mod.group(1) or mod.group(2)) if mod else None, 'columns_restricted': p.tables[1][0] if p.tables[1] else None}
# ---- joins Hotlist <-> CosIng (every CAS)
cos_proh = cos['II']; cos_rest = cos['III'] | cos['IV'] | cos['V'] | cos['VI']; cos_all = cos_proh | cos_rest
def j(name, a, b, c): out.setdefault('joins', {})[name] = {'matched': len(a & b), 'total': len(a), 'also_in_other_list': sorted(a & c)[:20], 'also_in_other_list_count': len(a & c), 'matched_sample_cas': sorted(a & b)[:10]}
j('hotlist_prohibited_in_cosing_annexII', hc_proh, cos_proh, cos_rest)
j('hotlist_restricted_in_cosing_annexIII', hc_rest, cos['III'], cos_proh)
j('hotlist_all_in_cosing_all_annexes', hc_proh | hc_rest, cos_all, set())
j('cosing_annexII_in_hotlist_prohibited', cos_proh, hc_proh, hc_rest)
j('cosing_annexIII_in_hotlist_restricted', cos['III'], hc_rest, hc_proh)
# hand check: 8 restricted CAS in both lists, compare the stated maximum concentration text
both = sorted(hc_rest & cos['III'])[:200]; step = max(1, len(both) // 8); chk = []
for c in both[::step][:8]:
    h = next(r for r in rest if c in cas_set(r[1])); e = cos_rows['III'][c]
    chk.append({'cas': c, 'hotlist_chemical': h[0], 'hotlist_max_concentration': h[4][:160], 'cosing_name': e.get('Chemical name / INN', '')[:100], 'cosing_max_concentration': (e.get('Maximum concentration in ready for use preparation') or '')[:160]})
out['hand_check_restricted_pairs'] = chk
# ---- UK retained legislation (OGL)
uk = {}
for a in ['II', 'III', 'IV', 'V', 'VI']:
    code, x = get(f'https://www.legislation.gov.uk/eur/2009/1223/annex/{a}/data.xml')
    c = cas_set(re.sub(r'<[^>]+>', ' ', x)); uk[a] = c
    out.setdefault('uk_legislation', {})[f'annex_{a}'] = {'http': code, 'bytes': len(x), 'distinct_cas': len(c), 'in_cosing_same_annex': len(c & cos[a]), 'in_cosing_any_annex': len(c & cos_all)}
out['uk_legislation']['uk_annexII_vs_cosing_annexII'] = {'matched': len(uk['II'] & cos['II']), 'total': len(uk['II'])}
ukr = set().union(uk['III'], uk['IV'], uk['V'], uk['VI']); out['uk_legislation']['uk_restricted_lists_vs_cosing_III_to_VI'] = {'matched': len(ukr & cos_rest), 'total': len(ukr)}
c, x = get('https://www.legislation.gov.uk/eur/2009/1223/annex/II/data.xml')
out['uk_legislation']['annex_II_xml_http'] = c
out['uk_legislation']['annex_II_dc_modified'] = re.findall(r'<dc:modified>([^<]+)</dc:modified>', x)[:1] or re.findall(r'Modified="([^"]+)"', x)[:2]
c, x = get('https://www.legislation.gov.uk/eur/2009/1223/contents')
out['uk_legislation']['contents_http'] = c
out['uk_legislation']['contents_revised_labels'] = re.findall(r'Revised \d\d/\d\d/\d{4}', x)[:6]
# ---- FDA probe (prose; any CAS?)
c, x = get('https://www.fda.gov/cosmetics/cosmetics-laws-regulations/prohibited-restricted-ingredients-cosmetics')
t = re.sub(r'<[^>]+>', ' ', x)
out['fda_prohibited_restricted_page'] = {'http': c, 'bytes': len(x), 'valid_cas_found': len(cas_set(t)), 'names_probe': {n: (n.lower() in t.lower()) for n in ['bithionol', 'chloroform', 'mercury', 'vinyl chloride', 'methylene chloride', 'hexachlorophene', 'zirconium', 'prohibited cattle materials']}}
json.dump(out, open(os.path.join(HERE, 'join.json'), 'w'), indent=1, ensure_ascii=False)
print(json.dumps({k: v for k, v in out.items() if k != 'hand_check_restricted_pairs'}, indent=1, ensure_ascii=False)[:6000])
