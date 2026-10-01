#!/usr/bin/env python3
"""Screen the regulatory-enforcement-actions data type (2026-10-01 scout round).

Members measured live: FDA warning letters, EPA ECHO enforcement cases (judicial/criminal/admin counts, case
reports), SEC litigation releases, CFPB enforcement actions, FTC cases and proceedings, UK CMA cases (gov.uk
search API). Politeness: <=2 req/s, FTC robots.txt Crawl-delay 5 honoured, no keys, no login.

Usage: python3 screen.py [cache_dir]   (writes results.json next to this file; raw responses go to cache_dir)
"""
import hashlib, html, json, os, random, re, sys, time, urllib.request, urllib.error
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = sys.argv[1] if len(sys.argv) > 1 else '/tmp/rea-cache'
os.makedirs(CACHE, exist_ok=True)
UA = 'data-foundry-scout (data@mail.proviciency.com)'
LAST = defaultdict(float)
GAP = {'www.ftc.gov': 5.2}  # FTC robots.txt: Crawl-delay: 5
random.seed(20261001)


def fetch(url, retries=3):
    """GET with cache, per-host delay, retry on 503. Returns (status, text)."""
    key = os.path.join(CACHE, hashlib.sha1(url.encode()).hexdigest())
    if os.path.exists(key):
        return 200, open(key, encoding='utf-8').read()
    host = url.split('/')[2]
    status, body = 0, ''
    for attempt in range(retries):
        wait = GAP.get(host, 0.55) - (time.time() - LAST[host])
        if wait > 0:
            time.sleep(wait)
        LAST[host] = time.time()
        try:
            req = urllib.request.Request(url, headers={'User-Agent': UA})
            with urllib.request.urlopen(req, timeout=60) as r:
                status, body = r.status, r.read().decode('utf-8', 'replace')
        except urllib.error.HTTPError as e:
            status, body = e.code, ''
        except Exception as e:  # network
            status, body = 0, ''
        if status == 200 and '<title>503' not in body[:300]:
            open(key, 'w', encoding='utf-8').write(body)
            return 200, body
        time.sleep(2 + attempt * 2)
    return status, body


