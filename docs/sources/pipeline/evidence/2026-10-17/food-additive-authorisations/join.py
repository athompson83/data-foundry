"""Measure joins for the food-additive-authorisations screening (2026-10-17).
Members: FDA Substances Added to Food (CSV), EU Food and Feed Information Portal food-additive Union list (JSON API),
21 CFR text (govinfo eCFR bulk XML), EFSA OpenFoodTox 3.0 (Zenodo xlsx).
Joins: (A) FDA cited CFR sections -> sections present in eCFR XML; (A2) FDA CAS number -> the cited CFR section text names that CAS;
(B) FDA CAS -> OpenFoodTox CAS; (C) FDA substance name -> EU additive name (candidate join, hand-checked in hand_check.json).
Run: python3 -I join.py   (downloads ~46 MB once into a fresh temp dir; open endpoints, declared UA; <=2 req/s)."""
import json, re, csv, io, os, sys, time, zipfile, tempfile, subprocess, datetime, collections
from xml.etree import ElementTree as ET
UA = 'data-foundry-scout/1.0 (data@mail.proviciency.com)'
HERE = os.path.dirname(os.path.abspath(__file__))
TMP = tempfile.mkdtemp(prefix='faa-')
log = []
def get(url, name):
    p = os.path.join(TMP, name)
    r = subprocess.run(['curl', '-sS', '-L', '-m', '300', '-A', UA, '-o', p, '-w', '%{http_code} %{size_download}', url], capture_output=True, text=True)
    code, size = r.stdout.split()
    log.append({'url': url, 'http': int(code), 'bytes': int(size), 'at': datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds')})
    time.sleep(0.6)
    return p
# ---- FDA SATF
p = get('https://www.hfpappexternal.fda.gov/scripts/fdcc/cfc/XMLService.cfm?method=downloadxls&set=FoodSubstances', 'satf.csv')
t = open(p, encoding='utf-8', errors='replace').read()
last_updated = re.search(r'Last updated ([\d/]+)', t).group(1)
rows = list(csv.reader(io.StringIO(t[t.find('CAS Reg No'):])))
H, fda = rows[0], rows[1:]
regc = [j for j, x in enumerate(H) if x.startswith('Reg ') and x != 'Reg Administrative']
def cites(r): return sorted({re.search(r'\("([\d.]+[a-z]?)"\)', r[j]).group(1) for j in regc if re.search(r'\("([\d.]+)', r[j])})
fda_n = len(fda)
cas = lambda r: r[0].strip()
fda_cas = [r for r in fda if re.fullmatch(r'\d{2,7}-\d\d-\d', cas(r)) and not cas(r).startswith('977')]  # 977nnn-nn-n are FDA internal codes, not CAS
fda_cited = [r for r in fda if cites(r)]
all_cites = sorted({c for r in fda_cited for c in cites(r)})
# ---- eCFR (govinfo bulk)
p = get('https://www.govinfo.gov/bulkdata/ECFR/title-21/ECFR-title21.xml', 'ecfr21.xml')
x = open(p, encoding='utf-8', errors='replace').read()
amd = re.search(r'<AMDDATE>\s*([^<]+?)\s*</AMDDATE>', x).group(1)
sections = {}
for m in re.finditer(r'<DIV8 N="§ ([\d.]+[a-z]?)"[^>]*TYPE="SECTION">(.*?)</DIV8>', x, re.S):
    sections[m.group(1)] = re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', ' ', m.group(2)))
A_match = [c for c in all_cites if c in sections]
# A2: CAS named in the cited section's text (only rows with a 172/173/182/184 cite, real CAS)
A2_rows = [r for r in fda_cas if any(c.split('.')[0] in ('172', '173', '182', '184') for c in cites(r))]
A2 = [(cas(r), r[1].strip(), [c for c in cites(r) if c in sections and cas(r) in sections[c]]) for r in A2_rows]
# ---- OpenFoodTox
p = get('https://zenodo.org/api/records/19388272/files/OFT3.0%20export%20repository.xlsx/content', 'oft.xlsx')
NS = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
z = zipfile.ZipFile(p); ss = []
for ev, el in ET.iterparse(z.open('xl/sharedStrings.xml')):
    if el.tag == NS + 'si': ss.append(''.join(t_.text or '' for t_ in el.iter(NS + 't'))); el.clear()
def colidx(ref):
    n = 0
    for ch in re.match(r'[A-Z]+', ref).group(0): n = n * 26 + ord(ch) - 64
    return n - 1
def sheet(part):
    for ev, el in ET.iterparse(z.open(part)):
        if el.tag == NS + 'row':
            r = {}
            for c in el.iter(NS + 'c'):
                v = c.find(NS + 'v')
                if v is None: continue
                r[colidx(c.get('r'))] = ss[int(v.text)] if c.get('t') == 's' else v.text
            yield r; el.clear()
wb = ET.fromstring(z.read('xl/workbook.xml'))
refsub = next(i for i, s in enumerate(wb.iter(NS + 'sheet'), 1) if s.get('name') == 'REF_SUB')
it = sheet(f'xl/worksheets/sheet{refsub}.xml'); hdr = next(it)
ci = next(k for k, v in hdr.items() if v == 'Inventory.CASNumber'); ni = next(k for k, v in hdr.items() if v == 'ReferenceSubstanceName')
oft = {}; oft_rows = 0
for r in it:
    oft_rows += 1
    if r.get(ci): oft.setdefault(r[ci].strip(), r.get(ni))
B = [(cas(r), r[1].strip(), oft[cas(r)]) for r in fda_cas if cas(r) in oft]
# ---- EU
p = get('https://ec.europa.eu/food/food-feed-portal/backend/api/policy-items?foodDomain=fin&authorisationType=fad_auth', 'eu.json')
eu_raw = json.load(open(p))
def walk(n, out):
    out.setdefault(n['valueIdentifier'], []).append(n.get('value'))
    for c in n.get('childrenValues', []): walk(c, out)
    return out
eu = []
for it_ in eu_raw:
    f = walk(it_, {})
    if (f.get('policyItemType') or [None])[0] != 'substanceFAD': continue
    eu.append({'name': f['displayName'][0], 'e': (f.get('eNumber') or [None])[0], 'ins': (f.get('insNumber') or [None])[0],
               'restrictions': len(f.get('foodCategoryRestriction', [])), 'note_texts': len([v for v in f.get('foodCategoryRestrictionNoteText', []) if v])})
norm = lambda s: re.sub(r'[^a-z0-9]+', ' ', re.sub(r'&[a-z]+;', ' ', s.lower())).strip()
fda_names = collections.defaultdict(list)
for r in fda:
    fda_names[norm(r[1])].append(r)
C = []
for e in eu:
    for r in fda_names.get(norm(e['name']), []): C.append({'eu_name': e['name'], 'eu_e': e['e'], 'fda_substance': r[1].strip(), 'fda_cas': cas(r)})
hc_path = os.path.join(HERE, 'hand_check.json')
hc = json.load(open(hc_path)) if os.path.exists(hc_path) else None
out = {
 'run_at': datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds'), 'requests': log,
 'fda_satf': {'records': fda_n, 'last_updated': last_updated, 'with_real_cas_excl_977': len(fda_cas), 'with_977_internal_code': sum(1 for r in fda if cas(r).startswith('977')),
              'with_cfr_cite': len(fda_cited), 'distinct_cfr_sections_cited': len(all_cites)},
 'ecfr_title21': {'amended_through': amd, 'sections': len(sections)},
 'openfoodtox': {'ref_substances_rows': oft_rows, 'distinct_cas': len(oft)},
 'eu_union_list': {'substance_items': len(eu), 'with_e_number': sum(1 for e in eu if e['e']), 'with_ins_number': sum(1 for e in eu if e['ins']),
                   'items_with_footnote_text': sum(1 for e in eu if e['note_texts']), 'food_category_restrictions': sum(e['restrictions'] for e in eu)},
 'join_A_fda_cfr_cite_to_ecfr_section': {'matched': len(A_match), 'total': len(all_cites), 'unmatched': [c for c in all_cites if c not in sections][:40]},
 'join_A2_fda_cas_named_in_cited_cfr_section': {'matched': sum(1 for a in A2 if a[2]), 'total': len(A2), 'sample_unmatched': [a[:2] for a in A2 if not a[2]][:15]},
 'join_B_fda_cas_to_openfoodtox_cas': {'matched': len(B), 'total': len(fda_cas), 'sample_matched': B[:15]},
 'join_C_fda_name_to_eu_name_candidate': {'exact_normalised_name_pairs': len(C), 'eu_items_total': len(eu), 'pairs': C, 'hand_check': ({'checked': hc['checked'], 'correct': hc['correct']} if hc else None)},
}
json.dump(out, open(os.path.join(HERE, 'join.json'), 'w'), indent=1, ensure_ascii=False)
print({k: v for k, v in out.items() if k not in ('requests', 'join_C_fda_name_to_eu_name_candidate')})
print('C pairs', len(C))
