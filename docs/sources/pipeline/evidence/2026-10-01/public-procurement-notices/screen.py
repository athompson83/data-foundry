#!/usr/bin/env python3
"""Screen public-procurement-notices members (2026-10-01). Polite (<2 req/s), anonymous, no keys.
Usage: python3 screen.py [workdir]   writes results.json next to this file."""
import csv, collections, html, json, os, re, sys, time, urllib.request
UA = 'data-foundry-scout (data@mail.proviciency.com)'
W = sys.argv[1] if len(sys.argv) > 1 else '/tmp/procurement-screen'
os.makedirs(W, exist_ok=True)
csv.field_size_limit(10**9)
R = {}

def get(u, body=None, ct=None, binary=False):
    h = {'User-Agent': UA}
    if ct: h['Content-Type'] = ct
    for i in range(3):
        try:
            r = urllib.request.urlopen(urllib.request.Request(u, body, h), timeout=120)
            d = r.read(); time.sleep(0.6)
            return (r.status, d)
        except urllib.error.HTTPError as e:
            return (e.code, b'')
        except Exception:
            time.sleep(3)
    return (0, b'')

def status(u): return get(u)[0]
def text(u):
    t = get(u)[1].decode('utf8', 'replace')
    t = re.sub(r'<script.*?</script>|<style.*?</style>', '', t, flags=re.S)
    return re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', ' ', t)))
def tedq(b): return json.loads(get('https://api.ted.europa.eu/v3/notices/search', json.dumps(b).encode(), 'application/json')[1])

# 1. reachability
R['reachability'] = {u: status(u) for u in [
    'https://open.canada.ca/data/api/action/package_show?id=6abd20d4-7a1c-4b38-baa2-9525d0bb2fd2',
    'https://canadabuys.canada.ca/opendata/pub/2026-2027-TenderNotice-AvisAppelOffres.csv',
    'https://canadabuys.canada.ca/opendata/pub/2026-2027-awardNotice-avisAttribution.csv',
    'https://www.contractsfinder.service.gov.uk/Published/Notices/OCDS/Search?limit=1',
    'https://www.find-tender.service.gov.uk/api/1.0/ocdsReleasePackages?limit=1',
    'https://api.usaspending.gov/api/v2/references/toptier_agencies/',
    'https://api.sam.gov/prod/opportunities/v2/search?limit=1',
    'https://ted.europa.eu/en/legal-notice']}
# 2. terms quotes (fetched text; the quote must appear verbatim)
Q = {'ogl-canada': ('https://open.canada.ca/en/open-government-licence-canada', 'including for commercial purposes'),
     'ogl-canada-exempt': ('https://open.canada.ca/en/open-government-licence-canada', 'This licence does not grant you any right to use: Personal Information'),
     'cf-terms': ('https://www.contractsfinder.service.gov.uk/Home/TermsAndConditions', 'You can reproduce content published on Contracts Finder and Find a Tender under the OGL as long as you follow the licence'),
     'fts-terms': ('https://www.find-tender.service.gov.uk/Content/TermsAndConditions', 'All content is available under the Open Government Licence v3.0'),
     'ted-api': ('https://docs.ted.europa.eu/api/latest/search.html', 'does not require authentication, making it openly accessible to any system or user'),
     'usaspending-readme': ('https://raw.githubusercontent.com/fedspendingtransparency/usaspending-api/master/README.md', 'all federal spending data which is open source and provided to the public as part of the DATA Act')}
R['terms_found'] = {k: (k2 in text(u)) for k, (u, k2) in Q.items()}
# 3. CanadaBuys
tr = list(csv.DictReader(open(f'{W}/cb_t.csv', encoding='utf-8-sig', newline=''))) if os.path.exists(f'{W}/cb_t.csv') else None
if tr is None:
    for n, u in [('cb_t.csv', '2026-2027-TenderNotice-AvisAppelOffres.csv'), ('cb_a.csv', '2026-2027-awardNotice-avisAttribution.csv')]:
        open(f'{W}/{n}', 'wb').write(get('https://canadabuys.canada.ca/opendata/pub/' + u)[1])
    tr = list(csv.DictReader(open(f'{W}/cb_t.csv', encoding='utf-8-sig', newline='')))
ar = list(csv.DictReader(open(f'{W}/cb_a.csv', encoding='utf-8-sig', newline='')))
fill = lambda rows, k: round(sum(1 for r in rows if r[k].strip()) / len(rows), 3)
ts = {r['solicitationNumber-numeroSollicitation'] for r in tr}; as_ = {r['solicitationNumber-numeroSollicitation'] for r in ar}
R['canadabuys'] = {'tender_rows_2026_27': len(tr), 'award_rows_2026_27': len(ar),
    'tender_pub_range': [min(r['publicationDate-datePublication'] for r in tr), max(r['publicationDate-datePublication'] for r in tr)],
    'award_pub_range': [min(r['publicationDate-datePublication'] for r in ar), max(r['publicationDate-datePublication'] for r in ar)],
    'unspsc_fill_tender': fill(tr, 'unspsc'), 'unspsc_fill_award': fill(ar, 'unspsc'),
    'desc_fill_tender': fill(tr, 'tenderDescription-descriptionAppelOffres-eng'), 'desc_fill_award': fill(ar, 'awardDescription-descriptionAttribution-eng'),
    'solicitation_ids_tender': len(ts), 'solicitation_ids_award': len(as_), 'award_solicitation_found_in_tenders': len(as_ & ts)}