def text_of(h):
    h = re.sub(r'<script.*?</script>|<style.*?</style>', ' ', h, flags=re.S)
    return html.unescape(re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', ' ', h))).strip()


SUFFIX = re.compile(r'\b(incorporated|inc|llc|l l c|lp|llp|ltd|limited|corp|corporation|co|company|plc|the|na|n a|holdings?|group)\b')


def norm(n):
    n = html.unescape(n or '').lower().replace('&', ' and ')
    n = re.sub(r"\(.*?\)", ' ', n)
    n = re.sub(r"[^a-z0-9 ]", ' ', n)
    n = SUFFIX.sub(' ', n)
    return re.sub(r'\s+', ' ', n).strip()


COURT = re.compile(r'\b(\d{1,2}):(\d{2})-(cv|cr|mc|mj|md|ap)-0*(\d{1,6})', re.I)


def courtnos(s):
    return {f'{m.group(1)}:{m.group(2)}-{m.group(3).lower()}-{int(m.group(4))}' for m in COURT.finditer(s or '')}


R = {'run_date': '2026-10-01', 'members': {}, 'linkage': {}}

# ------------------------------------------------------------------ FDA warning letters
fda = {}
rows, total = [], None
for start in range(0, 4000, 1000):
    st, b = fetch(f'https://www.fda.gov/datatables/views/ajax?length=1000&start={start}&view_name=warning_letter_solr_index&view_display_id=warning_letter_solr_block')
    if st != 200:
        break
    d = json.loads(b)
    total = d['recordsTotal']
    rows += d['data']
    if len(d['data']) < 1000:
        break
fda_recs = []
for r in rows:
    m = re.search(r'href="([^"]+)">(.*?)</a>', r[2], re.S)
    posted = re.search(r'datetime="(\d{4}-\d\d-\d\d)', r[0])
    issued = re.search(r'datetime="(\d{4}-\d\d-\d\d)', r[1])
    fda_recs.append({'url': 'https://www.fda.gov' + m.group(1), 'name': html.unescape(m.group(2)), 'posted': posted and posted.group(1),
                     'issued': issued and issued.group(1), 'office': r[3], 'subject': text_of(r[4])})
fda['records_total'] = total
fda['rows_fetched'] = len(fda_recs)
fda['newest_posted'] = max(x['posted'] for x in fda_recs if x['posted'])
fda['oldest_issued'] = min(x['issued'] for x in fda_recs if x['issued'])
fda['posted_last_30d'] = sum(1 for x in fda_recs if x['posted'] and x['posted'] >= '2026-09-01')
sample = fda_recs[:12] + random.sample(fda_recs[12:], 14)
fda_samples = []
for x in sample:
    st, b = fetch(x['url'])
    t = text_of(b)
    i = t.find('WARNING LETTER')
    body = t[i:] if i >= 0 else t
    j = body.find('Sincerely')
    body = body[: j + 300] if j > 0 else body
    fda_samples.append({'url': x['url'], 'name': x['name'], 'status': st, 'issued': x['issued'], 'office': x['office'], 'subject': x['subject'][:90],
                        'text_chars': len(body), 'cms': (re.search(r'CMS\s*#\s*(\d+)', t) or [None, None])[1],
                        'fei_mentions': len(re.findall(r'\bFEI\b', t)), 'court_cites': sorted(courtnos(t)),
                        'cites_cfr_or_usc': len(re.findall(r'\b21 (?:C\.F\.R\.|U\.S\.C\.|CFR)', t)),
                        'has_recipient_email': bool(re.search(r'[\w.]+@[\w.]+\.\w+', t)), 'redactions_b4': t.count('(b)(4)')})
fda['sample_n'] = len(fda_samples)
fda['sample_ok'] = sum(1 for s in fda_samples if s['status'] == 200 and s['text_chars'] > 1500)
fda['median_text_chars'] = sorted(s['text_chars'] for s in fda_samples)[len(fda_samples) // 2]
fda['sample_with_fei'] = sum(1 for s in fda_samples if s['fei_mentions'])
fda['sample_with_cms'] = sum(1 for s in fda_samples if s['cms'])
fda['sample_with_recipient_email'] = sum(1 for s in fda_samples if s['has_recipient_email'])
fda['sample_with_court_cites'] = sum(1 for s in fda_samples if s['court_cites'])
fda['samples'] = [{k: s[k] for k in ('url', 'name', 'issued', 'text_chars', 'cms', 'fei_mentions')} for s in fda_samples[:26]]
st, b = fetch('https://www.fda.gov/about-fda/about-website/website-policies')
fda['terms_page_status'] = st
fda['terms_quote_found'] = 'are not copyrighted. They are in the public domain and may be republished, reprinted and otherwise used freely by anyone without the need to obtain permission from FDA' in text_of(b)
R['members']['fda-warning-letters'] = fda

# ------------------------------------------------------------------ EPA ECHO
echo = {}
B = 'https://echodata.epa.gov/echo/case_rest_services'
st, b = fetch(f'{B}.get_cases?output=JSON&p_case_category=JDC')
q = json.loads(b)['Results']
echo['get_cases_status'] = st
echo['jdc_rows'] = q['JDCRows']; echo['fedpen_rows'] = q['FedPenRows']; echo['criminal_rows'] = q['CriminalRows']
qid = q['QueryID']
st, b = fetch(f'{B}.get_cases?output=JSON')
allq = json.loads(b)['Results']
echo['all_cases_rows_unfiltered_get_case_info'] = None
st2, b2 = fetch(f'{B}.get_case_info?output=JSON')
try:
    info = json.loads(b2)['Results']
    echo['all_cases_total'] = info['QueryRows']; echo['all_civil_judicial'] = info['JDCRows']; echo['all_administrative'] = info['AFRRows']; echo['all_criminal'] = info['CriminalRows']
except Exception:
    pass
cases = []
pages = (int(q['QueryRows']) + 999) // 1000
for p in range(1, pages + 1):
    st, b = fetch(f'{B}.get_qid?qid={qid}&pageno={p}&output=JSON')
    if st == 200:
        cases += json.loads(b)['Results']['Cases']
echo['judicial_listing_fetched'] = len(cases)
jdc = [c for c in cases if c['CaseCategoryCode'] == 'JDC' or c.get('CivilCriminalIndicator') == 'CI']


def yr(d):
    return (d or '')[-4:]


echo['listing_newest_filed'] = max((c['DateFiled'] for c in cases if c['DateFiled']), key=lambda d: d[-4:] + d[:2] + d[3:5])
echo['listing_with_court_docket'] = sum(1 for c in cases if c['CourtDocketNumber'])
echo['listing_with_doj_docket'] = sum(1 for c in cases if c['DOJDocketNmbr'])
echo['listing_with_fed_penalty_gt0'] = sum(1 for c in cases if c['FedPenalty'] and c['FedPenalty'] not in ('$0.00', '$0'))
recent = sorted([c for c in cases if c['DateFiled']], key=lambda c: (yr(c['DateFiled']), c['DateFiled'][:2], c['DateFiled'][3:5]), reverse=True)
echo['by_year_filed_2020_2026'] = {y: sum(1 for c in cases if yr(c['DateFiled']) == y) for y in map(str, range(2020, 2027))}
echo_samples = []
for c in recent[:30]:
    st, b = fetch(f"{B}.get_case_report?p_id={c['CaseNumber']}&output=JSON")
    if st != 200:
        continue
    try:
        r = json.loads(b)['Results']
    except Exception:
        continue
    ci = r.get('CaseInformation') or {}
    echo_samples.append({'case': c['CaseNumber'], 'name': c['CaseName'], 'filed': c['DateFiled'], 'law': c['PrimaryLaw'],
                         'court_docket': ci.get('RegionalDocketNumber') or c['CourtDocketNumber'], 'doj_docket': ci.get('DOJDocketNumber'),
                         'summary_chars': len(ci.get('CaseSummary') or ''), 'violations_chars': len(ci.get('Violations') or ''),
                         'frs_ids': [f['FRSNumber'] for f in (r.get('Facilities') or []) if f.get('FRSNumber')],
                         'defendants': [d['DefendantName'] for d in (r.get('Defendants') or [])], 'fed_penalty': ci.get('TotalFederalPenalty'),
                         'milestones': len(r.get('CaseMilestones') or []), 'citations': len(r.get('Citations') or [])})
echo['sample_n'] = len(echo_samples)
echo['sample_with_summary'] = sum(1 for s in echo_samples if s['summary_chars'] > 100)
echo['sample_with_frs'] = sum(1 for s in echo_samples if s['frs_ids'])
echo['sample_with_defendants'] = sum(1 for s in echo_samples if s['defendants'])
echo['sample_with_court_docket'] = sum(1 for s in echo_samples if s['court_docket'])
echo['samples'] = echo_samples
st, b = fetch('https://www.epa.gov/web-policies-and-procedures/epa-disclaimers')
tt = text_of(b)
echo['terms_page_status'] = st
echo['terms_quote_1'] = 'These documents may be freely distributed and used for non-commercial, scientific and educational purposes. Commercial use of the documents available from the EPA websites may be protected under the U.S. and Foreign Copyright Laws.' in tt
R['members']['epa-echo-enforcement-cases'] = echo

# ------------------------------------------------------------------ SEC litigation releases
sec = {}
sec_list = []
page = 0
while True:
    st, b = fetch(f'https://www.sec.gov/enforcement-litigation/litigation-releases?page={page}')
    if st != 200:
        break
    rr = re.findall(r"<time datetime=\"([^\"]+)\"[^>]*>.*?release-view__respondents'><a href='([^']+)'>(.*?)</a>.*?(LR-\d+)", b, re.S)
    if not rr:
        break
    for d, href, nm, no in rr:
        sec_list.append({'date': d[:10], 'url': 'https://www.sec.gov' + href, 'respondents': text_of(nm), 'no': no})
    page += 1
    if page > 140:
        break
sec['listing_pages'] = page
sec['releases_listed'] = len(sec_list)
sec['newest'] = max(x['date'] for x in sec_list)
sec['oldest'] = min(x['date'] for x in sec_list)
sec['last_30d'] = sum(1 for x in sec_list if x['date'] >= '2026-09-01')
sec_samples = []
for x in sec_list[:14] + random.sample(sec_list[14:], 14):
    st, b = fetch(x['url'])
    t = text_of(b)
    i = t.find(x['no'])
    body = t[i:] if i >= 0 else t
    j = body.find('Return to Top')
    body = body[:j] if j > 0 else body[:20000]
    sec_samples.append({'url': x['url'], 'no': x['no'], 'respondents': x['respondents'], 'date': x['date'], 'status': st, 'text_chars': len(body),
                        'court_cites': sorted(courtnos(body)), 'civil_action_phrase': bool(re.search(r'Civil Action No|Case No\.|Case Number', body)),
                        'cik_mentions': len(re.findall(r'\bCIK\b', body)), 'body_head': body[:200]})
sec['sample_n'] = len(sec_samples)
sec['sample_ok'] = sum(1 for s in sec_samples if s['status'] == 200 and s['text_chars'] > 800)
sec['sample_with_court_number'] = sum(1 for s in sec_samples if s['court_cites'])
sec['sample_with_civil_action_phrase'] = sum(1 for s in sec_samples if s['civil_action_phrase'])
sec['sample_with_cik'] = sum(1 for s in sec_samples if s['cik_mentions'])
sec['median_text_chars'] = sorted(s['text_chars'] for s in sec_samples)[len(sec_samples) // 2]
sec['samples'] = [{k: s[k] for k in ('url', 'no', 'respondents', 'date', 'text_chars', 'court_cites')} for s in sec_samples]
st, b = fetch('https://www.sec.gov/about/privacy-information')
sec['terms_page_status'] = st
sec['terms_quote_found'] = 'Information presented on sec.gov is considered public information and may be copied or further distributed by users of the web site without the SEC’s permission.' in text_of(b)
R['members']['sec-litigation-releases'] = sec

# ------------------------------------------------------------------ CFPB enforcement actions
cf = {}
cf_list = []
page = 1
while page < 40:
    st, b = fetch('https://www.consumerfinance.gov/enforcement/actions/' + (f'?page={page}' if page > 1 else ''))
    if st != 200:
        break
    links = []
    for l in re.findall(r'href="(/enforcement/actions/[^"/]+/)"', b):
        if l not in links and 'definitions' not in l:
            links.append(l)
    new = [l for l in links if l not in [x['url'] for x in cf_list]]
    if not new:
        break
    cf_list += [{'url': l} for l in new]
    page += 1
cf['listing_pages'] = page - 1
cf['actions_listed'] = len(cf_list)
cf_samples = []
for x in cf_list[:6] + random.sample(cf_list[6:], min(20, len(cf_list) - 6)):
    st, b = fetch('https://www.consumerfinance.gov' + x['url'])
    t = text_of(b)
    title = re.search(r'Enforcement Actions\s+(.*?)\s+(?:On |In |The )', t)
    dock = re.search(r'Docket number\s+([A-Za-z0-9:\-]+)', t)
    filed = re.search(r'Initial filing date\s+([A-Z]{3} \d+, \d{4})', t)
    forum = re.search(r'Forum\s+(.*?)\s+Docket number', t)
    body_i = t.find('Enforcement Actions')
    cf_samples.append({'url': 'https://www.consumerfinance.gov' + x['url'], 'status': st, 'title': title and title.group(1)[:80], 'docket': dock and dock.group(1),
                       'filed': filed and filed.group(1), 'forum': forum and forum.group(1), 'text_chars': len(t) - body_i,
                       'court_cites': sorted(courtnos(t))})
cf['sample_n'] = len(cf_samples)
cf['sample_with_docket'] = sum(1 for s in cf_samples if s['docket'])
cf['sample_with_court_cite'] = sum(1 for s in cf_samples if s['court_cites'])
fd = [s['filed'] for s in cf_samples if s['filed']]
cf['sample_filed_dates'] = sorted(fd)[-3:]
cf['samples'] = cf_samples
st, b = fetch('https://www.consumerfinance.gov/enforcement/actions/feed/')
cf['rss_status'] = st
cf['rss_last_build'] = (re.search(r'<lastBuildDate>(.*?)</lastBuildDate>', b) or [None, None])[1]
cf['rss_items'] = b.count('<item>')
cf['rss_newest_item'] = (re.search(r'<pubDate>(.*?)</pubDate>', b) or [None, None])[1]
st, b = fetch('https://www.consumerfinance.gov/privacy/website-privacy-policy/')
cf['terms_page_status'] = st
cf['terms_quote_found'] = 'Information created by the CFPB is in the public domain and you may reproduce, publish, or otherwise use it without the Bureau’s permission.' in text_of(b)
R['members']['cfpb-enforcement-actions'] = cf

# ------------------------------------------------------------------ FTC cases and proceedings
ftc = {}
ftc_list = []
for page in range(0, 12):
    st, b = fetch(f'https://www.ftc.gov/legal-library/browse/cases-proceedings?items_per_page=20&sort_by=field_date&page={page}')
    if st != 200:
        break
    for l, t in re.findall(r'<a href="(/legal-library/browse/cases-proceedings/[^"]+)"[^>]*>(.*?)</a>', b, re.S):
        t = text_of(t)
        if t and l not in [x['url'] for x in ftc_list] and 'adjudicative-proceedings' not in l:
            ftc_list.append({'url': l, 'title': t})
ftc['listing_pages_fetched'] = page + 1
ftc['titles_collected'] = len(ftc_list)
lastpage = 0
st, b = fetch('https://www.ftc.gov/legal-library/browse/cases-proceedings?items_per_page=20&sort_by=field_date&page=0')
pp = [int(x) for x in re.findall(r'page=(\d+)', b)]
ftc['last_page_index'] = max(pp) if pp else None
ftc['approx_cases_total'] = (max(pp) + 1) * 20 if pp else None
ftc_samples = []
for x in ftc_list[:24]:
    st, b = fetch('https://www.ftc.gov' + x['url'])
    t = text_of(b)
    i = t.find('Case Summary')
    k = t.find('Case Timeline')
    summ = t[i:k] if i >= 0 and k > i else ''
    ftc_samples.append({'url': 'https://www.ftc.gov' + x['url'], 'title': x['title'], 'status': st, 'summary_chars': len(summ),
                        'court_cites': sorted(courtnos(t)), 'has_docket_phrase': bool(re.search(r'Docket No|File No|Case No', t)),
                        'last_updated': (re.search(r'Last Updated\s+([A-Za-z]+ \d+, \d{4})', t) or [None, None])[1],
                        'file_number_in_slug': bool(re.search(r'/\d{3}-?\d{4}', x['url']))})
ftc['sample_n'] = len(ftc_samples)
ftc['sample_with_summary'] = sum(1 for s in ftc_samples if s['summary_chars'] > 100)
ftc['sample_with_court_cite'] = sum(1 for s in ftc_samples if s['court_cites'])
ftc['sample_with_docket_phrase'] = sum(1 for s in ftc_samples if s['has_docket_phrase'])
ftc['samples'] = ftc_samples
st, b = fetch('https://www.ftc.gov/policy-notices/website-policy')
ftc['terms_page_status'] = st
ftc['terms_quote_found'] = 'Most material on the FTC’s website is considered work of the United States Government, meaning that the material is in the public domain and is not subject to copyright restrictions' in text_of(b)
R['members']['ftc-cases-proceedings'] = ftc

# ------------------------------------------------------------------ UK CMA cases (gov.uk search + content API)
cma = {}
st, b = fetch('https://www.gov.uk/api/search.json?filter_format=cma_case&count=100&order=-public_timestamp&fields=title,public_timestamp,case_type,case_state,market_sector,outcome_type,opened_date,closed_date')
d = json.loads(b)
cma['search_status'] = st
cma['total'] = d['total']
cma['newest'] = d['results'][0]['public_timestamp']
cma['by_case_type_in_newest_100'] = {}
for r in d['results']:
    for t in r.get('case_type') or ['?']:
        cma['by_case_type_in_newest_100'][t] = cma['by_case_type_in_newest_100'].get(t, 0) + 1
enf = [r for r in d['results'] if set(r.get('case_type') or []) & {'ca98-and-civil-cartels', 'consumer-enforcement', 'criminal-cartels', 'markets', 'sau-referral'}]
cma_samples = []
for r in (enf or d['results'])[:25]:
    st, b = fetch('https://www.gov.uk/api/content' + r['_id'])
    try:
        j = json.loads(b)
    except Exception:
        continue
    det = j.get('details') or {}
    body = text_of(det.get('body') or '')
    cma_samples.append({'url': 'https://www.gov.uk' + r['_id'], 'title': r['title'], 'case_type': r.get('case_type'), 'status': st,
                        'metadata_keys': sorted((det.get('metadata') or {}).keys()), 'body_chars': len(body), 'docs': len(det.get('documents') or [])})
cma['sample_n'] = len(cma_samples)
cma['sample_with_body'] = sum(1 for s in cma_samples if s['body_chars'] > 50)
cma['samples'] = cma_samples
st, b = fetch('https://www.gov.uk/help/terms-conditions')
tt = text_of(b)
cma['terms_page_status'] = st
m = re.search(r'[^.]*Open Government Licence[^.]*\.', tt)
cma['terms_sentence'] = m.group(0).strip()[:300] if m else None
R['members']['uk-cma-cases'] = cma

# ------------------------------------------------------------------ reachability of parked UK members
reach = {}
for k, u in {'fca-final-notices': 'https://www.fca.org.uk/news/search-results?n_search_term=final%20notice',
             'fca-terms': 'https://www.fca.org.uk/terms-and-conditions',
             'ico-enforcement': 'https://ico.org.uk/action-weve-taken/enforcement/',
             'ico-terms': 'https://ico.org.uk/global/terms-and-conditions-for-the-use-of-the-ico-website/'}.items():
    st, b = fetch(u)
    t = text_of(b)
    m = re.search(r'[^.]*(?:Open Government Licence|copyright|reproduce)[^.]*\.', t, re.I)
    reach[k] = {'status': st, 'chars': len(t), 'terms_sentence': m.group(0).strip()[:300] if m else None}
R['members']['uk-fca-ico-reachability'] = reach

# ------------------------------------------------------------------ linkage
nm = {'fda': defaultdict(list), 'echo': defaultdict(list), 'sec': defaultdict(list), 'cfpb': defaultdict(list), 'ftc': defaultdict(list)}
for x in fda_recs:
    nm['fda'][norm(x['name'])].append(x['url'])
for c in cases:
    nm['echo'][norm(re.sub(r'\(Permit.*', '', c['CaseName'] or ''))].append(c['CaseNumber'])
for x in sec_list:
    for part in re.split(r',| and (?=[A-Z])|;', x['respondents']):
        if part.strip():
            nm['sec'][norm(part)].append(x['url'])
for x in cf_list:
    nm['cfpb'][norm(x['url'].strip('/').split('/')[-1].replace('-', ' '))].append(x['url'])
for x in ftc_list:
    nm['ftc'][norm(x['title'])].append(x['url'])
L = R['linkage']
L['name_sets'] = {k: len(v) for k, v in nm.items()}
pairs = {}
for a in nm:
    for b in nm:
        if a < b:
            hit = sorted(k for k in nm[a] if k and len(k) > 4 and k in nm[b])
            pairs[f'{a}|{b}'] = {'matched_normalised_names': len(hit), 'of_smaller_set': min(len(nm[a]), len(nm[b])),
                                 'examples': [(k, nm[a][k][0], nm[b][k][0]) for k in hit[:40]]}
L['name_pairs'] = pairs

# declared: court case numbers cited in prose / dockets, across independent publishers
court = defaultdict(lambda: defaultdict(set))
for c in cases:
    for n in courtnos(c['CourtDocketNumber']) | courtnos(c['DOJDocketNmbr']):
        court[n]['echo'].add(c['CaseNumber'])
for s in echo_samples:
    for n in courtnos(s['court_docket']) | courtnos(s['doj_docket']):
        court[n]['echo'].add(s['case'])
for s in sec_samples:
    for n in s['court_cites']:
        court[n]['sec'].add(s['url'])
for s in cf_samples:
    for n in s['court_cites']:
        court[n]['cfpb'].add(s['url'])
for s in ftc_samples:
    for n in s['court_cites']:
        court[n]['ftc'].add(s['url'])
for s in fda_samples:
    for n in s['court_cites']:
        court[n]['fda'].add(s['url'])
L['court_numbers_seen'] = {k: sum(1 for v in court.values() if k in v) for k in nm}
L['court_numbers_shared_by_2plus_publishers'] = [{n: {k: sorted(v)[:2] for k, v in d.items()}} for n, d in court.items() if len(d) >= 2][:30]
L['echo_judicial_docket_numbers_in_court_format'] = sum(1 for n, d in court.items() if 'echo' in d)

# Hand check (done by reading both records' names, SEC release headings and ECHO case names; no identifier is shared, so
# "correct" = the two records name the same distinctive legal entity; it is an entity link, never an event merge).
L['hand_check'] = {
    'fda|sec': {'checked': 4, 'correct': 4, 'note': 'Cardinal Health (LR-20212), MiMedx (LR-24678), United Health Products (LR-25413), Vivera Pharmaceuticals (LR-25538): SEC release caption names the same company as the FDA letter recipient'},
    'cfpb|sec': {'checked': 3, 'correct': 3, 'note': 'Bank of America N.A. (LR-22772), ITT Educational Services (LR-24188), Regions Bank (LR-21682)'},
    'echo|fda': {'checked': 5, 'correct': 5, 'note': 'Eli Lilly and Company, Hanover Foods Corporation, Kroger, Linemaster Switch Corporation, Stavis Seafoods; distinctive full names, no shared identifier'},
    'echo|sec': {'checked': 31, 'correct': 19, 'note': '19 distinctive corporate names (ADM, Bristol-Myers Squibb, Chevron, Collins & Aikman, Dow, GE, GM, Granite Construction, Guardian Industries, IBM, Monsanto, National Presto, Navistar, Safety-Kleen, Terex, Transocean, Tyco, Tyson, W.R. Grace); 12 not confirmable: 4 personal names (Edward Miller, Timothy Smith, Robert Pierce, William J. McCarthy), 5 generic fragments (Brown, Enterprises, Milan, New Castle, Saint James) and 3 small-company names with no corroboration (American Energy, New Energy, Trans Energy)'},
}
L['declared_court_number_join'] = {'matched': 0, 'note': 'ECHO court docket numbers (911 in the 13,652 listed cases match a federal docket pattern) vs docket numbers cited in 28 SEC releases, 26 CFPB actions, 24 FTC cases and 26 FDA letters: 0 numbers shared by two publishers. Regex only catches the D:YY-cv-N form, so SEC releases written as "07 CV 6709" are undercounted.'}
json.dump(R, open(os.path.join(HERE, 'results.json'), 'w'), indent=1, default=list)
print('done', {k: (v.get('records_total') or v.get('releases_listed') or v.get('actions_listed') or v.get('total') or v.get('judicial_listing_fetched') or v.get('titles_collected')) for k, v in R['members'].items() if isinstance(v, dict)})