# 4. UK OCDS (Contracts Finder + Find a Tender): 20 pages x 100 award releases each
def pages(u, n=20):
    out = []
    while u and n:
        d = json.loads(get(u)[1]); out += d['releases']; u = d.get('links', {}).get('next'); n -= 1
    return out
cf = pages('https://www.contractsfinder.service.gov.uk/Published/Notices/OCDS/Search?stages=award&publishedFrom=2026-01-01&publishedTo=2026-09-30&limit=100')
fts = pages('https://www.find-tender.service.gov.uk/api/1.0/ocdsReleasePackages?stages=award&limit=100&updatedFrom=2026-01-01T00:00:00&updatedTo=2026-09-30T00:00:00')
def coh(rels):
    s = collections.defaultdict(set)
    for r in rels:
        for p in r.get('parties', []):
            if 'supplier' in p.get('roles', []):
                for i in [p.get('identifier', {})] + p.get('additionalIdentifiers', []):
                    if i.get('scheme') == 'GB-COH' and i.get('id'): s[i['id'].strip().zfill(8)].add(r['ocid'])
    return s
cfs, ftss = coh(cf), coh(fts)
dr = lambda x: [min(r['date'] for r in x), max(r['date'] for r in x)]
desc = lambda x: round(sum(1 for r in x if (r.get('tender', {}).get('description') or '').strip()) / len(x), 3)
R['contracts_finder'] = {'award_releases_sampled': len(cf), 'date_range': dr(cf), 'description_fill': desc(cf), 'distinct_gb_coh_suppliers': len(cfs)}
R['find_a_tender'] = {'award_releases_sampled': len(fts), 'date_range': dr(fts), 'description_fill': desc(fts), 'distinct_gb_coh_suppliers': len(ftss)}
R['cf_fts_ocid_overlap'] = len({r['ocid'] for r in cf} & {r['ocid'] for r in fts}); R['cf_fts_shared_supplier_ids'] = len(set(cfs) & set(ftss))
# 5. TED
F = ["publication-number", "notice-type", "publication-date", "notice-title", "description-proc", "description-lot", "buyer-name", "buyer-identifier", "winner-name", "winner-identifier", "winner-country", "tender-value", "classification-cpv", "procedure-identifier"]
ted = []
for p in range(1, 11):
    d = tedq({"query": "winner-country=GBR AND publication-date>=20260101", "fields": F, "page": p, "limit": 100}); ted += d['notices']
    if p == 1: tot_gb = d['totalNoticeCount']
R['ted'] = {'total_notices_all_time': tedq({"query": "publication-date>=20000101", "fields": ["publication-number"], "page": 1, "limit": 1})['totalNoticeCount'],
    'notices_since_2026-09-25': tedq({"query": "publication-date>=20260925", "fields": ["publication-number"], "page": 1, "limit": 1})['totalNoticeCount'],
    'winner_country_GBR_since_2026-01-01': tot_gb, 'sampled': len(ted),
    'newest': max(n['publication-date'] for n in ted)}
ids = collections.defaultdict(list)
for n in ted:
    for i in n.get('winner-identifier') or []:
        i = i.strip()
        if re.fullmatch(r'(\d{8}|[A-Z]{2}\d{6})', i): ids[i].append(n['publication-number'])
m_cf, m_f = set(ids) & set(cfs), set(ids) & set(ftss)
R['link_gb_coh'] = {'ted_distinct_gb_coh_shaped_winner_ids': len(ids), 'matched_in_contracts_finder': sorted(m_cf), 'matched_in_find_a_tender': sorted(m_f),
    'matched_distinct': len(m_cf | m_f), 'matched_ted_notices': sorted({x for i in m_cf | m_f for x in ids[i]})}
# CAN -> CN within TED (procedure-identifier)
can = tedq({"query": "notice-type=can-standard AND publication-date>=20260920", "fields": F, "page": 1, "limit": 25})['notices']
hit = sum(1 for n in can if n.get('procedure-identifier') and tedq({"query": "procedure-identifier=%s AND notice-type=cn-standard" % n['procedure-identifier'], "fields": ["publication-number"], "page": 1, "limit": 1})['totalNoticeCount'] > 0)
R['ted_can_to_cn_by_procedure_identifier'] = [hit, len(can)]
# 6. USAspending
b = {"filters": {"award_type_codes": ["A", "B", "C", "D"], "time_period": [{"start_date": "2026-09-01", "end_date": "2026-09-30"}]}, "fields": ["Award ID", "Recipient Name", "Recipient UEI", "Description", "Award Amount", "Awarding Agency", "NAICS", "PSC"], "page": 1, "limit": 50}
u = json.loads(get('https://api.usaspending.gov/api/v2/search/spending_by_award/', json.dumps(b).encode(), 'application/json')[1])
R['usaspending'] = {'rows_sampled': len(u['results']), 'contracts_in_sept_2026': json.loads(get('https://api.usaspending.gov/api/v2/search/spending_by_award_count/', json.dumps({"filters": b['filters']}).encode(), 'application/json')[1])['results']['contracts'],
    'uei_fill': round(sum(1 for r in u['results'] if r.get('Recipient UEI')) / len(u['results']), 2), 'last_updated': json.loads(get('https://api.usaspending.gov/api/v2/awards/last_updated/')[1])}
json.dump(R, open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'results.json'), 'w'), indent=1)
print(json.dumps(R)[:1500])
